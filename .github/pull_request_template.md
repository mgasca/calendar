## Summary

<!-- What does this change and why? Link issues with "Closes #123". -->

## Changes

-

## Checklist

- [ ] `just check` passes locally
- [ ] Tests added or updated for behavior changes
- [ ] `contracts/openapi.json` regenerated (`just contracts`) if the API changed
- [ ] If this is part of a story: the card in `docs/stories/` exists (PR 0) and, when this PR completes the story, is updated (status, `pr` list, test links, implementation notes, user guide); `Closes #N` only on the completing PR
- [ ] ADR added in `docs/decisions/` for significant architectural/tooling decisions (drivers, driver × option rating table, pros/cons per option)
- [ ] If this adds a new backing service (cache, queue, blob storage, identity provider, …): add it to `compose.yaml` under a profile, bound to 127.0.0.1; if the local stack then needs more application processes than the API and the web app, or service discovery between them, re-evaluate an orchestrator such as Aspire per [ADR-0063](../docs/decisions/0063-docker-compose-profiles-for-local-backing-services-instead-of-aspire.md)
- [ ] If this adds a non-browser client: implement bearer authentication first, per [ADR-0027](../docs/decisions/0027-google-oidc-bff-session.md); if it adds sharing between users, a client with its own identity or a job that reads across users: re-decide row-level security first, per [ADR-0041](../docs/decisions/0041-per-user-data-ownership.md)
