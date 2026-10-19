# Flow API

Backend Flow (dsflow.ru) на FastAPI. Реальный контур: вход по основному паролю и чтение проектов.
Демо-контур: учётные записи по ролям, база подрядчиков, датасеты демо-объектов и журнал действий с проверкой прав на сервере.

| Метод | Путь | Доступ |
|---|---|---|
| POST | `/api/auth/login` | основной пароль → токен `scope=real` |
| GET | `/api/projects`, `/api/projects/{slug}` | только токен `scope=real` |
| POST | `/api/demo/login` | демо-логин → токен `scope=demo`, роль по логину |
| GET | `/api/demo/me`, `/api/demo/projects` | демо; подрядчик — только назначенные объекты |
| GET | `/api/demo/projects/{id}` | датасет, отфильтрованный по роли; не назначен — 403 |
| GET/POST | `/api/demo/journal/{id}` | журнал действий; каждая запись проверяется по роли, ступени и принадлежности |
| POST | `/api/demo/journal/{id\|all}/reset` | администратор |
| GET/POST/PUT | `/api/demo/contractors…` | база подрядчиков: администратор (создание, правка, архив, восстановление, временный пароль) |

Переменные: см. корневой README (FLOW_SECRET, REAL_PASSWORD_SHA256, FLOW_DEMO_STORAGE, FLOW_DATA_DIR). Миграция — `migrations/001_flow_demo.sql` (только для FLOW_DEMO_STORAGE=postgres).

## Эндпоинты

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/health` | `{"status":"ok"}` — сервис работает (базу не опрашивает; для healthcheck) |
| GET | `/health/db` | `{"status":"ok","database":"ok"}` — есть соединение с PostgreSQL |
| GET | `/api/projects` | список строк таблицы `projects` (все колонки как есть) |
| GET | `/api/projects/{slug}` | один проект: `/api/projects/ogni`, `/api/projects/ramenki`; 404 — `{"detail":"Проект не найден."}` |
| GET | `/docs` | интерактивная документация OpenAPI |

Если база не настроена или недоступна, `/api/...` отвечает 503 без технических подробностей (они пишутся в лог), а `/health` остаётся `ok`.

API только читает таблицы и не меняет их структуру. Колонки `projects` берутся из `information_schema`. Поиск по slug идёт по колонке `slug` (другое имя — в `PROJECTS_SLUG_COLUMN`). Список сортируется по первой существующей из колонок `sort_order`, `position`, `order_index`, `id`, `created_at`, `name`.

## Переменные окружения

Обязательные: `DB_HOST`, `DB_PORT`, `DB_NAME` (`dsflow`), `DB_USER` (`gen_user`), `DB_PASSWORD`.
S3 (подготовлено для следующих этапов): `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
Порт: `PORT` (задаёт платформа; локально по умолчанию 8000).

Необязательные: `DB_SSLMODE` (`require` / `verify-full`, если база требует SSL), `DB_SCHEMA` (по умолчанию `public`), `PROJECTS_SLUG_COLUMN` (по умолчанию `slug`), `CORS_ORIGINS`, `CORS_ORIGIN_REGEX`, `LOG_LEVEL`.

Шаблон — `.env.example`. Секреты в код и репозиторий не добавляются.

### CORS
По умолчанию разрешены `https://dsflow.ru`, `https://www.dsflow.ru` и технические домены Timeweb по шаблону `https://<имя>.twc1.net`.
Формат технического домена в документации Timeweb не описан. После создания приложения посмотрите фактический домен в панели и при необходимости задайте его явно:
```
CORS_ORIGINS=https://dsflow.ru,https://www.dsflow.ru,https://<технический-домен>
```

## Развёртывание в Timeweb App Platform

1. Создать приложение: **Backend → Python → FastAPI**, Python 3.12 (подходит 3.10–3.14), этот репозиторий и ветку.
2. **Путь к директории проекта:** `api` (Timeweb ожидает `main.py` в корне этой директории).
3. **Команда сборки:**
   ```
   pip3 install --upgrade -r requirements.txt
   ```
4. **Команда запуска:**
   ```
   python3 main.py
   ```
   `main.py` запускает uvicorn на `0.0.0.0` и порту из `PORT` (без `PORT` — 8000).
   Альтернатива, если платформа выполняет команду через shell:
   ```
   uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips="*"
   ```
5. **Переменные окружения:** задать значения из `.env.example`.
6. **Путь проверки состояния (healthcheck):** `/health`.
7. После запуска открыть `https://<технический-домен>/health`, затем `/health/db` и `/api/projects`.

## Локальный запуск

```sh
cd api
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export DB_HOST=... DB_PORT=5432 DB_NAME=dsflow DB_USER=gen_user DB_PASSWORD=...
python3 main.py            # http://127.0.0.1:8000/health
```

## Тесты

```sh
pytest -q                  # без базы: health, CORS, проверка slug, ответ 503 без настроек
```
Тест с базой создаёт и удаляет отдельную схему `dsflow_test`. Запускать только на тестовой базе:
```sh
DSFLOW_TEST_DB=1 DB_HOST=... DB_NAME=... DB_USER=... DB_PASSWORD=... pytest -q
```

## Структура

```
api/
├── main.py              точка входа (Timeweb, uvicorn)
├── app/
│   ├── __init__.py
│   ├── application.py   FastAPI: маршруты, CORS, обработка ошибок
│   ├── config.py        настройки из переменных окружения
│   ├── db.py            пул PostgreSQL (psycopg 3), чтение projects
│   └── storage.py       клиент S3 (для следующих этапов)
├── tests/
│   ├── __init__.py
│   └── test_api.py
├── requirements.txt
├── requirements-dev.txt
├── .env.example
├── .gitignore
└── README.md
```
