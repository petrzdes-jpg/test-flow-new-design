"""Каталог разрешений Flow: раздел × действие.

Один каталог для сервера и интерфейса (интерфейс получает его в /api/demo/admin/meta и /api/demo/me).
Роль — набор ячеек «раздел.действие». Пользователю можно добавить (grants) или запретить (denies)
отдельные ячейки поверх роли. Сервер проверяет ячейки при каждом действии.
"""
from __future__ import annotations

ACTIONS = {
    "view": "Просмотр", "create": "Создание", "edit": "Редактирование", "delete": "Удаление",
    "upload": "Загрузка документов", "check": "Проверка", "agree": "Согласование", "approve": "Утверждение",
    "export": "Экспорт данных", "settings": "Управление настройками",
    "roles": "Роли и матрица прав", "passwords": "Смена паролей", "passwordsAdmin": "Пароли администраторов",
}

# раздел → действия (с пояснением, что именно разрешает ячейка)
SECTIONS: list[dict] = [
    {"k": "overview", "t": "Обзор", "a": {"view": "открывать объекты и обзор", "approve": "решения по сигналам штаба", "export": "выгрузка"}},
    {"k": "schedule", "t": "График", "a": {"view": "просмотр графика", "create": "запрос на корректировку срока", "edit": "правка работ, связей и прогноза",
                                           "agree": "решение техзаказчика по корректировке", "approve": "утверждение корректировки", "settings": "базовый план: новая версия, перенос начала", "export": "выгрузка"}},
    {"k": "calendar", "t": "Календарь", "a": {"view": "просмотр", "create": "события, совещания, поручения", "edit": "изменение событий", "delete": "удаление событий"}},
    {"k": "production", "t": "Выполнение работ", "a": {"view": "журнал факта", "create": "подача ежедневного факта", "agree": "подтверждение факта (своя ступень)",
                                                        "edit": "корректировка ранее внесённого факта", "export": "выгрузка"}},
    {"k": "docs", "t": "Документы", "a": {"view": "просмотр", "upload": "загрузка документов", "edit": "новые редакции и реквизиты",
                                          "agree": "проверка и передача в производство", "approve": "утверждение", "delete": "в архив"}},
    {"k": "iddocs", "t": "Исполнительная документация", "a": {"view": "просмотр", "upload": "загрузка ИД, приказов, сертификатов, паспортов",
                                                               "check": "запуск предварительной проверки", "agree": "проверка", "approve": "приёмка ИД"}},
    {"k": "quality", "t": "Строительный контроль", "a": {"view": "замечания", "create": "выдача замечаний", "edit": "устранение (подрядчик)", "approve": "приём устранения, закрытие"}},
    {"k": "base", "t": "База подрядчиков", "a": {"view": "просмотр", "create": "добавление организаций", "edit": "реквизиты, назначения, виды работ", "delete": "архив"}},
    {"k": "contracts", "t": "Договоры", "a": {"view": "просмотр", "create": "регистрация договора", "edit": "изменение договора", "approve": "утверждение стоимости, доп. соглашений", "delete": "удаление"}},
    {"k": "estimates", "t": "Сметы", "a": {"view": "просмотр", "create": "загрузка и составление смет", "edit": "правка позиций, новые версии",
                                           "agree": "проверка сметчиком, замечания", "approve": "утверждение сметы"}},
    {"k": "budget", "t": "Бюджет и КС", "a": {"view": "просмотр", "create": "КС-2 подрядчика", "check": "сметная проверка КС", "agree": "проверка и приёмка КС",
                                              "approve": "утверждение КС", "edit": "оплаты и корректировки финансов", "export": "выгрузка"}},
    {"k": "risks", "t": "Риски", "a": {"view": "просмотр", "create": "добавление", "edit": "изменение"}},
    {"k": "reports", "t": "Отчёты и аналитика", "a": {"view": "просмотр", "export": "выгрузка"}},
    {"k": "admin", "t": "Администрирование", "a": {"view": "раздел администрирования", "edit": "пользователи и назначения", "roles": "роли и матрица прав",
                                                    "passwords": "смена паролей пользователей", "passwordsAdmin": "смена паролей администраторов",
                                                    "settings": "настройки объектов", "create": "создание объектов"}},
]
ALL = [f"{s['k']}.{a}" for s in SECTIONS for a in s["a"]]

# прежние укрупнённые права интерфейса → ячейка матрицы
ALIAS = {
    "view": "overview.view", "fact": "production.create", "confirm": "production.agree", "factfix": "production.edit",
    "data": "calendar.create", "decide": "overview.approve", "docs": "docs.upload", "docapprove": "docs.agree",
    "ksgc": "budget.create", "kstz": "budget.agree", "kscheck": "budget.check", "quality": "quality.create", "fix": "quality.edit",
    "schedule": "schedule.edit", "baseline": "schedule.settings", "budget": "budget.edit", "settings": "admin.settings",
    "create": "admin.create", "admin": "admin.view", "corr_req": "schedule.create", "corr_tz": "schedule.agree", "corr_dir": "schedule.approve",
    "base": "base.edit",
}


def _all(prefixes: list[str], exclude: list[str] | None = None) -> list[str]:
    ex = set(exclude or [])
    return [p for p in ALL if any(p == x or p.startswith(x + ".") for x in prefixes) and p not in ex]


# системные роли (kind: staff — полный контур, contractor — свои договоры, investor — упрощённый обзор)
DEFAULT_ROLES: list[dict] = [
    {"id": "admin", "title": "Администратор", "system": True, "kind": "staff", "step": None, "scope": "all", "perms": list(ALL)},
    {"id": "director", "title": "Директор по строительству", "system": True, "kind": "staff", "step": "director", "scope": "all",
     "perms": _all(["overview", "calendar", "risks", "reports"]) + ["schedule.view", "schedule.edit", "schedule.approve", "schedule.settings", "schedule.export",
               "production.view", "production.agree", "production.edit", "production.export", "docs.view", "docs.upload", "docs.agree", "docs.approve",
               "iddocs.view", "iddocs.approve", "quality.view", "quality.approve", "base.view", "contracts.view", "contracts.approve",
               "estimates.view", "estimates.approve", "budget.view", "budget.approve", "budget.edit", "budget.export", "admin.settings"]},
    {"id": "tz", "title": "Технический заказчик", "system": True, "kind": "staff", "step": "tz", "scope": "all",
     "perms": ["overview.view", "schedule.view", "schedule.agree", "schedule.export", "calendar.view", "calendar.create", "calendar.edit",
               "production.view", "production.agree", "production.edit", "docs.view", "docs.upload", "docs.agree", "iddocs.view", "iddocs.upload",
               "iddocs.check", "iddocs.agree", "iddocs.approve", "quality.view", "quality.create", "quality.approve", "base.view", "contracts.view",
               "estimates.view", "budget.view", "budget.agree", "risks.view", "risks.create", "reports.view"]},
    {"id": "estimator", "title": "Сметчик", "system": True, "kind": "staff", "step": None, "scope": "assigned",
     "perms": ["overview.view", "schedule.view", "production.view", "base.view", "contracts.view", "estimates.view", "estimates.edit", "estimates.agree",
               "budget.view", "budget.check", "reports.view"]},
    {"id": "gip", "title": "ГИП — главный инженер проекта", "system": True, "kind": "staff", "step": None, "scope": "assigned",
     "perms": ["overview.view", "schedule.view", "calendar.view", "docs.view", "docs.upload", "docs.edit", "docs.agree", "docs.delete",
               "quality.view", "base.view", "iddocs.view"]},
    {"id": "contractor", "title": "Подрядчик", "system": True, "kind": "contractor", "step": None, "scope": "assigned",
     "perms": ["overview.view", "schedule.view", "schedule.create", "calendar.view", "production.view", "production.create", "docs.view", "docs.upload",
               "iddocs.view", "iddocs.upload", "quality.view", "quality.edit", "contracts.view", "estimates.view", "estimates.create", "estimates.edit",
               "budget.view", "budget.create"]},
    {"id": "viewer", "title": "Инвестор / зритель", "system": True, "kind": "investor", "step": None, "scope": "all", "perms": ["overview.view"]},
]
