# wastewise/forecasting/forecaster.py
import numpy as np
import pandas as pd
from xgboost import XGBRegressor
from wastewise.models import SalesRecord, ForecastItem
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
                   holiday_dates: frozenset = frozenset()) -> tuple[list[ForecastItem], float]:
    df = build_frame(records, holiday_dates)
    model = _train(df)
    items: list[ForecastItem] = []
    for item, g in df.groupby("item"):
        future = _future_rows(g, horizon_days, holiday_dates)
        pred = float(np.clip(model.predict(future[FEATURES]).sum(), 0, None))
        base = baseline_forecast(records, item, horizon_days)
        buffer = safety_frac * pred
        items.append(ForecastItem(item=item, forecast=round(pred, 2),
                                  baseline=round(base, 2),
                                  safety_buffer=round(buffer, 2),
                                  recommended_purchase_qty=round(pred + buffer, 2)))
    delta = _backtest_delta(records, df)
    return items, delta


def _backtest_delta(records: list[SalesRecord], df: pd.DataFrame) -> float:
    """Fractional MAE improvement of model vs baseline over a 7-day holdout."""
    cutoff = df["date"].max() - pd.Timedelta(days=7)
    train_df = df[df["date"] <= cutoff]
    test_df = df[df["date"] > cutoff].dropna(subset=FEATURES)
    if len(train_df.dropna(subset=FEATURES)) < 20 or test_df.empty:
        return 0.0
    model = _train(train_df)
    model_err, base_err = [], []
    for _, row in test_df.iterrows():
        yhat = float(model.predict(row[FEATURES].to_frame().T.astype(float))[0])
        model_err.append(abs(yhat - row["quantity"]))
        base_err.append(abs(row["lag7"] - row["quantity"]))
    m, b = float(np.mean(model_err)), float(np.mean(base_err))
    if b == 0:
        return 0.0
    return float(np.clip((b - m) / b, 0.0, 1.0))
