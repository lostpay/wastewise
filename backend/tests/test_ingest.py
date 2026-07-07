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


def test_summarize(sample_sales):
    summary = summarize("ds1", sample_sales)
    assert summary.dataset_id == "ds1"
    assert summary.n_rows == len(sample_sales)
    assert set(summary.items) == {"cabbage", "pork"}
