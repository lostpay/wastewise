from concurrent.futures import ThreadPoolExecutor

from wastewise.models import POLine, SourcingResponse

SYSTEM = ("You write one short English sentence explaining how a chosen supplier "
          "price compares to the market benchmark. Respond with plain text only.")

NO_BENCHMARK_NOTE = "No market benchmark available for comparison."
NO_MATCH_NOTE = "No retail listing or market benchmark found for this item."


def _fallback_note(unit_price: float, benchmark: float | None) -> str:
    if benchmark is None:
        return NO_BENCHMARK_NOTE
    if unit_price < benchmark:
        pct = round((benchmark - unit_price) / benchmark * 100)
        return f"{pct}% under market benchmark."
    return "At or above market benchmark."


def _note(llm, item: str, unit_price: float, benchmark: float | None) -> str:
    try:
        return llm.complete(
            SYSTEM,
            f"Item {item}: chosen price {unit_price}, benchmark {benchmark}.").strip()
    except Exception:
        return _fallback_note(unit_price, benchmark)


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
        elif benchmark is not None:
            supplier, unit_price = "Market", benchmark
        else:
            supplier, unit_price = "No price data", 0.0
        line_total = round(unit_price * qty, 2)
        total += line_total
        if benchmark is not None and unit_price < benchmark:
            savings += (benchmark - unit_price) * qty
        prepared.append((item, qty, supplier, unit_price, line_total, benchmark, bool(offers)))

    def _note_for(p):
        item, qty, supplier, unit_price, line_total, benchmark, has_offer = p
        if not has_offer and benchmark is None:
            return NO_MATCH_NOTE
        if benchmark is None:
            return NO_BENCHMARK_NOTE
        return _note(llm, item, unit_price, benchmark)

    with ThreadPoolExecutor(max_workers=min(8, len(prepared)) or 1) as pool:
        notes = list(pool.map(_note_for, prepared))

    lines = [
        POLine(item=item, qty=qty, supplier=supplier, unit_price=unit_price,
              line_total=line_total, note=note)
        for (item, qty, supplier, unit_price, line_total, benchmark, has_offer), note
        in zip(prepared, notes)
    ]
    return SourcingResponse(lines=lines, total=round(total, 2),
                            savings=round(savings, 2))
