# Which CI jobs a run needs, from the files it changes (ADR-0046, story 0038, issue #418).
# The Changes job in ci.yml runs it as `jq -c -f .github/ci-changes.jq`; tools/delivery-guards tests it with canned inputs.
#
# Input:  {"event": "pull_request", "complete": true, "files": ["backend/src/A.cs", ...]}
#         `files` holds every changed path, the old path of a rename included; `complete` is false when the listing may
#         be truncated.
# Output: {"backend": true, "frontend": false, "docs": false, "tooling": false, "image": true, "skipped": ["Frontend", ...]}
#         one boolean per filtered job id, and the names of the jobs it skips, which CI result accepts as skipped.

# The filtered jobs: id in ci.yml -> job name.
def jobs: {backend: "Backend", frontend: "Frontend", docs: "Docs site", tooling: "Tooling", image: "Container image"};

# A change to the rules themselves runs everything, so the new rules are checked by every job they could skip.
def rules_files: [".github/workflows/ci.yml", ".github/ci-changes.jq"];

def under($prefixes): . as $file | any($prefixes[]; . as $prefix | $file | startswith($prefix));

# Files directly under frontend/ (package.json, pnpm-lock.yaml, eslint.config.js, tsconfig.base.json, .node-version,
# the prettier files, mod.just), but not its Markdown guidance.
def frontend_root: test("^frontend/[^/]+$") and (endswith(".md") | not);

# Backend MSBuild files: tool-versions reads Directory.Packages.props, and the delivery guards read every one.
def backend_msbuild: startswith("backend/") and test("\\.(props|targets|csproj)$");

def just_files: . == "justfile" or . == ".just-version" or endswith(".just");

# Files under .github/ that the tooling tests read: the run-time gate and its baseline (ADR-0045), the trend workflow
# and the pull request template (agent-hooks).
def tooling_github:
  [".github/ci-gate.jq", ".github/ci-baseline.json", ".github/workflows/ci-trend.yml", ".github/pull_request_template.md"];

# Files beside docs/decisions/ that `just tools adr` checks (story 0051, issue #562): the architecture model's ADR
# entries and citations (M2), and, with docs/stories/, the planned story cards that must not cite a superseded ADR (J6).
def adr_inputs: ["docs/architecture/calendar.architecture.json"];

# Docs site: its suite tests the publisher, .github/workflows/pages.yml (pages-workflow.test.ts), and it builds from the
# shared theme package, so that one named directory is an input too (ADR-0025, third amendment; story 0046, issue #518).
# The trailing slash keeps look-alike directories out. No other frontend/packages/ directory and nothing under
# frontend/apps/web/ makes a run build the docs site by itself.
def docs_theme_package: "frontend/packages/theme/";

# Whether the file at `.` is an input of job `$job`.
def needs($job):
  if $job == "docs" then under(["docs/", "frontend/apps/docs/", docs_theme_package]) or frontend_root or . == ".github/workflows/pages.yml"
  elif $job == "backend" then under(["backend/", "contracts/"])
  elif $job == "frontend" then under(["frontend/apps/web/", "frontend/packages/", "contracts/"]) or frontend_root
  elif $job == "tooling" then
    under(["tools/", ".claude/", "infra/", "docker/", "just/", "docs/decisions/"]) or just_files or backend_msbuild
      or IN(tooling_github[]) or IN(adr_inputs[]) or under(["docs/stories/"])
  elif $job == "image" then
    under(["backend/", "frontend/apps/web/", "frontend/packages/", "contracts/", "docker/"]) or frontend_root
      or IN("Dockerfile", ".dockerignore", "image.just")
  else error("ci-changes.jq: no rule for job \($job)")
  end;

def filtered: (.event | IN("pull_request", "merge_group")) and .complete == true
  and (.files | all(. as $file | rules_files | index($file) | not));

. as $run
| (if $run | filtered
   then jobs | with_entries(.key as $job | .value = any($run.files[]; needs($job)))
   else jobs | map_values(true)
   end)
| . + {skipped: [to_entries[] | select(.value == false) | .key as $job | jobs[$job]]}
