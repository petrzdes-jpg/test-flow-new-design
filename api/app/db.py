"""Подключение к PostgreSQL (psycopg 3 + пул соединений) и чтение проектов.

Структура таблиц не меняется: API только читает `projects`. Колонки таблицы
определяются по information_schema, поэтому ответ повторяет фактическую структуру.
"""
from __future__ import annotations

import logging
import threading
from typing import Any

from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

log = logging.getLogger("dsflow.db")


class DatabaseNotConfigured(RuntimeError):
    pass


class ProjectsTableError(RuntimeError):
    pass


_pool: ConnectionPool | None = None
_lock = threading.Lock()
_columns_cache: list[str] | None = None

# Порядок сортировки списка: первая существующая колонка из этого перечня.
_ORDER_CANDIDATES = ("sort_order", "position", "order_index", "id", "created_at", "name")


def get_pool() -> ConnectionPool:
    global _pool
    if not settings.db.configured:
        raise DatabaseNotConfigured(
            "Не заданы переменные окружения: " + ", ".join(settings.db.missing())
        )
    with _lock:
        if _pool is None:
            _pool = ConnectionPool(
                kwargs=settings.db.conninfo_kwargs(),
                min_size=settings.db.pool_min,
                max_size=settings.db.pool_max,
                open=False,
                name="dsflow",
                timeout=10,
            )
            # Не ждём соединения при старте: приложение и /health поднимаются даже без БД.
            _pool.open(wait=False)
    return _pool


def close_pool() -> None:
    global _pool
    with _lock:
        if _pool is not None:
            _pool.close()
            _pool = None


def ping() -> bool:
    with get_pool().connection() as conn:
        conn.execute("SELECT 1")
    return True


def _table_columns() -> list[str]:
    global _columns_cache
    if _columns_cache is not None:
        return _columns_cache
    with get_pool().connection() as conn:
        rows = conn.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position",
            (settings.db.schema, settings.projects_table),
        ).fetchall()
    columns = [r[0] for r in rows]
    if not columns:
        raise ProjectsTableError(
            f"Таблица {settings.db.schema}.{settings.projects_table} не найдена или недоступна пользователю."
        )
    _columns_cache = columns
    return columns


def _table() -> sql.Composed:
    return sql.SQL("{}.{}").format(sql.Identifier(settings.db.schema), sql.Identifier(settings.projects_table))


def list_projects() -> list[dict[str, Any]]:
    columns = _table_columns()
    order = next((c for c in _ORDER_CANDIDATES if c in columns), None)
    query = sql.SQL("SELECT * FROM {}").format(_table())
    if order:
        query = query + sql.SQL(" ORDER BY {}").format(sql.Identifier(order))
    with get_pool().connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query)
            return cur.fetchall()


def get_project(slug: str) -> dict[str, Any] | None:
    columns = _table_columns()
    slug_column = settings.projects_slug_column
    if slug_column not in columns:
        raise ProjectsTableError(
            f"В таблице {settings.projects_table} нет колонки «{slug_column}». "
            "Укажите нужную колонку в переменной PROJECTS_SLUG_COLUMN."
        )
    query = sql.SQL("SELECT * FROM {} WHERE {} = %s LIMIT 1").format(_table(), sql.Identifier(slug_column))
    with get_pool().connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query, (slug,))
            return cur.fetchone()
