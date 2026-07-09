"""Market-agnostic price fallback derived from a dataset's own historical
`price` column.

Kroger/USDA only make sense for US grocery items. When a dataset contains
non-US items (e.g. Mutton, Paneer, Rohu Fish), those APIs return nothing, and
sourcing degrades to a silent $0.00 line. This adapter uses only data the
restaurant already provided -- never fabricated -- as a last-resort
benchmark: the historical average of that item's own `price` column.
"""
from collections import defaultdict
import statistics

from wastewise.adapters.base import RetailSource, WholesaleSource
from wastewise.models import SalesRecord, SupplierPrice

HISTORICAL_SUPPLIER = "Historical average"


class HistoricalPriceSource:
    def __init__(self, records: list[SalesRecord]):
        by_item: dict[str, list[float]] = defaultdict(list)
        display_name: dict[str, str] = {}
        for r in records:
            key = r.item.lower()
            display_name.setdefault(key, r.item)
            if r.price is not None:
                by_item[key].append(r.price)
        self._avg_price = {item: round(statistics.fmean(prices), 2)
                           for item, prices in by_item.items()}
        self._display_name = display_name

    def get_wholesale_price(self, item: str) -> float | None:
        return self._avg_price.get(item.lower())

    def get_retail_prices(self, item: str, location: str) -> list[SupplierPrice]:
        key = item.lower()
        price = self._avg_price.get(key)
        if price is None:
            return []
        # Use the item's original casing as it appeared in the dataset (not
        # the caller's query casing) so the description reads naturally
        # regardless of how the caller normalized the item name.
        display = self._display_name.get(key, item)
        return [SupplierPrice(
            supplier=HISTORICAL_SUPPLIER, unit_price=price,
            description=f"Average of {display}'s own historical purchase price")]


class FallbackWholesale:
    """Tries `primary` first; falls back to `secondary` only when primary
    has no answer (`None`), never overrides a real primary result."""

    def __init__(self, primary: WholesaleSource, secondary: WholesaleSource):
        self.primary, self.secondary = primary, secondary

    def get_wholesale_price(self, item: str) -> float | None:
        price = self.primary.get_wholesale_price(item)
        return price if price is not None else self.secondary.get_wholesale_price(item)


class FallbackRetail:
    def __init__(self, primary: RetailSource, secondary: RetailSource):
        self.primary, self.secondary = primary, secondary

    def get_retail_prices(self, item: str, location: str) -> list[SupplierPrice]:
        offers = self.primary.get_retail_prices(item, location)
        return offers if offers else self.secondary.get_retail_prices(item, location)
