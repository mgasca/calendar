# Rotate the staging database password

Rotate the password for the staging database. Do this during a quiet period.

Stop the app first:

```bash
make app-stop ENV=staging
```

Generate a new password and store it in the vault:

```bash
make secret-rotate ENV=staging NAME=db-password
```

Restart the app:

```bash
make app-start ENV=staging
```

Check that the app connects. The health check should return `ok`.
