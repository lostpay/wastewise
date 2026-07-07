from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    llm_base_url: str = "https://api.fireworks.ai/inference/v1"
    llm_api_key: str = "changeme"
    llm_model: str = "accounts/fireworks/models/llama-v3p1-8b-instruct"
    usda_api_key: str = "changeme"
    kroger_client_id: str = "changeme"
    kroger_client_secret: str = "changeme"
    db_path: str = "wastewise.sqlite3"
    cache_dir: str = "wastewise/data/cache"


@lru_cache
def get_settings() -> Settings:
    return Settings()
