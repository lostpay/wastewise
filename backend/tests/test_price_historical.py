import datetime
from wastewise.models import SalesRecord, SupplierPrice
from wastewise.adapters.price_historical import (
    HistoricalPriceSource, FallbackWholesale, FallbackRetail, HISTORICAL_SUPPLIER,
)


def _records():
    d = datetime.date(2026, 1, 1)
    return [
        SalesRecord(date=d, item="Mutton", quantity=2.0, price=600.0),
        SalesRecord(date=d, item="Mutton", quantity=1.8, price=620.0),
        SalesRecord(date=d, item="Rice", quantity=3.0, price=None),  # no price -> excluded
    ]


def test_historical_wholesale_price_is_average_of_recorded_prices():
    src = HistoricalPriceSource(_records())
    assert src.get_wholesale_price("mutton") == 610.0  # (600+620)/2


def test_historical_wholesale_price_none_when_item_never_priced():
    src = HistoricalPriceSource(_records())
    assert src.get_wholesale_price("rice") is None


def test_historical_retail_prices_returns_one_offer_with_description():
    src = HistoricalPriceSource(_records())
    offers = src.get_retail_prices("mutton", "any-location")
    assert len(offers) == 1
    assert offers[0].supplier == HISTORICAL_SUPPLIER
    assert offers[0].unit_price == 610.0
    assert "Mutton" in offers[0].description


class _NoDataSource:
    def get_wholesale_price(self, item): return None
    def get_retail_prices(self, item, location): return []


class _RealDataSource:
    def get_wholesale_price(self, item): return 2.0
    def get_retail_prices(self, item, location):
        return [SupplierPrice(supplier="Kroger", unit_price=1.5)]


def test_fallback_wholesale_uses_secondary_only_when_primary_has_nothing():
    historical = HistoricalPriceSource(_records())
    combo = FallbackWholesale(_NoDataSource(), historical)
    assert combo.get_wholesale_price("mutton") == 610.0


def test_fallback_wholesale_never_overrides_a_real_primary_result():
    historical = HistoricalPriceSource(_records())
    combo = FallbackWholesale(_RealDataSource(), historical)
    assert combo.get_wholesale_price("mutton") == 2.0


def test_fallback_retail_uses_secondary_only_when_primary_returns_no_offers():
    historical = HistoricalPriceSource(_records())
    combo = FallbackRetail(_NoDataSource(), historical)
    offers = combo.get_retail_prices("mutton", "loc")
    assert offers[0].supplier == HISTORICAL_SUPPLIER


def test_fallback_retail_never_overrides_real_primary_offers():
    historical = HistoricalPriceSource(_records())
    combo = FallbackRetail(_RealDataSource(), historical)
    offers = combo.get_retail_prices("mutton", "loc")
    assert offers[0].supplier == "Kroger"
