# wastewise/api.py
import re
import sys
from contextlib import asynccontextmanager
from typing import Literal
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from wastewise.config import get_settings
from wastewise.storage import DatasetStore
from wastewise.ingest import parse_sales_csv, summarize
from wastewise.pipeline import run_forecast, run_sourcing
from wastewise.adapters.base import FileCache
from wastewise.adapters.weather_noaa import NOAAWeather
from wastewise.adapters.holidays import USHolidays
from wastewise.adapters.price_usda import USDAWholesale
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
        "weather": NOAAWeather(cache),
        "holidays": USHolidays(),
        "wholesale": USDAWholesale(s.usda_api_key, cache),
        "retail": KrogerRetail(s.kroger_client_id, s.kroger_client_secret, cache),
        "llm": LLMClient(s.llm_base_url, s.llm_api_key, s.llm_model),
    }


_LOCATION_RE = re.compile(r"^-?\d+(\.\d+)?,-?\d+(\.\d+)?$")


class _LocatedRequest(BaseModel):
    location: str = "40.7,-74.0"

    @field_validator("location")
    @classmethod
    def _valid_location(cls, v: str) -> str:
        # location is interpolated into an outbound weather.gov URL path;
        # pin it to "lat,lon" so untrusted input can't reshape the request.
        if not _LOCATION_RE.match(v):
            raise ValueError("location must be 'lat,lon' (e.g. '40.7,-74.0')")
        return v


class ForecastRequest(_LocatedRequest):
    dataset_id: str
    horizon: Literal["day", "week"] = "week"


class SourcingItem(BaseModel):
    item: str
    qty: float


class SourcingRequest(_LocatedRequest):
    items: list[SourcingItem]
    dataset_id: str | None = None


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
    return run_forecast(records, req.horizon, req.location,
                        deps["weather"], deps["holidays"], deps["llm"])


@app.post("/sourcing")
def sourcing(req: SourcingRequest, deps: dict = Depends(get_deps)):
    wholesale, retail = deps["wholesale"], deps["retail"]
    if req.dataset_id:
        try:
            records = deps["store"].load(req.dataset_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="dataset not found")
        historical = HistoricalPriceSource(records)
        wholesale = FallbackWholesale(wholesale, historical)
        retail = FallbackRetail(retail, historical)
    return run_sourcing([i.model_dump() for i in req.items], req.location,
                        wholesale, retail, deps["llm"])
