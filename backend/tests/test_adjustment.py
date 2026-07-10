# tests/test_adjustment.py
from wastewise.models import ForecastItem, WeatherInfo
from wastewise.agents.adjustment import adjust_forecast, FALLBACK_REASON


def _items():
    return [
        ForecastItem(item="stew", forecast=100, baseline=95, safety_buffer=15,
                    recommended_purchase_qty=115),
        ForecastItem(item="salad greens", forecast=80, baseline=75,
                    safety_buffer=10, recommended_purchase_qty=90),
    ]


class _PerItemLLM:
    """Returns a different, item-specific completion per call -- proves each
    item gets its own reasoning instead of a shared/copy-pasted one."""
    _RESPONSES = {
        "stew": '{"adjusted_qty": 130, "reason": "Rain drives comfort-food orders like stew up."}',
        "salad greens": '{"adjusted_qty": 60, "reason": "Rain lowers dine-in demand for cold salad items."}',
    }

    def complete(self, system, user):
        for item, resp in self._RESPONSES.items():
            if f"Item: {item}," in user:
                return resp
        raise AssertionError(f"unexpected item in prompt: {user}")


def test_adjusts_each_item_with_genuinely_different_reasoning():
    weather = WeatherInfo(condition="Rain", temp_c=15, precipitation_mm=8)
    out = adjust_forecast(_items(), weather, [], _PerItemLLM())
    by_item = {o.item: o for o in out}
    assert by_item["stew"].adjusted_qty == 130
    assert by_item["salad greens"].adjusted_qty == 60
    assert by_item["stew"].reason != by_item["salad greens"].reason
    assert all(o.live for o in out)


class _BadJsonLLM:
    def complete(self, system, user):
        return "not json"


def test_fallback_on_bad_json_marks_not_live():
    out = adjust_forecast(_items(), WeatherInfo(condition="Clear", temp_c=25,
                          precipitation_mm=0), [], _BadJsonLLM())
    assert out[0].adjusted_qty == 115  # unchanged recommended qty
    assert out[0].reason == FALLBACK_REASON
    assert out[0].live is False


class _MixedLLM:
    """One item's call succeeds, the other's returns garbage -- proves a
    single bad call only zeroes out that one item, not the whole batch."""
    def complete(self, system, user):
        if "Item: stew," in user:
            return '{"adjusted_qty": 130, "reason": "Rain drives comfort-food orders like stew up."}'
        return "not json"


def test_one_items_failure_does_not_affect_another_items_success():
    out = adjust_forecast(_items(), WeatherInfo(condition="Rain", temp_c=15,
                          precipitation_mm=8), [], _MixedLLM())
    by_item = {o.item: o for o in out}
    assert by_item["stew"].live is True
    assert by_item["stew"].adjusted_qty == 130
    assert by_item["salad greens"].live is False
    assert by_item["salad greens"].reason == FALLBACK_REASON


class _RaisingLLM:
    def complete(self, system, user):
        raise RuntimeError("endpoint down")


def test_fallback_on_llm_transport_error():
    items = _items()
    out = adjust_forecast(items, WeatherInfo(condition="Clear", temp_c=25,
                          precipitation_mm=0), [], _RaisingLLM())
    assert all(o.adjusted_qty == i.recommended_purchase_qty for o, i in zip(out, items))
    assert all(o.reason == FALLBACK_REASON for o in out)
    assert all(o.live is False for o in out)
