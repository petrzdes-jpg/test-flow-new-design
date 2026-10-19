"""Точка входа DSFlow API (Timeweb App Platform ожидает main.py в корне директории проекта).

Запуск:  python3 main.py
Слушает 0.0.0.0 и порт из переменной окружения PORT (по умолчанию 8000).
"""
import os

from app.application import app  # noqa: F401  — объект app нужен и для `uvicorn main:app`

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
        proxy_headers=True,
        forwarded_allow_ips="*",
        log_level=os.environ.get("LOG_LEVEL", "info"),
    )
