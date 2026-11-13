# Original C# comparison evidence

These fixtures were captured before C# removal, from the unmodified reporting sources at `d4e86f597` (reporting code also matches `56b17db9b`). The original classes were copied to a temporary directory and an oracle entry point used their public methods. Compilation used the repository-pinned .NET SDK; `dotnet run --no-build` supplied clean stdout after the first compile. The replacement never generated the expected outputs.

Original source SHA-256:

| Source | SHA-256 |
| --- | --- |
| CiTimings.cs | 601c1550fa21ef00a54b614c99e69d59fe83374295b7cd1da03ed30f8835b2a4 |
| Baseline.cs | bed9036674862e55cbf1e5eb3847c0076f6ae3c54b52288378ab9ec5e45d4f34 |
| Trend.cs | b64fa863eaecb623af78fef941edd2293677e211d05ed576e2adf7bff547a027 |

`csharp-reports.json` holds the original `BaselineIo.Write`, `BaselineReport.Table`, `BaselineReport.Window`, `BaselineReport.BackTestTable`, `Trend.Report`, `Report.JobsTable`, `Report.StepsTable`, `Report.SupersededTable` and `Report.SupersessionSummary` results. Inputs are explicit in `parity_test.ts`: the fixed 2026-11-06 timestamp, thirty baseline values `80 + (i*7)%11 - 5`, twenty recent values `100 + (i*3)%11 - 5`, the two-job/two-run step sample, and the two superseded pairs. The C# oracle constructed the same typed inputs and wrote each returned string with Utf8JsonWriter. The Deno test compares every string byte for byte, including ordering, rounding, punctuation, and newlines. JSON baseline output is also compared byte for byte.

`csharp-cli-sample.txt` is stdout of the original entry point with `--repo o/r --runs 2 --job Frontend`; it exited 0 with empty stderr. `csharp-cli-invalid.txt` is stderr with `--runs x`; it exited 2 with empty stdout. The former used `mock-gh.ts` as a local executable named `gh`, supplied `cli-responses.json` through `CI_TIMINGS_RESPONSES`, and made no network call. The same responder and arguments execute the Deno entry point in `cli_test.ts`.

Reproduction after removal starts by extracting the three original classes and entry point from the stated Git revision into a scratch directory. Use the same typed inputs from `parity_test.ts` and the same mocked CLI response fixture. Ordinary tests consume only the frozen outputs and Deno; they do not require .NET.
