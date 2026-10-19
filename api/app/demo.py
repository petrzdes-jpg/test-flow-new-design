"""Демо-контур Flow: пользователи и права, база подрядчиков, виды работ, датасеты, журнал действий, файлы.

Все проверки прав выполняются здесь, на сервере (интерфейс только скрывает недоступное):
  * права — ячейки матрицы «раздел.действие» (perms.py), роль задаёт администратор (accounts.py);
  * объекты: подрядчик — назначенные ему, сметчик и ГИП — назначенные, остальные — по роли;
    чужой объект по подставленному ID — 403;
  * датасет фильтруется по виду роли: подрядчик видит свои договоры, сметы, КС-2, отчёты, документы;
    инвестор не получает КС-2 в работе и внутренние согласования; без права «Бюджет и КС: просмотр»
    суммы договоров не передаются;
  * каждая запись журнала проверяется по ячейке прав, ступени согласования и принадлежности.

Демо-данные никогда не смешиваются с реальными: датасеты — api/demo_data, журнал и учётные записи —
отдельное демо-хранилище (demo_storage), реальная таблица projects не используется.
"""
from __future__ import annotations

import copy
import json
import mimetypes
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import accounts as A
from . import auth
from .demo_storage import storage
from .perms import ACTIONS, ALL, ALIAS, SECTIONS

router = APIRouter(prefix="/api/demo", tags=["demo"])

DATA_DIR = Path(__file__).resolve().parent.parent / "demo_data"
MANIFEST = json.loads((DATA_DIR / "manifest.json").read_text(encoding="utf-8"))
DEMO_PASSWORD = A.DEMO_PASSWORD
FILE_TYPES = [x.strip().lower() for x in (os.environ.get("FLOW_FILE_TYPES") or "pdf,dwg,docx,xlsx,jpg,jpeg,png").split(",") if x.strip()]
FILE_MAX = int(os.environ.get("FLOW_FILE_MAX_MB", "25")) * 1024 * 1024


# ---------------------------------------------------------------- текущий пользователь
class Me:
    """Пользователь запроса: учётная запись, роль, действующие права, видимые объекты."""

    def __init__(self, u: dict) -> None:
        self.u = u
        self.id = u["id"]
        self.login = u["login"]
        self.name = u.get("name")
        self.role = u.get("role")
        r = A.role(self.role) or {}
        self.kind = r.get("kind", "staff")
        self.step = r.get("step")
        self.perms = A.effective(u)
        self.contractor = contractor_by_id(u.get("contractorId")) if self.kind == "contractor" else None
        self.org = self.contractor["name"] if self.contractor else None

    def can(self, cell: str) -> bool:
        return ALIAS.get(cell, cell) in self.perms

    def need(self, cell: str, msg: str = "Недостаточно прав для этого действия.") -> None:
        if not self.can(cell):
            raise HTTPException(status_code=403, detail=msg)

    def projects(self) -> list[str]:
        all_ids = list(MANIFEST["projects"])
        if self.u.get("projects") is not None:
            return [p for p in self.u["projects"] if p in all_ids]
        if self.kind == "contractor":
            c = self.contractor
            if not c or c.get("archived"):
                return []
            return [a["project"] for a in c.get("assignments", []) if a.get("project") in all_ids]
        r = A.role(self.role) or {}
        return all_ids if r.get("scope", "all") == "all" else []


def current(p: auth.Principal = Depends(auth.require_demo)) -> Me:
    u = A.user_by_id(p.uid) if p.uid else A.user_by_login(p.login)
    if not u or not u.get("active"):
        raise HTTPException(status_code=401, detail="Учётная запись отключена.")
    if int(u.get("pv", 1)) != int(p.pv or 1):
        raise HTTPException(status_code=401, detail="Пароль изменён — войдите заново.")
    return Me(u)


def _forbid(msg: str) -> None:
    raise HTTPException(status_code=403, detail=msg)


# ---------------------------------------------------------------- датасеты
_ds_cache: dict[str, dict] = {}
_ds_lock = threading.Lock()


def dataset(pid: str) -> dict:
    if pid not in MANIFEST["projects"]:
        raise HTTPException(status_code=404, detail="Объект не найден.")
    with _ds_lock:
        if pid not in _ds_cache:
            _ds_cache[pid] = json.loads((DATA_DIR / f"{pid}.json").read_text(encoding="utf-8"))
        return _ds_cache[pid]


def _is_tz_contract(P: dict, c: dict) -> bool:
    subj = (c.get("subject") or "").lower()
    return c.get("contractor") == P.get("supervisor") or "технический заказчик" in subj or "строительный контроль" in subj


def norm_name(s: str) -> str:
    return re.sub(r"[^a-zа-я0-9]+", " ", str(s or "").lower().replace("ё", "е")).strip()


# ---------------------------------------------------------------- журнал
KINDS = ["events", "eventOps", "docs", "docOps", "orders", "orderOps", "ks", "ksOps", "letters", "reports", "reportOps",
         "remarks", "remarkOps", "decisions", "notes", "changes", "changeOps",
         "linkOps", "taskOps", "baselineOps", "workTypes", "contracts", "contractOps", "estimates", "estimateOps", "regdocs", "regdocOps", "aiChecks"]


def journal_state(pid: str) -> dict[str, list]:
    st: dict[str, list] = {k: [] for k in KINDS}
    for row in storage().journal(pid):
        if row.get("kind") in st:
            st[row["kind"]].append(row["entry"])
    return st


def work_types(pid: str, st: dict | None = None) -> list[dict]:
    st = st or journal_state(pid)
    P = dataset(pid)
    out = [dict(w) for w in P.get("workTypes", [])] or [{"id": i["code"], "name": i["name"]} for i in P.get("budget", {}).get("items", [])]
    for w in st["workTypes"]:
        if not any(norm_name(x["name"]) == norm_name(w.get("name")) for x in out):
            out.append({"id": w["id"], "name": w["name"], "added": True})
    return out


def contracts_of(pid: str, st: dict | None = None) -> list[dict]:
    """Договоры объекта: из датасета и зарегистрированные в системе (с правками)."""
    st = st or journal_state(pid)
    out = [dict(c) for c in dataset(pid).get("contracts", [])] + [dict(c, registered=True) for c in st["contracts"]]
    for op in st["contractOps"]:
        c = next((x for x in out if x["id"] == op.get("contract")), None)
        if c and op.get("op") == "edit":
            c.update({k: v for k, v in (op.get("patch") or {}).items() if k in ("contractor", "contractorId", "subject", "no", "workTypes")})
    return out


# ---------------------------------------------------------------- база подрядчиков
_c_lock = threading.RLock()


def seed_contractors() -> list[dict]:
    """Начальная база: организации-исполнители договоров демо-объектов (без технических заказчиков)."""
    orgs: dict[str, dict] = {}
    for pid in MANIFEST["projects"]:
        P = dataset(pid)
        reps: dict[str, int] = {}
        for r in P.get("reports", []):
            reps[r.get("org")] = reps.get(r.get("org"), 0) + 1
        for c in P.get("contracts", []):
            if _is_tz_contract(P, c):
                continue
            o = orgs.setdefault(c["contractor"], {"name": c["contractor"], "assign": {}, "reports": 0, "first": len(orgs), "late": True})
            o["late"] = o["late"] and bool(c.get("demoDocs"))   # организации демо-комплекта документов — в конце, нумерация прежних логинов не меняется
            a = o["assign"].setdefault(pid, {"project": pid, "workTypes": []})
            wt = next((w for w in a["workTypes"] if w["id"] == c.get("item")), None)
            if not wt:
                wt = {"id": c.get("item"), "zone": "", "tasks": [], "contracts": [], "active": True, "since": c.get("date")}
                a["workTypes"].append(wt)
            wt["contracts"].append(c["id"])
            o["reports"] += reps.get(c["contractor"], 0) if len(a["workTypes"]) == 1 and len(wt["contracts"]) == 1 else 0
    ordered = sorted(orgs.values(), key=lambda o: (o["late"], -o["reports"], -len(o["assign"]), o["first"]))
    out = []
    for i, o in enumerate(ordered, start=1):
        out.append({"id": f"c{i}", "login": f"contractor{i}", "name": o["name"], "inn": "", "kpp": "", "ogrn": "", "address": "", "bank": "", "extra": "",
                    "contacts": [], "archived": False, "assignments": list(o["assign"].values()), "created_at": time.strftime("%Y-%m-%d"), "history": []})
    return out


def _migrate_assignments(c: dict) -> None:
    """Формат версии 1 (объект → договоры, «работы» текстом) → виды работ с зонами ответственности."""
    for a in c.get("assignments", []):
        if "workTypes" in a:
            continue
        P = dataset(a["project"]) if a.get("project") in MANIFEST["projects"] else {"contracts": []}
        wts: list[dict] = []
        for cid in a.get("contracts", []):
            k = next((x for x in P.get("contracts", []) if x["id"] == cid), None)
            item = (k or {}).get("item") or "other"
            wt = next((w for w in wts if w["id"] == item), None)
            if not wt:
                wt = {"id": item, "zone": "", "tasks": [], "contracts": [], "active": True}
                wts.append(wt)
            wt["contracts"].append(cid)
        a["workTypes"] = wts
        a.pop("contracts", None)
        a.pop("works", None)


def contractors() -> list[dict]:
    with _c_lock:
        items = storage().contractors()
        if items is None:
            items = seed_contractors()
            storage().save_contractors(items)
        for c in items:
            _migrate_assignments(c)
        return items


def save_contractors(items: list[dict]) -> None:
    with _c_lock:
        storage().save_contractors(items)


def contractor_by_id(cid: str | None) -> dict | None:
    return next((c for c in contractors() if c["id"] == cid), None) if cid else None


def assignment(c: dict | None, pid: str) -> dict | None:
    return next((a for a in (c or {}).get("assignments", []) if a.get("project") == pid), None)


def own_contracts(me: Me, pid: str, st: dict | None = None) -> set[str]:
    """Договоры подрядчика на объекте: где он исполнитель (по базе) и назначенные администратором."""
    if me.kind != "contractor" or not me.contractor:
        return set()
    c = me.contractor
    ids = {k["id"] for k in contracts_of(pid, st) if k.get("contractor") == c["name"] or k.get("contractorId") == c["id"]}
    a = assignment(c, pid)
    for w in (a or {}).get("workTypes", []):
        if w.get("active", True):
            ids |= set(w.get("contracts") or [])
    return ids


def own_tasks(me: Me, pid: str, st: dict | None = None) -> set[str]:
    P = dataset(pid)
    own = own_contracts(me, pid, st)
    ids = {t["id"] for t in P.get("tasks", []) if t.get("contract") in own}
    a = assignment(me.contractor, pid)
    for w in (a or {}).get("workTypes", []):
        if w.get("active", True):
            ids |= set(w.get("tasks") or [])
    return ids


def check_project(me: Me, pid: str) -> None:
    dataset(pid)  # 404 для несуществующего
    if pid not in me.projects():
        raise HTTPException(status_code=403, detail="Объект не назначен этой учётной записи.")


def _ks_contract(ks_id: str) -> str | None:
    m = re.match(r"^ks-(.+)-u?\d+$", str(ks_id or ""))
    return m.group(1) if m else None


# ---------------------------------------------------------------- фильтр датасета по роли
def filter_dataset(me: Me, pid: str) -> dict:
    P = copy.deepcopy(dataset(pid))
    st = journal_state(pid)
    P["workTypes"] = work_types(pid, st)
    names = {c["id"]: c.get("contractor") for c in contracts_of(pid, st)}
    for t in P.get("tasks", []):
        if t.get("contract") in names:
            t["org"] = names[t["contract"]]
    if me.kind == "investor":
        P["ks2"] = []
        for k in ("letters", "remarks", "protocols", "orders", "decisions", "estimates", "regdocs"):
            P[k] = []
        P["documents"] = [d for d in P.get("documents", []) if isinstance(d, list) and d and d[0] in ("permits",)]
        P["readOnly"] = True
        return P
    if me.kind == "contractor":
        own = own_contracts(me, pid, st)
        tasks_own = own_tasks(me, pid, st)
        org = me.org
        P["contracts"] = [c for c in P.get("contracts", []) if c["id"] in own]
        items_used = {c.get("item") for c in P["contracts"]}
        P["budget"] = {"reserve": 0, "items": [dict(i, budget=0) for i in P.get("budget", {}).get("items", []) if i.get("code") in items_used]}
        for t in P.get("tasks", []):
            if t["id"] not in tasks_own:
                t["cost"] = 0
                t.pop("contract", None)
                t.pop("item", None)
            else:
                t["mine"] = True
        P["readiness"] = {"mode": "manual"}
        P["ks2"] = [k for k in P.get("ks2", []) if k.get("contract") in own]
        P["letters"] = [l for l in P.get("letters", []) if org and (l.get("from") == org or l.get("to") == org)]
        P["remarks"] = [r for r in P.get("remarks", []) if r.get("task") in tasks_own or r.get("org") == org]
        P["estimates"] = [e for e in P.get("estimates", []) if e.get("contract") in own]
        P["regdocs"] = [d for d in P.get("regdocs", []) if d.get("public") or d.get("org") == org or d.get("contract") in own]
        for r in P.get("risks", []):
            eff = r.get("effect") or {}
            eff.pop("cost", None)
            eff.pop("item", None)
        for r in P.get("reports", []):
            if r.get("org") != org:
                r["org"] = "Другой подрядчик"
                for k in ("crew", "note", "photos"):
                    r.pop(k, None)
        P["documents"] = [d for d in P.get("documents", []) if not (isinstance(d, list) and d and d[0] in ("contracts", "ks"))]
        P["myOrg"] = org
        P["myContracts"] = sorted(own)
        P["myTasks"] = sorted(tasks_own)
        return P
    if not me.can("contracts.view"):
        P["regdocs"] = [d for d in P.get("regdocs", []) if d.get("kind") != "contract"]
    if not me.can("budget.view"):
        # без права на бюджет суммы договоров и КС не передаются
        for c in P.get("contracts", []):
            c["amount"] = 0
            c.pop("supp", None)
        P["ks2"] = []
        P["budget"] = {"reserve": 0, "items": [dict(i, budget=0) for i in P.get("budget", {}).get("items", [])]}
        P["estimates"] = [] if not me.can("estimates.view") else P.get("estimates", [])
        P["readiness"] = P.get("readiness") or {"mode": "cost"}
        P["financeHidden"] = True
    return P


# ---------------------------------------------------------------- проверка записей журнала
def change_status(st: dict[str, list], cid: str) -> str | None:
    ch = next((c for c in st["changes"] if c.get("id") == cid), None)
    if not ch:
        return None
    s = "tz"
    for op in st["changeOps"]:
        if op.get("change") != cid:
            continue
        o = op.get("op")
        s = {"tz-approve": "director", "tz-reject": "rejected", "dir-reject": "rejected", "tz-return": "returned", "dir-return": "returned",
             "resubmit": "tz", "withdraw": "withdrawn", "dir-approve": "approved"}.get(o, s)
    return s


def estimate_status(st: dict[str, list], eid: str, P: dict) -> str | None:
    e = next((x for x in st["estimates"] + P.get("estimates", []) if x.get("id") == eid), None)
    if not e:
        return None
    s = e.get("status", "draft")
    for op in st["estimateOps"]:
        if op.get("estimate") == eid and op.get("to"):
            s = op["to"]
    return s


CONTRACTOR_KS_STEPS = {"sent", "formed"}
ESTIMATOR_KS_STEPS = {"checked", "estremarks"}


def validate_append(me: Me, pid: str, kind: str, e: dict, st: dict[str, list]) -> None:
    if kind not in KINDS:
        _forbid("Неизвестный тип записи.")
    P = dataset(pid)
    is_c = me.kind == "contractor"
    own = own_contracts(me, pid, st) if is_c else set()
    tasks_own = own_tasks(me, pid, st) if is_c else set()
    org = me.org

    if kind == "reports":
        me.need("production.create")
        if is_c and e.get("org") != org:
            _forbid("Отчёт можно подать только от своей организации.")
        if is_c and any(isinstance(l, list) and l and l[0] not in tasks_own for l in e.get("lines", [])):
            _forbid("В отчёте есть работы, не назначенные подрядчику.")
    elif kind == "reportOps":
        op = e.get("op")
        if op == "resubmit":
            me.need("production.create")
            rep = next((r for r in st["reports"] + P.get("reports", []) if r.get("id") == e.get("rep")), None)
            if is_c and (not rep or rep.get("org") != org):
                _forbid("Исправлять можно только свой отчёт.")
        elif op in ("correct", "cancel"):
            me.need("production.edit", "Корректировать внесённый факт может только уполномоченный пользователь.")
        else:
            me.need("production.agree")
            if e.get("step") != me.step and "admin.roles" not in me.perms:
                _forbid("Подтверждение доступно только на своей ступени.")
    elif kind == "remarks":
        me.need("quality.create")
        if e.get("org") is not None:
            org_ok = any(c.get("contractor") == e["org"] for c in contracts_of(pid, st)) or any(
                c["name"] == e["org"] and assignment(c, pid) for c in contractors() if not c.get("archived"))
            if not org_ok:
                _forbid("Организация не назначена на этот объект.")
            if e.get("contract"):
                k = next((c for c in contracts_of(pid, st) if c["id"] == e["contract"]), None)
                if not k or k.get("contractor") != e["org"]:
                    _forbid("Договор не относится к выбранной организации на этом объекте.")
            elif len((e.get("noContractReason") or "").strip()) < 3:
                _forbid("Укажите причину, по которой договор не указан.")
            if not e.get("workType") or not any(w["id"] == e["workType"] for w in work_types(pid, st)):
                _forbid("Выберите вид работ объекта.")
    elif kind == "remarkOps":
        to = e.get("to")
        if to == "presented" or (to == "work" and not e.get("back")):
            me.need("quality.edit")
            if is_c:
                rem = next((r for r in st["remarks"] + P.get("remarks", []) if r.get("id") == e.get("rem")), None)
                assigned = [o for o in st["remarkOps"] if o.get("rem") == e.get("rem") and o.get("org")]
                r_org = assigned[-1].get("org") if assigned else (rem or {}).get("org")
                if not (rem and (rem.get("task") in tasks_own or r_org == org)):
                    _forbid("Замечание выдано другому подрядчику.")
        elif to == "closed":
            if not (me.can("quality.approve") or me.can("quality.create")):
                _forbid("Недостаточно прав.")
        else:
            me.need("quality.create")
    elif kind == "notes":
        if not (me.can("calendar.create") or me.can("production.create")):
            _forbid("Недостаточно прав.")
        if is_c and e.get("task") and e.get("task") not in tasks_own:
            _forbid("Комментарий можно оставить только по своей работе.")
    elif kind in ("events", "orders"):
        me.need("calendar.create")
    elif kind in ("eventOps", "orderOps"):
        if not (me.can("calendar.edit") or me.can("calendar.create")):
            _forbid("Недостаточно прав.")
    elif kind == "docs":
        me.need("docs.upload")
    elif kind == "docOps":
        me.need("docs.agree")
    elif kind == "decisions":
        me.need("overview.approve")
    elif kind == "ks":
        me.need("budget.create")
        if is_c and e.get("contract") not in own:
            _forbid("КС-2 можно подать только по своему договору.")
    elif kind == "ksOps":
        to = e.get("to")
        cid = _ks_contract(e.get("ks"))
        if to in CONTRACTOR_KS_STEPS:
            if is_c:
                me.need("budget.create")
                if cid not in own:
                    _forbid("КС-2 относится к чужому договору.")
            elif not me.can("budget.agree"):
                _forbid("Недостаточно прав.")
        elif to in ESTIMATOR_KS_STEPS:
            me.need("budget.check", "Сметную проверку КС выполняет сметчик.")
        elif to == "paid":
            me.need("budget.edit")
        else:
            me.need("budget.agree")
    elif kind == "letters":
        if e.get("kind") == "guarantee":
            me.need("budget.create")
            if is_c and e.get("from") != org:
                _forbid("Гарантийное письмо оформляется только от своей организации.")
        else:
            me.need("calendar.create")
    elif kind == "changes":
        me.need("schedule.create")
        if is_c and e.get("task") not in tasks_own:
            _forbid("Корректировку можно запросить только по своей работе.")
        if is_c and e.get("org") != org:
            _forbid("Запрос оформляется от своей организации.")
        t = next((x for x in P.get("tasks", []) if x["id"] == e.get("task")), None)
        if t and (t.get("af") or (t.get("pct") or 0) >= 100):
            _forbid("Работа фактически завершена — перенос сроков невозможен.")
    elif kind == "changeOps":
        cur = change_status(st, e.get("change"))
        if cur is None:
            _forbid("Запрос на корректировку не найден.")
        op = e.get("op", "")
        ch = next(c for c in st["changes"] if c.get("id") == e.get("change"))
        if op.startswith("tz-"):
            me.need("schedule.agree")
            if cur != "tz":
                _forbid("Запрос не ожидает решения технического заказчика.")
        elif op.startswith("dir-"):
            me.need("schedule.approve")
            if cur != "director":
                _forbid("Запрос не ожидает решения директора.")
        elif op in ("resubmit", "withdraw"):
            me.need("schedule.create")
            if is_c and ch.get("org") != org:
                _forbid("Это запрос другого подрядчика.")
            if op == "resubmit" and cur != "returned":
                _forbid("Повторно направить можно только возвращённый запрос.")
            if op == "withdraw" and cur in ("approved", "rejected", "withdrawn"):
                _forbid("Решение по запросу уже принято.")
        else:
            _forbid("Неизвестная операция.")
    elif kind == "linkOps":
        me.need("schedule.edit", "Связи графика меняет только уполномоченный пользователь.")
    elif kind == "taskOps":
        layer = e.get("layer")
        if layer == "baseline" or e.get("op") == "add":
            me.need("schedule.settings", "Базовый план меняется отдельным действием с полномочием «График: управление настройками».")
        elif layer == "fact":
            me.need("production.edit", "Корректировать факт может только уполномоченный пользователь.")
        else:
            me.need("schedule.edit")
        if not (e.get("reason") or "").strip():
            _forbid("Укажите основание корректировки.")
    elif kind == "baselineOps":
        me.need("schedule.settings", "Новую версию базового плана утверждает пользователь с полномочием на базовый план.")
        if not (e.get("reason") or "").strip():
            _forbid("Укажите основание новой версии базового плана.")
    elif kind == "workTypes":
        if not (me.can("base.edit") or me.can("schedule.edit")):
            _forbid("Добавлять виды работ может только уполномоченный пользователь.")
        if any(norm_name(w["name"]) == norm_name(e.get("name")) for w in work_types(pid, st)):
            raise HTTPException(status_code=409, detail="Такой вид работ уже есть в структуре объекта.")
    elif kind == "contracts":
        me.need("contracts.create")
        if any(c.get("no") == e.get("no") and (c.get("contractor") == e.get("contractor")) for c in contracts_of(pid, st)):
            raise HTTPException(status_code=409, detail="У этого контрагента уже есть договор с таким номером на объекте.")
    elif kind == "contractOps":
        op = e.get("op")
        if op in ("supp", "approve"):
            me.need("contracts.approve")
        elif op in ("pay", "payfix"):
            me.need("budget.edit")
        elif op == "act":
            me.need("budget.edit")
        else:
            me.need("contracts.edit")
        if not (e.get("reason") or e.get("comment") or op in ("pay", "act", "supp")):
            _forbid("Укажите основание изменения.")
    elif kind == "estimates":
        me.need("estimates.create")
        if is_c and e.get("contract") not in own:
            _forbid("Смету можно загрузить только по своему договору.")
    elif kind == "estimateOps":
        to = e.get("to")
        est = next((x for x in st["estimates"] + P.get("estimates", []) if x.get("id") == e.get("estimate")), None)
        if not est:
            _forbid("Смета не найдена.")
        cur = estimate_status(st, e.get("estimate"), P)
        if to in ("review",):
            if not (me.can("estimates.create") or me.can("estimates.edit")):
                _forbid("Недостаточно прав.")
            if is_c and est.get("contract") not in own:
                _forbid("Смета другого подрядчика.")
            if cur not in ("draft", "remarks", "returned"):
                _forbid("Смета уже на проверке или утверждена.")
        elif to in ("remarks", "returned", "checked"):
            me.need("estimates.agree", "Проверку сметы выполняет сметчик.")
            if cur != "review":
                _forbid("Смета не находится на проверке.")
        elif to == "approved":
            me.need("estimates.approve")
            if cur != "checked":
                _forbid("Утвердить можно смету, проверенную сметчиком.")
        elif e.get("op") in ("version", "edit"):
            if not (me.can("estimates.edit") or me.can("estimates.create")):
                _forbid("Недостаточно прав.")
            if is_c and est.get("contract") not in own:
                _forbid("Смета другого подрядчика.")
            if cur in ("review", "checked") and e.get("op") == "edit":
                _forbid("Смета на проверке — правки после возврата или новой версией.")
        else:
            me.need("estimates.agree")
    elif kind == "regdocs":
        if e.get("kind") == "sections":
            me.need("docs.edit", "Перечень разделов ПД/РД меняет ГИП или уполномоченный пользователь.")
            return
        if e.get("kind") in ("pd", "rd"):
            me.need("docs.upload", "Проектную и рабочую документацию загружает ГИП или уполномоченный пользователь.")
        else:
            if not (me.can("iddocs.upload") or me.can("docs.upload")):
                _forbid("Недостаточно прав для загрузки документов.")
        if is_c and e.get("org") != org:
            _forbid("Документ оформляется от своей организации.")
    elif kind == "regdocOps":
        op = e.get("op")
        d = next((x for x in st["regdocs"] + P.get("regdocs", []) if x.get("id") == e.get("doc")), None)
        if not d:
            _forbid("Документ не найден.")
        if op == "revision":
            if is_c:
                if d.get("org") != org:
                    _forbid("Документ другой организации.")
            elif not (me.can("docs.edit") or me.can("iddocs.upload")):
                _forbid("Недостаточно прав.")
        elif op == "status":
            to = e.get("to")
            if d.get("kind") in ("pd", "rd"):
                me.need("docs.agree")
            elif to == "accepted":
                me.need("iddocs.approve")
            else:
                if not (me.can("iddocs.agree") or me.can("docs.agree")):
                    _forbid("Недостаточно прав.")
        else:
            _forbid("Неизвестная операция.")
    elif kind == "aiChecks":
        # результаты автоматической проверки записывает только сервер (/check); вручную — решение специалиста
        if e.get("method") != "expert":
            _forbid("Результат проверки формирует сервер — запишите решение специалиста.")
        if not (me.can("iddocs.agree") or me.can("docs.agree")):
            _forbid("Решение по документу принимает специалист с правом проверки.")
        if e.get("status") not in ("expert", "rejected"):
            _forbid("Недопустимый статус.")


def filter_journal(me: Me, pid: str, st: dict[str, list]) -> dict[str, list]:
    if me.kind == "staff" and me.can("budget.view"):
        return st
    out = {k: list(v) for k, v in st.items()}
    if me.kind == "staff":   # без права на бюджет
        out["ks"], out["ksOps"], out["contractOps"] = [], [], [o for o in st["contractOps"] if o.get("op") not in ("pay", "act", "supp")]
        if not me.can("estimates.view"):
            out["estimates"], out["estimateOps"] = [], []
        return out
    if me.kind == "investor":
        for k in ("ks", "ksOps", "letters", "remarks", "remarkOps", "orders", "orderOps", "decisions", "docs", "docOps", "notes",
                  "estimates", "estimateOps", "regdocs", "regdocOps", "aiChecks"):
            out[k] = []
        out["changes"] = [c for c in st["changes"] if change_status(st, c.get("id")) == "approved"]
        out["changeOps"] = [o for o in st["changeOps"] if any(c.get("id") == o.get("change") for c in out["changes"])]
        return out
    own = own_contracts(me, pid, st)
    org = me.org
    tasks_own = own_tasks(me, pid, st)
    P = dataset(pid)
    out["ks"] = [k for k in st["ks"] if k.get("contract") in own]
    out["ksOps"] = [o for o in st["ksOps"] if _ks_contract(o.get("ks")) in own]
    out["letters"] = [l for l in st["letters"] if l.get("from") == org or l.get("to") == org]
    my_reps = {r.get("id") for r in st["reports"] if r.get("org") == org}
    out["reports"] = [r if r.get("org") == org else {k: v for k, v in r.items() if k not in ("crew", "note", "photos")} | {"org": "Другой подрядчик", "by": "Другой подрядчик"} for r in st["reports"]]
    out["reportOps"] = [o if o.get("rep") in my_reps else {k: v for k, v in o.items() if k != "comment"} for o in st["reportOps"]]
    out["remarks"] = [r for r in st["remarks"] if r.get("task") in tasks_own or r.get("org") == org]
    rem_ids = {r.get("id") for r in out["remarks"]} | {r.get("id") for r in P.get("remarks", []) if r.get("task") in tasks_own or r.get("org") == org}
    out["remarkOps"] = [o for o in st["remarkOps"] if o.get("rem") in rem_ids or o.get("org") == org]
    mine = {c.get("id") for c in st["changes"] if c.get("org") == org}
    approved = {c.get("id") for c in st["changes"] if change_status(st, c.get("id")) == "approved"}
    out["changes"] = [c for c in st["changes"] if c.get("id") in mine | approved]
    out["changeOps"] = [o for o in st["changeOps"] if o.get("change") in mine | approved]
    out["decisions"] = []
    out["contracts"] = [c for c in st["contracts"] if c.get("id") in own]
    out["contractOps"] = [o for o in st["contractOps"] if o.get("contract") in own]
    est_ids = {e.get("id") for e in st["estimates"] + P.get("estimates", []) if e.get("contract") in own}
    out["estimates"] = [e for e in st["estimates"] if e.get("id") in est_ids]
    out["estimateOps"] = [o for o in st["estimateOps"] if o.get("estimate") in est_ids]
    doc_ok = lambda d: d.get("public") or d.get("org") == org or d.get("contract") in own or d.get("kind") in ("pd", "rd")
    doc_ids = {d.get("id") for d in st["regdocs"] + P.get("regdocs", []) if doc_ok(d)}
    out["regdocs"] = [d for d in st["regdocs"] if d.get("id") in doc_ids]
    out["regdocOps"] = [o for o in st["regdocOps"] if o.get("doc") in doc_ids]
    out["aiChecks"] = [a for a in st["aiChecks"] if a.get("doc") in doc_ids]
    return out


# ---------------------------------------------------------------- модели запросов
class LoginIn(BaseModel):
    login: str = Field(..., max_length=64)
    password: str = Field(..., max_length=128)


class Append(BaseModel):
    kind: str
    entry: dict[str, Any]


class AppendIn(BaseModel):
    appends: list[Append] = Field(..., max_length=200)


class ContractorIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    inn: str = ""
    kpp: str = ""
    ogrn: str = ""
    address: str = ""
    bank: str = ""
    extra: str = ""
    contacts: list[dict[str, Any]] = []
    assignments: list[dict[str, Any]] = []


class PasswordIn(BaseModel):
    password: str = Field(..., max_length=128)
    confirm: str | None = None
    current: str | None = None


class RoleIn(BaseModel):
    title: str = Field(..., min_length=2, max_length=80)
    perms: list[str] = []
    kind: str | None = None
    scope: str | None = None
    copyFrom: str | None = None
    step: str | None = None


class UserIn(BaseModel):
    login: str | None = Field(None, max_length=64)
    name: str | None = Field(None, max_length=200)
    role: str | None = None
    projects: list[str] | None = None
    projectsMode: str | None = None          # "role" — по роли, "list" — список
    grants: list[str] | None = None
    denies: list[str] | None = None
    active: bool | None = None
    contractorId: str | None = None
    password: str | None = None


# ---------------------------------------------------------------- вход и профиль
def _user_payload(me: Me) -> dict:
    u = A.public_user(me.u)
    u.update({"org": me.org, "projects": me.projects(), "kind": me.kind, "step": me.step, "superadmin": bool(me.u.get("superadmin"))})
    u.pop("temp_password", None)
    return u


def _catalog() -> dict:
    return {"sections": SECTIONS, "actions": ACTIONS, "alias": ALIAS, "all": ALL}


@router.post("/login")
def demo_login(body: LoginIn) -> dict:
    u = A.user_by_login(body.login)
    if not u or not A.check_password(body.password, u.get("password_hash"), u["login"]):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль.")
    if not u.get("active"):
        raise HTTPException(status_code=403, detail="Учётная запись отключена или в архиве.")
    if u.get("contractorId"):
        c = contractor_by_id(u["contractorId"])
        if not c or c.get("archived"):
            raise HTTPException(status_code=403, detail="Учётная запись подрядчика в архиве.")
    me = Me(u)
    token = auth.sign({"scope": "demo", "login": u["login"], "uid": u["id"], "pv": int(u.get("pv", 1)), "role": u["role"], "name": u.get("name"), "org": me.org})
    return {"token": token, "user": _user_payload(me), "today": MANIFEST["today"], "catalog": _catalog()}


@router.get("/me")
def me_info(me: Me = Depends(current)) -> dict:
    return {"user": _user_payload(me), "today": MANIFEST["today"], "catalog": _catalog()}


@router.post("/me/password")
def change_own_password(body: PasswordIn, me: Me = Depends(current)) -> dict:
    if not A.check_password(body.current or "", me.u.get("password_hash"), me.login):
        raise HTTPException(status_code=403, detail="Текущий пароль указан неверно.")
    if body.confirm is not None and body.confirm != body.password:
        raise HTTPException(status_code=422, detail="Пароль и подтверждение не совпадают.")
    err = A.password_policy(body.password)
    if err:
        raise HTTPException(status_code=422, detail=err)
    items = A.users()
    u = next(x for x in items if x["id"] == me.id)
    u["password_hash"] = A.hash_password(body.password)
    u["pv"] = int(u.get("pv", 1)) + 1
    u["temp_password"] = None
    A.save_users(items)
    A.audit(me.login, "Смена собственного пароля", me.login)
    token = auth.sign({"scope": "demo", "login": u["login"], "uid": u["id"], "pv": u["pv"], "role": u["role"], "name": u.get("name"), "org": me.org})
    return {"ok": True, "token": token}


# ---------------------------------------------------------------- объекты и журнал
@router.get("/projects")
def projects(me: Me = Depends(current)) -> dict:
    ids = me.projects()
    return {"today": MANIFEST["today"], "projects": [{"id": i, "name": dataset(i).get("name")} for i in ids]}


@router.get("/projects/{pid}")
def project(pid: str, me: Me = Depends(current)) -> dict:
    check_project(me, pid)
    return filter_dataset(me, pid)


@router.get("/journal/{pid}")
def journal(pid: str, me: Me = Depends(current)) -> dict:
    check_project(me, pid)
    return {"journal": filter_journal(me, pid, journal_state(pid))}


@router.post("/journal/{pid}")
def append(pid: str, body: AppendIn, me: Me = Depends(current)) -> dict:
    check_project(me, pid)
    me.need("overview.view")
    st = journal_state(pid)
    rows = []
    for a in body.appends:
        validate_append(me, pid, a.kind, a.entry, st)
        st[a.kind].append(a.entry)   # следующая запись пакета видит предыдущие
        rows.append({"kind": a.kind, "entry": a.entry, "author": me.login, "role": me.role})
    if rows:
        storage().append(pid, rows)
    return {"ok": True, "saved": len(rows)}


@router.get("/worktypes/{pid}")
def get_work_types(pid: str, me: Me = Depends(current)) -> dict:
    check_project(me, pid)
    return {"workTypes": work_types(pid)}


# ---------------------------------------------------------------- база подрядчиков
def _clean_assignments(raw: list[dict]) -> list[dict]:
    out = []
    for a in raw or []:
        if "workTypes" not in a:      # прежний формат: объект → договоры
            tmp = {"assignments": [dict(a)]}
            _migrate_assignments(tmp)
            a = tmp["assignments"][0]
        pid = a.get("project")
        if pid not in MANIFEST["projects"]:
            continue
        st = journal_state(pid)
        wts = {w["id"] for w in work_types(pid, st)}
        cids = {c["id"] for c in contracts_of(pid, st)}
        tids = {t["id"] for t in dataset(pid).get("tasks", [])}
        items = []
        for w in a.get("workTypes", []):
            if w.get("id") not in wts:
                continue
            items.append({"id": w["id"], "zone": str(w.get("zone") or "")[:300], "tasks": [t for t in w.get("tasks", []) if t in tids],
                          "contracts": [c for c in w.get("contracts", []) if c in cids], "active": w.get("active", True) is not False,
                          "since": w.get("since") or time.strftime("%Y-%m-%d"), "until": w.get("until")})
        out.append({"project": pid, "workTypes": items})
    return out


def _base_payload(me: Me) -> dict:
    catalog = []
    for pid in MANIFEST["projects"]:
        st = journal_state(pid)
        cs = contracts_of(pid, st)
        catalog.append({"id": pid, "name": dataset(pid).get("name"), "workTypes": work_types(pid, st),
                        "contracts": [{"id": c["id"], "no": c.get("no"), "subject": c.get("subject"), "contractor": c.get("contractor"), "workTypes": c.get("workTypes") or ([c["item"]] if c.get("item") else [])} for c in cs],
                        "tasks": [{"id": t["id"], "name": t["name"], "stage": t.get("stage"), "workType": t.get("workType") or t.get("item")} for t in dataset(pid).get("tasks", []) if not t.get("ms")]})
    users = {u.get("contractorId"): u for u in A.users() if u.get("contractorId")}
    items = []
    for c in contractors():
        x = dict(c)
        u = users.get(c["id"])
        x["login"] = u["login"] if u else c.get("login")
        x["userId"] = u["id"] if u else None
        items.append(x)
    return {"contractors": items, "projects": catalog, "canEdit": me.can("base.edit"), "canCreate": me.can("base.create")}


@router.get("/base")
@router.get("/contractors")
def list_base(me: Me = Depends(current)) -> dict:
    me.need("base.view", "База подрядчиков недоступна для этой роли.")
    return _base_payload(me)


@router.post("/base")
@router.post("/contractors")
def create_contractor(body: ContractorIn, me: Me = Depends(current)) -> dict:
    me.need("base.create")
    items = contractors()
    if any(norm_name(c["name"]) == norm_name(body.name) for c in items):
        raise HTTPException(status_code=409, detail="Подрядчик с таким названием уже есть в базе.")
    n = 1 + max([int(re.sub(r"\D", "", c["id"]) or 0) for c in items] + [0])
    users = A.users()
    k = n
    while any(u["login"] == f"contractor{k}" for u in users):
        k += 1
    c = body.model_dump()
    c.update({"id": f"c{n}", "login": f"contractor{k}", "archived": False, "assignments": _clean_assignments(body.assignments),
              "created_at": time.strftime("%Y-%m-%d"), "history": [{"at": time.strftime("%Y-%m-%d %H:%M"), "by": me.login, "text": "Организация добавлена в базу"}]})
    items.append(c)
    save_contractors(items)
    pw = "".join(secrets.choice("23456789abcdefghjkmnpqrstuvwxyz") for _ in range(8))
    u = A.contractor_user(c, pw)
    u["password_hash"] = A.hash_password(pw)
    users.append(u)
    A.save_users(users)
    A.audit(me.login, "Создан подрядчик и учётная запись", u["login"], {"org": c["name"]})
    return {"contractor": c, "login": u["login"], "password": pw}


@router.put("/base/{cid}")
@router.put("/contractors/{cid}")
def update_contractor(cid: str, body: ContractorIn, me: Me = Depends(current)) -> dict:
    me.need("base.edit")
    items = contractors()
    c = next((x for x in items if x["id"] == cid), None)
    if not c:
        raise HTTPException(status_code=404, detail="Подрядчик не найден.")
    old = json.dumps(c.get("assignments"), ensure_ascii=False, sort_keys=True)
    data = body.model_dump()
    new_asg = _clean_assignments(body.assignments)
    # исключение из вида работ не удаляет историю: вид работ помечается неактивным с датой окончания
    for a_old in c.get("assignments", []):
        a_new = next((a for a in new_asg if a["project"] == a_old["project"]), None)
        for w in a_old.get("workTypes", []):
            if not a_new or not any(x["id"] == w["id"] for x in a_new["workTypes"]):
                gone = dict(w, active=False, until=w.get("until") or time.strftime("%Y-%m-%d"))
                if a_new is None:
                    a_new = {"project": a_old["project"], "workTypes": []}
                    new_asg.append(a_new)
                a_new["workTypes"].append(gone)
    data["assignments"] = new_asg
    hist = c.get("history", [])
    if json.dumps(new_asg, ensure_ascii=False, sort_keys=True) != old:
        hist.append({"at": time.strftime("%Y-%m-%d %H:%M"), "by": me.login, "text": "Изменены назначения на объекты и виды работ"})
    c.update(data)
    c["history"] = hist[-200:]
    save_contractors(items)
    us = A.users()
    for u in us:
        if u.get("contractorId") == cid:
            u["name"] = c["name"]
    A.save_users(us)
    return {"contractor": c}


@router.post("/base/{cid}/archive")
@router.post("/contractors/{cid}/archive")
def archive_contractor(cid: str, me: Me = Depends(current)) -> dict:
    return _set_archived(cid, True, me)


@router.post("/base/{cid}/restore")
@router.post("/contractors/{cid}/restore")
def restore_contractor(cid: str, me: Me = Depends(current)) -> dict:
    return _set_archived(cid, False, me)


def _set_archived(cid: str, flag: bool, me: Me) -> dict:
    me.need("base.delete")
    items = contractors()
    c = next((x for x in items if x["id"] == cid), None)
    if not c:
        raise HTTPException(status_code=404, detail="Подрядчик не найден.")
    c["archived"] = flag
    c.setdefault("history", []).append({"at": time.strftime("%Y-%m-%d %H:%M"), "by": me.login, "text": "Перенесён в архив" if flag else "Восстановлен из архива"})
    save_contractors(items)
    us = A.users()
    for u in us:
        if u.get("contractorId") == cid:
            u["active"] = not flag
    A.save_users(us)
    A.audit(me.login, "Подрядчик в архиве" if flag else "Подрядчик восстановлен", c["name"])
    return {"contractor": c}


# ---------------------------------------------------------------- администрирование: роли, пользователи, пароли
@router.get("/admin/meta")
def admin_meta(me: Me = Depends(current)) -> dict:
    me.need("admin.view", "Раздел доступен администратору.")
    users = [A.public_user(u) for u in A.users()]
    return {"catalog": _catalog(), "roles": A.roles(), "users": users,
            "projects": [{"id": p, "name": dataset(p).get("name")} for p in MANIFEST["projects"]],
            "audit": storage().get("audit", [])[:300], "me": me.id, "superadmin": bool(me.u.get("superadmin"))}


@router.post("/admin/roles")
def create_role(body: RoleIn, me: Me = Depends(current)) -> dict:
    me.need("admin.roles")
    items = A.roles()
    src = A.role(body.copyFrom) if body.copyFrom else None
    rid = "r-" + secrets.token_hex(3)
    perms = [p for p in (body.perms or (src or {}).get("perms", [])) if p in ALL]
    r = {"id": rid, "title": body.title.strip(), "system": False, "kind": body.kind or (src or {}).get("kind", "staff"),
         "step": body.step if body.step is not None else (src or {}).get("step"), "scope": body.scope or (src or {}).get("scope", "assigned"), "perms": perms}
    if any(x["title"].strip().lower() == r["title"].lower() for x in items):
        raise HTTPException(status_code=409, detail="Роль с таким названием уже есть.")
    items.append(r)
    A.save_roles(items)
    A.audit(me.login, "Создана роль" + (" (копия «" + src["title"] + "»)" if src else ""), r["title"], {"perms": perms})
    return {"role": r}


@router.put("/admin/roles/{rid}")
def update_role(rid: str, body: RoleIn, me: Me = Depends(current)) -> dict:
    me.need("admin.roles")
    items = A.roles()
    r = next((x for x in items if x["id"] == rid), None)
    if not r:
        raise HTTPException(status_code=404, detail="Роль не найдена.")
    if rid == "admin":
        raise HTTPException(status_code=403, detail="Базовые полномочия роли «Администратор» защищены от изменения.")
    before = set(r.get("perms", []))
    after = {p for p in body.perms if p in ALL}
    r["title"] = body.title.strip()
    r["perms"] = sorted(after)
    if body.scope in ("all", "assigned"):
        r["scope"] = body.scope
    if not r.get("system") and body.kind in ("staff", "contractor", "investor"):
        r["kind"] = body.kind
    # нельзя лишить систему последнего администратора через изменение роли
    A.guard_admin_change(me.u, None, A.users())
    A.save_roles(items)
    A.audit(me.login, "Изменены права роли", r["title"], {"added": sorted(after - before), "removed": sorted(before - after)})
    return {"role": r}


@router.delete("/admin/roles/{rid}")
def delete_role(rid: str, me: Me = Depends(current)) -> dict:
    me.need("admin.roles")
    items = A.roles()
    r = next((x for x in items if x["id"] == rid), None)
    if not r:
        raise HTTPException(status_code=404, detail="Роль не найдена.")
    if r.get("system"):
        raise HTTPException(status_code=403, detail="Системную роль удалить нельзя.")
    if any(u.get("role") == rid for u in A.users()):
        raise HTTPException(status_code=409, detail="Роль назначена пользователям — сначала смените им роль.")
    A.save_roles([x for x in items if x["id"] != rid])
    A.audit(me.login, "Удалена роль", r["title"])
    return {"ok": True}


def _apply_user(u: dict, body: UserIn) -> list[str]:
    changes = []
    if body.name is not None and body.name.strip() and body.name != u.get("name"):
        u["name"] = body.name.strip()
        changes.append("имя")
    if body.role is not None and body.role != u.get("role"):
        if not A.role(body.role):
            raise HTTPException(status_code=422, detail="Неизвестная роль.")
        changes.append(f"роль: {u.get('role')} → {body.role}")
        u["role"] = body.role
    if body.projectsMode == "role":
        if u.get("projects") is not None:
            changes.append("объекты: по роли")
        u["projects"] = None
    elif body.projects is not None:
        new = [p for p in body.projects if p in MANIFEST["projects"]]
        if new != u.get("projects"):
            changes.append("объекты: " + ", ".join(new))
        u["projects"] = new
    for k in ("grants", "denies"):
        v = getattr(body, k)
        if v is not None:
            new = sorted({p for p in v if p in ALL})
            if new != sorted(u.get(k) or []):
                changes.append(("индивидуальные разрешения" if k == "grants" else "индивидуальные запреты") + ": " + (", ".join(new) or "нет"))
            u[k] = new
    if body.active is not None and body.active != u.get("active"):
        u["active"] = body.active
        changes.append("включена" if body.active else "отключена")
        if not body.active:
            u["pv"] = int(u.get("pv", 1)) + 1     # сессии отключённого пользователя завершаются
    if body.contractorId is not None:
        u["contractorId"] = body.contractorId or None
    return changes


@router.post("/admin/users")
def create_user(body: UserIn, me: Me = Depends(current)) -> dict:
    me.need("admin.edit")
    items = A.users()
    login = (body.login or "").strip().lower()
    if not re.match(r"^[a-z0-9._-]{3,40}$", login):
        raise HTTPException(status_code=422, detail="Логин: 3–40 символов, латиница, цифры, точка, дефис.")
    if any(u["login"] == login for u in items):
        raise HTTPException(status_code=409, detail="Логин уже занят.")
    if not A.role(body.role or ""):
        raise HTTPException(status_code=422, detail="Выберите роль.")
    if body.role == "admin" and not me.u.get("superadmin") and not me.can("admin.roles"):
        raise HTTPException(status_code=403, detail="Назначать роль «Администратор» может только администратор с правом на роли.")
    pw = body.password or "".join(secrets.choice("23456789abcdefghjkmnpqrstuvwxyz") for _ in range(8))
    err = A.password_policy(pw)
    if err:
        raise HTTPException(status_code=422, detail=err)
    u = {"id": "u-" + login, "login": login, "name": (body.name or login).strip(), "role": body.role, "superadmin": False, "active": True,
         "projects": None, "grants": [], "denies": [], "password_hash": A.hash_password(pw), "pv": 1, "created_at": time.strftime("%Y-%m-%d")}
    _apply_user(u, body)
    items.append(u)
    A.save_users(items)
    A.audit(me.login, "Создан пользователь", login, {"role": u["role"]})
    return {"user": A.public_user(u), "password": pw}


@router.put("/admin/users/{uid}")
def update_user(uid: str, body: UserIn, me: Me = Depends(current)) -> dict:
    me.need("admin.edit")
    items = A.users()
    u = next((x for x in items if x["id"] == uid), None)
    if not u:
        raise HTTPException(status_code=404, detail="Пользователь не найден.")
    if u.get("superadmin") and not me.u.get("superadmin"):
        raise HTTPException(status_code=403, detail="Учётную запись суперадминистратора может менять только суперадминистратор.")
    if (body.role == "admin" or body.grants) and not me.can("admin.roles"):
        raise HTTPException(status_code=403, detail="Назначать права и роль администратора может пользователь с правом на роли.")
    before = json.dumps(A.public_user(u), sort_keys=True, ensure_ascii=False)
    changes = _apply_user(u, body)
    A.guard_admin_change(me.u, u, items)
    A.save_users(items)
    if changes:
        A.audit(me.login, "Изменён пользователь", u["login"], {"changes": changes})
    return {"user": A.public_user(u), "changed": before != json.dumps(A.public_user(u), sort_keys=True, ensure_ascii=False)}


@router.post("/admin/users/{uid}/password")
def set_password(uid: str, body: PasswordIn, me: Me = Depends(current)) -> dict:
    me.need("admin.passwords", "Нет права на смену паролей пользователей.")
    items = A.users()
    u = next((x for x in items if x["id"] == uid), None)
    if not u:
        raise HTTPException(status_code=404, detail="Пользователь не найден.")
    if u.get("superadmin") and not me.u.get("superadmin"):
        raise HTTPException(status_code=403, detail="Пароль суперадминистратора может сменить только он сам.")
    if A.is_admin_user(u) and u["id"] != me.id and not me.can("admin.passwordsAdmin"):
        raise HTTPException(status_code=403, detail="Смена пароля администратора требует отдельного полномочия «Пароли администраторов».")
    if body.confirm is not None and body.confirm != body.password:
        raise HTTPException(status_code=422, detail="Пароль и подтверждение не совпадают.")
    err = A.password_policy(body.password)
    if err:
        raise HTTPException(status_code=422, detail=err)
    u["password_hash"] = A.hash_password(body.password)
    u["pv"] = int(u.get("pv", 1)) + 1          # прежние сессии пользователя завершаются
    u["temp_password"] = None
    A.save_users(items)
    A.audit(me.login, "Смена пароля пользователя", u["login"])   # сам пароль в журнал не пишется
    return {"ok": True}


# ---------------------------------------------------------------- файлы документов
def _files_meta() -> dict:
    return storage().get("files", {})


def _demo_files() -> dict:
    p = DATA_DIR / "files" / "manifest.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _file_access(me: Me, meta: dict) -> None:
    check_project(me, meta.get("project"))
    if me.kind == "investor" and not meta.get("public"):
        _forbid("Документ недоступен для этой роли.")
    if me.kind == "contractor":
        st = journal_state(meta["project"])
        if not (meta.get("public") or meta.get("org") == me.org or meta.get("contract") in own_contracts(me, meta["project"], st)):
            _forbid("Документ другой организации.")
    if meta.get("finance") and not me.can("budget.view") and not me.can("contracts.view"):
        _forbid("Финансовый документ недоступен для этой роли.")


@router.put("/files")
async def upload_file(request: Request, project: str = Query(...), name: str = Query(..., max_length=200), contract: str | None = None,
                      public: bool = False, me: Me = Depends(current)) -> dict:
    check_project(me, project)
    if not (me.can("docs.upload") or me.can("iddocs.upload") or me.can("estimates.create") or me.can("contracts.create")):
        _forbid("Нет права загружать документы.")
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in FILE_TYPES:
        raise HTTPException(status_code=415, detail="Формат не поддерживается. Допустимо: " + ", ".join(FILE_TYPES))
    data = await request.body()
    if not data:
        raise HTTPException(status_code=422, detail="Пустой файл.")
    if len(data) > FILE_MAX:
        raise HTTPException(status_code=413, detail=f"Файл больше {FILE_MAX // 1024 // 1024} МБ.")
    fid = "f" + secrets.token_hex(10)
    storage().file_path(fid).write_bytes(data)
    meta = {"id": fid, "project": project, "name": name, "ext": ext, "size": len(data), "type": mimetypes.guess_type(name)[0] or "application/octet-stream",
            "owner": me.login, "org": me.org, "contract": contract, "public": bool(public), "at": time.strftime("%Y-%m-%d %H:%M")}
    m = _files_meta()
    m[fid] = meta
    storage().put("files", m)
    return {"file": meta}


@router.get("/files/{fid}")
def get_file(fid: str, me: Me = Depends(current), download: bool = False):
    demo = _demo_files().get(fid)
    meta = demo or _files_meta().get(fid)
    if not meta:
        raise HTTPException(status_code=404, detail="Файл не найден.")
    _file_access(me, meta)
    path = (DATA_DIR / "files" / meta["path"]) if demo else storage().file_path(fid)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Файл не найден в хранилище.")
    disp = "attachment" if download else "inline"
    return FileResponse(path, media_type=meta.get("type") or "application/octet-stream", filename=meta["name"], content_disposition_type=disp)


# ---------------------------------------------------------------- предварительная проверка документов
REG_LABEL = {"order": "приказ", "cert": "сертификат", "passport": "документ о качестве", "equipment": "паспорт оборудования", "aosr": "АОСР",
             "scheme": "исполнительная схема", "journal": "журнал", "pd": "ПД", "rd": "РД", "act": "акт", "contract": "договор"}
REQUIRED = {"order": ["position", "validFrom"], "cert": ["material", "manufacturer", "validTo", "batch"], "passport": ["material", "manufacturer", "batch"],
            "equipment": ["equipment", "model", "serial", "manufacturer"]}
FIELD_RU = {"position": "должность", "validFrom": "дата начала действия", "material": "материал", "manufacturer": "изготовитель", "validTo": "срок действия",
            "batch": "партия", "equipment": "оборудование", "model": "модель", "serial": "заводской номер"}


def regdocs_state(pid: str, st: dict) -> list[dict]:
    docs = [copy.deepcopy(d) for d in dataset(pid).get("regdocs", [])] + [dict(copy.deepcopy(d), user=True) for d in st["regdocs"]]
    by = {d["id"]: d for d in docs}
    for op in st["regdocOps"]:
        d = by.get(op.get("doc"))
        if not d:
            continue
        if op.get("op") == "revision":
            d.setdefault("revisions", []).append({"rev": len(d.get("revisions", [])), "date": op.get("date"), "file": op.get("file"), "note": op.get("note"), "by": op.get("by")})
            d["status"] = op.get("to") or "draft"
        elif op.get("op") == "status":
            d["status"] = op.get("to")
    return docs


def rule_check(d: dict, docs: list[dict], files: dict) -> list[dict]:
    """Проверка по формальным правилам: наличие файла и реквизитов, сроки, связи. Подлинность не устанавливается."""
    out = []
    by = {x["id"]: x for x in docs}
    revs = d.get("revisions") or []
    last = revs[-1] if revs else None
    if not last or not (last.get("file") or {}).get("id"):
        out.append({"sev": "error", "text": "К документу не приложен файл."})
    elif (last["file"]["id"] not in files) and (last["file"]["id"] not in _files_meta()):
        out.append({"sev": "error", "text": "Файл документа не найден в хранилище."})
    f = d.get("fields") or {}
    for k in REQUIRED.get(d.get("kind"), []):
        if not f.get(k):
            out.append({"sev": "error", "text": "Не заполнено поле «" + FIELD_RU.get(k, k) + "»."})
    if not d.get("date"):
        out.append({"sev": "warn", "text": "Не указана дата документа."})
    today = MANIFEST["today"]
    if d.get("kind") == "cert" and f.get("validTo") and f["validTo"] < today:
        out.append({"sev": "error", "text": "Срок действия сертификата истёк " + f["validTo"] + "."})
    if d.get("kind") in ("aosr", "scheme", "journal") and not d.get("tasks"):
        out.append({"sev": "warn", "text": "Документ не связан с работами графика."})
    links = [l for l in (d.get("links") or [])]
    for l in links:
        lid = l.split(":", 1)[1] if ":" in l else l
        if lid not in by:
            out.append({"sev": "error", "text": "Связанный документ не найден (" + lid + ")."})
    linked = [by[(l.split(":", 1)[1] if ":" in l else l)] for l in links if (l.split(":", 1)[1] if ":" in l else l) in by]
    if d.get("kind") == "aosr":
        if not any(x.get("kind") in ("cert", "passport") for x in linked):
            out.append({"sev": "error", "text": "В АОСР нет ссылок на документы о качестве применённых материалов."})
        if not any(x.get("kind") == "scheme" for x in linked):
            out.append({"sev": "warn", "text": "К АОСР не приложена исполнительная схема."})
        rds = [x for x in linked if x.get("kind") == "rd"]
        if not rds:
            out.append({"sev": "error", "text": "В АОСР нет ссылки на рабочую документацию."})
        for x in rds:
            if x.get("status") != "production":
                out.append({"sev": "error", "text": "РД " + (x.get("code") or "") + " не передана в производство работ."})
        for x in linked:
            if x.get("kind") == "cert" and (x.get("fields") or {}).get("validTo") and d.get("date") and x["fields"]["validTo"] < d["date"]:
                out.append({"sev": "error", "text": "Сертификат " + (x.get("code") or "") + " истёк на дату акта."})
            if x.get("status") in ("remarks", "rejected"):
                out.append({"sev": "warn", "text": "Связанный документ «" + x.get("title", "") + "» имеет замечания."})
            if x.get("kind") in ("cert", "passport", "scheme") and x.get("status") not in ("accepted",):
                out.append({"sev": "warn", "text": "Связанный документ «" + x.get("title", "") + "» ещё не принят."})
        if not any(x.get("kind") == "order" for x in linked):
            out.append({"sev": "warn", "text": "Не указан приказ о назначении ответственного лица."})
    return out


@router.post("/check/{pid}/{doc}")
def check_doc(pid: str, doc: str, me: Me = Depends(current)) -> dict:
    check_project(me, pid)
    me.need("iddocs.check", "Нет права запускать проверку документов.")
    st = journal_state(pid)
    docs = regdocs_state(pid, st)
    d = next((x for x in docs if x["id"] == doc), None)
    if not d:
        raise HTTPException(status_code=404, detail="Документ не найден.")
    findings = rule_check(d, docs, _demo_files())
    errors = [x for x in findings if x["sev"] == "error"]
    status = "issues" if errors else ("more" if findings else "ok")
    entry = {"id": "chk-" + secrets.token_hex(5), "doc": doc, "rev": len(d.get("revisions") or []) - 1, "method": "rules", "status": status, "findings": findings,
             "by": me.login, "date": MANIFEST["today"], "at": time.strftime("%Y-%m-%d %H:%M"),
             "note": "Автоматическая проверка по формальным правилам (реквизиты, сроки, связи). Подлинность документа не устанавливается."}
    storage().append(pid, [{"kind": "aiChecks", "entry": entry, "author": me.login, "role": me.role}])
    return {"check": entry}


@router.post("/ai/check/{pid}/{doc}")
def ai_check(pid: str, doc: str, me: Me = Depends(current)) -> dict:
    check_project(me, pid)
    me.need("iddocs.check", "Нет права запускать проверку документов.")
    if not os.environ.get("FLOW_AI_URL"):
        raise HTTPException(status_code=503, detail="ИИ-сервис проверки документов не подключён. Результат ИИ-проверки не формируется; доступна проверка по формальным правилам.")
    raise HTTPException(status_code=501, detail="Подключение ИИ-сервиса настраивается на сервере (FLOW_AI_URL).")
