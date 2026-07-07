import datetime
from wastewise.adapters.holidays import USHolidays


def test_returns_holiday_in_range():
    hs = USHolidays().get_holidays(datetime.date(2026, 7, 1), datetime.date(2026, 7, 10))
    names = {h.name for h in hs}
    assert "Independence Day" in names


def test_empty_when_no_holiday():
    hs = USHolidays().get_holidays(datetime.date(2026, 9, 8), datetime.date(2026, 9, 12))
    assert hs == []
