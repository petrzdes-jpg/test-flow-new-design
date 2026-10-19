"""Flow API — цифровой штаб строительства.

Реальный контур: вход по основному паролю (/api/auth/login) и чтение проектов (/api/projects).
Демо-контур: /api/demo/* (роли, база подрядчиков, датасеты демо-объектов, журнал действий).
Токены контуров не взаимозаменяемы — проверка выполняется на сервере.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import psycopg
from fastapi import Depends, FastAPI, HTTPException, Path
from pydantic import BaseModel, Field
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg_pool import PoolTimeout
from starlette.concurrency import run_in_threadpool

from . import auth, db
from .demo import router as demo_router
from .config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("flow.api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.db.configured:
        try:
            db.get_pool()
        except Exception:  # приложение стартует и без базы; ошибка будет в ответе /api
            log.exception("Не удалось создать пул соединений PostgreSQL")
    else:
        log.warning("PostgreSQL не настроен: не заданы %s", ", ".join(settings.db.missing()))
    yield
    db.close_pool()


app = FastAPI(
    title="Flow API",
    version="0.2.0",
    description="API Flow — цифрового штаба строительства (dsflow.ru).",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)


@app.exception_handler(db.DatabaseNotConfigured)
async def _db_not_configured(_, exc: db.DatabaseNotConfigured):
    log.error("%s", exc)
    return JSONResponse(status_code=503, content={"detail": "База данных не настроена."})


@app.exception_handler(db.ProjectsTableError)
async def _projects_table(_, exc: db.ProjectsTableError):
    log.error("%s", exc)
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.exception_handler(psycopg.Error)
async def _db_error(_, exc: psycopg.Error):
    log.error("Ошибка PostgreSQL: %s", exc)
    return JSONResponse(status_code=503, content={"detail": "База данных недоступна."})


@app.exception_handler(PoolTimeout)
async def _pool_timeout(_, exc: PoolTimeout):
    log.error("Нет свободного соединения с PostgreSQL: %s", exc)
    return JSONResponse(status_code=503, content={"detail": "База данных недоступна."})


@app.get("/health", tags=["service"])
def health() -> dict:
    """Проверка работы сервиса (для healthcheck Timeweb). Базу не опрашивает."""
    return {"status": "ok"}


@app.get("/health/db", tags=["service"])
async def health_db() -> dict:
    """Проверка соединения с PostgreSQL."""
    await run_in_threadpool(db.ping)
    return {"status": "ok", "database": "ok"}


class RealLoginIn(BaseModel):
    password: str = Field(..., max_length=256)


@app.post("/api/auth/login", tags=["auth"])
def real_login(body: RealLoginIn) -> dict:
    """Основной вход стартового экрана: открывает только реальный контур (scope = real)."""
    if not auth.check_real_password(body.password):
        raise HTTPException(status_code=401, detail="Неверный пароль.")
    return {"token": auth.sign({"scope": "real", "login": "main", "role": "admin", "name": "Рабочий контур"}), "scope": "real"}


@app.get("/api/auth/me", tags=["auth"])
def real_me(p: auth.Principal = Depends(auth.require_real)) -> dict:
    return {"scope": p.scope, "role": p.role, "name": p.name}


app.include_router(demo_router)


@app.get("/api/projects", tags=["projects"])
async def list_projects(_: auth.Principal = Depends(auth.require_real)) -> list[dict]:
    rows = await run_in_threadpool(db.list_projects)
    return jsonable_encoder(rows)


@app.get("/api/projects/{slug}", tags=["projects"])
async def get_project(slug: str = Path(..., pattern=r"^[a-z0-9][a-z0-9_-]{0,63}$", description="Например: ogni, ramenki"),
                      _: auth.Principal = Depends(auth.require_real)) -> dict:
    row = await run_in_threadpool(db.get_project, slug)
    if row is None:
        raise HTTPException(status_code=404, detail="Проект не найден.")
    return jsonable_encoder(row)
