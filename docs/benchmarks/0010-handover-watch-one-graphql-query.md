# 0010 One GraphQL query per handover-watch tick

- **Date:** 2026-11-06
- **Issue:** [#363](https://github.com/mgasca/calendar/issues/363), a follow-up of [#320](https://github.com/mgasca/calendar/issues/320) (story 0027) and of finding 1 of the [performance review on #360](https://github.com/mgasca/calendar/pull/360#issuecomment-6689752931)
- **Harness:** `tools/handover-watch/handover-watch.cs`, run as `dotnet run tools/handover-watch/handover-watch.cs -- <issue> --peek`. `--peek` prints without recording, so every run fetches and prints the same. A `gh` shim on `PATH` counts calls and bytes, as described under Method.
- **Baseline commit:** `b609b438` (main)
- **After commit:** `9f55989d` (the code of the change). The record commit after it changes only `docs/`.

## Question

Each tick of the watch started 2 + 3N `gh api` processes for N delivery PRs: the issue's REST timeline and comments, then the comments, review comments and reviews of every delivery PR, merged ones included. The timeline also embeds each cross-referencing issue in full. How many calls, bytes and seconds per tick does one GraphQL query save, and does the printed output stay the same?

## Method

- **The change.** One `gh api graphql` query fetches the issue's comments and cross-references. Each cross-referencing PR comes with its state, body, author association, comments, reviews and review threads, and each `--pr` PR is an alias in the same query. A list longer than its page (100 items, or 50 for review threads and their comments) gets its next page by node ID, all such lists in one follow-up call per round. IDs are read from `fullDatabaseId`, so the seen-ID keys are unchanged. GraphQL drops the `[bot]` suffix from a bot's login, so it is added back.
- **Workload.** #262 (3 delivery PRs), #332 (6) and #318 (9). #318 had 3 delivery PRs when #360's review measured it; it now covers the "six or more PRs" case of #363 by itself. No issue in the repository has a list longer than one page: the longest are the 25 cross-references on #292 and the 22 comments on #153.
- **Wall time.** Each version ran with `dotnet run` from its own checkout, the old one in a scratch worktree at `b609b438`, with a warm build cache. The versions alternated, old then new, for each issue in turn, in 7 rounds from 19:45Z to 19:47Z on 2026-11-06. The machine was a WSL2 laptop with 12 logical cores and other work running, at a load average of 2.1 to 2.5.
- **Calls, requests and bytes.** After the timed rounds, one more run of each version per issue had a `gh` shim first on `PATH`. The shim ran the real `gh` with `GH_DEBUG=api`, logged one line per process and counted the `* Request to https` lines on its stderr and the bytes on its stdout. It is a throwaway shell script, not committed, because ADR-0017 keeps repository tooling in .NET. To repeat the count, any wrapper that does the same works.
- **Rate-limit cost.** Each issue's query was sent once more with `rateLimit { cost }` added.
- **Same output.** The old and new versions ran back to back with `--peek` on 20 targets, and their stdout was compared byte for byte. The targets: issues #51, #153, #262, #272, #275, #292, #318, #319, #320, #321, #325, #332, #347, #349 and #363; PRs #266 and #360 watched as the issue; and `262 --pr 266`, `320 --pr 361` and `363 --pr 359`. A scratch copy with page sizes of 2 and 1 then ran against the real API on 7 targets, so that every kind of follow-up page was requested. Its output was compared with the old version's the same way.
- **Controls.** The first is a `dotnet run` of each version with no arguments: a usage error that starts no `gh`, so only startup is timed, which the change should not move. The second is a single REST call, `gh api repos/{owner}/{repo}/issues/363`, the cost of one `gh` process and round trip. It ran once per round.

## Results

Measured. Timed runs give the median and range of 7 alternating runs; counts come from the shim run.

| Issue | Delivery PRs | `gh` processes | API requests | Bytes received | Wall time before | Wall time after |
| --- | --: | --: | --: | --: | --: | --: |
| #262 | 3 | 11 → 1 | 11 → 1 | 153 KB → 29 KB | 2.42 s (2.27–3.03) | 1.42 s (1.03–1.69) |
| #332 | 6 | 20 → 1 | 20 → 1 | 165 KB → 37 KB | 3.81 s (3.47–4.43) | 1.53 s (1.15–1.77) |
| #318 | 9 | 29 → 1 | 29 → 1 | 375 KB → 95 KB | 4.37 s (4.15–4.87) | 1.86 s (1.52–2.32) |

| Control | Before | After |
| --- | --: | --: |
| `dotnet run` with a usage error (no `gh`) | 0.24 s (0.21–0.29) | 0.24 s (0.21–0.28) |
| One `gh api` REST call (one series, same session) | 0.78 s (0.57–0.95) | (same series) |

| Quantity | Before | After |
| --- | --: | --: |
| Rate-limit cost of one tick, each of the three issues | 11, 20 or 29 REST requests | 1 GraphQL point |
| Targets with byte-identical output, default page sizes | (reference) | 20 of 20 |
| Targets with byte-identical output, page sizes 2 and 1 | (reference) | 7 of 7, at 5 to 14 calls each |

## Reading

- Measured: a tick is one call instead of 2 + 3N, so the saving grows with N. Wall time fell by 1.0 s for #262, 2.3 s for #332 and 2.5 s for #318. Before and after ranges do not overlap, and neither control moved.
- Measured: a tick receives 75–81% fewer bytes. Measured on #318's response: about 37 KB of its 95 KB are the lists of the 7 cross-referencing PRs that are not delivery PRs. GraphQL cannot filter PRs on their body, so the query fetches every cross-referencing PR's lists and the parser drops the ones it does not watch. Fetching the delivery PRs' lists in a second query would drop those bytes but add a call and a round trip, so it was not done.
- Inferred from the counts: at the 5-minute cadence of #319, watching #318 costs 12 GraphQL points an hour instead of 348 REST requests. Each limit allows 5,000 an hour. At a 60-second cadence it costs 60 points instead of 1,740 requests.
- Inferred: what remains after the change is mostly fixed cost, `dotnet run` startup (0.24 s) and one `gh` process with one round trip. The GraphQL round trip is slower than a REST one, so a tick takes about twice the single-call control.
- Measured: the output did not change. Follow-up pages were requested from the real API only by the scratch copy with small page sizes, because no real list is longer than a page. A real tick makes one call.

## Reconsider when

A tick takes more than about 3 s again, or one response passes about 250 KB because many PRs that are not delivery PRs cross-reference the issue: then fetch the delivery PRs' lists in a second query. Also reconsider when GitHub reports a cost above 1 point or a node-limit error for the query. Repeat the method above on both versions, alternating them, compare with this record, and never edit it.
