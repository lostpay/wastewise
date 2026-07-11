# tests/test_whatif.py
import json

from wastewise.models import POLine
from wastewise.agents.whatif import negotiate_order, REPLY_UNAVAILABLE


def _lines():
    return [
        POLine(item="Rice", qty=25, supplier="Kroger", unit_price=1.79,
               line_total=44.75, note="", live=True),
        POLine(item="Rohu Fish", qty=30, supplier="Kroger", unit_price=12.99,
               line_total=389.70, note="", live=True),
    ]


class _TrimLLM:
    def complete(self, system, user):
        return json.dumps({
            "updates": [{"item": "rohu fish", "qty": 20}],
            "reply": "Cut Rohu fish to 20 to fit the budget; it is the most expensive line.",
        })


def test_negotiate_applies_updates_and_recomputes_totals():
    resp = negotiate_order("keep it under $350", _lines(), _TrimLLM())
    by_item = {l.item: l for l in resp.lines}
    assert by_item["Rohu Fish"].qty == 20            # matched case-insensitively
    assert by_item["Rohu Fish"].line_total == 259.80
    assert by_item["Rice"].qty == 25                 # untouched line preserved
    assert resp.total == round(44.75 + 259.80, 2)
    assert resp.live is True
    assert "Rohu" in resp.reply or "budget" in resp.reply


class _HallucinatingLLM:
    def complete(self, system, user):
        return json.dumps({
            "updates": [{"item": "lobster", "qty": 99}, {"item": "rice", "qty": -5}],
            "reply": "Added lobster!",
        })


def test_unknown_items_ignored_and_negative_qty_clamped_to_zero():
    resp = negotiate_order("whatever", _lines(), _HallucinatingLLM())
    assert {l.item for l in resp.lines} == {"Rice", "Rohu Fish"}  # no lobster
    by_item = {l.item: l for l in resp.lines}
    assert by_item["Rice"].qty == 0.0
    assert by_item["Rice"].line_total == 0.0


class _FractionalLLM:
    def complete(self, system, user):
        return json.dumps({
            "updates": [{"item": "rice", "qty": 24.5}],
            "reply": "You have 20 lbs on hand, so you need 24.5 more of rice.",
        })


def test_fractional_qty_is_rounded_up_to_a_whole_unit():
    resp = negotiate_order("I have 20 lbs of rice on hand", _lines(), _FractionalLLM())
    by_item = {l.item: l for l in resp.lines}
    assert by_item["Rice"].qty == 25                      # ceil(24.5) -> 25
    assert by_item["Rice"].qty == int(by_item["Rice"].qty)  # whole unit, no fraction
    assert by_item["Rice"].line_total == round(1.79 * 25, 2)
    assert by_item["Rohu Fish"].qty == 30                  # untouched line preserved


class _DownLLM:
    def complete(self, system, user):
        raise RuntimeError("endpoint down")


def test_fallback_leaves_order_unchanged():
    resp = negotiate_order("budget $1", _lines(), _DownLLM())
    assert [l.qty for l in resp.lines] == [25, 30]
    assert resp.reply == REPLY_UNAVAILABLE
    assert resp.live is False
