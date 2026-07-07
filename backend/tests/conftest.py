import datetime
import pytest
from wastewise.models import SalesRecord


@pytest.fixture
def sample_sales():
    """Two items, 70 days, weekly seasonality (weekends higher)."""
    records = []
    start = datetime.date(2026, 4, 1)
    for d in range(70):
        day = start + datetime.timedelta(days=d)
        weekend = day.weekday() >= 5
        records.append(SalesRecord(date=day, item="cabbage",
                                   quantity=20 + (10 if weekend else 0)))
        records.append(SalesRecord(date=day, item="pork",
                                   quantity=15 + (5 if weekend else 0)))
    return records
