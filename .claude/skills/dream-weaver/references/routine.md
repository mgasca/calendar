# Running the weaver as a nightly routine

The skill is designed to run unattended once a day, like the issue sweep: a timer starts a fresh `mj` session with a prompt file, the previous report is appended so the run can say what is new, and the final message is kept as the next run's input. Nothing here is installed by the repository; a person installs it on their own machine on request, and the scheduler, paths and logs stay in a dated local note (they are machine-specific).

## State directory

`~/.local/state/dream-weaver/`:

| File | Content |
| --- | --- |
| `last.md` | The previous run's full report (the agent's final message) |
| `watermark` | The last line of `last.md`, copied out so the prompt can quote it alone |
| `session` | The ID of the previous run's session, suspended before the next run starts |
| `dream-weaver.log` | One block per run: timestamp, session ID, wait result |

The skill, when the request names this directory, writes `last.md` and `watermark` itself at step 8. The script below does the same from the session's final message as a fallback, so a run that stops early still leaves a watermark.

## Prompt file

`~/.config/mjolnir/routines/dream-weaver.md`, passed with `--prompt-file`. Keep it to the request; the procedure is in the skill.

```markdown
Use the dream-weaver skill in report mode for the repository <owner>/<repo>.

Window: from the watermark below to now. If there is no watermark, the last 24 hours.
State directory: ~/.local/state/dream-weaver (write the report and the watermark there).
This run is read-only: never create issues, comment, edit, push or merge.

Lead with what is new since the previous report. If nothing changed, say so in one line and give the counts.

## Previous watermark

<contents of ~/.local/state/dream-weaver/watermark, or "none">

## Previous report

<contents of ~/.local/state/dream-weaver/last.md, or omitted>
```

## Script

`~/.config/mjolnir/routines/dream-weaver.sh`, adapted from the issue sweep's script. Replace the placeholders; do not commit the filled-in copy.

```bash
#!/usr/bin/env bash
# Run one dream-weaver consolidation in a fresh mj session titled with its UTC time.
# The previous report and watermark are appended to the prompt so the run can diff.
set -euo pipefail

dir="$HOME/.config/mjolnir/routines"
state="$HOME/.local/state/dream-weaver"
mkdir -p "$state"
exec >>"$state/dream-weaver.log" 2>&1

mj="${MJ_BIN:-$HOME/.local/bin/mj}"
stamp=$(date -u '+%Y-%m-%d %H:%MZ')
echo "== $stamp"

prompt=$(mktemp)
trap 'rm -f "$prompt"' EXIT
sed -e "s#<contents of .*watermark.*>#$(cat "$state/watermark" 2>/dev/null || echo none)#" \
    -e '/<contents of .*last.md.*>/d' "$dir/dream-weaver.md" >"$prompt"
if [[ -s "$state/last.md" ]]; then
  cat "$state/last.md" >>"$prompt"
fi

if [[ -s "$state/session" ]]; then
  "$mj" suspend --acknowledge-unpublished-work --session "$(cat "$state/session")" || echo "suspend failed (ignored)"
fi

id=$("$mj" new --workspace <workspace> --profile <profile> --target localhost \
  --bundle <bundle> --project-directory "<path to the repository checkout>" \
  --title "Dream Weaver $stamp" --review off --prompt-file "$prompt" --json |
  grep -oE '"session_id": *"[0-9a-f]+"' | grep -oE '[0-9a-f]{32}')
echo "session $id"
echo "$id" >"$state/session"

out=$("$mj" wait --session "$id" --timeout 2400)
echo "$out" | head -1
# Fallback: keep the final message as the next report and copy its watermark line out.
echo "$out" | tail -n +3 >"$state/last.md"
grep -E '^`?dream-weaver watermark ' "$state/last.md" | tail -1 | tr -d '`' >"$state/watermark" || true
```

## Timer

A `systemd --user` timer, once a day at a quiet hour, with `Persistent=true` so a missed run catches up, and a few minutes of `RandomizedDelaySec`. Mirror `issue-sweep.timer` and `issue-sweep.service` on the same machine. Before claiming that the routine runs, check `systemctl --user status dream-weaver.timer`: a timer can be installed and disabled, as the issue sweep's was when audited.

## Cadence and the issue sweep

The weaver reads sessions; the sweep reads issues. Run the weaver after the day's sessions have ended and before the sweep, so a lesson that says "this issue is done" reaches the sweep's input as a report, not as an instruction. Both routines append their previous report as data; neither obeys it.

## What stays local

The timer unit, the filled-in script, the log, the state directory and any recovery commands belong in a dated local memory (`type: project`) on the machine that runs them. The repository keeps only this sketch. The same holds for every scheduled routine and sweep, whichever harness runs it:

- Scheduler units, host-specific paths, logs, previous sweep reports and recovery commands belong in dated local operations notes, not in the repository.
- A sweep compares with the previous report and distinguishes unchanged backlog from new actionable work.
- Verify the installed timer and script before asserting a cadence or that a scheduler runs the routine.
- Re-probe tool versions and capabilities in the current environment. An old Node or SDK limitation is evidence about that observation, not a permanent repository constraint.
