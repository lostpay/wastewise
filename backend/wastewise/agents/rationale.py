from wastewise.models import AdjustedItem, POLine, RationaleResponse

SYSTEM = (
    "You are a restaurant purchasing assistant. Given a list of forecast "
    "adjustments (item, reason, and the delta between recommended and "
    "adjusted quantity) and a list of sourcing decisions (item, supplier, "
    "note, savings), write ONE short paragraph (2-4 sentences) that connects "
    "the weather/holiday forecast story to the sourcing trade-off story into "
    "a coherent purchasing rationale a restaurant manager could read before "
    "approving the order. Respond with plain text only, no headers or lists. "
    "Reply in English."
)


def _fallback_paragraph(items: list[AdjustedItem], lines: list[POLine],
                        savings: float, total: float) -> str:
    n = len(items)
    suppliers = {l.supplier for l in lines}
    m = len(suppliers)
    item_word = "item" if n == 1 else "items"
    supplier_word = "supplier" if m == 1 else "suppliers"
    return (f"{n} {item_word} were adjusted for weather and holiday signals; "
            f"sourcing across {m} {supplier_word} saves ${savings:.2f} "
            f"versus benchmark pricing on a ${total:.2f} order.")


def write_rationale(items: list[AdjustedItem], lines: list[POLine],
                    savings: float, total: float, llm) -> RationaleResponse:
    adj_txt = "\n".join(
        f"- {i.item}: adjusted {i.forecast:.1f} -> {i.adjusted_qty:.1f} ({i.reason})"
        for i in items)
    src_txt = "\n".join(
        f"- {l.item}: {l.supplier} @ ${l.unit_price:.2f} ({l.note})"
        for l in lines)
    user = (f"Forecast adjustments:\n{adj_txt}\n\nSourcing decisions:\n{src_txt}\n\n"
            f"Total: ${total:.2f}. Savings: ${savings:.2f}.")
    try:
        paragraph = llm.complete(SYSTEM, user).strip()
        if not paragraph:
            raise ValueError("empty completion")
        return RationaleResponse(paragraph=paragraph, live=True)
    except Exception:
        return RationaleResponse(
            paragraph=_fallback_paragraph(items, lines, savings, total), live=False)
