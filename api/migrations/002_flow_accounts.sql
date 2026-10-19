-- Flow: учётные записи, роли, журнал безопасности демо-контура (только при FLOW_DEMO_STORAGE=postgres).
-- Существующие таблицы не изменяются. Повторный запуск безопасен.
CREATE TABLE IF NOT EXISTS flow_demo_kv (
    key         text PRIMARY KEY,          -- users | roles | audit | …
    data        jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Откат: DROP TABLE IF EXISTS flow_demo_kv;
