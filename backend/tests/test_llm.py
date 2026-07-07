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
