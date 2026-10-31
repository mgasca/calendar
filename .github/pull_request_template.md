## Summary

<!-- What does this change and why? Link issues with "Closes #123". -->

## Changes

-

## Checklist

- [ ] `make check` passes locally
- [ ] Tests added or updated for behavior changes
- [ ] `contracts/openapi.json` regenerated (`make contracts`) if the API changed
- [ ] If this is part of a story: the card in `docs/stories/` exists (PR 0) and, when this PR completes the story, is updated (status, `pr` list, test links, implementation notes, user guide); `Closes #N` only on the completing PR
- [ ] ADR added in `docs/decisions/` for significant architectural/tooling decisions (drivers, driver × option rating table, pros/cons per option)
- [ ] If this adds a new backing service (cache, queue, blob storage, identity provider, …): re-evaluate .NET Aspire per [ADR-0016](../docs/decisions/0016-local-database-provisioning.md)
- [ ] If this adds a second user: implement `owner_id` and per-user scoping first; if it adds a non-browser client: implement bearer authentication first, per [ADR-0027](../docs/decisions/0027-google-oidc-bff-session.md)
