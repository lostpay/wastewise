"""Static currency conversion for CSV-supplied historical prices.

Restaurants keep books in local currency. Kroger and FRED return USD.
Without a conversion, mixing them yields nonsense (e.g. ₹600/kg mutton
displayed as $600 and inflating "savings vs. US retail average" by two
orders of magnitude). This module converts a user-declared source
currency to USD at ingest, using a hardcoded rate table -- the table is
demo-quality (not real-time FX), but the alternative is silently mixing
currencies.
"""

# Approximate mid-market rates as of early 2026. Not real-time; the goal
# is only to keep unit-price displays in the right ballpark for the
# demo. When adding a currency, ensure the code path that calls
# `to_usd` still returns None for None (no price -> stay None).
_USD_PER: dict[str, float] = {
    "USD": 1.0,
    "INR": 0.012,
    "EUR": 1.08,
    "GBP": 1.28,
    "JPY": 0.0067,
    "CAD": 0.74,
    "AUD": 0.66,
    "CNY": 0.14,
}

SUPPORTED = tuple(_USD_PER)


def to_usd(price: float | None, currency: str) -> float | None:
    if price is None:
        return None
    rate = _USD_PER.get(currency.upper())
    if rate is None:
        return price  # unknown code -> assume already USD, don't lose the data
    return price * rate
