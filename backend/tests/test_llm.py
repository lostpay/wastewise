import pytest
from wastewise.agents.llm import extract_json, LLMClient


def test_extract_json_from_fenced_block():
    text = 'Here you go:\n```json\n[{"item": "cabbage", "qty": 12}]\n```'
    assert extract_json(text) == [{"item": "cabbage", "qty": 12}]


def test_extract_json_raises_when_absent():
    with pytest.raises(ValueError):
        extract_json("no json here")


class _FakeCompletions:
    def create(self, **kwargs):
        class M:  # minimal shape of the OpenAI response
            choices = [type("C", (), {"message": type("Msg", (), {"content": "hi"})})]
        return M()


class _FakeOpenAI:
    def __init__(self): self.chat = type("Chat", (), {"completions": _FakeCompletions()})


def test_complete_returns_content():
    client = LLMClient("url", "key", "model", _openai=_FakeOpenAI())
    assert client.complete("sys", "user") == "hi"


class _BoomCompletions:
    def create(self, **kwargs):
        raise RuntimeError("connection refused")


class _BoomOpenAI:
    def __init__(self):
        self.chat = type("Chat", (), {"completions": _BoomCompletions()})


def test_ping_live_when_model_responds():
    client = LLMClient("url", "realkey", "model", _openai=_FakeOpenAI())
    status = client.ping()
    assert status.live is True


def test_ping_flags_placeholder_key_without_calling():
    # "changeme" is the shipped default; ping must not even attempt a call.
    client = LLMClient("url", "changeme", "model", _openai=_BoomOpenAI())
    status = client.ping()
    assert status.live is False
    assert "changeme" in status.detail


def test_ping_down_on_transport_error():
    client = LLMClient("url", "realkey", "model", _openai=_BoomOpenAI())
    status = client.ping()
    assert status.live is False
    assert "connection refused" in status.detail
