import datetime
from wastewise.models import Holiday

_US_2026 = [
    (datetime.date(2026, 1, 1), "New Year's Day"),
    (datetime.date(2026, 5, 25), "Memorial Day"),
    (datetime.date(2026, 7, 4), "Independence Day"),
    (datetime.date(2026, 9, 7), "Labor Day"),
    (datetime.date(2026, 11, 26), "Thanksgiving"),
    (datetime.date(2026, 12, 25), "Christmas Day"),
]


class USHolidays:
    def get_holidays(self, start: datetime.date, end: datetime.date) -> list[Holiday]:
        return [Holiday(date=d, name=n) for d, n in _US_2026 if start <= d <= end]
