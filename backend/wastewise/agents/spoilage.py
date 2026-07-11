import sys

from wastewise.models import SpoilageInfo
from wastewise.agents.llm import extract_json

# Buffer fraction per risk class. "low" matches the pre-spoilage flat 15%
# buffer, so the LLM-unavailable fallback changes nothing.
BUFFER_BY_RISK = {"high": 0.05, "medium": 0.10, "low": 0.15}

_DEFAULT = SpoilageInfo(risk="low", shelf_life_days=None, live=False)

SYSTEM = (
    "You are a food-storage expert for restaurant inventory. For each "
    "ingredient in the list, estimate its typical refrigerated shelf life in "
    "days and classify spoilage risk: 'high' (3 days or less), 'medium' "
    "(4-10 days), 'low' (more than 10 days, e.g. shelf-stable staples). "
    "Respond ONLY with a JSON array, one object per ingredient, copying each "
    'name exactly: [{"item": str, "shelf_life_days": int, '
    '"risk": "high"|"medium"|"low"}].'
)


def assess_spoilage(items: list[str], llm) -> dict[str, SpoilageInfo]:
    """One call for the whole item list; per-item validation so a single bad
    entry only defaults that item, not the batch."""
    out = {i: _DEFAULT for i in items}
    if not items:
        return out
    try:
        parsed = extract_json(llm.complete(SYSTEM, "Ingredients:\n" + "\n".join(items)))
        by_name = {str(e.get("item", "")).lower(): e for e in parsed}
    except Exception as e:
        print(f"[spoilage] LLM call failed: {type(e).__name__}: {e}",
              file=sys.stderr, flush=True)
        return out
    for item in items:
        entry = by_name.get(item.lower())
        if not entry:
            continue
        risk = str(entry.get("risk", "")).lower()
        if risk not in BUFFER_BY_RISK:
            continue
        try:
            days = int(entry["shelf_life_days"])
        except (KeyError, TypeError, ValueError):
            days = None
        out[item] = SpoilageInfo(risk=risk, shelf_life_days=days, live=True)
    return out
