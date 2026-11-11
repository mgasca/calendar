-- Translation of the EF Core migration 20261102232144_PerUserOwnership (ADR-0041).
-- Order matters: the users table and its legacy placeholder must exist before owner_id can reference them, and
-- every existing event and task is backfilled to the placeholder through the column default. The default stays:
-- migrations run before the new revision starts, and a row the previous revision still creates in that window
-- lands on the legacy owner too. The app always names the owner.
CREATE TABLE users (
    id uuid NOT NULL,
    google_subject character varying(255),
    email character varying(320),
    display_name character varying(200),
    picture_url character varying(2048),
    created_at timestamp with time zone NOT NULL,
    last_signed_in_at timestamp with time zone,
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT ck_users_email_lower CHECK (email IS NULL OR email = lower(email))
);

CREATE UNIQUE INDEX ix_users_email ON users (email) WHERE email IS NOT NULL;

CREATE UNIQUE INDEX ix_users_google_subject ON users (google_subject) WHERE google_subject IS NOT NULL;

-- The legacy owner: no subject and no email until the first allow-listed email signs in (or seeds) and claims it.
INSERT INTO users (id, created_at) VALUES ('11111111-1111-1111-1111-111111111111', now());

ALTER TABLE events ADD owner_id uuid NOT NULL DEFAULT '11111111-1111-1111-1111-111111111111';

ALTER TABLE tasks ADD owner_id uuid NOT NULL DEFAULT '11111111-1111-1111-1111-111111111111';

ALTER TABLE events ADD CONSTRAINT fk_events_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE RESTRICT;

ALTER TABLE tasks ADD CONSTRAINT fk_tasks_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE RESTRICT;

CREATE INDEX ix_events_owner_id ON events (owner_id);

-- The task indexes the agenda and task-list queries use now lead with the owner.
DROP INDEX ix_tasks_completed_at;

DROP INDEX ix_tasks_due_at;

DROP INDEX ix_tasks_due_date;

DROP INDEX ix_tasks_open_due_at;

DROP INDEX ix_tasks_open_due_date;

CREATE INDEX ix_tasks_completed_at ON tasks (owner_id, completed_at) WHERE completed_at IS NOT NULL;

CREATE INDEX ix_tasks_due_at ON tasks (owner_id, due_at) WHERE due_at IS NOT NULL;

CREATE INDEX ix_tasks_due_date ON tasks (owner_id, due_date) WHERE due_date IS NOT NULL;

CREATE INDEX ix_tasks_open_due_at ON tasks (owner_id, due_at) WHERE due_at IS NOT NULL AND completed_at IS NULL;

CREATE INDEX ix_tasks_open_due_date ON tasks (owner_id, due_date) WHERE due_date IS NOT NULL AND completed_at IS NULL;
