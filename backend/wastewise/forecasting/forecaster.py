# wastewise/forecasting/forecaster.py
from typing import TYPE_CHECKING

import numpy as np
import pandas as pd
from wastewise.models import SalesRecord, ForecastItem, BacktestStats
from wastewise.forecasting.features import build_frame
from wastewise.forecasting.baseline import baseline_forecast

if TYPE_CHECKING:
    from xgboost import XGBRegressor

FEATURES = ["dow", "weekofyear", "month", "lag7", "roll7", "item_code", "is_holiday"]


def _train(df: pd.DataFrame) -> "XGBRegressor":
    # Imported lazily (rather than at module scope) so tests can monkeypatch
    # sys.modules["xgboost"] with a fake regressor without xgboost installed.
    from xgboost import XGBRegressor

    train = df.dropna(subset=FEATURES)
    model = XGBRegressor(n_estimators=120, max_depth=4, learning_rate=0.1,
                         random_state=0)
    model.fit(train[FEATURES], train["quantity"])
    return model


def _future_rows(df_item: pd.DataFrame, horizon_days: int,
                 holiday_dates: frozenset) -> pd.DataFrame:
    """Build feature rows for the next horizon_days for a single item."""
    last_date = df_item["date"].max()
    recent_mean = df_item["quantity"].tail(7).mean()
    item_code = int(df_item["item_code"].iloc[0])
    hist = {r["date"].date(): r["quantity"] for _, r in df_item.iterrows()}
    rows = []
    for i in range(1, horizon_days + 1):
        d = (last_date + pd.Timedelta(days=i))
        lag7_date = (d - pd.Timedelta(days=7)).date()
        rows.append({
            "dow": d.dayofweek,
            "weekofyear": int(d.isocalendar().week),
            "month": d.month,
            "lag7": hist.get(lag7_date, recent_mean),
            "roll7": recent_mean,
            "item_code": item_code,
            "is_holiday": 1 if d.date() in holiday_dates else 0,
        })
    return pd.DataFrame(rows)


def forecast_items(records: list[SalesRecord], horizon_days: int,
                   safety_frac: float = 0.15,
                   holiday_dates: frozenset = frozenset()) -> tuple[list[ForecastItem], BacktestStats]:
    df = build_frame(records, holiday_dates)
    model = _train(df)
    items: list[ForecastItem] = []
    for item, g in df.groupby("item"):
        future = _future_rows(g, horizon_days, holiday_dates)
        preds = model.predict(future[FEATURES])
        daily = [round(float(max(p, 0.0)), 2) for p in preds]
        pred = float(np.clip(preds.sum(), 0, None))
        base = baseline_forecast(records, item, horizon_days)
        buffer = safety_frac * pred
        items.append(ForecastItem(item=item, forecast=round(pred, 2),
                                  baseline=round(base, 2),
                                  safety_buffer=round(buffer, 2),
                                  recommended_purchase_qty=round(pred + buffer, 2),
                                  daily=daily))
    stats = _backtest(records, df, safety_frac)
    return items, stats


def _mean_prices(records: list[SalesRecord]) -> dict[str, float]:
    by_item: dict[str, list[float]] = {}
    for r in records:
        if r.price is not None:
            by_item.setdefault(r.item, []).append(r.price)
    return {item: float(np.mean(v)) for item, v in by_item.items()}


def _backtest(records: list[SalesRecord], df: pd.DataFrame,
              safety_frac: float) -> BacktestStats:
    """MAE improvement plus over-ordering avoided (model vs baseline policy,
    both buffered) over a 7-day holdout."""
    cutoff = df["date"].max() - pd.Timedelta(days=7)
    train_df = df[df["date"] <= cutoff]
    test_df = df[df["date"] > cutoff].dropna(subset=FEATURES)
    if len(train_df.dropna(subset=FEATURES)) < 20 or test_df.empty:
        return BacktestStats(delta=0.0, waste_avoided_units=0.0, waste_avoided_value=None)
    model = _train(train_df)
    prices = _mean_prices(records)
    model_err, base_err = [], []
    over_model = over_base = 0.0
    value_model = value_base = 0.0
    any_priced = False
    for _, row in test_df.iterrows():
        yhat = float(model.predict(row[FEATURES].to_frame().T.astype(float))[0])
        actual = row["quantity"]
        model_err.append(abs(yhat - actual))
        base_err.append(abs(row["lag7"] - actual))
        om = max(0.0, yhat * (1 + safety_frac) - actual)
        ob = max(0.0, row["lag7"] * (1 + safety_frac) - actual)
        over_model += om
        over_base += ob
        price = prices.get(row["item"])
        if price is not None:
            any_priced = True
            value_model += om * price
            value_base += ob * price
    m, b = float(np.mean(model_err)), float(np.mean(base_err))
    delta = 0.0 if b == 0 else float(np.clip((b - m) / b, 0.0, 1.0))
    units = round(max(0.0, over_base - over_model), 2)
    value = round(max(0.0, value_base - value_model), 2) if any_priced else None
    return BacktestStats(delta=delta, waste_avoided_units=units,
                         waste_avoided_value=value)
