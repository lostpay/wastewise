# tests/test_rationale.py
from wastewise.models import AdjustedItem, POLine
from wastewise.agents.rationale import write_rationale


def _items():
    return [
        AdjustedItem(item="cabbage", forecast=168, adjusted_qty=150,
                    reason="Rain lowers dine-in demand for cabbage sides.", live=True),
        AdjustedItem(item="chicken", forecast=210, adjusted_qty=196,
                    reason="Rain lowers dine-in demand for quick-grill chicken.", live=True),
    ]


def _lines():
    return [
        POLine(item="cabbage", qty=150, supplier="Kroger", unit_price=1.4,
              line_total=210.0, note="30% under the US retail average.", live=True),
        POLine(item="chicken", qty=196, supplier="Kroger", unit_price=1.24,
              line_total=243.2, note="38% under the US retail average.", live=True),
    ]


class _FakeLLM:
    def complete(self, system, user):
        return ("Rain softens dine-in demand across the board; sourcing beats "
                "the US retail average on both items.")


def test_write_rationale_returns_live_paragraph_on_success():
    resp = write_rationale(_items(), _lines(), 92.0, 453.2, _FakeLLM())
    assert resp.live is True
    assert "Rain" in resp.paragraph


class _RaisingLLM:
    def complete(self, system, user):
        raise RuntimeError("endpoint down")


def test_write_rationale_falls_back_to_deterministic_template():
    resp = write_rationale(_items(), _lines(), 92.0, 453.2, _RaisingLLM())
    assert resp.live is False
    assert "2 items" in resp.paragraph
    assert "1 supplier" in resp.paragraph  # both lines are "Kroger"
    assert "$92.00" in resp.paragraph
    assert "$453.20" in resp.paragraph


class _EmptyLLM:
    def complete(self, system, user):
        return "   "


def test_write_rationale_falls_back_when_completion_is_empty():
    resp = write_rationale(_items(), _lines(), 92.0, 453.2, _EmptyLLM())
    assert resp.live is False
