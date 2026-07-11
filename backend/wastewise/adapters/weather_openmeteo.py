import datetime
import httpx
from wastewise.adapters.base import FileCache
from wastewise.models import WeatherInfo

NEUTRAL = WeatherInfo(condition="unknown", temp_c=20.0, precipitation_mm=0.0)

# WMO weather codes -> short human condition. Open-Meteo returns these globally
# (unlike NWS/weather.gov, which only covers the US), so weather -- and thus the
# purchasing adjustment -- actually varies by location everywhere.
_WMO = {
    0: "Clear",
    1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Fog",
    51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
    56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Rain", 63: "Rain", 65: "Heavy rain",
    66: "Freezing rain", 67: "Freezing rain",
    71: "Snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Rain showers", 81: "Rain showers", 82: "Violent rain showers",
    85: "Snow showers", 86: "Snow showers",
    95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
}


def _condition(code) -> str:
    if code is None:
        return "unknown"
    return _WMO.get(int(code), "unknown")


class OpenMeteoWeather:
    """Global daily-forecast weather via Open-Meteo (free, no API key). Returns
    real per-location weather worldwide, so a restaurant outside the US still
    gets location-specific forecasts instead of a fixed neutral fallback."""

    def __init__(self, cache: FileCache, client: httpx.Client | None = None):
        self.cache = cache
        self.client = client or httpx.Client(
            timeout=10, headers={"User-Agent": "WasteWise/0.1"})

    def get_weather(self, date: datetime.date, location: str) -> WeatherInfo:
        key = f"weather-om/{location}/{date.isoformat()}"
        cached = self.cache.get(key)
        if cached is not None:
            return WeatherInfo(**cached)
        try:
            lat, lon = location.split(",")
            resp = self.client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={"latitude": lat, "longitude": lon,
                        "daily": "weather_code,temperature_2m_max,precipitation_sum",
                        "forecast_days": 16, "timezone": "UTC"})
            resp.raise_for_status()
            daily = resp.json()["daily"]
            times = daily["time"]
            codes = daily["weather_code"]
            temps = daily["temperature_2m_max"]
            precs = daily["precipitation_sum"]
        except (httpx.HTTPError, KeyError, ValueError):
            return NEUTRAL
        # Open-Meteo returns null for days past the true forecast window (the tail
        # of forecast_days). Parse each day independently so a null tail day never
        # aborts the near-term days the pipeline actually orders against.
        days: dict[str, WeatherInfo] = {}
        for i, t in enumerate(times):
            temp = temps[i] if i < len(temps) else None
            if temp is None:
                continue
            prec = precs[i] if i < len(precs) else 0.0
            code = codes[i] if i < len(codes) else None
            days[t] = WeatherInfo(condition=_condition(code),
                                  temp_c=round(float(temp), 1),
                                  precipitation_mm=round(float(prec or 0.0), 1))
        if not days:
            return NEUTRAL
        # Cache every returned day so the pipeline's per-horizon-day calls reuse
        # this single fetch instead of hitting the network once per day.
        for t, info in days.items():
            self.cache.set(f"weather-om/{location}/{t}", info.model_dump())
        return days.get(date.isoformat()) or next(iter(days.values()))
