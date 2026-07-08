import json
import re
from dataclasses import dataclass
from openai import OpenAI

_JSON_RE = re.compile(r"(\[.*\]|\{.*\})", re.DOTALL)

_PLACEHOLDER_KEYS = {"", "changeme"}


@dataclass
class LLMStatus:
    live: bool          # True = a real model answered; False = agents will fall back
    base_url: str
    model: str
    detail: str         # human-readable reason / evidence


def format_status_banner(status: LLMStatus) -> str:
    bar = "=" * 70
    if status.live:
        body = (
            "  [ LLM LIVE ]  real inference IS being used\n"
            f"    endpoint : {status.base_url}\n"
            f"    model    : {status.model}\n"
            f"    evidence : {status.detail}"
        )
    else:
        body = (
            "  [ LLM DOWN ]  endpoint unreachable -- agents will run on\n"
            "                DETERMINISTIC FALLBACKS (no model is being used for\n"
            "                forecast adjustment or sourcing notes)\n"
            f"    endpoint : {status.base_url}\n"
            f"    model    : {status.model}\n"
            f"    reason   : {status.detail}"
        )
    return f"\n{bar}\n{body}\n{bar}"


def extract_json(text: str):
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text
    match = _JSON_RE.search(candidate)
    if not match:
        raise ValueError("no JSON found in model output")
    return json.loads(match.group(1))


class LLMClient:
    def __init__(self, base_url: str, api_key: str, model: str, _openai=None):
        self.model = model
        self.base_url = base_url
        self.api_key = api_key
        self.client = _openai or OpenAI(base_url=base_url, api_key=api_key)

    def complete(self, system: str, user: str) -> str:
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": user}],
            temperature=0.2,
        )
        return resp.choices[0].message.content

    def ping(self) -> LLMStatus:
        """Make a tiny real call to prove the endpoint answers. This is the ONLY
        way to distinguish real inference from the agents' silent fallbacks."""
        if self.api_key in _PLACEHOLDER_KEYS:
            return LLMStatus(False, self.base_url, self.model,
                             "LLM_API_KEY is the placeholder 'changeme' "
                             "(set a real key in backend/.env)")
        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": "Reply with the single word: OK"}],
                temperature=0,
                max_tokens=16,
            )
            choice = resp.choices[0]
            content = (choice.message.content or "").strip()
            finish = getattr(choice, "finish_reason", None)
        except Exception as e:  # transport, auth, bad model id, etc.
            return LLMStatus(False, self.base_url, self.model,
                             f"{type(e).__name__}: {e}")
        # A 200 with a choice proves the endpoint answered; reasoning models may
        # return empty content under a tiny token budget, which is still "live".
        return LLMStatus(True, self.base_url, self.model,
                         f"HTTP 200, finish_reason={finish!r}, content={content[:32]!r}")
