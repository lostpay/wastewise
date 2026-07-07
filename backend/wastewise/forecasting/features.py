# wastewise/forecasting/features.py
import pandas as pd
from wastewise.models import SalesRecord


def build_frame(records: list[SalesRecord]) -> pd.DataFrame:
    df = pd.DataFrame([{"date": r.date, "item": r.item, "quantity": r.quantity}
                       for r in records])
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["item", "date"]).reset_index(drop=True)
    df["dow"] = df["date"].dt.dayofweek
    df["weekofyear"] = df["date"].dt.isocalendar().week.astype(int)
    df["month"] = df["date"].dt.month
    df["lag7"] = df.groupby("item")["quantity"].shift(7)
    df["roll7"] = (df.groupby("item")["quantity"]
                     .shift(1).rolling(7).mean().reset_index(level=0, drop=True))
    return df
