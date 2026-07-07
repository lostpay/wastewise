# tests/test_adjustment.py
from wastewise.models import ForecastItem, WeatherInfo, Holiday, AdjustedItem
from wastewise.agents.adjustment import adjust_forecast


def _items():
    return [ForecastItem(item="chicken", forecast=100, baseline=95,
                         safety_buffer=15, recommended_purchase_qty=115)]


class _FakeLLM:
    def __init__(self, out): self.out = out
    def complete(self, system, user): return self.out


def test_applies_valid_adjustment():
    llm = _FakeLLM('[{"item": "chicken", "adjusted_qty": 98, "reason": "Rain forecast"}]')
    out = adjust_forecast(_items(), WeatherInfo(condition="Rain", temp_c=15,
                          precipitation_mm=8), [], llm)
    assert out[0].adjusted_qty == 98
    assert "rain" in out[0].reason.lower()


def test_fallback_on_bad_json():
    llm = _FakeLLM("not json")
    out = adjust_forecast(_items(), WeatherInfo(condition="Clear", temp_c=25,
                          precipitation_mm=0), [], llm)
    assert out[0].adjusted_qty == 115  # unchanged recommended qty
    assert out[0].reason == "No adjustment applied."


class _RaisingLLM:
    def complete(self, system, user):
        raise RuntimeError("endpoint down")


def test_fallback_on_llm_transport_error():
    llm = _RaisingLLM()
    out = adjust_forecast(_items(), WeatherInfo(condition="Clear", temp_c=25,
                          precipitation_mm=0), [], llm)
    assert out[0].adjusted_qty == 115  # unchanged recommended qty
    assert out[0].reason == "No adjustment applied."
