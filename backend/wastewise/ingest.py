import csv
import datetime
import io
from wastewise.models import SalesRecord, DatasetSummary

REQUIRED = {"date", "item", "quantity"}


def parse_sales_csv(text: str) -> list[SalesRecord]:
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None or not REQUIRED.issubset(set(reader.fieldnames)):
        raise ValueError(f"CSV must contain columns: {sorted(REQUIRED)}")
    records = []
    for i, row in enumerate(reader, start=2):  # row 1 is the header
        try:
            records.append(SalesRecord(
                date=datetime.date.fromisoformat((row["date"] or "").strip()),
                item=(row["item"] or "").strip(),
                quantity=float(row["quantity"]),
                price=float(row["price"]) if row.get("price") else None,
            ))
        except (TypeError, ValueError) as e:
            # Ragged rows leave required fields as None (-> TypeError) and bad
            # dates/numbers raise ValueError; surface both as a 400-friendly error.
            raise ValueError(f"Invalid CSV row {i}: {e}") from e
    return records


def summarize(dataset_id: str, records: list[SalesRecord]) -> DatasetSummary:
    dates = [r.date for r in records]
    return DatasetSummary(
        dataset_id=dataset_id,
        n_rows=len(records),
        items=sorted({r.item for r in records}),
        start_date=min(dates),
        end_date=max(dates),
    )
