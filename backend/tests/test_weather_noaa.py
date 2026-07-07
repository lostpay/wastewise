import datetime
import httpx
import respx
from wastewise.adapters.base import FileCache
from wastewise.adapters.weather_noaa import NOAAWeather


@respx.mock
def test_get_weather_parses_forecast(tmp_path):
    points = {"properties": {"forecast": "https://api.weather.gov/gridpoints/X/1,2/forecast"}}
    forecast = {"properties": {"periods": [
        {"startTime": "2026-07-09T06:00:00-04:00", "temperature": 68,
         "temperatureUnit": "F", "shortForecast": "Rain likely",
         "probabilityOfPrecipitation": {"value": 80}},
    ]}}
    respx.get("https://api.weather.gov/points/40.7,-74.0").mock(
        return_value=httpx.Response(200, json=points))
    respx.get("https://api.weather.gov/gridpoints/X/1,2/forecast").mock(
        return_value=httpx.Response(200, json=forecast))

    w = NOAAWeather(FileCache(str(tmp_path)))
    info = w.get_weather(datetime.date(2026, 7, 9), "40.7,-74.0")
    assert "rain" in info.condition.lower()
    assert info.precipitation_mm > 0


@respx.mock
def test_get_weather_http_error_returns_neutral(tmp_path):
    respx.get("https://api.weather.gov/points/40.7,-74.0").mock(
        return_value=httpx.Response(500))
    w = NOAAWeather(FileCache(str(tmp_path)))
    info = w.get_weather(datetime.date(2026, 7, 9), "40.7,-74.0")
    assert info.condition == "unknown"
