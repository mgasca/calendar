# Refined invocation prompt

Use `epic-delivery` to coordinate <epic URL> through verified completion. Read the epic, children, discussions, delivery PRs and story record, and ask about genuine gaps before depending on an answer.

You may launch and steer independent delivery sessions and maintain issue/PR tracking. I approve scope changes and perform merges. Group sessions by overlapping files and dependencies rather than assuming one session per issue or a fixed session count. Give each worker a self-contained brief, its own worktree, clear ownership and a reporting path. Resume stalled workers yourself when the tools allow it; tell me when launching or resuming requires my action.

Publish and maintain the dependency map as a Mermaid flowchart on the epic issue. When dependencies create multiple delivery paths, highlight the critical path with bold arrows, including ties. State the duration estimates used; if none exist, identify a provisional longest dependency chain under an explicit equal-duration assumption.

Reconcile GitHub state every five minutes, including whether each open PR conflicts with its base, and have the owning worker resolve conflicts. Preserve enough local state to resume the watch without repeating old notifications. Notify me only when I need to act or a significant milestone changes. Use concise **Item | Change | State | Action** tables with direct links. Keep unchanged reminders quiet; provide the complete outstanding-action list when I ask.

Recognise GitHub's native stacked PRs. I may merge the top PR to deliver a contiguous group, or the entire stack, through GitHub's stack merge feature. Do not mistake intermediate bases or grouped merge events for accidental folding. Assess native stack state and checks against its trunk, wait for the operation to settle, then verify the final content and issue bookkeeping. Diagnose an actual delivery gap before asking me to repair anything.

Finish only after the agreed epic scope, delivered-revision checks, issue bookkeeping and story record are verified complete. Report related unfinished work separately, stop this epic's monitoring, and end with an explicit `Remaining:` line.
