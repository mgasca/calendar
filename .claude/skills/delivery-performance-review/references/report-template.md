# Report template

Keep the section order. Write each number with its basis: *measured* (name the command or harness) or *inferred* (from reading or arithmetic). Leave a section out only when its surface was out of scope, and say so under **Not covered**.

```markdown
# <Surface or job>: delivery performance review (<YYYY-MM-DD>)

**Question.** <What someone waits for, and how often: "a PR author waits for CI result, about N runs a day".>

**Sample.** <n successful runs of <workflow>, <window>, events <mix>, commits <first>..<last> (or one head commit).
Harness: `just tools ci-timings ...`. Local measurements at <commit> on <machine>.>

## What a run costs

| Lens | Value | Basis |
| --- | --: | --- |
| Critical path (median) | m:ss | measured, <jobs on the path> |
| Queue time (median) | m:ss | measured by hand from the jobs API / not sampled |
| Compute per run (median of per-run sums) | m:ss | measured / approximated as a sum of medians |

<Job table from the harness, unchanged.>

<Step table of the jobs in focus, unchanged.>

<One paragraph on the sample's shape: clusters, the control step checked, outliers.>

## Where the time goes

<For each mechanism, most expensive first: what repeats or grows, the count that proves it, and its share of the job.
Mark each as confirmed (counted or probed) or a lead (from the static pass only).>

## Opportunities, in order

| # | Change | Baseline | Predicted saving | Critical-path effect | Compute effect | Proof a fix needs |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | <smallest change that removes the cost> | <quantity, value, basis> | <s per run, basis> | <shortens the run / frees compute only> | <+/− s> | <test that fails without it; record NNNN> |

<Interactions between opportunities, and what the combined after-measurement on `main` would be.>

## Measurement plan

<For each opportunity: the after-quantity, the harness, the sample (n, events, head commit), the CI runs it would dispatch.
Total dispatches across the plan.>

## Not time, but worth fixing

<Log noise, warnings, unhandled requests: each with its count per run and why it matters for correctness.>

## Agent delivery loop

<When in scope: wake-ups, no-op wake-ups, CI runs dispatched only to measure, waits on checks, usage-limit stops. Where each fix belongs.>

## Not covered

<Surfaces, jobs or sessions not examined; measurements not run and why; what would settle each.>

**Review cost:** <runs sampled, CI runs dispatched (0 in report mode), probes run, scratch worktree removed>.
```
