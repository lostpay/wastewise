# wastewise/forecasting/features.py
import datetime
import pandas as pd
from wastewise.models import SalesRecord


def build_frame(records: list[SalesRecord],
                holiday_dates: frozenset[datetime.date] = frozenset()) -> pd.DataFrame:
    df = pd.DataFrame([{"date": r.date, "item": r.item, "quantity": r.quantity}
                       for r in records])
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["item", "date"]).reset_index(drop=True)
    df["dow"] = df["date"].dt.dayofweek
    df["weekofyear"] = df["date"].dt.isocalendar().week.astype(int)
    df["month"] = df["date"].dt.month
    df["item_code"] = df["item"].astype("category").cat.codes
    df["is_holiday"] = df["date"].dt.date.isin(holiday_dates).astype(int)
    df["lag7"] = df.groupby("item")["quantity"].shift(7)
    df["roll7"] = (df.groupby("item")["quantity"]
                     .shift(1).rolling(7).mean().reset_index(level=0, drop=True))
    return df
