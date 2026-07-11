import datetime
import httpx
import respx
from wastewise.adapters.base import FileCache
from wastewise.adapters.weather_openmeteo import OpenMeteoWeather

_URL = "https://api.open-meteo.com/v1/forecast"


def _daily(codes, temps, precs, start="2026-07-13"):
    d0 = datetime.date.fromisoformat(start)
    times = [(d0 + datetime.timedelta(days=i)).isoformat() for i in range(len(codes))]
    return {"daily": {"time": times, "weather_code": codes,
                      "temperature_2m_max": temps, "precipitation_sum": precs}}


@respx.mock
def test_parses_daily_forecast(tmp_path):
    respx.get(_URL).mock(return_value=httpx.Response(
        200, json=_daily([61, 0], [30.2, 28.0], [5.4, 0.0])))
    w = OpenMeteoWeather(FileCache(str(tmp_path)))
    info = w.get_weather(datetime.date(2026, 7, 13), "25.03,121.56")
    assert "rain" in info.condition.lower()
    assert info.temp_c == 30.2
    assert info.precipitation_mm == 5.4


@respx.mock
def test_picks_the_requested_day(tmp_path):
    respx.get(_URL).mock(return_value=httpx.Response(
        200, json=_daily([0, 95], [25.0, 19.0], [0.0, 12.0])))
    w = OpenMeteoWeather(FileCache(str(tmp_path)))
    info = w.get_weather(datetime.date(2026, 7, 14), "25.03,121.56")
    assert info.condition == "Thunderstorm"
    assert info.temp_c == 19.0


@respx.mock
def test_different_locations_get_different_weather(tmp_path):
    # The whole point of the fix: two locations must not collapse to one result.
    def handler(request):
        lat = request.url.params.get("latitude")
        if lat == "25.03":
            return httpx.Response(200, json=_daily([61], [31.0], [8.0]))
        return httpx.Response(200, json=_daily([0], [22.0], [0.0]))

    respx.get(_URL).mock(side_effect=handler)
    w = OpenMeteoWeather(FileCache(str(tmp_path)))
    taipei = w.get_weather(datetime.date(2026, 7, 13), "25.03,121.56")
    tokyo = w.get_weather(datetime.date(2026, 7, 13), "35.68,139.69")
    assert taipei != tokyo
    assert taipei.temp_c == 31.0
    assert tokyo.temp_c == 22.0


@respx.mock
def test_null_tail_days_do_not_abort_parse(tmp_path):
    # Open-Meteo returns null for days past the true forecast window. A null tail
    # day must not poison the near-term days (regression: int(None) once aborted
    # the whole location into the neutral fallback).
    payload = _daily([61, 0, 3], [30.0, 28.0, 26.0], [5.0, 0.0, 1.0])
    payload["daily"]["time"].append("2026-07-16")
    payload["daily"]["weather_code"].append(None)
    payload["daily"]["temperature_2m_max"].append(None)
    payload["daily"]["precipitation_sum"].append(None)
    respx.get(_URL).mock(return_value=httpx.Response(200, json=payload))
    w = OpenMeteoWeather(FileCache(str(tmp_path)))
    info = w.get_weather(datetime.date(2026, 7, 13), "25.03,121.56")
    assert "rain" in info.condition.lower()
    assert info.temp_c == 30.0


@respx.mock
def test_http_error_returns_neutral(tmp_path):
    respx.get(_URL).mock(return_value=httpx.Response(500))
    w = OpenMeteoWeather(FileCache(str(tmp_path)))
    info = w.get_weather(datetime.date(2026, 7, 13), "25.03,121.56")
    assert info.condition == "unknown"


@respx.mock
def test_second_lookup_is_served_from_cache(tmp_path):
    route = respx.get(_URL).mock(return_value=httpx.Response(
        200, json=_daily([61, 0, 3], [30.0, 28.0, 26.0], [5.0, 0.0, 1.0])))
    w = OpenMeteoWeather(FileCache(str(tmp_path)))
    # One fetch should cache every returned day, so asking for a second day of
    # the same horizon must not trigger another network call.
    w.get_weather(datetime.date(2026, 7, 13), "25.03,121.56")
    w.get_weather(datetime.date(2026, 7, 14), "25.03,121.56")
    assert route.call_count == 1
