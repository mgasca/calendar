-- Translation of the EF Core migration 20261028173124_OpenTaskDueIndexes.
CREATE INDEX ix_tasks_open_due_at ON tasks (due_at) WHERE due_at IS NOT NULL AND completed_at IS NULL;

CREATE INDEX ix_tasks_open_due_date ON tasks (due_date) WHERE due_date IS NOT NULL AND completed_at IS NULL;
