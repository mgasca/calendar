-- Translation of the EF Core migration 20261026195516_InitialCreate (ADR-0014, ADR-0015).
CREATE TABLE events (
    id uuid NOT NULL,
    title character varying(200) NOT NULL,
    location character varying(200),
    notes character varying(4000),
    is_all_day boolean NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    time_zone_id character varying(64),
    start_date date,
    end_date date,
    span tstzrange GENERATED ALWAYS AS (CASE WHEN is_all_day THEN NULL ELSE tstzrange(starts_at, ends_at, '[)') END) STORED,
    CONSTRAINT pk_events PRIMARY KEY (id),
    CONSTRAINT ck_events_shape CHECK ((is_all_day AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date > start_date AND starts_at IS NULL AND ends_at IS NULL AND time_zone_id IS NULL) OR (NOT is_all_day AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at AND time_zone_id IS NOT NULL AND start_date IS NULL AND end_date IS NULL)),
    CONSTRAINT ck_events_title_not_blank CHECK (length(btrim(title)) > 0)
);

CREATE TABLE tasks (
    id uuid NOT NULL,
    title character varying(200) NOT NULL,
    due_date date,
    due_at timestamp with time zone,
    completed_at timestamp with time zone,
    CONSTRAINT pk_tasks PRIMARY KEY (id),
    CONSTRAINT ck_tasks_due_date_xor_due_at CHECK (due_date IS NULL OR due_at IS NULL),
    CONSTRAINT ck_tasks_title_not_blank CHECK (length(btrim(title)) > 0)
);

CREATE INDEX ix_events_all_day_dates ON events (start_date, end_date) WHERE is_all_day;

CREATE INDEX ix_events_span ON events USING gist (span);

CREATE INDEX ix_tasks_completed_at ON tasks (completed_at) WHERE completed_at IS NOT NULL;

CREATE INDEX ix_tasks_due_at ON tasks (due_at) WHERE due_at IS NOT NULL;

CREATE INDEX ix_tasks_due_date ON tasks (due_date) WHERE due_date IS NOT NULL;
