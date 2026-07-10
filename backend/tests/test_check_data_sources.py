from wastewise.check_data_sources import check_sources, SourceStatus


class _OkWholesale:
    def get_wholesale_price(self, item):
        return 2.0


class _DeadWholesale:
    def get_wholesale_price(self, item):
        return None


class _OkRetail:
    def get_retail_prices(self, item, location):
        return [object()]


class _DeadRetail:
    def get_retail_prices(self, item, location):
        return []


def test_check_sources_all_live():
    statuses = check_sources(_OkWholesale(), _OkRetail())
    assert all(s.live for s in statuses)


def test_check_sources_flags_dead_wholesale():
    statuses = check_sources(_DeadWholesale(), _OkRetail())
    by_name = {s.name: s for s in statuses}
    assert by_name["fred"].live is False
    assert by_name["kroger"].live is True


def test_check_sources_flags_dead_retail():
    statuses = check_sources(_OkWholesale(), _DeadRetail())
    by_name = {s.name: s for s in statuses}
    assert by_name["kroger"].live is False
