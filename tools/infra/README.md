# Infrastructure tooling

Use `make doctor ARGS=--infra` to check the pinned Azure CLI and Bicep. Local application development does not require them. Azure CLI uses its installed Bicep binary, never a binary found on PATH.

Set `AZURE_DEPLOYER_CLIENT_ID` to the target environment's deployment identity client ID. The tool resolves its object ID through Microsoft Graph, even when the operator is signed in as a user; this avoids granting the human operator the pipeline's vault role. The pipeline identity can read its own service principal without tenant-wide Graph permissions; a human caller needs permission to read that principal. `CALENDAR_CONTAINER_IMAGE` optionally overrides the parameter file's image.

First deploy the `foundation` phase, grant the owner Key Vault Secrets Officer, and run `make infra-secret-init ENV=staging`. Then deploy the `full` phase. The owner command refuses to overwrite an existing password unless `ARGS=--force` is explicitly supplied. The deploy identity needs Key Vault Secrets User. Full preview requires the owner's secret initialization; foundation preview works before it.

The tool creates mode 0600 temporary files for the password and deployment parameters and deletes them in a `finally` block. Azure CLI receives only the file path, never a secret value in an argument. Abrupt termination can leave the file behind; run on a private temporary filesystem and remove stale `calendar-infra-*` files. CLI error output is suppressed because it may echo sensitive inputs.

PRs lint and build the templates. Protected environment branch restrictions prevent PR branch OIDC authentication, so a workflow dispatch from `main` previews both environments; production still requires approval. Review each preview and investigate incomplete results. A no-change preview should show no resource changes; ARM incremental deployment does not delete resources removed from templates.
