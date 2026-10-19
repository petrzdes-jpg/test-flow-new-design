"""Демо-контур Flow: вход по ролям, разделение контуров и серверная проверка прав.

Запуск: pytest -q (база данных не нужна — журнал демо хранится во временном каталоге).
"""
import hashlib

import pytest
from fastapi.testclient import TestClient

from tests.test_api import load_app


@pytest.fixture
def client(monkeypatch):
    app = load_app(monkeypatch, {})
    with TestClient(app) as c:
        yield c


def login(client, user, pw="1234"):
    r = client.post("/api/demo/login", json={"login": user, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}, r.json()["user"]


def test_roles_by_login(client):
    expect = {"admin": "admin", "director": "director", "tech": "tz", "investor": "viewer", "contractor1": "contractor", "contractor2": "contractor", "contractor3": "contractor"}
    for user, role in expect.items():
        _, u = login(client, user)
        assert u["role"] == role, user
    assert client.post("/api/demo/login", json={"login": "director", "password": "0000"}).status_code == 401
    assert client.post("/api/demo/login", json={"login": "nobody", "password": "1234"}).status_code == 401


def test_every_contractor_has_own_account(client):
    h, _ = login(client, "admin")
    items = client.get("/api/demo/contractors", headers=h).json()["contractors"]
    logins = [c["login"] for c in items]
    assert len(logins) == len(set(logins)) and len(items) >= 3
    orgs = [c["name"] for c in items]
    assert len(orgs) == len(set(orgs))
    for c in items:           # у каждого подрядчика — отдельная учётная запись и только свои объекты
        _, u = login(client, c["login"])
        assert u["org"] == c["name"]
        assert set(u["projects"]) == {a["project"] for a in c["assignments"]}


def test_contractor_isolation(client):
    h, u = login(client, "contractor1")
    allowed = set(u["projects"])
    for pid in ["kristall", "bereg", "vostok", "briz", "ladoga"]:
        code = client.get(f"/api/demo/projects/{pid}", headers=h).status_code
        assert code == (200 if pid in allowed else 403), pid           # чужой объект по подставленному ID — 403
        assert client.get(f"/api/demo/journal/{pid}", headers=h).status_code == (200 if pid in allowed else 403)
    P = client.get(f"/api/demo/projects/{sorted(allowed)[0]}", headers=h).json()
    assert all(c["contractor"] == u["org"] for c in P["contracts"])   # только свой договор
    assert all(k["contract"] in P["myContracts"] for k in P["ks2"])
    assert P["readiness"] == {"mode": "manual"}                         # общий бюджет / готовность не раскрываются
    assert all(i["budget"] == 0 for i in P["budget"]["items"])
    assert client.get("/api/demo/contractors", headers=h).status_code == 403


def test_investor_has_no_working_ks(client):
    h, _ = login(client, "investor")
    P = client.get("/api/demo/projects/bereg", headers=h).json()
    assert P["ks2"] == [] and P["letters"] == [] and P["remarks"] == []
    r = client.post("/api/demo/journal/bereg", headers=h, json={"appends": [{"kind": "events", "entry": {"id": "x", "title": "t", "date": "2026-10-05"}}]})
    assert r.status_code == 403


def test_real_and_demo_are_separated(client):
    h, _ = login(client, "admin")
    assert client.get("/api/projects", headers=h).status_code == 403           # демо-токен не открывает реальные проекты
    r = client.post("/api/auth/login", json={"password": "test"})
    rh = {"Authorization": "Bearer " + r.json()["token"]}
    assert client.get("/api/demo/projects", headers=rh).status_code == 403     # реальный токен не открывает демо
    assert client.post("/api/demo/login", json={"login": "admin", "password": "test"}).status_code == 401


def test_schedule_change_route(client):
    hc, u = login(client, "contractor2")             # ВолгаМонолит, «Береговой»
    P = client.get("/api/demo/projects/bereg", headers=hc).json()
    own = next(t for t in P["tasks"] if t.get("contract") in P["myContracts"] and not t.get("ms") and not t.get("af"))
    other = next(t for t in P["tasks"] if not t.get("contract") and not t.get("ms"))
    ch = {"id": "ch-1", "task": own["id"], "ps0": own["ps"], "pf0": own["pf"], "ps": own["ps"], "pf": "2027-03-01", "reason": "x", "comment": "y", "org": u["org"], "date": "2026-10-05"}
    bad = dict(ch, id="ch-2", task=other["id"])
    assert client.post("/api/demo/journal/bereg", headers=hc, json={"appends": [{"kind": "changes", "entry": bad}]}).status_code == 403
    assert client.post("/api/demo/journal/bereg", headers=hc, json={"appends": [{"kind": "changes", "entry": ch}]}).status_code == 200
    hd, _ = login(client, "director")
    ht, _ = login(client, "tech")
    op = lambda o: {"appends": [{"kind": "changeOps", "entry": {"change": "ch-1", "op": o, "date": "2026-10-05"}}]}
    assert client.post("/api/demo/journal/bereg", headers=hd, json=op("dir-approve")).status_code == 403   # директор — только после ТЗ
    assert client.post("/api/demo/journal/bereg", headers=hc, json=op("tz-approve")).status_code == 403   # подрядчик не согласует
    assert client.post("/api/demo/journal/bereg", headers=ht, json=op("tz-approve")).status_code == 200
    assert client.post("/api/demo/journal/bereg", headers=ht, json=op("tz-approve")).status_code == 403   # повторно — нет
    assert client.post("/api/demo/journal/bereg", headers=hd, json=op("dir-approve")).status_code == 200
    j = client.get("/api/demo/journal/bereg", headers=hd).json()["journal"]
    assert [o["op"] for o in j["changeOps"]] == ["tz-approve", "dir-approve"]


def test_ks_and_reports_ownership(client):
    hc, u = login(client, "contractor2")
    P = client.get("/api/demo/projects/bereg", headers=hc).json()
    mine = P["myContracts"][0]
    other = next(c["id"] for c in client.get("/api/demo/projects/bereg", headers=login(client, "director")[0]).json()["contracts"] if c["id"] not in P["myContracts"])
    ks = lambda cid: {"appends": [{"kind": "ks", "entry": {"id": f"ks-{cid}-u1", "contract": cid, "date": "2026-10-05", "obj": 1, "claimed": 1}}]}
    assert client.post("/api/demo/journal/bereg", headers=hc, json=ks(other)).status_code == 403
    assert client.post("/api/demo/journal/bereg", headers=hc, json=ks(mine)).status_code == 200
    step = lambda to: {"appends": [{"kind": "ksOps", "entry": {"ks": f"ks-{mine}-u1", "to": to, "date": "2026-10-05"}}]}
    assert client.post("/api/demo/journal/bereg", headers=hc, json=step("sent")).status_code == 200
    assert client.post("/api/demo/journal/bereg", headers=hc, json=step("accepted")).status_code == 403    # приёмка — только ТЗ
    assert client.post("/api/demo/journal/bereg", headers=login(client, "tech")[0], json=step("review")).status_code == 200
    rep = lambda org: {"appends": [{"kind": "reports", "entry": {"id": "r1", "date": "2026-10-05", "org": org, "lines": [], "ok": []}}]}
    assert client.post("/api/demo/journal/bereg", headers=hc, json=rep("ООО «Чужая»")).status_code == 403
    assert client.post("/api/demo/journal/bereg", headers=hc, json=rep(u["org"])).status_code == 200
    # чужой подрядчик не видит заявки и отчёты ВолгаМонолит
    h3, u3 = login(client, "contractor3")
    j = client.get("/api/demo/journal/bereg", headers=h3).json()["journal"]
    assert j["ks"] == [] and all(r["org"] != u["org"] for r in j["reports"])


def test_contractor_base_admin(client):
    h, _ = login(client, "admin")
    r = client.post("/api/demo/contractors", headers=h, json={"name": "ООО «Новый подрядчик»", "inn": "7700000000", "assignments": [{"project": "kristall", "contracts": ["kc2"], "works": ["Благоустройство"]}, {"project": "ladoga", "contracts": []}]})
    assert r.status_code == 200
    c = r.json()["contractor"]
    hc, u = login(client, c["login"], r.json()["password"])
    assert set(u["projects"]) == {"kristall", "ladoga"}
    assert client.get("/api/demo/projects/bereg", headers=hc).status_code == 403
    uid = next(x for x in client.get("/api/demo/admin/meta", headers=h).json()["users"] if x["login"] == c["login"])["id"]
    assert client.post(f"/api/demo/admin/users/{uid}/password", headers=h, json={"password": "n3w-pass", "confirm": "n3w-pass"}).status_code == 200
    cred = {"password": "n3w-pass"}
    assert client.post("/api/demo/login", json={"login": c["login"], "password": "1234"}).status_code == 401
    login(client, c["login"], cred["password"])
    assert client.post(f"/api/demo/contractors/{c['id']}/archive", headers=h).status_code == 200
    assert client.post("/api/demo/login", json={"login": c["login"], "password": cred["password"]}).status_code == 403
    assert client.post(f"/api/demo/contractors/{c['id']}/restore", headers=h).status_code == 200
    login(client, c["login"], cred["password"])


def test_password_change_ends_sessions(client):
    h, _ = login(client, "admin")
    hd, ud = login(client, "director")
    meta = client.get("/api/demo/admin/meta", headers=h).json()
    assert all("password_hash" not in u for u in meta["users"])
    r = client.post(f"/api/demo/admin/users/{ud['id']}/password", headers=h, json={"password": "abcd5", "confirm": "abcd6"})
    assert r.status_code == 422
    assert client.post(f"/api/demo/admin/users/{ud['id']}/password", headers=h, json={"password": "abcd5", "confirm": "abcd5"}).status_code == 200
    assert client.get("/api/demo/me", headers=hd).status_code == 401          # старая сессия завершена
    assert client.post("/api/demo/login", json={"login": "director", "password": "1234"}).status_code == 401
    hd2, _ = login(client, "director", "abcd5")
    assert client.post("/api/demo/me/password", headers=hd2, json={"current": "bad", "password": "zzzz9"}).status_code == 403
    r = client.post("/api/demo/me/password", headers=hd2, json={"current": "abcd5", "password": "zzzz9", "confirm": "zzzz9"})
    assert r.status_code == 200
    a = client.get("/api/demo/admin/meta", headers=h).json()["audit"]
    assert any(x["action"].startswith("Смена") for x in a) and not any("abcd5" in str(x) or "zzzz9" in str(x) for x in a)
    # директор не может менять пароли (нет права)
    hd3 = {"Authorization": "Bearer " + r.json()["token"]}
    assert client.post("/api/demo/admin/users/u-tech/password", headers=hd3, json={"password": "qqqq1"}).status_code == 403


def test_roles_matrix_and_admin_protection(client):
    h, ua = login(client, "admin")
    r = client.post("/api/demo/admin/roles", headers=h, json={"title": "Инженер ПТО", "copyFrom": "tz", "perms": []})
    assert r.status_code == 200
    rid = r.json()["role"]["id"]
    assert "iddocs.agree" in r.json()["role"]["perms"]
    u = client.post("/api/demo/admin/users", headers=h, json={"login": "pto", "name": "Инженер", "role": rid, "projects": ["bereg"], "password": "pto1"}).json()["user"]
    hp, up = login(client, "pto", "pto1")
    assert up["projects"] == ["bereg"]
    assert client.get("/api/demo/projects/kristall", headers=hp).status_code == 403
    # индивидуальный запрет снимает право роли
    client.put(f"/api/demo/admin/users/{u['id']}", headers=h, json={"denies": ["calendar.create"]})
    ev = {"appends": [{"kind": "events", "entry": {"id": "e1", "title": "t", "date": "2026-10-05"}}]}
    assert client.post("/api/demo/journal/bereg", headers=hp, json=ev).status_code == 403
    client.put(f"/api/demo/admin/users/{u['id']}", headers=h, json={"denies": []})
    assert client.post("/api/demo/journal/bereg", headers=hp, json=ev).status_code == 200
    assert client.delete("/api/demo/admin/roles/tz", headers=h).status_code == 403          # системная
    assert client.delete(f"/api/demo/admin/roles/{rid}", headers=h).status_code == 409       # назначена пользователю
    assert client.put(f"/api/demo/admin/users/{ua['id']}", headers=h, json={"active": False}).status_code in (403, 409)
    assert client.put("/api/demo/admin/roles/admin", headers=h, json={"title": "Админ", "perms": []}).status_code == 403
    hdir, _ = login(client, "director")
    assert client.get("/api/demo/admin/meta", headers=hdir).status_code == 403


def test_estimator_and_gip(client):
    hs, us = login(client, "smeta")
    assert us["role"] == "estimator" and set(us["projects"]) == {"kristall", "bereg", "vostok"}
    assert client.get("/api/demo/projects/briz", headers=hs).status_code == 403
    hg, ug = login(client, "gip")
    assert ug["projects"] == ["kristall"]
    P = client.get("/api/demo/projects/kristall", headers=hg).json()
    assert P.get("financeHidden") and all(c["amount"] == 0 for c in P["contracts"])
    ks = {"appends": [{"kind": "ksOps", "entry": {"ks": "ks-kc2-u1", "to": "accepted"}}]}
    assert client.post("/api/demo/journal/kristall", headers=hg, json=ks).status_code == 403


def test_no_reset_endpoints(client):
    h, _ = login(client, "admin")
    assert client.post("/api/demo/journal/bereg/reset", headers=h).status_code in (404, 405)
    assert client.post("/api/demo/contractors/reset", headers=h).status_code in (404, 405, 422)


def _post(client, h, pid, kind, entry):
    return client.post(f"/api/demo/journal/{pid}", headers=h, json={"appends": [{"kind": kind, "entry": entry}]}).status_code


def _regdoc(client, h, code):
    P = client.get("/api/demo/projects/kristall", headers=h).json()
    return next(d for d in P["regdocs"] if d.get("code") == code)


def test_document_files_access(client):
    hc, _ = login(client, "contractor38")       # ООО «Монолит Инжиниринг» — исполнитель договора КП-26/МР-015
    contract = _regdoc(client, hc, "КП-26/МР-015")
    fid = contract["revisions"][0]["file"]["id"]
    r = client.get(f"/api/demo/files/{fid}", headers=hc)
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    h1, _ = login(client, "contractor1")         # другой подрядчик не видит чужой договор
    assert client.get(f"/api/demo/files/{fid}", headers=h1).status_code == 403
    assert all(d["kind"] != "contract" for d in client.get("/api/demo/projects/kristall", headers=h1).json()["regdocs"])
    hg, _ = login(client, "gip")                 # ГИП: РД — да, договор (финансы) — нет
    assert client.get(f"/api/demo/files/{fid}", headers=hg).status_code == 403
    rd = _regdoc(client, hg, "КП-Р-КЖ-01")
    assert client.get(f"/api/demo/files/{rd['revisions'][-1]['file']['id']}", headers=hg).status_code == 200
    hb, _ = login(client, "contractor2")         # подрядчик другого объекта — 403 по объекту
    assert client.get(f"/api/demo/files/{rd['revisions'][-1]['file']['id']}", headers=hb).status_code == 403
    # загрузка: формат проверяется
    r = client.put("/api/demo/files?project=kristall&name=x.exe", headers=hg, content=b"MZ")
    assert r.status_code == 415
    r = client.put("/api/demo/files?project=kristall&name=list.pdf&public=true", headers=hg, content=b"%PDF-1.4 test")
    assert r.status_code == 200


def test_rule_check_and_ai(client):
    ht, _ = login(client, "tech")
    a = _regdoc(client, ht, "ДЕМО-АОСР-01")
    r = client.post(f"/api/demo/check/kristall/{a['id']}", headers=ht)
    assert r.status_code == 200
    chk = r.json()["check"]
    assert chk["method"] == "rules" and chk["status"] in ("ok", "more", "issues") and "Подлинность" in chk["note"]
    assert client.post(f"/api/demo/ai/check/kristall/{a['id']}", headers=ht).status_code == 503   # ИИ не подключён — результата нет
    fake = {"id": "x", "doc": a["id"], "method": "ai", "status": "ok"}
    assert _post(client, ht, "kristall", "aiChecks", fake) == 403                                 # подставить «результат ИИ» нельзя
    assert _post(client, ht, "kristall", "aiChecks", dict(fake, method="expert", status="expert", comment="ok")) == 200
    hc, _ = login(client, "contractor38")
    assert client.post(f"/api/demo/check/kristall/{a['id']}", headers=hc).status_code == 403


def test_estimate_route(client):
    hc, _ = login(client, "contractor1")
    hs, _ = login(client, "smeta")
    hd, _ = login(client, "director")
    op = lambda to: {"estimate": "est-kc2", "to": to, "comment": "x"}
    assert _post(client, hc, "kristall", "estimateOps", op("checked")) == 403        # подрядчик не проверяет
    assert _post(client, hd, "kristall", "estimateOps", op("approved")) == 403       # без проверки сметчика — нельзя
    assert _post(client, hs, "kristall", "estimateOps", op("checked")) == 200
    assert _post(client, hs, "kristall", "estimateOps", op("approved")) == 403       # сметчик не утверждает
    assert _post(client, hd, "kristall", "estimateOps", op("approved")) == 200


def test_contracts_and_corrections_rights(client):
    ha, _ = login(client, "admin")
    hc, _ = login(client, "contractor1")
    ct = {"id": "ct-1", "no": "Т-1", "date": "2026-10-01", "contractor": "ООО «Тест»", "subject": "Тест", "item": "roof", "amount": 1.5}
    assert _post(client, hc, "kristall", "contracts", ct) == 403
    assert _post(client, ha, "kristall", "contracts", ct) == 200
    assert _post(client, ha, "kristall", "contracts", dict(ct, id="ct-2")) == 409                     # дубль номера у контрагента
    assert _post(client, ha, "kristall", "contractOps", {"contract": "ct-1", "op": "edit", "patch": {"amount": 2}}) == 403   # без основания
    assert _post(client, ha, "kristall", "contractOps", {"contract": "ct-1", "op": "edit", "patch": {"amount": 2}, "reason": "ДС"}) == 200
    hd, _ = login(client, "director")
    ht, _ = login(client, "tech")
    tb = {"task": "k20", "layer": "baseline", "patch": {"ps": "2027-01-01", "pf": "2027-02-01"}, "reason": "решение"}
    assert _post(client, hc, "kristall", "taskOps", tb) == 403
    assert _post(client, ht, "kristall", "taskOps", tb) == 403                       # техзаказчик не меняет базовый план
    assert _post(client, hd, "kristall", "taskOps", dict(tb, reason="")) == 403      # без основания
    assert _post(client, hd, "kristall", "taskOps", tb) == 200
    assert _post(client, ht, "kristall", "linkOps", {"succ": "k20", "pred": "k15", "op": "add", "type": "FS"}) == 403
    assert _post(client, hd, "kristall", "baselineOps", {"version": 1, "tasks": {}, "reason": "утверждено"}) == 200


def test_remark_requires_org_contract_worktype(client):
    ht, _ = login(client, "tech")
    base = {"id": "rem-x", "title": "t", "task": "b06", "due": "2026-10-20", "date": "2026-10-05", "status": "new", "workType": "frame"}
    assert _post(client, ht, "bereg", "remarks", dict(base, org="ООО «Нет на объекте»", noContractReason="xxx")) == 403
    P = client.get("/api/demo/projects/bereg", headers=ht).json()
    c1, c2 = P["contracts"][0], next(c for c in P["contracts"] if c["contractor"] != P["contracts"][0]["contractor"])
    assert _post(client, ht, "bereg", "remarks", dict(base, org=c1["contractor"], contract=c2["id"])) == 403   # чужой договор
    assert _post(client, ht, "bereg", "remarks", dict(base, org=c1["contractor"])) == 403                     # нет договора и причины
    assert _post(client, ht, "bereg", "remarks", dict(base, org=c1["contractor"], noContractReason="на подписании")) == 200
    assert _post(client, ht, "bereg", "remarks", dict(base, id="rem-y", org=c1["contractor"], contract=c1["id"], workType="nope")) == 403
