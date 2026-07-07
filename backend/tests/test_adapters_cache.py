from wastewise.adapters.base import FileCache


def test_cache_set_get_roundtrip(tmp_path):
    cache = FileCache(str(tmp_path))
    assert cache.get("k1") is None
    cache.set("k1", {"a": 1})
    assert cache.get("k1") == {"a": 1}


def test_cache_key_is_filesystem_safe(tmp_path):
    cache = FileCache(str(tmp_path))
    cache.set("weather/2026-01-01/New York", {"ok": True})
    assert cache.get("weather/2026-01-01/New York") == {"ok": True}
