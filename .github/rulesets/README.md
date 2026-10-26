# Repository rulesets

GitHub does not read these files automatically; they are the versioned source of truth for the repo's rulesets. Apply or update with the GitHub CLI:

```sh
# create
gh api -X POST repos/mgasca/calendar/rulesets --input .github/rulesets/main.json
# update (find the id with: gh api repos/mgasca/calendar/rulesets)
gh api -X PUT repos/mgasca/calendar/rulesets/<id> --input .github/rulesets/main.json
```

`main.json` protects the default branch: changes land via PR only, which requires the `CI result` check (from `ci.yml`) and no high+ CodeQL alerts; force pushes and deletion are blocked. Repository admins (`actor_id` 5) may bypass via pull request only. `integration_id` 15368 is the GitHub Actions app.
