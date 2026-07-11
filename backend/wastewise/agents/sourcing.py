import sys
from concurrent.futures import ThreadPoolExecutor

from wastewise.models import POLine, SourcingResponse, SupplierPrice
from wastewise.agents.llm import extract_json

FLAG_FRAC = 1.25  # price > 1.25x the US benchmark -> flag regardless of the LLM

SELECT_SYSTEM = (
    "You are a restaurant purchasing agent choosing which supplier listing to buy "
    "for a bulk kitchen order. Given a plain ingredient name, a US retail average "
    "benchmark price (BLS, via FRED) (or 'none' if unavailable), and a numbered "
    "list of candidate retail listings (each with a description and unit price), "
    "pick the listing that is the plain, unprocessed commodity form of the "
    "ingredient -- not a marinated, seasoned, or specialty product -- at the best "
    "price. Also give a verdict: \"buy\" when the price is reasonable, \"caution\" "
    "when even the best candidate is far above the US benchmark or clearly "
    "overpriced -- and when the verdict is \"caution\", the reason must warn the "
    "buyer about the price (suggest trimming or substituting), never justify it. "
    'Respond ONLY with JSON: {"index": int, "reason": str, "verdict": "buy"|"caution"}. '
    '"index" is the 0-based position in the candidate list. "reason" is one short '
    "English sentence. If the benchmark is 'none', do NOT claim or imply a "
    "comparison to it -- explain the choice in terms of the listing itself instead."
)

NO_BENCHMARK_NOTE = "No US retail average available for comparison."
NO_MATCH_NOTE = "No retail listing or US retail average found for this item."


def _fallback_note(unit_price: float, benchmark: float | None) -> str:
    if benchmark is None:
        return NO_BENCHMARK_NOTE
    if unit_price < benchmark:
        pct = round((benchmark - unit_price) / benchmark * 100)
        return f"${unit_price:.2f} vs. US avg ${benchmark:.2f} ({pct}% under)."
    return f"${unit_price:.2f} vs. US avg ${benchmark:.2f} (at or above)."


def _choose_offer(llm, item: str, offers: list[SupplierPrice],
                  benchmark: float | None) -> tuple[SupplierPrice, str, bool, bool]:
    """Ask the LLM to pick the best candidate + explain; fall back to the
    cheapest offer with a formulaic note if the LLM is unavailable or
    returns something unusable. `offers` must be non-empty. Returns
    (offer, note, live, caution). `live` is True only on the LLM-selection
    success path. `caution` is the LLM's own verdict; the deterministic price
    guard is applied later where the *real* benchmark is known."""
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
        caution = str(parsed.get("verdict", "buy")).strip().lower() == "caution"
        if not (0 <= idx < len(offers)) or not reason:
            raise ValueError("bad selection")
        return offers[idx], reason, True, caution
    except Exception as e:
        print(f"[sourcing] LLM call failed for {item!r}: "
              f"{type(e).__name__}: {e}", file=sys.stderr, flush=True)
        return fallback_best, _fallback_note(fallback_best.unit_price, benchmark), False, False


def source_order(items: list[dict], wholesale, retail, llm,
                 location: str,
                 historical_items: set[str] | None = None) -> SourcingResponse:
    historical_items = {i.lower() for i in (historical_items or set())}
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
            return None, _fallback_note(benchmark, benchmark), False, False
        return None, NO_MATCH_NOTE, False, False

    # Choosing an offer and writing its note is an independent LLM call per
    # item -- run them concurrently instead of one at a time, since each
    # round trip dominates wall time otherwise.
    with ThreadPoolExecutor(max_workers=min(3, len(prepared)) or 1) as pool:
        resolved = list(pool.map(_resolve, prepared))

    total = 0.0
    savings = 0.0
    overpay = 0.0
    lines = []
    for (item, qty, benchmark, offers), (offer, note, live, caution) in zip(prepared, resolved):
        is_historical_benchmark = item.lower() in historical_items
        if offer is not None:
            supplier, unit_price, unit = offer.supplier, offer.unit_price, offer.unit
        elif benchmark is not None:
            supplier, unit_price, unit = "Market", benchmark, ""
        else:
            supplier, unit_price, unit = "No price data", 0.0, ""
        line_total = round(unit_price * qty, 2)
        total += line_total
        # Real US retail benchmark (FRED) -- the only kind that shows in the
        # per-line `benchmark` field and counts toward `savings`. Historical
        # benchmarks are the item's own past purchase price, not a market
        # comparison. See api.py for how historical_items is derived.
        real_benchmark = benchmark if not is_historical_benchmark else None
        # Rewrite the note when the note-generator's benchmark was actually
        # historical -- otherwise it would falsely claim "vs. US avg" using
        # the historical average, and inflate/mislead the reader.
        if is_historical_benchmark and note != NO_MATCH_NOTE:
            note = NO_BENCHMARK_NOTE
        flagged = caution or (
            real_benchmark is not None and unit_price > FLAG_FRAC * real_benchmark)
        if real_benchmark is not None and unit_price > real_benchmark:
            overpay += (unit_price - real_benchmark) * qty
        if (real_benchmark is not None
                and unit_price < real_benchmark):
            savings += (real_benchmark - unit_price) * qty
        lines.append(POLine(item=item, qty=qty, supplier=supplier,
                            unit_price=unit_price, line_total=line_total,
                            note=note, live=live, benchmark=real_benchmark,
                            unit=unit, flagged=flagged))
    return SourcingResponse(lines=lines, total=round(total, 2),
                            savings=round(savings, 2), overpay=round(overpay, 2))
