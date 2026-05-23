from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    SECRET: str = "change-me-in-production"
    REDIS_URL: str = "redis://localhost:6379"
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/analytic"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
