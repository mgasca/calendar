# Monitoring

Use Azure Monitor alerts, the Container App's Metrics and Logs, and the environment's Application Insights Availability and Failures views. Check `https://<container-app-fqdn>/api/health` for process liveness and `/api/health/ready` for the app and database; the latter runs one trivial database query per ping and returns only `ok` or `unavailable`. The Container App startup, liveness and readiness probes continue to use `/api/health`. A stopped staging database is expected when staging is idle; staging has no availability test by design.

The 5xx alert in both environments counts Container Apps `Requests` with status category 5xx. Defaults are `serverErrorThreshold=3` responses over `serverErrorWindowMinutes=15`, evaluated every `serverErrorEvaluationMinutes=5`, severity 2, automatically resolved. Missing data does not trigger it. Production also has a standard availability test of the readiness URL every 900 seconds from one location; an availability failure means the public endpoint or database is unavailable. The test and 5xx alert together cover database outages. One location can itself fail, so inspect the test result before diagnosing the app. Budget notifications indicate actual spending reached 80% or forecast spending reached 100% of the resource-group budget; budgets do not cap spending.

For slow requests, compare request duration with replica count and review cold starts in Container Apps system logs. If staging is down, check whether PostgreSQL is stopped before restarting it. For failures during startup or secret rotation, inspect Container Apps system logs and the app vault's audit events for Key Vault reference or authorization failures. Avoid putting tokens, cookies or personal data into queries or screenshots.

In the workspace Logs view, adjust the time range and resource filters before running:

```kusto
ContainerAppSystemLogs_CL
| where TimeGenerated > ago(1h)
| project TimeGenerated, Log_s
| order by TimeGenerated desc
```

```kusto
AppRequests
| where TimeGenerated > ago(1h)
| summarize requests = sum(ItemCount), errors = sumif(ItemCount, ResultCode startswith "5") by bin(TimeGenerated, 5m)
| order by TimeGenerated desc
```

```kusto
AppAvailabilityResults
| where TimeGenerated > ago(24h)
| summarize failures = countif(Success == false), checks = count() by Name, bin(TimeGenerated, 1h)
```

## Prove alert delivery

Perform these checks in a maintenance window, with the owner watching the configured mailbox. Record the Azure alert and delivery times and restore all temporary changes immediately. Avoid disrupting production users; use staging for the 5xx and budget tests.

1. **5xx:** in staging, stop its PostgreSQL server, then make three requests to `/api/health/ready` within 15 minutes. Verify they return 503 and observe the alert and email after the next evaluation. Restart PostgreSQL and verify the alert resolves. Do not use `/api/health` as it remains 200.
2. **Availability:** in production during a scheduled maintenance window, temporarily point the standard test at `/api/does-not-exist` on the same app. Wait for retries, the next test and alert evaluation, confirm the fired alert and email, then restore `/api/health/ready` and confirm recovery. The test configuration can take time to propagate.
3. **Budget actual:** in staging, temporarily lower the budget amount so accrued actual cost exceeds 80%; wait for Cost Management evaluation and email, then restore the configured amount. If current cost is zero, wait until there is accrued cost rather than generating wasteful usage.
4. **Budget forecast:** temporarily lower the staging amount below its forecast and verify the forecast notification and email, then restore the amount. Forecasts may be unavailable early in a billing period; retry when Azure provides one. Budget notifications are not instant and may only fire once per threshold per period; use a separate temporary budget if a threshold has already fired.

Re-run the full what-if after these tests and restore any drift. Inspect Azure's resource state and delivered emails; a successful template build cannot prove notifications fire.
