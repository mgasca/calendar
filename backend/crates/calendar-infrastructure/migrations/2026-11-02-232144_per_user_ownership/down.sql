ALTER TABLE events DROP CONSTRAINT fk_events_owner;

ALTER TABLE tasks DROP CONSTRAINT fk_tasks_owner;

DROP TABLE users;

DROP INDEX ix_tasks_completed_at;

DROP INDEX ix_tasks_due_at;

DROP INDEX ix_tasks_due_date;

DROP INDEX ix_tasks_open_due_at;

DROP INDEX ix_tasks_open_due_date;

DROP INDEX ix_events_owner_id;

ALTER TABLE tasks DROP COLUMN owner_id;

ALTER TABLE events DROP COLUMN owner_id;

CREATE INDEX ix_tasks_completed_at ON tasks (completed_at) WHERE completed_at IS NOT NULL;

CREATE INDEX ix_tasks_due_at ON tasks (due_at) WHERE due_at IS NOT NULL;

CREATE INDEX ix_tasks_due_date ON tasks (due_date) WHERE due_date IS NOT NULL;

CREATE INDEX ix_tasks_open_due_at ON tasks (due_at) WHERE due_at IS NOT NULL AND completed_at IS NULL;

CREATE INDEX ix_tasks_open_due_date ON tasks (due_date) WHERE due_date IS NOT NULL AND completed_at IS NULL;
