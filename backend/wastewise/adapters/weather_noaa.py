import datetime
import httpx
from wastewise.adapters.base import FileCache
from wastewise.models import WeatherInfo

NEUTRAL = WeatherInfo(condition="unknown", temp_c=20.0, precipitation_mm=0.0)


class NOAAWeather:
    def __init__(self, cache: FileCache, client: httpx.Client | None = None):
        self.cache = cache
        self.client = client or httpx.Client(
            timeout=10, headers={"User-Agent": "WasteWise/0.1"})

    def get_weather(self, date: datetime.date, location: str) -> WeatherInfo:
        key = f"weather/{location}/{date.isoformat()}"
        cached = self.cache.get(key)
        if cached is not None:
            return WeatherInfo(**cached)
        try:
            pts = self.client.get(f"https://api.weather.gov/points/{location}")
            pts.raise_for_status()
            url = pts.json()["properties"]["forecast"]
            fc = self.client.get(url)
            fc.raise_for_status()
            info = self._parse_period(fc.json()["properties"]["periods"], date)
        except (httpx.HTTPError, KeyError, IndexError):
            return NEUTRAL
        self.cache.set(key, info.model_dump())
        return info

    @staticmethod
    def _parse_period(periods: list[dict], date: datetime.date) -> WeatherInfo:
        match = next((p for p in periods
                      if p["startTime"].startswith(date.isoformat())), periods[0])
        temp_f = match["temperature"]
        temp_c = (temp_f - 32) * 5 / 9 if match.get("temperatureUnit") == "F" else temp_f
        pop = (match.get("probabilityOfPrecipitation") or {}).get("value") or 0
        return WeatherInfo(condition=match["shortForecast"],
                           temp_c=round(temp_c, 1),
                           precipitation_mm=float(pop) / 10.0)
