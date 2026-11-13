# Reporting port verification inventory

The TypeScript suites preserve the original assertions and constructed fixtures from the C# dashboard test app. Theory rows are grouped into loops; a Deno test count is not an xUnit case count.

| Original suite | Replacement |
| --- | --- |
| `CiSnapshotTests`, `SnapshotRulesTests`, `CiBaselineTrendTests`, `SnapshotVersionTests` in `delivery-dashboard.tests.cs` | `snapshot_test.ts` (including the shared docs-site valid fixtures and version 1/2 compatibility) |
| `QualityTests.cs`, `QualityJobNameTests.cs`, `QualityReuseTests.cs` | `quality_test.ts` |
| `AgentTests.cs` | `agents_test.ts` |
| `FlowTests.cs` | `flow_test.ts` |
| `SupersededTests.cs` | `superseded_test.ts` |
| `AlertTests.cs` | `alerts_test.ts` |
| CLI exit/output/collector reuse checks added for the migration | `cli_test.ts` |
| Deterministic complete snapshot bytes | `parity_test.ts` |

`fixtures/snapshot-parity.json` was generated with the unchanged original reporting sources at `d4e86f597` using `SnapshotJson.Write` over the same inputs constructed in `parity_test.ts`: rounding boundary durations, CI/path aggregation, first duplicate PR mention with a different review count, issue counters, flow stacks and repeated issue closing references, and two weeks of superseded/control runs. The comparison checks exact bytes (fixed key order, indentation and newline), then validates the result. This comparison caught a last-versus-first duplicate-mention mismatch in the initial TypeScript implementation; the port now preserves the first mention as the original `DistinctBy` does.

`fixtures/quality-parity.json` was generated with original `QualityJson.Write` over the ninety-run constructed history in `quality_test.ts`: seven conclusions, main and pull-request scopes, one through three attempts, untrusted job names, supersession and tooling guard step counts. The parsed output must equal the new section exactly. No live GitHub data is required by these fixtures.

The scratch oracle compilation disabled analyzers only on the scratch entry point; it included unchanged original production implementations. It is a behavioral comparison, not a substitute for production strict checking, lint, formatting or tests. No test needs the retired SDK after fixture capture.
