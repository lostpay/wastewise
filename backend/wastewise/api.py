# wastewise/api.py
import re
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from wastewise.config import get_settings
from wastewise.storage import DatasetStore
from wastewise.ingest import parse_sales_csv, summarize
from wastewise.pipeline import run_forecast, run_sourcing, run_rationale
from wastewise.models import AdjustedItem, POLine
from wastewise.adapters.base import FileCache
from wastewise.adapters.weather_openmeteo import OpenMeteoWeather
from wastewise.adapters.holidays import USHolidays
from wastewise.adapters.price_fred import FredWholesale
from wastewise.adapters.price_kroger import KrogerRetail
from wastewise.adapters.price_historical import (
    HistoricalPriceSource, FallbackWholesale, FallbackRetail)
from wastewise.agents.llm import LLMClient, format_status_banner


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Prove (or disprove) real inference at boot so a fallback-only run is never
    # mistaken for the real thing. See wastewise/check_llm.py for the same check
    # as a standalone command.
    s = get_settings()
    status = LLMClient(s.llm_base_url, s.llm_api_key, s.llm_model).ping()
    print(format_status_banner(status), file=sys.stderr, flush=True)
    if not status.live and s.llm_require_live:
        raise RuntimeError(
            "LLM_REQUIRE_LIVE is set but the LLM endpoint did not respond: "
            f"{status.detail}"
        )
    yield


app = FastAPI(title="WasteWise", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])


def get_deps() -> dict:
    s = get_settings()
    cache = FileCache(s.cache_dir)
    return {
        "store": DatasetStore(s.db_path),
        "weather": OpenMeteoWeather(cache),
        "holidays": USHolidays(),
        "wholesale": FredWholesale(s.fred_api_key, cache),
        "retail": KrogerRetail(s.kroger_client_id, s.kroger_client_secret, cache),
        "llm": LLMClient(s.llm_base_url, s.llm_api_key, s.llm_model),
    }


_LOCATION_RE = re.compile(r"^-?\d+(\.\d+)?,-?\d+(\.\d+)?$")


class _LocatedRequest(BaseModel):
    location: str = "40.7,-74.0"

    @field_validator("location")
    @classmethod
    def _valid_location(cls, v: str) -> str:
        # Google Maps and human paste habits produce "lat, lon" with a space
        # after the comma. Strip whitespace before the regex so we don't 422
        # on a value the regex would otherwise accept.
        v = v.replace(" ", "").strip()
        # location is interpolated into an outbound weather.gov URL path;
        # pin it to "lat,lon" so untrusted input can't reshape the request.
        if not _LOCATION_RE.match(v):
            raise ValueError("location must be 'lat,lon' (e.g. '40.7,-74.0')")
        return v


class ForecastRequest(_LocatedRequest):
    dataset_id: str
    # Number of consecutive days to forecast, starting the day after the
    # dataset's last date. Capped at 14: beyond ~16 days the weather source
    # (Open-Meteo) stops returning real forecasts and adjustments go neutral.
    horizon_days: int = Field(default=7, ge=1, le=14)
    # ISO-4217 code for the CSV's `price` column. Converts to USD before
    # computing waste_avoided_value so restaurants abroad don't see their
    # rupee/euro/yen prices printed with a "$" sign. Same field as
    # SourcingRequest; unknown codes pass through as-is.
    currency: str = "USD"


class SourcingItem(BaseModel):
    item: str
    qty: float


class SourcingRequest(_LocatedRequest):
    items: list[SourcingItem]
    dataset_id: str | None = None
    # ISO-4217 code for the historical `price` column in the uploaded CSV.
    # Non-USD values get converted to USD before being used as a benchmark
    # or displayed as a unit price. See wastewise/currency.py for supported
    # codes; unknown values pass through as-is.
    currency: str = "USD"


class RationaleRequest(BaseModel):
    items: list[AdjustedItem]
    lines: list[POLine]
    savings: float
    total: float


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload(file: UploadFile = File(...), deps: dict = Depends(get_deps)):
    try:
        text = (await file.read()).decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="file must be UTF-8 encoded CSV")
    try:
        records = parse_sales_csv(text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    ds_id = deps["store"].save(records)
    return {"dataset_id": ds_id, "summary": summarize(ds_id, records).model_dump(mode="json")}


@app.post("/forecast")
def forecast(req: ForecastRequest, deps: dict = Depends(get_deps)):
    try:
        records = deps["store"].load(req.dataset_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="dataset not found")
    return run_forecast(records, req.horizon_days, req.location,
                        deps["weather"], deps["holidays"], deps["llm"],
                        currency=req.currency)


@app.post("/sourcing")
def sourcing(req: SourcingRequest, deps: dict = Depends(get_deps)):
    wholesale, retail = deps["wholesale"], deps["retail"]
    # Items whose benchmark, if any, will come from the historical fallback --
    # i.e. items where the *primary* wholesale (FRED) has no answer. These are
    # the rows we exclude from the "savings vs. US retail average" total,
    # since comparing a locally-averaged benchmark to itself isn't a market
    # saving. Items FRED does cover (e.g. Eggs) stay in savings even when the
    # dataset also happens to include them.
    historical_items: set[str] = set()
    if req.dataset_id:
        try:
            records = deps["store"].load(req.dataset_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="dataset not found")
        historical = HistoricalPriceSource(records, currency=req.currency)
        historical_items = {
            i.item for i in req.items
            if wholesale.get_wholesale_price(i.item) is None
            and historical.get_wholesale_price(i.item) is not None
        }
        wholesale = FallbackWholesale(wholesale, historical)
        retail = FallbackRetail(retail, historical)
    return run_sourcing([i.model_dump() for i in req.items], req.location,
                        wholesale, retail, deps["llm"],
                        historical_items=historical_items)


@app.post("/rationale")
def rationale(req: RationaleRequest, deps: dict = Depends(get_deps)):
    return run_rationale(req.items, req.lines, req.savings, req.total, deps["llm"])
