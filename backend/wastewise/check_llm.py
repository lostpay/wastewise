"""Standalone LLM connectivity smoke test.

Run it to prove whether the configured endpoint (Fireworks in dev, vLLM/AMD in
prod) actually answers -- as opposed to the agents silently falling back:

    python -m wastewise.check_llm

Exits 0 if a real model responded, 1 otherwise (handy for CI / demo prep).
"""
import sys

from wastewise.config import get_settings
from wastewise.agents.llm import LLMClient, format_status_banner


def main() -> int:
    s = get_settings()
    status = LLMClient(s.llm_base_url, s.llm_api_key, s.llm_model).ping()
    print(format_status_banner(status), file=sys.stderr)
    return 0 if status.live else 1


if __name__ == "__main__":
    raise SystemExit(main())
