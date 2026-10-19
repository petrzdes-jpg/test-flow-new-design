"""Хранилище демо-контура Flow: база подрядчиков и журнал действий пользователей.

Два варианта (переменная FLOW_DEMO_STORAGE):
  * file (по умолчанию) — JSON-файлы в каталоге FLOW_DATA_DIR (по умолчанию ./var).
    На App Platform каталог может очищаться при новом деплое — демо при этом возвращается
    к исходному состоянию, реальные данные не затрагиваются;
  * postgres — таблицы flow_demo_contractors и flow_demo_journal
    (создаются миграцией api/migrations/001_flow_demo.sql).

Демо-хранилище физически отделено от реальных данных: оно не читает и не пишет
таблицу projects и не содержит записей реальных объектов.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("flow.demo.storage")


class FileStorage:
    name = "file"

    def __init__(self, root: str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def _path(self, name: str) -> Path:
        return self.root / name

    def _read(self, name: str, default: Any) -> Any:
        p = self._path(name)
        if not p.exists():
            return default
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            log.exception("Не удалось прочитать %s", p)
            return default

    def _write(self, name: str, value: Any) -> None:
        p = self._path(name)
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, p)

    # --- произвольные наборы: пользователи, роли, журнал безопасности ---
    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self._read(f"{key}.json", default)

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            self._write(f"{key}.json", value)

    # --- файлы (документы, сметы, сканы) ---
    def file_path(self, fid: str) -> Path:
        d = self.root / "files"
        d.mkdir(exist_ok=True)
        return d / fid

    # --- подрядчики ---
    def contractors(self) -> list[dict] | None:
        with self._lock:
            return self._read("contractors.json", None)

    def save_contractors(self, items: list[dict]) -> None:
        with self._lock:
            self._write("contractors.json", items)

    # --- журнал ---
    def journal(self, project: str) -> list[dict]:
        with self._lock:
            return self._read(f"journal-{project}.json", [])

    def append(self, project: str, rows: list[dict]) -> None:
        with self._lock:
            cur = self._read(f"journal-{project}.json", [])
            now = time.time()
            for r in rows:
                cur.append({"kind": r["kind"], "entry": r["entry"], "author": r.get("author"), "role": r.get("role"), "at": now})
            self._write(f"journal-{project}.json", cur)



class PostgresStorage:
    name = "postgres"

    def __init__(self) -> None:
        from . import db  # пул соединений общего API
        self.db = db

    def get(self, key: str, default: Any = None) -> Any:
        with self.db.get_pool().connection() as conn:
            row = conn.execute("SELECT data FROM flow_demo_kv WHERE key = %s", (key,)).fetchone()
        return row[0] if row else default

    def put(self, key: str, value: Any) -> None:
        from psycopg.types.json import Jsonb
        with self.db.get_pool().connection() as conn:
            conn.execute("INSERT INTO flow_demo_kv (key, data, updated_at) VALUES (%s, %s, now()) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
                         (key, Jsonb(value)))

    def file_path(self, fid: str) -> Path:
        # файлы хранятся на диске и в режиме postgres (каталог FLOW_DATA_DIR/files); для общего хранения — S3 (следующий этап)
        d = Path(os.environ.get("FLOW_DATA_DIR") or str(Path(__file__).resolve().parent.parent / "var" / "demo")) / "files"
        d.mkdir(parents=True, exist_ok=True)
        return d / fid

    def contractors(self) -> list[dict] | None:
        with self.db.get_pool().connection() as conn:
            rows = conn.execute("SELECT data FROM flow_demo_contractors ORDER BY position, id").fetchall()
        return [r[0] for r in rows] if rows else None

    def save_contractors(self, items: list[dict]) -> None:
        from psycopg.types.json import Jsonb
        with self.db.get_pool().connection() as conn:
            with conn.transaction():
                conn.execute("DELETE FROM flow_demo_contractors")
                for i, it in enumerate(items):
                    conn.execute("INSERT INTO flow_demo_contractors (id, position, data, updated_at) VALUES (%s, %s, %s, now())",
                                 (it["id"], i, Jsonb(it)))

    def journal(self, project: str) -> list[dict]:
        with self.db.get_pool().connection() as conn:
            rows = conn.execute("SELECT kind, entry, author, role, extract(epoch from created_at) FROM flow_demo_journal WHERE project = %s ORDER BY id",
                                (project,)).fetchall()
        return [{"kind": k, "entry": e, "author": a, "role": r, "at": float(t)} for k, e, a, r, t in rows]

    def append(self, project: str, rows: list[dict]) -> None:
        from psycopg.types.json import Jsonb
        with self.db.get_pool().connection() as conn:
            with conn.transaction():
                for r in rows:
                    conn.execute("INSERT INTO flow_demo_journal (project, kind, entry, author, role) VALUES (%s, %s, %s, %s, %s)",
                                 (project, r["kind"], Jsonb(r["entry"]), r.get("author"), r.get("role")))



_storage = None
_lock = threading.Lock()


def storage():
    global _storage
    with _lock:
        if _storage is None:
            kind = (os.environ.get("FLOW_DEMO_STORAGE") or "file").strip().lower()
            if kind == "postgres":
                _storage = PostgresStorage()
            else:
                _storage = FileStorage(os.environ.get("FLOW_DATA_DIR") or str(Path(__file__).resolve().parent.parent / "var" / "demo"))
            log.info("Демо-хранилище: %s", _storage.name)
        return _storage


def set_storage(s) -> None:
    """Для тестов: подменить хранилище."""
    global _storage
    with _lock:
        _storage = s
