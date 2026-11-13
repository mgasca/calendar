---
subject: "The handover watch: two GraphQL queries per tick instead of 2 + 3N REST calls (#363)"
harness: "tools/handover-watch/handover-watch.ts"
---

# 0013 Two GraphQL queries per handover-watch tick instead of 2 + 3N REST calls

- **Date:** 2026-11-06
- **Issue:** [#363](https://github.com/mgasca/calendar/issues/363), a follow-up of [#320](https://github.com/mgasca/calendar/issues/320) (story 0027) and of finding 1 of the [performance review on #360](https://github.com/mgasca/calendar/pull/360#issuecomment-6689752931); PR [#375](https://github.com/mgasca/calendar/pull/375)
- **Harness:** `tools/handover-watch/handover-watch.cs`, run as `dotnet run tools/handover-watch/handover-watch.cs -- <issue> --peek`. `--peek` prints without recording, so every run fetches and prints the same. A `gh` shim on `PATH` counts calls and bytes, as described under Method.
- **Baseline commit:** `b609b438` (main)
- **After commit:** `f7dec6cc` (the code of the change). The commits after it change only `docs/` and one code comment.

## Question

Each tick of the watch started 2 + 3N `gh api` processes for N delivery PRs: the issue's REST timeline and comments, then the comments, review comments and reviews of every delivery PR, merged ones included. The timeline also embeds each cross-referencing issue in full. How many calls, bytes and seconds per tick does GraphQL save, and does the printed output stay the same?

## Method

- **The change.** The first query asks for the issue's comments and its cross-references. Each cross-reference brings only the fields that decide whether the PR is a delivery PR, and that give its state. Any `--pr` PR comes in full. The next query asks, in one call, for the lists of the delivery PRs found (comments, reviews, review threads) and for the next page of any list longer than a page. A page is 100 items, 10 review threads, or 50 comments per thread. An issue with no delivery PR needs one call; one with delivery PRs needs two.
- **IDs and logins.** IDs are read from `fullDatabaseId`, so the seen-ID keys are unchanged. GraphQL drops the `[bot]` suffix from a bot's login, so it is added back.
- **How the design got here.** The first version of #375 (`9f55989d`) asked for every cross-referencing PR's lists in the first query, so a tick was one call. The PR's security review found that this let anyone who mentions the issue from their own repository decide how much each tick downloads. The maintainer chose two queries, and this record measures that version. The one-query figures are kept under Results for comparison.
- **Workload.**
  - #155: no cross-references.
  - #272: 18 cross-references, no delivery PR.
  - #262: 3 delivery PRs.
  - #332: 6 delivery PRs.
  - #318: 9 delivery PRs. It had 3 when #360's review measured it, so it now covers the "six or more PRs" case of #363 by itself.

  The PR's performance review found no list in the repository longer than one page. The longest are 26 cross-references (#292), 22 comments (#153), 21 PR comments, 6 reviews, 3 review threads and 2 comments in one thread.
- **Wall time.** Each version ran with `dotnet run` from its own checkout, the old one in a scratch worktree at `b609b438`, with a warm build cache. The versions alternated, old then new, for each issue in turn, in 7 rounds from 20:19Z to 20:22Z on 2026-11-06. The machine was a WSL2 laptop with 12 logical cores and other work running, at a load average of 1.3 to 1.8. Old always ran before new within a pair. The effects are larger than any order effect.
- **Calls, requests and bytes.** After the timed rounds, one more run of each version per issue had a `gh` shim first on `PATH`. The shim ran the real `gh` with `GH_DEBUG=api`, logged one line per process and counted the `* Request to https` lines on its stderr and the bytes on its stdout. It is a throwaway shell script, not committed, because ADR-0017 keeps repository tooling in .NET. To repeat the count, any wrapper that does the same works. The bytes are decompressed JSON, as `gh` prints it.
- **Rate-limit cost.** Each query was sent with `rateLimit { cost nodeCount }` added, both charged and with `dryRun: true`.
- **Same output.** The old and new versions ran back to back with `--peek` on 20 targets, and their stdout was compared byte for byte. The targets:
  - issues #51, #153, #262, #272, #275, #292, #318, #319, #320, #321, #325, #332, #347, #349 and #363;
  - PRs #266 and #360, watched as the issue;
  - `262 --pr 266`, `320 --pr 361` and `363 --pr 359`.

  A scratch copy with page sizes of 2 and 1 then ran against the real API on 7 targets, so that every kind of follow-up page and the second query were requested. Its output was compared with the old version's the same way.
- **Controls.** The first is a `dotnet run` of each version with no arguments: a usage error that starts no `gh`, so only startup is timed, which the change should not move. The second is a single REST call, `gh api repos/{owner}/{repo}/issues/363`, the cost of one `gh` process and round trip. It ran once per round.

## Results

Measured. Timed runs give the median and range of 7 alternating runs; counts come from the shim run.

| Issue | Delivery PRs | `gh` processes | Bytes received | Wall time before | Wall time after |
| --- | --: | --: | --: | --: | --: |
| #155 | 0 (no cross-references) | 2 → 1 | 1.3 KB → 0.2 KB | 0.94 s (0.87–1.14) | 1.19 s (0.99–1.25) |
| #272 | 0 (18 cross-references) | 2 → 1 | 300 KB → 47 KB | 1.19 s (1.04–1.92) | 1.39 s (1.24–1.50) |
| #262 | 3 | 11 → 2 | 167 KB → 35 KB | 2.75 s (2.30–2.89) | 2.28 s (2.10–2.74) |
| #332 | 6 | 20 → 2 | 179 KB → 43 KB | 3.61 s (3.33–3.91) | 2.26 s (2.05–2.30) |
| #318 | 9 | 29 → 2 | 389 KB → 85 KB | 4.45 s (4.12–4.56) | 2.39 s (2.05–2.61) |

API requests equal `gh` processes in every row: no call needed a second page.

| Control | Before | After |
| --- | --: | --: |
| `dotnet run` with a usage error (no `gh`) | 0.24 s (0.22–0.38) | 0.26 s (0.23–0.30) |
| One `gh api` REST call (one series, same session) | 0.79 s (0.68–0.91) | (same series) |

| Query on #318 | Charged cost | Nodes | Response |
| --- | --: | --: | --: |
| First: the issue and its cross-references | 1 point | 200 | 52 KB |
| Second: the lists of 9 delivery PRs | 1 point | 6,390 | 32 KB (measured by the performance review on a later run) |

The first version of #375 (one query, `9f55989d`) was measured the same way at 19:45Z to 19:47Z, with the same old version. On #262, #332 and #318 it took 1.42 s, 1.53 s and 1.86 s and received 29, 37 and 95 KB in one call each.

## Reading

- **Measured, wall time:** a tick on an issue with delivery PRs is two calls instead of 2 + 3N, and the saving grows with N. Wall time fell by 0.5 s for #262, 1.4 s for #332 and 2.1 s for #318. The #262 ranges overlap (2.30–2.89 s against 2.10–2.74 s), so its saving is the least firm. Neither control moved.
- **Inferred across two sessions, the second call's price:** the second query is a second round trip. Comparing this session with the one-query session of 19:45Z (load 2.1–2.5 against 1.3–1.8), these ticks are about 0.5–0.9 s slower than with the one-query version. That was the price of keeping strangers' PRs from deciding the download.
- **Measured, issues without delivery PRs:** a tick is 0.2–0.25 s slower than before (#155, #272). One GraphQL call takes longer than the old two small REST calls, which ran in parallel. At a 5-minute cadence this is negligible.
- **Measured, bytes:** a tick on an issue with delivery PRs receives 75–80% fewer bytes. On #272 it receives 84% fewer, because the REST timeline embedded every cross-referencing issue in full. What a PR that is not a delivery PR now costs is its header, mostly its body: GraphQL cannot filter PRs on their body, so every cross-reference brings one. Its comments, reviews and threads are no longer fetched. In the one-query version, the 7 PRs #318 drops were 37 KB of whole objects (measured in this session). The performance review later measured 39 KB of whole objects, 16.5 KB of them their lists.
- **Measured, cost:** both queries cost 1 point each, and the first asks for 200 nodes whatever the issue, because cross-references no longer nest lists. Each `--pr` PR adds about 710 nodes, and each delivery PR in the second query about 710 nodes and 0.13 points (9 PRs cost 1 point, 100 would cost 13). This no longer relies on GitHub skipping connections nested under the timeline union. The one-query version did rely on that: by the documented formula it would have cost 53 points.
- **Inferred from the counts:** at the 5-minute cadence of #319, watching #318 costs 24 GraphQL points an hour instead of 348 REST requests. Each limit allows 5,000 an hour. At a 60-second cadence it costs 120 points instead of 1,740 requests.
- **Measured, output:** the output did not change. Follow-up pages and the second query were exercised against the real API only by the scratch copy with small page sizes, because no real list is longer than a page.

## Reconsider when

Reconsider when one of these happens:

- A tick takes more than about 3 s again.
- Cross-reference headers pass about 250 KB in one response.
- A query costs more than a few points, or GitHub reports a node-limit error.
- A list needs more than 20 follow-up rounds, so its tail stays unread on every tick, at 21 calls per tick. Comments are read oldest first, so reading them newest first (`last:`, `before:`) would fix it. This is inferred and needs about 2,000 items in one list; the repository maximum is 26.
- A round names more than about 200 delivery PRs, which would bring its query text near Linux's 128 KB limit for a single argument. Capping the PRs per round would fix it. This is inferred.
- The extra round trip on issues with delivery PRs is felt in sessions. The performance review's alternative is to name the PRs already in the seen record (`pr-state:N` keys) in the first query. That would make a steady-state tick one call again, at the price of the record deciding what is fetched.

Repeat the method above on both versions, alternating them, compare with this record, and never edit it.
