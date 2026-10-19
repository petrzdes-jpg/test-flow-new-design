"""Авторизация Flow: подписанные токены и проверка паролей.

Два независимых контура:
  * scope = "real" — основной вход стартового экрана (реальные проекты «Огни», «Раменки»);
  * scope = "demo" — демо-режим с ролями (admin, director, tech, investor, contractorN).

Токен демо-контура не открывает реальные данные и наоборот: каждый эндпоинт
проверяет scope и роль на сервере, а не полагается на скрытие кнопок в интерфейсе.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, HTTPException, Request

log = logging.getLogger("flow.auth")

_SECRET = os.environ.get("FLOW_SECRET") or ""
if not _SECRET:
    # Без FLOW_SECRET токены действуют только до перезапуска процесса — для демо это допустимо.
    _SECRET = secrets.token_urlsafe(48)
    log.warning("FLOW_SECRET не задан: используется временный ключ подписи (сессии сбросятся при перезапуске).")
_KEY = _SECRET.encode()

TOKEN_TTL = int(os.environ.get("FLOW_TOKEN_TTL", str(12 * 3600)))

# Хэш основного пароля: sha256("dsflow.v1:" + пароль). Значение по умолчанию совпадает
# с хэшем, который уже использует экран входа, поэтому текущий пароль продолжает работать.
DEFAULT_REAL_HASH = "5bec60f7472f240d87e261149c7f7d3929aa8817100d955e1454f02a903cc70a"
REAL_PASSWORD_SHA256 = (os.environ.get("REAL_PASSWORD_SHA256") or DEFAULT_REAL_HASH).strip().lower()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign(payload: dict[str, Any], ttl: int = TOKEN_TTL) -> str:
    body = dict(payload)
    body["exp"] = int(time.time()) + ttl
    raw = _b64(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode())
    mac = _b64(hmac.new(_KEY, raw.encode(), hashlib.sha256).digest())
    return raw + "." + mac


def verify(token: str | None) -> dict[str, Any] | None:
    if not token or token.count(".") != 1:
        return None
    raw, mac = token.split(".")
    good = _b64(hmac.new(_KEY, raw.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(mac, good):
        return None
    try:
        body = json.loads(_unb64(raw))
    except Exception:
        return None
    if int(body.get("exp", 0)) < time.time():
        return None
    return body


def password_hash(login: str, password: str) -> str:
    """Хэш пароля демо-учётной записи (соль — логин)."""
    return hashlib.sha256(f"flow.demo:{login.lower()}:{password}".encode()).hexdigest()


def check_real_password(password: str) -> bool:
    got = hashlib.sha256(("dsflow.v1:" + (password or "")).encode()).hexdigest()
    return hmac.compare_digest(got, REAL_PASSWORD_SHA256)


@dataclass
class Principal:
    scope: str
    login: str
    role: str
    org: str | None = None
    uid: str | None = None
    name: str | None = None
    pv: int | None = None


def _bearer(request: Request) -> str | None:
    h = request.headers.get("authorization") or ""
    if h.lower().startswith("bearer "):
        return h[7:].strip()
    return None


def optional_principal(request: Request) -> Principal | None:
    body = verify(_bearer(request))
    if not body:
        return None
    return Principal(scope=body.get("scope", ""), login=body.get("login", ""), role=body.get("role", ""),
                     org=body.get("org"), uid=body.get("uid"), name=body.get("name"), pv=body.get("pv"))


def require_demo(p: Principal | None = Depends(optional_principal)) -> Principal:
    if p is None:
        raise HTTPException(status_code=401, detail="Требуется вход в демо-режим.")
    if p.scope != "demo":
        raise HTTPException(status_code=403, detail="Учётная запись не относится к демо-режиму.")
    return p


def require_real(p: Principal | None = Depends(optional_principal)) -> Principal:
    if p is None:
        raise HTTPException(status_code=401, detail="Требуется вход.")
    if p.scope != "real":
        raise HTTPException(status_code=403, detail="Демо-учётная запись не даёт доступа к реальным проектам.")
    return p
