import json
import re
from openai import OpenAI

_JSON_RE = re.compile(r"(\[.*\]|\{.*\})", re.DOTALL)


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
        self.client = _openai or OpenAI(base_url=base_url, api_key=api_key)

    def complete(self, system: str, user: str) -> str:
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": user}],
            temperature=0.2,
        )
        return resp.choices[0].message.content
