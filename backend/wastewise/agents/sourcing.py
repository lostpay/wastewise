from concurrent.futures import ThreadPoolExecutor

from wastewise.models import POLine, SourcingResponse, SupplierPrice
from wastewise.agents.llm import extract_json

SELECT_SYSTEM = (
    "You are a restaurant purchasing agent choosing which supplier listing to buy "
    "for a bulk kitchen order. Given a plain ingredient name, a US retail average "
    "benchmark price (BLS, via FRED) (or 'none' if unavailable), and a numbered "
    "list of candidate retail listings (each with a description and unit price), "
    "pick the listing that is the plain, unprocessed commodity form of the "
    "ingredient -- not a marinated, seasoned, or specialty product -- at the best "
    "price. Respond ONLY with JSON: {\"index\": int, \"reason\": str}. \"index\" is "
    'the 0-based position in the candidate list. "reason" is one short English '
    "sentence explaining the choice. If the benchmark is 'none', do NOT claim or "
    "imply a comparison to it (e.g. never say 'under the US retail average' or "
    "'at or above the US retail average') -- explain the choice in terms of the "
    "listing itself (e.g. plain cut vs. specialty, or lowest price among "
    "candidates) instead."
)

NO_BENCHMARK_NOTE = "No US retail average available for comparison."
NO_MATCH_NOTE = "No retail listing or US retail average found for this item."


def _fallback_note(unit_price: float, benchmark: float | None) -> str:
    if benchmark is None:
        return NO_BENCHMARK_NOTE
    if unit_price < benchmark:
        pct = round((benchmark - unit_price) / benchmark * 100)
        return f"{pct}% under the US retail average."
    return "At or above the US retail average."


def _choose_offer(llm, item: str, offers: list[SupplierPrice],
                  benchmark: float | None) -> tuple[SupplierPrice, str]:
    """Ask the LLM to pick the best candidate + explain; fall back to the
    cheapest offer with a formulaic note if the LLM is unavailable or
    returns something unusable. `offers` must be non-empty."""
    fallback_best = min(offers, key=lambda o: o.unit_price)
    candidates = "\n".join(
        f"[{i}] {o.description or o.supplier} @ {o.unit_price}"
        for i, o in enumerate(offers))
    bench_txt = "none" if benchmark is None else str(benchmark)
    try:
        raw = llm.complete(
            SELECT_SYSTEM,
            f"Item: {item}. Benchmark: {bench_txt}. Candidates:\n{candidates}")
        parsed = extract_json(raw)
        idx = int(parsed["index"])
        reason = str(parsed["reason"]).strip()
        if not (0 <= idx < len(offers)) or not reason:
            raise ValueError("bad selection")
        return offers[idx], reason
    except Exception:
        return fallback_best, _fallback_note(fallback_best.unit_price, benchmark)


def source_order(items: list[dict], wholesale, retail, llm,
                 location: str) -> SourcingResponse:
    prepared = []
    for entry in items:
        item, qty = entry["item"], float(entry["qty"])
        benchmark = wholesale.get_wholesale_price(item)
        offers = retail.get_retail_prices(item, location)
        prepared.append((item, qty, benchmark, offers))

    def _resolve(p):
        item, qty, benchmark, offers = p
        if offers:
            return _choose_offer(llm, item, offers, benchmark)
        if benchmark is not None:
            return None, _fallback_note(benchmark, benchmark)
        return None, NO_MATCH_NOTE

    # Choosing an offer and writing its note is an independent LLM call per
    # item -- run them concurrently instead of one at a time, since each
    # round trip dominates wall time otherwise.
    with ThreadPoolExecutor(max_workers=min(8, len(prepared)) or 1) as pool:
        resolved = list(pool.map(_resolve, prepared))

    total = 0.0
    savings = 0.0
    lines = []
    for (item, qty, benchmark, offers), (offer, note) in zip(prepared, resolved):
        if offer is not None:
            supplier, unit_price = offer.supplier, offer.unit_price
        elif benchmark is not None:
            supplier, unit_price = "Market", benchmark
        else:
            supplier, unit_price = "No price data", 0.0
        line_total = round(unit_price * qty, 2)
        total += line_total
        if benchmark is not None and unit_price < benchmark:
            savings += (benchmark - unit_price) * qty
        lines.append(POLine(item=item, qty=qty, supplier=supplier,
                            unit_price=unit_price, line_total=line_total, note=note))
    return SourcingResponse(lines=lines, total=round(total, 2),
                            savings=round(savings, 2))
