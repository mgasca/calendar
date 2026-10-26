## Summary

<!-- What does this change and why? Link issues with "Closes #123". -->

## Changes

-

## Checklist

- [ ] `make check` passes locally
- [ ] Tests added or updated for behavior changes
- [ ] `contracts/openapi.json` regenerated (`make contracts`) if the API changed
- [ ] ADR added in `docs/decisions/` for significant architectural/tooling decisions (drivers, driver × option rating table, pros/cons per option)
- [ ] If this adds a new backing service (cache, queue, blob storage, identity provider, …): re-evaluate .NET Aspire per [ADR-0016](../docs/decisions/0016-local-database-provisioning.md)
- [ ] If this adopts a PostgreSQL-specific feature: kept inside `Calendar.Infrastructure`, and the SQLite-fallback impact is noted per [ADR-0014](../docs/decisions/0014-postgresql-database-engine.md)
