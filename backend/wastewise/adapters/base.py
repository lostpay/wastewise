import datetime
import hashlib
import json
import os
from typing import Protocol
from wastewise.models import WeatherInfo, Holiday, SupplierPrice


class FileCache:
    def __init__(self, cache_dir: str):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)

    def _path(self, key: str) -> str:
        h = hashlib.sha256(key.encode()).hexdigest()[:24]
        return os.path.join(self.cache_dir, f"{h}.json")

    def get(self, key: str) -> dict | None:
        path = self._path(key)
        if not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def set(self, key: str, value: dict) -> None:
        with open(self._path(key), "w", encoding="utf-8") as f:
            json.dump(value, f)


class WeatherSource(Protocol):
    def get_weather(self, date: datetime.date, location: str) -> WeatherInfo: ...


class HolidaySource(Protocol):
    def get_holidays(self, start: datetime.date, end: datetime.date) -> list[Holiday]: ...


class WholesaleSource(Protocol):
    def get_wholesale_price(self, item: str) -> float | None: ...


class RetailSource(Protocol):
    def get_retail_prices(self, item: str, location: str) -> list[SupplierPrice]: ...
