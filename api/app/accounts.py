"""Учётные записи демо-контура Flow: пользователи, роли, права, пароли, журнал безопасности.

Единый механизм для всех ролей (администратор, директор, техзаказчик, сметчик, ГИП, инвестор,
подрядчики и роли, созданные администратором):
  * пароль — только хеш PBKDF2-HMAC-SHA256 с солью; в журнал не пишется;
  * смена пароля увеличивает версию (pv) — ранее выданные сессии пользователя перестают действовать;
  * права = права роли ∪ индивидуальные разрешения − индивидуальные запреты;
  * доступ к объектам: роль «все объекты» или назначенные; администратор может задать список вручную;
  * защита: последний активный администратор не удаляется и не теряет права, суперадминистратора
    меняет только суперадминистратор, пароли администраторов — отдельное разрешение.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import threading
import time
from typing import Any

from fastapi import HTTPException

from .demo_storage import storage
from .perms import ALL, DEFAULT_ROLES

DEMO_PASSWORD = "1234"
_lock = threading.RLock()


# ---------------------------------------------------------------- пароли
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    it = 120_000
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), it).hex()
    return f"pbkdf2${it}${salt}${h}"


def check_password(password: str, stored: str | None, login: str = "") -> bool:
    if not stored:
        return False
    if stored.startswith("pbkdf2$"):
        _, it, salt, h = stored.split("$")
        got = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(it)).hex()
        return hmac.compare_digest(got, h)
    # формат версии 1 (sha256 с логином) — для записей, созданных до обновления
    got = hashlib.sha256(f"flow.demo:{login.lower()}:{password}".encode()).hexdigest()
    return hmac.compare_digest(got, stored)


def password_policy(pw: str) -> str | None:
    if len(pw or "") < 4:
        return "Пароль должен быть не короче 4 символов."
    if len(pw) > 128:
        return "Слишком длинный пароль."
    return None


# ---------------------------------------------------------------- хранилище
def roles() -> list[dict]:
    with _lock:
        items = storage().get("roles")
        if items is None:
            items = [dict(r) for r in DEFAULT_ROLES]
            storage().put("roles", items)
        # системные роли, появившиеся в новой версии, добавляются, существующие настройки не меняются
        have = {r["id"] for r in items}
        added = [dict(r) for r in DEFAULT_ROLES if r["id"] not in have]
        if added:
            items += added
            storage().put("roles", items)
        return items


def role(rid: str) -> dict | None:
    return next((r for r in roles() if r["id"] == rid), None)


def save_roles(items: list[dict]) -> None:
    storage().put("roles", items)


def users() -> list[dict]:
    with _lock:
        items = storage().get("users")
        if items is None:
            items = _seed_users()
            storage().put("users", items)
        return items


def save_users(items: list[dict]) -> None:
    storage().put("users", items)


def user_by_login(login: str) -> dict | None:
    login = (login or "").strip().lower()
    return next((u for u in users() if u["login"].lower() == login), None)


def user_by_id(uid: str) -> dict | None:
    return next((u for u in users() if u["id"] == uid), None)


def audit(actor: str, action: str, target: str = "", details: Any = None) -> None:
    with _lock:
        log = storage().get("audit", [])
        log.insert(0, {"at": time.strftime("%Y-%m-%d %H:%M:%S"), "actor": actor, "action": action, "target": target, "details": details})
        storage().put("audit", log[:2000])


def _seed_users() -> list[dict]:
    from . import demo  # подрядчики — из базы подрядчиков
    staff = [
        ("admin", "admin", "Администратор Flow", True, None),
        ("director", "director", "Директор по строительству", False, None),
        ("tech", "tz", "Технический заказчик", False, None),
        ("investor", "viewer", "Инвестор", False, None),
        ("smeta", "estimator", "Сметчик", False, ["kristall", "bereg", "vostok"]),
        ("gip", "gip", "ГИП — главный инженер проекта", False, ["kristall"]),
    ]
    out = []
    for login, rid, name, sup, projects in staff:
        out.append({"id": "u-" + login, "login": login, "name": name, "role": rid, "superadmin": sup, "active": True, "projects": projects,
                    "grants": [], "denies": [], "password_hash": hash_password(DEMO_PASSWORD), "pv": 1,
                    "created_at": time.strftime("%Y-%m-%d")})
    for c in demo.contractors():
        out.append(contractor_user(c, DEMO_PASSWORD))
    return out


def contractor_user(c: dict, password: str) -> dict:
    login = c.get("login") or ("contractor" + re.sub(r"\D", "", c["id"]))
    return {"id": "u-" + login, "login": login, "name": c["name"], "role": "contractor", "contractorId": c["id"], "superadmin": False, "active": not c.get("archived"),
            "projects": None, "grants": [], "denies": [], "password_hash": c.get("password_hash") or hash_password(password), "pv": 1,
            "created_at": c.get("created_at") or time.strftime("%Y-%m-%d")}


# ---------------------------------------------------------------- права
def effective(u: dict) -> set[str]:
    r = role(u.get("role")) or {"perms": []}
    p = set(r.get("perms", []))
    if u.get("superadmin"):
        return set(ALL)
    p |= set(u.get("grants") or [])
    p -= set(u.get("denies") or [])
    return p & set(ALL)


def is_admin_user(u: dict) -> bool:
    """Пользователь с правами администрирования (пароли таких пользователей — отдельное разрешение)."""
    return bool(u.get("superadmin")) or any(x in effective(u) for x in ("admin.roles", "admin.passwords", "admin.edit"))


def active_admins(items: list[dict]) -> list[dict]:
    return [u for u in items if u.get("active") and ("admin.roles" in effective(u) or u.get("superadmin"))]


def public_user(u: dict) -> dict:
    r = role(u.get("role")) or {}
    # пароль и его хеш наружу не передаются никогда (администратор задаёт новый, но не видит текущий)
    out = {k: v for k, v in u.items() if k not in ("password_hash", "temp_password")}
    out["roleTitle"] = r.get("title", u.get("role"))
    out["kind"] = r.get("kind", "staff")
    out["perms"] = sorted(effective(u))
    out["rolePerms"] = sorted(set(r.get("perms", [])))
    return out


def guard_admin_change(actor: dict, target: dict | None, after: list[dict]) -> None:
    if target and target.get("superadmin") and not actor.get("superadmin"):
        raise HTTPException(status_code=403, detail="Учётную запись суперадминистратора может менять только суперадминистратор.")
    if not active_admins(after):
        raise HTTPException(status_code=409, detail="Нельзя оставить систему без активного администратора.")
