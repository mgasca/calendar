-- The rows of "__EFMigrationsHistory" after `dotnet ef database update` applied the complete EF Core chain
-- (product version 10.0.15), captured together with ef-schema.sql.
INSERT INTO public."__EFMigrationsHistory" (migration_id, product_version) VALUES
  ('20261026195516_InitialCreate', '10.0.15'),
  ('20261027000112_TaskDetails', '10.0.15'),
  ('20261028173124_OpenTaskDueIndexes', '10.0.15'),
  ('20261028193145_AllDayDateSpan', '10.0.15'),
  ('20261029140850_DataProtectionKeys', '10.0.15'),
  ('20261102232144_PerUserOwnership', '10.0.15');
