from wastewise.models import POLine, SourcingResponse

SYSTEM = ("You write one short English sentence explaining how a chosen supplier "
          "price compares to the market benchmark. Respond with plain text only.")


def _note(llm, item: str, unit_price: float, benchmark: float | None) -> str:
    try:
        return llm.complete(
            SYSTEM,
            f"Item {item}: chosen price {unit_price}, benchmark {benchmark}.").strip()
    except Exception:
        if benchmark and unit_price < benchmark:
            pct = round((benchmark - unit_price) / benchmark * 100)
            return f"{pct}% under market benchmark."
        return "At or above market benchmark."


def source_order(items: list[dict], wholesale, retail, llm,
                 location: str) -> SourcingResponse:
    lines: list[POLine] = []
    total = 0.0
    savings = 0.0
    for entry in items:
        item, qty = entry["item"], float(entry["qty"])
        benchmark = wholesale.get_wholesale_price(item)
        offers = retail.get_retail_prices(item, location)
        if offers:
            best = min(offers, key=lambda p: p.unit_price)
            supplier, unit_price = best.supplier, best.unit_price
        else:
            supplier = "Market"
            unit_price = benchmark if benchmark is not None else 0.0
        line_total = round(unit_price * qty, 2)
        total += line_total
        if benchmark is not None and unit_price < benchmark:
            savings += (benchmark - unit_price) * qty
        lines.append(POLine(item=item, qty=qty, supplier=supplier,
                            unit_price=unit_price, line_total=line_total,
                            note=_note(llm, item, unit_price, benchmark)))
    return SourcingResponse(lines=lines, total=round(total, 2),
                            savings=round(savings, 2))
