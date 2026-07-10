"""Standalone data-source connectivity smoke test.

Probes FRED (US retail average benchmark) and Kroger (retail prices) with a
known-common item ("chicken") to prove whether each adapter's credentials
actually work -- as opposed to `sourcing.source_order` silently treating a
dead credential the same as "no benchmark available":

    python -m wastewise.check_data_sources

Exits 0 if both sources answered, 1 if either is down (handy for CI / demo
prep, same convention as `check_llm.py`).
"""
import sys
from dataclasses import dataclass

_PROBE_ITEM = "chicken"
_PROBE_LOCATION = "40.7,-74.0"


@dataclass
class SourceStatus:
    name: str
    live: bool
    detail: str


def check_sources(wholesale, retail) -> list[SourceStatus]:
    statuses = []

    try:
        price = wholesale.get_wholesale_price(_PROBE_ITEM)
        statuses.append(SourceStatus(
            "fred", price is not None,
            f"price={price}" if price is not None
            else "no price returned (bad credential or no match)"))
    except Exception as e:  # transport, auth, etc.
        statuses.append(SourceStatus("fred", False, f"{type(e).__name__}: {e}"))

    try:
        offers = retail.get_retail_prices(_PROBE_ITEM, _PROBE_LOCATION)
        statuses.append(SourceStatus(
            "kroger", bool(offers),
            f"{len(offers)} offer(s)" if offers
            else "no offers returned (bad credential or no match)"))
    except Exception as e:
        statuses.append(SourceStatus("kroger", False, f"{type(e).__name__}: {e}"))

    return statuses


def format_report(statuses: list[SourceStatus]) -> str:
    bar = "=" * 70
    lines = [bar]
    for s in statuses:
        tag = "[ LIVE ]" if s.live else "[ DOWN ]"
        lines.append(f"  {tag} {s.name:<8} {s.detail}")
    lines.append(bar)
    return "\n".join(lines)


def main() -> int:
    from wastewise.config import get_settings
    from wastewise.adapters.base import FileCache
    from wastewise.adapters.price_fred import FredWholesale
    from wastewise.adapters.price_kroger import KrogerRetail

    s = get_settings()
    cache = FileCache(s.cache_dir)
    wholesale = FredWholesale(s.fred_api_key, cache)
    retail = KrogerRetail(s.kroger_client_id, s.kroger_client_secret, cache)

    statuses = check_sources(wholesale, retail)
    print(format_report(statuses), file=sys.stderr)
    return 0 if all(s.live for s in statuses) else 1


if __name__ == "__main__":
    raise SystemExit(main())
