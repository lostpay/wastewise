import sys

from wastewise.models import POLine, WhatIfResponse
from wastewise.agents.llm import extract_json

SYSTEM = (
    "You are a restaurant purchasing copilot. You are given the current "
    "purchase-order lines (item, quantity, unit price, line total, grand "
    "total) and an instruction from the restaurant manager. Work out which "
    "quantity changes satisfy the instruction. You may ONLY change "
    "quantities (0 is allowed, to drop a line); you cannot change prices or "
    "add items that are not on the order. If the instruction sets a budget, "
    "trim the most expensive lines first and explain the trade-off. If the "
    "instruction says stock is already on hand, subtract it from that "
    "item's quantity. If the instruction is unclear or unrelated to this "
    "order, return an empty updates list and ask for clarification in the "
    'reply. Respond ONLY with JSON: {"updates": [{"item": str, "qty": '
    'number}], "reply": str}. "item" must copy a name from the order '
    'exactly. "reply" is 1-3 English sentences summarizing what you changed '
    "and why."
)

REPLY_UNAVAILABLE = "AI assistant unavailable — the order was left unchanged."


def negotiate_order(message: str, lines: list[POLine], llm) -> WhatIfResponse:
    table = "\n".join(
        f"- {l.item}: qty {l.qty}, unit ${l.unit_price:.2f}, line ${l.line_total:.2f}"
        for l in lines)
    total = round(sum(l.line_total for l in lines), 2)
    user = f"Order:\n{table}\nGrand total: ${total:.2f}\n\nInstruction: {message}"
    try:
        parsed = extract_json(llm.complete(SYSTEM, user))
        updates = {str(u["item"]).strip().lower(): float(u["qty"])
                   for u in parsed.get("updates", [])}
        reply = str(parsed["reply"]).strip()
        if not reply:
            raise ValueError("empty reply")
    except Exception as e:
        print(f"[whatif] LLM call failed: {type(e).__name__}: {e}",
              file=sys.stderr, flush=True)
        return WhatIfResponse(lines=lines, total=total,
                              reply=REPLY_UNAVAILABLE, live=False)
    # Apply quantity updates only to items that exist on the order -- a
    # hallucinated item name must never add a line.
    new_lines = []
    for l in lines:
        qty = max(0.0, updates.get(l.item.lower(), l.qty))
        new_lines.append(l.model_copy(update={
            "qty": qty, "line_total": round(l.unit_price * qty, 2)}))
    new_total = round(sum(l.line_total for l in new_lines), 2)
    return WhatIfResponse(lines=new_lines, total=new_total, reply=reply, live=True)
