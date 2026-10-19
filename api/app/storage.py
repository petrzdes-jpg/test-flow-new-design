"""S3-хранилище (Timeweb S3 или любое S3-совместимое). Подготовка для следующих этапов:
фото хода работ, отчёты, файлы ГПР. На первом этапе эндпоинтов нет — только клиент.

Переменные окружения: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
"""
from __future__ import annotations

from functools import lru_cache

from .config import settings


class StorageNotConfigured(RuntimeError):
    pass


@lru_cache(maxsize=1)
def get_s3_client():
    """Создаёт клиент boto3 при первом обращении (не при запуске приложения)."""
    cfg = settings.s3
    if not cfg.configured:
        raise StorageNotConfigured("Не заданы переменные S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.")
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint,
        region_name=cfg.region,
        aws_access_key_id=cfg.access_key,
        aws_secret_access_key=cfg.secret_key,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def bucket() -> str:
    if not settings.s3.bucket:
        raise StorageNotConfigured("Не задана переменная S3_BUCKET.")
    return settings.s3.bucket
