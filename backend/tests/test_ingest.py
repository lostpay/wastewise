import json

import pytest
from wastewise.ingest import parse_sales_csv, summarize


def test_parse_valid_csv():
    text = "date,item,quantity\n2026-01-01,cabbage,5\n2026-01-02,pork,3\n"
    recs = parse_sales_csv(text)
    assert len(recs) == 2
    assert recs[0].item == "cabbage"
    assert recs[0].quantity == 5.0


def test_parse_missing_column_raises():
    with pytest.raises(ValueError):
        parse_sales_csv("day,thing\n2026-01-01,cabbage\n")


def test_parse_ragged_row_raises_valueerror():
    # A row missing the quantity value must raise ValueError (-> 400), not a
    # TypeError that would surface as a 500.
    with pytest.raises(ValueError):
        parse_sales_csv("date,item,quantity\n2026-01-01,cabbage\n")


def test_parse_bad_quantity_raises_valueerror():
    with pytest.raises(ValueError):
        parse_sales_csv("date,item,quantity\n2026-01-01,cabbage,notanumber\n")


def test_summarize(sample_sales):
    summary = summarize("ds1", sample_sales)
    assert summary.dataset_id == "ds1"
    assert summary.n_rows == len(sample_sales)
    assert set(summary.items) == {"cabbage", "pork"}


MESSY = ("Day,Product,Units Sold,Cost\n"
         "07/01/2026,eggs,12,3.5\n"
         "07/02/2026,eggs,9,3.5\n")


class _MappingLLM:
    def complete(self, system, user):
        return json.dumps({"date": "Day", "item": "Product",
                           "quantity": "Units Sold", "price": "Cost",
                           "date_format": "%m/%d/%Y"})


def test_llm_maps_nonstandard_columns():
    from wastewise.ingest import parse_sales_csv
    records = parse_sales_csv(MESSY, llm=_MappingLLM())
    assert len(records) == 2
    assert records[0].item == "eggs"
    assert records[0].quantity == 12.0
    assert records[0].price == 3.5
    assert str(records[0].date) == "2026-07-01"


def test_without_llm_messy_csv_still_raises():
    from wastewise.ingest import parse_sales_csv
    import pytest
    with pytest.raises(ValueError):
        parse_sales_csv(MESSY)


class _BadMappingLLM:
    def complete(self, system, user):
        return json.dumps({"date": "Nope", "item": "Product",
                           "quantity": "Units Sold", "price": None,
                           "date_format": "%m/%d/%Y"})


def test_mapping_to_missing_column_raises_clean_error():
    from wastewise.ingest import parse_sales_csv
    import pytest
    with pytest.raises(ValueError):
        parse_sales_csv(MESSY, llm=_BadMappingLLM())
