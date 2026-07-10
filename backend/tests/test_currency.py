from wastewise.currency import SUPPORTED, to_usd


def test_to_usd_is_identity_for_usd():
    assert to_usd(12.5, "USD") == 12.5


def test_to_usd_scales_inr_by_the_hardcoded_rate():
    assert to_usd(600.0, "INR") == 7.2


def test_to_usd_is_case_insensitive():
    assert to_usd(1.0, "inr") == to_usd(1.0, "INR")


def test_to_usd_none_stays_none_regardless_of_currency():
    assert to_usd(None, "INR") is None


def test_unknown_currency_passes_through_instead_of_dropping_the_value():
    # Prefer showing an unconverted number over silently losing user data.
    assert to_usd(42.0, "ZZZ") == 42.0


def test_supported_advertises_at_least_the_usd_baseline_and_inr():
    assert "USD" in SUPPORTED
    assert "INR" in SUPPORTED
