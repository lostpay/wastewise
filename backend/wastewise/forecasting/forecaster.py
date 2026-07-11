# wastewise/forecasting/forecaster.py
import numpy as np
import pandas as pd
from xgboost import XGBRegressor
from wastewise.currency import to_usd
from wastewise.models import SalesRecord, ForecastItem, BacktestStats, HoldoutDay
from wastewise.forecasting.features import build_frame
from wastewise.forecasting.baseline import baseline_forecast

FEATURES = ["dow", "weekofyear", "month", "lag7", "roll7", "item_code", "is_holiday"]


def _train(df: pd.DataFrame) -> XGBRegressor:
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
                   holiday_dates: frozenset = frozenset(),
                   currency: str = "USD") -> tuple[list[ForecastItem], BacktestStats]:
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
    stats = _backtest(records, df, safety_frac, currency)
    return items, stats


def _mean_prices(records: list[SalesRecord], currency: str = "USD") -> dict[str, float]:
    # Convert once at ingest so downstream $-denominated aggregates
    # (waste_avoided_value) don't silently mix currencies.
    by_item: dict[str, list[float]] = {}
    for r in records:
        usd = to_usd(r.price, currency)
        if usd is not None:
            by_item.setdefault(r.item, []).append(usd)
    return {item: float(np.mean(v)) for item, v in by_item.items()}


def _backtest(records: list[SalesRecord], df: pd.DataFrame,
              safety_frac: float, currency: str = "USD") -> BacktestStats:
    """MAE improvement plus over-ordering avoided (model vs baseline policy,
    both buffered) over a 7-day holdout."""
    cutoff = df["date"].max() - pd.Timedelta(days=7)
    train_df = df[df["date"] <= cutoff]
    test_df = df[df["date"] > cutoff].dropna(subset=FEATURES)
    if len(train_df.dropna(subset=FEATURES)) < 20 or test_df.empty:
        return BacktestStats(delta=0.0, waste_avoided_units=0.0, waste_avoided_value=None)
    model = _train(train_df)
    prices = _mean_prices(records, currency)
    model_err, base_err = [], []
    over_model = over_base = 0.0
    value_model = value_base = 0.0
    any_priced = False
    # Per-day aggregates for the frontend "backtest replay" chart. Summed
    # across items so a single day is one point on the chart, not one per SKU.
    daily: dict[str, dict[str, float]] = {}
    for _, row in test_df.iterrows():
        yhat = float(model.predict(row[FEATURES].to_frame().T.astype(float))[0])
        actual = row["quantity"]
        baseline = float(row["lag7"])
        model_err.append(abs(yhat - actual))
        base_err.append(abs(baseline - actual))
        om = max(0.0, yhat * (1 + safety_frac) - actual)
        ob = max(0.0, baseline * (1 + safety_frac) - actual)
        over_model += om
        over_base += ob
        price = prices.get(row["item"])
        vm = vb = 0.0
        if price is not None:
            any_priced = True
            vm = om * price
            vb = ob * price
            value_model += vm
            value_base += vb
        # `date` is a pandas Timestamp; ISO-format for JSON serialization.
        d_key = row["date"].date().isoformat()
        bucket = daily.setdefault(d_key, {"actual": 0.0, "model": 0.0,
                                          "baseline": 0.0, "vm": 0.0,
                                          "vb": 0.0})
        bucket["actual"] += float(actual)
        bucket["model"] += yhat
        bucket["baseline"] += baseline
        bucket["vm"] += vm
        bucket["vb"] += vb
    m, b = float(np.mean(model_err)), float(np.mean(base_err))
    delta = 0.0 if b == 0 else float(np.clip((b - m) / b, 0.0, 1.0))
    units = round(max(0.0, over_base - over_model), 2)
    value = round(max(0.0, value_base - value_model), 2) if any_priced else None
    holdout_daily = [
        HoldoutDay(
            date=d,
            actual=round(v["actual"], 2),
            model=round(max(v["model"], 0.0), 2),
            baseline=round(max(v["baseline"], 0.0), 2),
            waste_model_value=round(v["vm"], 2) if any_priced else None,
            waste_baseline_value=round(v["vb"], 2) if any_priced else None,
        )
        for d, v in sorted(daily.items())
    ]
    return BacktestStats(delta=delta, waste_avoided_units=units,
                         waste_avoided_value=value,
                         holdout_daily=holdout_daily)
