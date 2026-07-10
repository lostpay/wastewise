import datetime
from pydantic import BaseModel


class SalesRecord(BaseModel):
    date: datetime.date
    item: str
    quantity: float
    price: float | None = None


class DatasetSummary(BaseModel):
    dataset_id: str
    n_rows: int
    items: list[str]
    start_date: datetime.date
    end_date: datetime.date


class ForecastItem(BaseModel):
    item: str
    forecast: float
    baseline: float
    safety_buffer: float
    recommended_purchase_qty: float
    daily: list[float] = []


class AdjustedItem(BaseModel):
    item: str
    forecast: float
    adjusted_qty: float
    reason: str
    live: bool
    daily: list[float] = []


class BacktestStats(BaseModel):
    delta: float
    waste_avoided_units: float
    waste_avoided_value: float | None


class ForecastResponse(BaseModel):
    items: list[AdjustedItem]
    baseline_delta: float
    waste_avoided_units: float = 0.0
    waste_avoided_value: float | None = None


class POLine(BaseModel):
    item: str
    qty: float
    supplier: str
    unit_price: float
    line_total: float
    note: str
    live: bool
    # US retail average (BLS via FRED) for this item in USD, or None when the
    # benchmark came from the historical fallback or no source at all.
    # `savings` at the response level only counts rows where this is not None.
    benchmark: float | None = None
    unit: str = ""


class SourcingResponse(BaseModel):
    lines: list[POLine]
    total: float
    savings: float


class WeatherInfo(BaseModel):
    condition: str
    temp_c: float
    precipitation_mm: float


class Holiday(BaseModel):
    date: datetime.date
    name: str


class SupplierPrice(BaseModel):
    supplier: str
    unit_price: float
    description: str = ""
    unit: str = ""


class RationaleResponse(BaseModel):
    paragraph: str
    live: bool
