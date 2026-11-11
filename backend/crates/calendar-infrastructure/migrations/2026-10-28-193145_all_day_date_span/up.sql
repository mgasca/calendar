-- Translation of the EF Core migration 20261028193145_AllDayDateSpan.
DROP INDEX ix_events_all_day_dates;

ALTER TABLE events ADD date_span daterange GENERATED ALWAYS AS (CASE WHEN is_all_day THEN daterange(start_date, end_date, '[)') END) STORED;

CREATE INDEX ix_events_date_span ON events USING gist (date_span) WHERE is_all_day;
