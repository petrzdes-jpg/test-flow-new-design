"""Настройки DSFlow API. Все значения берутся только из переменных окружения.

Секреты (пароли, ключи) в коде не задаются и не имеют значений по умолчанию.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = _env(name)
    if raw is None:
        return default
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class DatabaseSettings:
    host: str | None
    port: int
    name: str | None
    user: str | None
    password: str | None
    sslmode: str | None
    schema: str
    connect_timeout: int
    pool_min: int
    pool_max: int

    @property
    def configured(self) -> bool:
        return bool(self.host and self.name and self.user)

    def missing(self) -> list[str]:
        names = {"DB_HOST": self.host, "DB_NAME": self.name, "DB_USER": self.user}
        return [key for key, value in names.items() if not value]

    def conninfo_kwargs(self) -> dict:
        kwargs = {
            "host": self.host,
            "port": self.port,
            "dbname": self.name,
            "user": self.user,
            "connect_timeout": self.connect_timeout,
            "application_name": "dsflow-api",
        }
        if self.password is not None:
            kwargs["password"] = self.password
        if self.sslmode:
            kwargs["sslmode"] = self.sslmode
        return kwargs


@dataclass(frozen=True)
class S3Settings:
    endpoint: str | None
    region: str | None
    bucket: str | None
    access_key: str | None
    secret_key: str | None

    @property
    def configured(self) -> bool:
        return all([self.endpoint, self.bucket, self.access_key, self.secret_key])


@dataclass(frozen=True)
class Settings:
    db: DatabaseSettings
    s3: S3Settings
    port: int
    cors_origins: list[str] = field(default_factory=list)
    cors_origin_regex: str | None = None
    projects_table: str = "projects"
    projects_slug_column: str = "slug"


def load_settings() -> Settings:
    return Settings(
        db=DatabaseSettings(
            host=_env("DB_HOST"),
            port=int(_env("DB_PORT", "5432")),
            name=_env("DB_NAME"),
            user=_env("DB_USER"),
            password=os.environ.get("DB_PASSWORD"),  # может содержать пробелы — не обрезаем
            sslmode=_env("DB_SSLMODE"),               # необязательно: disable | prefer | require | verify-full
            schema=_env("DB_SCHEMA", "public"),
            connect_timeout=int(_env("DB_CONNECT_TIMEOUT", "5")),
            pool_min=int(_env("DB_POOL_MIN", "1")),
            pool_max=int(_env("DB_POOL_MAX", "5")),
        ),
        s3=S3Settings(
            endpoint=_env("S3_ENDPOINT"),
            region=_env("S3_REGION"),
            bucket=_env("S3_BUCKET"),
            access_key=_env("S3_ACCESS_KEY"),
            secret_key=os.environ.get("S3_SECRET_KEY") or None,
        ),
        port=int(_env("PORT", "8000")),
        # Основной домен и временный технический домен Timeweb.
        # Технический домен задайте в CORS_ORIGINS после создания приложения
        # (например: https://dsflow.ru,https://www.dsflow.ru,https://<имя>.twc1.net).
        cors_origins=_env_list("CORS_ORIGINS", ["https://dsflow.ru", "https://www.dsflow.ru"]),
        cors_origin_regex=_env("CORS_ORIGIN_REGEX", r"https://[a-z0-9-]+\.twc1\.net"),
        projects_table=_env("PROJECTS_TABLE", "projects"),
        projects_slug_column=_env("PROJECTS_SLUG_COLUMN", "slug"),
    )


settings = load_settings()
