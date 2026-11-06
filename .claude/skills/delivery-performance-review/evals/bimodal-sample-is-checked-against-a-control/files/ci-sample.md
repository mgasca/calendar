# CI sample (synthetic eval fixture)

This data is made up for an eval of the delivery-performance-review skill. It is not a real measurement.

Sample: 12 successful runs of `ci.yml`, all `pull_request` events, over two days. Every run is on one of two head commits, `aaaa111` (runs 1–6) and `bbbb222` (runs 7–12). Commit `bbbb222` changed only `frontend/apps/web/src/features/day/DayView.tsx`.

Job `Web`, seconds per step, one row per run:

| Run | Head | Set up job | Checkout | Setup Node | Install | Lint | Typecheck | Test | Build | Job total |
| --- | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| 1 | aaaa111 | 1 | 1 | 3 | 2 | 10 | 30 | 14 | 29 | 90 |
| 2 | aaaa111 | 2 | 1 | 7 | 4 | 16 | 48 | 23 | 46 | 147 |
| 3 | aaaa111 | 1 | 1 | 3 | 2 | 11 | 31 | 15 | 30 | 94 |
| 4 | aaaa111 | 2 | 2 | 8 | 5 | 16 | 49 | 22 | 47 | 151 |
| 5 | aaaa111 | 1 | 1 | 2 | 2 | 10 | 29 | 14 | 28 | 87 |
| 6 | aaaa111 | 2 | 1 | 7 | 4 | 17 | 47 | 23 | 48 | 149 |
| 7 | bbbb222 | 2 | 1 | 8 | 4 | 16 | 50 | 24 | 47 | 152 |
| 8 | bbbb222 | 2 | 2 | 7 | 5 | 17 | 48 | 23 | 46 | 150 |
| 9 | bbbb222 | 1 | 1 | 3 | 2 | 10 | 30 | 15 | 29 | 91 |
| 10 | bbbb222 | 2 | 1 | 8 | 4 | 16 | 49 | 22 | 48 | 150 |
| 11 | bbbb222 | 2 | 1 | 7 | 4 | 16 | 47 | 23 | 47 | 147 |
| 12 | bbbb222 | 2 | 2 | 8 | 5 | 17 | 49 | 24 | 46 | 153 |

Other jobs in the same runs (median over all 12): `Api` 1:58, `Tooling` 1:14. `Web`, `Api` and `Tooling` run in parallel; a final `Result` job needs all three and takes 3 s.

A teammate says: "`bbbb222` made the web job about 25% slower; we should revert the DayView change."
