from wastewise.forecasting.baseline import baseline_forecast


def test_baseline_next_day_matches_weekday_mean(sample_sales):
    # cabbage weekday demand is 20 (weekday) / 30 (weekend); next-day should be ~one day
    val = baseline_forecast(sample_sales, "cabbage", horizon_days=1)
    assert 18 <= val <= 32


def test_baseline_week_sums_seven_days(sample_sales):
    day = baseline_forecast(sample_sales, "cabbage", horizon_days=1)
    week = baseline_forecast(sample_sales, "cabbage", horizon_days=7)
    assert week > day * 5  # roughly 7 days summed
