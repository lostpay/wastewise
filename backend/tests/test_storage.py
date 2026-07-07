import datetime
import pytest
from wastewise.models import SalesRecord
from wastewise.storage import DatasetStore


def _records():
    return [
        SalesRecord(date=datetime.date(2026, 1, 1), item="cabbage", quantity=5),
        SalesRecord(date=datetime.date(2026, 1, 2), item="cabbage", quantity=7),
    ]


def test_save_then_load_roundtrip(tmp_path):
    store = DatasetStore(str(tmp_path / "t.sqlite3"))
    ds_id = store.save(_records())
    assert isinstance(ds_id, str) and len(ds_id) > 0
    loaded = store.load(ds_id)
    assert len(loaded) == 2
    assert loaded[0].item == "cabbage"


def test_load_missing_raises(tmp_path):
    store = DatasetStore(str(tmp_path / "t.sqlite3"))
    with pytest.raises(KeyError):
        store.load("nope")
