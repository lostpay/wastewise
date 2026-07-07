import json
import sqlite3
import uuid
from wastewise.models import SalesRecord


class DatasetStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS datasets "
                "(id TEXT PRIMARY KEY, payload TEXT NOT NULL)"
            )

    def save(self, records: list[SalesRecord]) -> str:
        ds_id = uuid.uuid4().hex[:12]
        payload = json.dumps([r.model_dump(mode="json") for r in records])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("INSERT INTO datasets (id, payload) VALUES (?, ?)",
                         (ds_id, payload))
        return ds_id

    def load(self, dataset_id: str) -> list[SalesRecord]:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("SELECT payload FROM datasets WHERE id = ?",
                               (dataset_id,)).fetchone()
        if row is None:
            raise KeyError(dataset_id)
        return [SalesRecord(**r) for r in json.loads(row[0])]
