import csv
import datetime
import io
import sys
from wastewise.models import SalesRecord, DatasetSummary

REQUIRED = {"date", "item", "quantity"}

MAPPING_SYSTEM = (
    "You map arbitrary sales-CSV headers onto a canonical schema. Given the "
    "header row and a few sample data rows, identify which column holds the "
    "sale date, which holds the item/product name, which holds the quantity "
    "sold, and (optionally) which holds the unit price. Also give the Python "
    "strptime pattern that parses the date column (e.g. \"%m/%d/%Y\"), or "
    "\"iso\" for ISO dates. Column names must be copied EXACTLY from the "
    'header. Respond ONLY with JSON: {"date": str, "item": str, '
    '"quantity": str, "price": str|null, "date_format": str}.'
)


def _parse_date(raw: str, fmt: str) -> datetime.date:
    if fmt == "iso":
        return datetime.date.fromisoformat(raw)
    return datetime.datetime.strptime(raw, fmt).date()


def _parse_rows(reader: csv.DictReader, cols: dict[str, str | None],
                date_format: str) -> list[SalesRecord]:
    records = []
    for i, row in enumerate(reader, start=2):  # row 1 is the header
        try:
            price_col = cols.get("price")
            records.append(SalesRecord(
                date=_parse_date((row[cols["date"]] or "").strip(), date_format),
                item=(row[cols["item"]] or "").strip(),
                quantity=float(row[cols["quantity"]]),
                price=float(row[price_col]) if price_col and row.get(price_col) else None,
            ))
        except (TypeError, ValueError, KeyError) as e:
            # Ragged rows leave required fields as None (-> TypeError) and bad
            # dates/numbers raise ValueError; surface both as a 400-friendly error.
            raise ValueError(f"Invalid CSV row {i}: {e}") from e
    return records


def _llm_column_mapping(fieldnames: list[str], sample_rows: list[dict],
                        llm) -> tuple[dict[str, str | None], str]:
    from wastewise.agents.llm import extract_json  # local import: avoid cycle
    sample = "\n".join(",".join(str(r.get(f, "")) for f in fieldnames)
                       for r in sample_rows)
    user = f"Header: {','.join(fieldnames)}\nSample rows:\n{sample}"
    parsed = extract_json(llm.complete(MAPPING_SYSTEM, user))
    cols = {"date": parsed["date"], "item": parsed["item"],
            "quantity": parsed["quantity"], "price": parsed.get("price")}
    for role, col in cols.items():
        if col is not None and col not in fieldnames:
            raise ValueError(f"AI mapped '{role}' to missing column '{col}'")
    return cols, str(parsed.get("date_format", "iso"))


def parse_sales_csv(text: str, llm=None) -> list[SalesRecord]:
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ValueError(f"CSV must contain columns: {sorted(REQUIRED)}")
    if REQUIRED.issubset(set(reader.fieldnames)):
        cols = {"date": "date", "item": "item", "quantity": "quantity",
                "price": "price" if "price" in reader.fieldnames else None}
        return _parse_rows(reader, cols, "iso")
    if llm is None:
        raise ValueError(f"CSV must contain columns: {sorted(REQUIRED)}")
    # Nonstandard header: ask the LLM to map columns, then re-read from the top.
    sample_reader = csv.DictReader(io.StringIO(text))
    sample_rows = [row for row, _ in zip(sample_reader, range(5))]
    try:
        cols, date_format = _llm_column_mapping(list(reader.fieldnames),
                                                sample_rows, llm)
    except ValueError:
        raise
    except Exception as e:
        print(f"[ingest] LLM column mapping failed: {type(e).__name__}: {e}",
              file=sys.stderr, flush=True)
        raise ValueError(f"CSV must contain columns: {sorted(REQUIRED)}") from e
    return _parse_rows(csv.DictReader(io.StringIO(text)), cols, date_format)


def summarize(dataset_id: str, records: list[SalesRecord]) -> DatasetSummary:
    dates = [r.date for r in records]
    return DatasetSummary(
        dataset_id=dataset_id,
        n_rows=len(records),
        items=sorted({r.item for r in records}),
        start_date=min(dates),
        end_date=max(dates),
    )
