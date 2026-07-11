# tests/test_spoilage.py
import json

from wastewise.agents.spoilage import assess_spoilage, BUFFER_BY_RISK


class _GoodLLM:
    def complete(self, system, user):
        return json.dumps([
            {"item": "rohu fish", "shelf_life_days": 2, "risk": "high"},
            {"item": "rice", "shelf_life_days": 365, "risk": "low"},
        ])


def test_assess_spoilage_parses_llm_reply():
    out = assess_spoilage(["rohu fish", "rice"], _GoodLLM())
    assert out["rohu fish"].risk == "high"
    assert out["rohu fish"].shelf_life_days == 2
    assert out["rohu fish"].live is True
    assert out["rice"].risk == "low"


def test_items_missing_from_reply_get_conservative_default():
    out = assess_spoilage(["rohu fish", "rice", "paneer"], _GoodLLM())
    # Default preserves the pre-spoilage 15% buffer (risk "low") and is
    # marked not-live so the UI won't render a made-up shelf life.
    assert out["paneer"].risk == "low"
    assert out["paneer"].shelf_life_days is None
    assert out["paneer"].live is False


class _BadLLM:
    def complete(self, system, user):
        return "not json"


def test_fallback_keeps_current_buffer_behavior():
    out = assess_spoilage(["rice"], _BadLLM())
    assert out["rice"].risk == "low"
    assert out["rice"].live is False
    assert BUFFER_BY_RISK[out["rice"].risk] == 0.15


class _InvalidRiskLLM:
    def complete(self, system, user):
        return json.dumps([{"item": "rice", "shelf_life_days": 5, "risk": "extreme"}])


def test_invalid_risk_value_falls_back_to_default():
    out = assess_spoilage(["rice"], _InvalidRiskLLM())
    assert out["rice"].risk == "low"
    assert out["rice"].live is False
