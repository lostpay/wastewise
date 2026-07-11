# tests/test_adjustment.py
import datetime

from wastewise.models import ForecastItem, WeatherInfo, AdjustedItem
from wastewise.agents.adjustment import adjust_forecast, FALLBACK_REASON, summarize_adjustments


def _one_day(w):
    return [(datetime.date(2026, 7, 13), w)]


def _items():
    return [
        ForecastItem(item="stew", forecast=100, baseline=95, safety_buffer=15,
                    recommended_purchase_qty=115, daily=[14, 15, 14, 15, 14, 14, 14]),
        ForecastItem(item="salad greens", forecast=80, baseline=75,
                    safety_buffer=10, recommended_purchase_qty=90,
                    daily=[11, 12, 11, 12, 11, 11, 12]),
    ]


class _PerItemLLM:
    """Returns a different, item-specific completion per call -- proves each
    item gets its own reasoning instead of a shared/copy-pasted one."""
    _RESPONSES = {
        "stew": '{"adjusted_qty": 130, "reason": "Rain drives comfort-food orders like stew up."}',
        "salad greens": '{"adjusted_qty": 70, "reason": "Rain lowers dine-in demand for cold salad items."}',
    }

    def complete(self, system, user):
        for item, resp in self._RESPONSES.items():
            if f"Item: {item}," in user:
                return resp
        raise AssertionError(f"unexpected item in prompt: {user}")


def test_adjusts_each_item_with_genuinely_different_reasoning():
    weather = WeatherInfo(condition="Rain", temp_c=15, precipitation_mm=8)
    out = adjust_forecast(_items(), _one_day(weather), [], _PerItemLLM())
    by_item = {o.item: o for o in out}
    assert by_item["stew"].adjusted_qty == 130
    assert by_item["salad greens"].adjusted_qty == 70
    assert by_item["stew"].reason != by_item["salad greens"].reason
    assert all(o.live for o in out)


class _BadJsonLLM:
    def complete(self, system, user):
        return "not json"


def test_fallback_on_bad_json_marks_not_live():
    out = adjust_forecast(_items(), _one_day(WeatherInfo(condition="Clear", temp_c=25,
                          precipitation_mm=0)), [], _BadJsonLLM())
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
    out = adjust_forecast(_items(), _one_day(WeatherInfo(condition="Rain", temp_c=15,
                          precipitation_mm=8)), [], _MixedLLM())
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
    out = adjust_forecast(items, _one_day(WeatherInfo(condition="Clear", temp_c=25,
                          precipitation_mm=0)), [], _RaisingLLM())
    assert all(o.adjusted_qty == i.recommended_purchase_qty for o, i in zip(out, items))
    assert all(o.reason == FALLBACK_REASON for o in out)
    assert all(o.live is False for o in out)


class _CaptureLLM:
    def __init__(self):
        self.prompts = []

    def complete(self, system, user):
        self.prompts.append(user)
        return '{"adjusted_qty": 100, "reason": "ok"}'


def test_prompt_includes_every_horizon_day():
    weather = [
        (datetime.date(2026, 7, 13), WeatherInfo(condition="Rain", temp_c=15, precipitation_mm=8)),
        (datetime.date(2026, 7, 14), WeatherInfo(condition="Clear", temp_c=25, precipitation_mm=0)),
    ]
    llm = _CaptureLLM()
    adjust_forecast(_items(), weather, [], llm)
    assert "Mon Jul 13" in llm.prompts[0]
    assert "Tue Jul 14" in llm.prompts[0]
    assert "Rain" in llm.prompts[0] and "Clear" in llm.prompts[0]


def test_adjustment_preserves_daily_series():
    out = adjust_forecast(_items(), _one_day(WeatherInfo(condition="Clear", temp_c=25,
                          precipitation_mm=0)), [], _BadJsonLLM())
    assert out[0].daily == [14, 15, 14, 15, 14, 14, 14]


class _ExtremeHighLLM:
    def complete(self, system, user):
        return '{"adjusted_qty": 9999, "reason": "Heat wave megaorder."}'


class _ExtremeLowLLM:
    def complete(self, system, user):
        return '{"adjusted_qty": 1, "reason": "Nobody eats this week."}'


def test_llm_adjustment_is_clamped_to_40_percent_up():
    out = adjust_forecast(_items(), _one_day(WeatherInfo(condition="Heat", temp_c=38,
                          precipitation_mm=0)), [], _ExtremeHighLLM())
    by_item = {o.item: o for o in out}
    # stew: recommended 115 -> ceiling 115 * 1.40 = 161.0
    assert by_item["stew"].adjusted_qty == 161.0
    assert by_item["stew"].live is True


def test_llm_adjustment_is_clamped_to_40_percent_down():
    out = adjust_forecast(_items(), _one_day(WeatherInfo(condition="Storm", temp_c=10,
                          precipitation_mm=30)), [], _ExtremeLowLLM())
    by_item = {o.item: o for o in out}
    # salad greens: recommended 90 -> floor 90 * 0.60 = 54.0
    assert by_item["salad greens"].adjusted_qty == 54.0


def test_recommended_qty_is_carried_through_on_success_and_fallback():
    ok = adjust_forecast(_items(), _one_day(WeatherInfo(condition="Rain", temp_c=15,
                         precipitation_mm=8)), [], _PerItemLLM())
    assert {o.item: o.recommended for o in ok} == {"stew": 115, "salad greens": 90}
    bad = adjust_forecast(_items(), _one_day(WeatherInfo(condition="Clear", temp_c=25,
                          precipitation_mm=0)), [], _BadJsonLLM())
    assert {o.item: o.recommended for o in bad} == {"stew": 115, "salad greens": 90}


def test_summarize_adjustments_counts_directions_and_net_pct():
    adjusted = [
        AdjustedItem(item="a", forecast=90, adjusted_qty=110, reason="r", live=True, recommended=100),
        AdjustedItem(item="b", forecast=90, adjusted_qty=90, reason="r", live=True, recommended=100),
        AdjustedItem(item="c", forecast=90, adjusted_qty=100, reason="r", live=True, recommended=100),
    ]
    s = summarize_adjustments(adjusted)
    assert (s.n_up, s.n_down, s.n_unchanged) == (1, 1, 1)
    # (110 + 90 + 100) - 300 = 0 -> 0.0%
    assert s.net_delta_pct == 0.0


def test_summarize_adjustments_handles_zero_recommended():
    s = summarize_adjustments([AdjustedItem(item="a", forecast=0, adjusted_qty=0,
                                            reason="r", live=False, recommended=0)])
    assert s.net_delta_pct == 0.0
