# wastewise/api.py
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from wastewise.config import get_settings
from wastewise.storage import DatasetStore
from wastewise.ingest import parse_sales_csv, summarize
from wastewise.pipeline import run_forecast, run_sourcing
from wastewise.adapters.base import FileCache
from wastewise.adapters.weather_noaa import NOAAWeather
from wastewise.adapters.holidays import USHolidays
from wastewise.adapters.price_usda import USDAWholesale
from wastewise.adapters.price_kroger import KrogerRetail
from wastewise.agents.llm import LLMClient

app = FastAPI(title="WasteWise")
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


class ForecastRequest(BaseModel):
    dataset_id: str
    horizon: str = "week"
    location: str = "40.7,-74.0"


class SourcingRequest(BaseModel):
    items: list[dict]
    location: str = "40.7,-74.0"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload(file: UploadFile = File(...), deps: dict = Depends(get_deps)):
    text = (await file.read()).decode("utf-8")
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
    return run_sourcing(req.items, req.location, deps["wholesale"],
                        deps["retail"], deps["llm"])
