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
    # Pre-LLM buffered recommendation (forecast + safety buffer). Lets the UI
    # show the AI's true delta instead of blaming the buffer on the AI.
    recommended: float = 0.0
    # Only set when the spoilage lookup for this item was live -- the UI must
    # never render a fabricated shelf life from the conservative fallback.
    spoilage_risk: str = ""
    shelf_life_days: int | None = None


class HoldoutDay(BaseModel):
    """One day of the 7-day backtest holdout, aggregated across items.

    `actual` is what really sold that day. `model` and `baseline` are the
    forecasters' raw predictions (no safety buffer). `waste_model_value`
    and `waste_baseline_value` are the dollar over-orderings both
    forecasters *would have* caused with the 15% safety buffer applied,
    for the "Waste avoided" chart; None when the CSV has no price column.
    """
    date: str
    actual: float
    model: float
    baseline: float
    waste_model_value: float | None = None
    waste_baseline_value: float | None = None


class BacktestStats(BaseModel):
    delta: float
    waste_avoided_units: float
    waste_avoided_value: float | None
    holdout_daily: list[HoldoutDay] = []


class AdjustmentSummary(BaseModel):
    n_up: int
    n_down: int
    n_unchanged: int
    net_delta_pct: float


class ForecastResponse(BaseModel):
    items: list[AdjustedItem]
    baseline_delta: float
    waste_avoided_units: float = 0.0
    waste_avoided_value: float | None = None
    adjustment: AdjustmentSummary | None = None
    holdout_daily: list[HoldoutDay] = []


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
    # True when the AI (or the deterministic price guard) says this price is
    # bad enough that the buyer should trim, substitute, or shop elsewhere.
    flagged: bool = False


class SourcingResponse(BaseModel):
    lines: list[POLine]
    total: float
    savings: float
    # Sum of (unit_price - US benchmark) * qty over lines priced above their
    # real benchmark -- the honest counterweight to `savings`.
    overpay: float = 0.0


class WeatherInfo(BaseModel):
    condition: str
    temp_c: float
    precipitation_mm: float


class SpoilageInfo(BaseModel):
    risk: str                       # "high" | "medium" | "low"
    shelf_life_days: int | None
    live: bool


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


class WhatIfResponse(BaseModel):
    lines: list[POLine]
    total: float
    reply: str
    live: bool
