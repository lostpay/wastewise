from concurrent.futures import ThreadPoolExecutor

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
    total = 0.0
    savings = 0.0
    prepared = []
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
        prepared.append((item, qty, supplier, unit_price, line_total, benchmark))

    # Notes are independent per-item LLM calls -- run them concurrently instead
    # of one at a time, since each round trip dominates wall time otherwise.
    with ThreadPoolExecutor(max_workers=min(8, len(prepared)) or 1) as pool:
        notes = list(pool.map(
            lambda p: _note(llm, p[0], p[3], p[5]), prepared))

    lines = [
        POLine(item=item, qty=qty, supplier=supplier, unit_price=unit_price,
              line_total=line_total, note=note)
        for (item, qty, supplier, unit_price, line_total, benchmark), note
        in zip(prepared, notes)
    ]
    return SourcingResponse(lines=lines, total=round(total, 2),
                            savings=round(savings, 2))
