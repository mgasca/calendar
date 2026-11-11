-- Translation of the EF Core migration 20261027000112_TaskDetails.
ALTER TABLE tasks ADD notes character varying(4000);

ALTER TABLE tasks ADD priority character varying(6) NOT NULL DEFAULT 'medium';

ALTER TABLE tasks ADD CONSTRAINT ck_tasks_priority CHECK (priority IN ('low', 'medium', 'high'));
