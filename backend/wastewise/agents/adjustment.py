from wastewise.models import ForecastItem, AdjustedItem, WeatherInfo, Holiday
from wastewise.agents.llm import extract_json

SYSTEM = (
    "You are a restaurant purchasing assistant. Given per-item recommended "
    "purchase quantities plus weather and holidays, adjust each quantity up or "
    "down and give a one-sentence reason. Respond ONLY with a JSON array of "
    '{"item": str, "adjusted_qty": number, "reason": str}. Reply in English.'
)


def _fallback(items: list[ForecastItem]) -> list[AdjustedItem]:
    return [AdjustedItem(item=i.item, forecast=i.forecast,
                         adjusted_qty=i.recommended_purchase_qty,
                         reason="No adjustment applied.") for i in items]


def adjust_forecast(items: list[ForecastItem], weather: WeatherInfo,
                    holidays: list[Holiday], llm) -> list[AdjustedItem]:
    holiday_txt = ", ".join(h.name for h in holidays) or "none"
    lines = "\n".join(f"- {i.item}: recommended {i.recommended_purchase_qty}"
                      for i in items)
    user = (f"Weather: {weather.condition}, {weather.temp_c}C, "
            f"precip {weather.precipitation_mm}mm. Holidays: {holiday_txt}.\n"
            f"Items:\n{lines}")
    try:
        parsed = extract_json(llm.complete(SYSTEM, user))
        by_item = {p["item"]: p for p in parsed}
    except Exception:
        return _fallback(items)

    out: list[AdjustedItem] = []
    for i in items:
        p = by_item.get(i.item)
        try:
            out.append(AdjustedItem(item=i.item, forecast=i.forecast,
                                    adjusted_qty=float(p["adjusted_qty"]),
                                    reason=str(p["reason"])))
        except (TypeError, KeyError, ValueError):
            out.append(AdjustedItem(item=i.item, forecast=i.forecast,
                                    adjusted_qty=i.recommended_purchase_qty,
                                    reason="No adjustment applied."))
    return out
