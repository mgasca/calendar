# Infrastructure tooling

Use `just doctor --infra` to check the pinned Azure CLI and Bicep. Local application development does not require them. Azure CLI uses its installed Bicep binary, never a binary found on PATH.

Set `AZURE_DEPLOYER_CLIENT_ID` to the target environment's deployment identity client ID. The tool resolves its object ID through Microsoft Graph, even when the operator is signed in as a user; this avoids granting the human operator the pipeline's vault role. The pipeline identity can read its own service principal without tenant-wide Graph permissions; a human caller needs permission to read that principal. `CALENDAR_CONTAINER_IMAGE` optionally overrides the parameter file's image.

First deploy the `foundation` phase, grant the owner Key Vault Secrets Officer on the ops vault, and run `just infra-secret-init staging`. Then deploy the `full` phase. The owner command refuses to overwrite an existing password; password rotation requires a coordinated manual change to PostgreSQL and the ops vault. The deploy identity needs Key Vault Secrets User on both vaults. Full preview requires the owner's secret initialization; foundation preview works before it.

Supply extra IPv4 addresses or CIDRs with repeatable `--allow-ip` as extra arguments after the environment or comma-separated `AZURE_ALLOWED_IPS`; the tool converts CIDRs to PostgreSQL firewall ranges. CI can use the environment variable of the same name.

The tool creates mode 0600 temporary files for the password and deployment parameters and deletes them in a `finally` block. Azure CLI receives only the file path, never a secret value in an argument. Files are placed in a private mode 0700 directory under `XDG_RUNTIME_DIR`, or `~/.cache` when it is unavailable. Abrupt termination can leave files behind; startup removes files with the tool prefix older than 24 hours, and the owner can remove them sooner after ensuring no command is running. CLI error output is suppressed because it may echo sensitive inputs.

PRs lint and build the templates. Protected environment branch restrictions prevent PR branch OIDC authentication, so a workflow dispatch from `main` previews both environments; production still requires approval. Review each preview and investigate incomplete results. A no-change preview should show no resource changes; ARM incremental deployment does not delete resources removed from templates.
