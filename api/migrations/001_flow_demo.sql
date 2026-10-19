-- Flow: таблицы демо-контура (нужны только при FLOW_DEMO_STORAGE=postgres).
-- Существующие таблицы (projects и др.) не изменяются. Повторный запуск безопасен.
CREATE TABLE IF NOT EXISTS flow_demo_contractors (
    id          text PRIMARY KEY,
    position    integer NOT NULL DEFAULT 0,
    data        jsonb   NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flow_demo_journal (
    id          bigserial PRIMARY KEY,
    project     text NOT NULL,
    kind        text NOT NULL,
    entry       jsonb NOT NULL,
    author      text,
    role        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flow_demo_journal_project_idx ON flow_demo_journal (project, id);

-- Откат (только демо-данные):
--   DROP TABLE IF EXISTS flow_demo_journal; DROP TABLE IF EXISTS flow_demo_contractors;
