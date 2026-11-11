DROP INDEX ix_events_date_span;

ALTER TABLE events DROP COLUMN date_span;

CREATE INDEX ix_events_all_day_dates ON events (start_date, end_date) WHERE is_all_day;
