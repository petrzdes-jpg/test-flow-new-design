"""Тесты DSFlow API.

Без базы:   pytest -q                    (health, CORS, ответ при отсутствии настроек БД)
С базой:    DSFLOW_TEST_DB=1 DB_HOST=... DB_NAME=... DB_USER=... DB_PASSWORD=... pytest -q
            Тесты с базой создают и удаляют ОТДЕЛЬНУЮ схему dsflow_test — рабочие таблицы не затрагиваются.
            Запускайте их только на тестовой базе.
"""
import importlib
import os
import sys

import pytest
from fastapi.testclient import TestClient

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

DB_KEYS = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SCHEMA", "DB_SSLMODE"]


def load_app(monkeypatch, env: dict):
    import hashlib, tempfile
    for key in DB_KEYS + ["CORS_ORIGINS", "CORS_ORIGIN_REGEX"]:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("REAL_PASSWORD_SHA256", hashlib.sha256(b"dsflow.v1:test").hexdigest())
    monkeypatch.setenv("FLOW_SECRET", "test-secret")
    monkeypatch.setenv("FLOW_DATA_DIR", tempfile.mkdtemp(prefix="flow-demo-"))
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    for name in [m for m in list(sys.modules) if m == "main" or m.startswith("app.") or m == "app"]:
        del sys.modules[name]
    import main  # noqa: F401
    return importlib.import_module("main").app


def real_headers(client):
    """Токен реального контура. В тестах хэш основного пароля подменяется: REAL_PASSWORD_SHA256 = sha256('dsflow.v1:test')."""
    r = client.post("/api/auth/login", json={"password": "test"})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_health_without_database(monkeypatch):
    app = load_app(monkeypatch, {})
    with TestClient(app) as client:
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}
        assert client.get("/api/projects").status_code == 401          # без входа реальные данные не выдаются
        r = client.get("/api/projects", headers=real_headers(client))
        assert r.status_code == 503
        assert r.json() == {"detail": "База данных не настроена."}


def test_cors(monkeypatch):
    app = load_app(monkeypatch, {})
    with TestClient(app) as client:
        for origin in ["https://dsflow.ru", "https://www.dsflow.ru", "https://dsflow-app-abc123.twc1.net"]:
            r = client.get("/health", headers={"Origin": origin})
            assert r.headers.get("access-control-allow-origin") == origin
        r = client.get("/health", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in r.headers
        r = client.options("/api/projects", headers={"Origin": "https://dsflow.ru", "Access-Control-Request-Method": "GET"})
        assert r.status_code == 200


def test_invalid_slug(monkeypatch):
    app = load_app(monkeypatch, {})
    with TestClient(app) as client:
        h = real_headers(client)
        assert client.get("/api/projects/..%2Fetc", headers=h).status_code in (404, 422)
        assert client.get("/api/projects/Ogni;DROP", headers=h).status_code == 422


needs_db = pytest.mark.skipif(os.environ.get("DSFLOW_TEST_DB") != "1", reason="нужна тестовая база: DSFLOW_TEST_DB=1")


@pytest.fixture
def db_app(monkeypatch):
    import psycopg

    env = {k: os.environ[k] for k in DB_KEYS if os.environ.get(k)}
    conn_kwargs = dict(host=env["DB_HOST"], port=env.get("DB_PORT", "5432"), dbname=env["DB_NAME"], user=env["DB_USER"], password=env.get("DB_PASSWORD"))
    with psycopg.connect(**conn_kwargs, autocommit=True) as conn:
        conn.execute("DROP SCHEMA IF EXISTS dsflow_test CASCADE")
        conn.execute("CREATE SCHEMA dsflow_test")
        conn.execute("CREATE TABLE dsflow_test.projects (id serial PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL, stage text, readiness numeric(5,2), updated_at timestamptz DEFAULT now())")
        conn.execute("INSERT INTO dsflow_test.projects (slug, name, stage, readiness) VALUES ('ogni','БЦ «Огни»','Нулевой цикл',1.7), ('ramenki','БЦ «Раменки»','Надземная часть КЖ',37.3)")
    env["DB_SCHEMA"] = "dsflow_test"
    app = load_app(monkeypatch, env)
    yield app
    with psycopg.connect(**conn_kwargs, autocommit=True) as conn:
        conn.execute("DROP SCHEMA IF EXISTS dsflow_test CASCADE")


@needs_db
def test_projects_from_database(db_app):
    with TestClient(db_app) as client:
        assert client.get("/health/db").json() == {"status": "ok", "database": "ok"}
        h = real_headers(client)
        r = client.get("/api/projects", headers=h)
        assert r.status_code == 200
        data = r.json()
        assert [p["slug"] for p in data] == ["ogni", "ramenki"]
        assert data[0]["name"] == "БЦ «Огни»" and data[0]["readiness"] == 1.7
        r = client.get("/api/projects/ramenki", headers=h)
        assert r.status_code == 200 and r.json()["name"] == "БЦ «Раменки»"
        assert client.get("/api/projects/ogni", headers=h).json()["slug"] == "ogni"
        r = client.get("/api/projects/unknown", headers=h)
        assert r.status_code == 404 and r.json() == {"detail": "Проект не найден."}
