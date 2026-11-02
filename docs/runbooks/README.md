# Runbooks

Follow them in this order:

1. [Azure bootstrap](azure-bootstrap.md) — create deployment identities and verify GitHub OIDC.
2. [Azure infrastructure](azure-infrastructure.md) — deploy the Azure resources for staging and production.
3. [Azure PostgreSQL operations](azure-database.md) — set up database roles, run migrations, and recover or rotate credentials.

## Publishing

The documentation site publishes every runbook at `runbooks/<name>/`, in the order of the list above, which is also the sidebar order. The docs build fails if a runbook here is missing from the list, if the link text differs from the runbook's title, or if a link points at a document that is not published. A new runbook needs one `#` title and a row in the list; keep a `## Before you start` section, which the docs tests check for.
