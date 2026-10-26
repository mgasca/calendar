#!/usr/bin/env python3
"""Validate Architecture Decision Records against this repo's conventions (see ADR-0000).

Usage:
  check_adr.py                     validate every ADR in docs/decisions
  check_adr.py FILE...             validate specific ADRs (repo-level checks still run)
  check_adr.py --fix-links [FILE...]  rewrite bare "ADR-NNNN" mentions as Markdown links, then validate
  check_adr.py --next-number       print the next free ADR number (e.g. 0017)

Exit code 0 when no errors are found, 1 otherwise. Standard library only.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

STARS = {"★★★", "★★☆", "★☆☆", "☆☆☆"}
STATUS_RE = re.compile(
    r"^(proposed|accepted|rejected|deprecated|superseded by \[ADR-\d{4}\]\(\d{4}-[a-z0-9-]+\.md\))$"
)
FILENAME_RE = re.compile(r"^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$")
REQUIRED_H2 = [
    "Context and Problem Statement",
    "Decision Drivers",
    "Considered Options",
    "Decision Outcome",
    "Pros and Cons of the Options",
]
REQUIRED_H3_IN_OUTCOME = ["Consequences", "Confirmation"]
DRIVER_RE = re.compile(r"^\* \*\*(D\d+) [^*]+\*\*: \S", re.M)
PRO_CON_RE = re.compile(r"^\* (Good|Bad|Neutral), because \*\*D\d+")
BARE_REF_RE = re.compile(r"(?<!\[)ADR-(\d{4})(?!\]\()")


def repo_root() -> Path:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
        ).stdout.strip()
        return Path(out)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return Path.cwd()


def adr_files(decisions: Path) -> dict[str, Path]:
    return {
        m.group(1): p
        for p in sorted(decisions.glob("[0-9][0-9][0-9][0-9]-*.md"))
        if (m := FILENAME_RE.match(p.name))
    }


def strip_code(text: str) -> str:
    """Blank out fenced and inline code so references inside code aren't flagged."""
    text = re.sub(r"```.*?```", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return re.sub(r"`[^`\n]*`", "``", text)


def sections(body: str, level: int) -> dict[str, str]:
    marker = "#" * level
    parts = re.split(rf"^{marker} (.+)$", body, flags=re.M)
    return {parts[i].strip(): parts[i + 1] for i in range(1, len(parts) - 1, 2)}


def parse_tables(text: str) -> list[list[list[str]]]:
    tables, current = [], []
    for line in text.splitlines():
        if line.startswith("|"):
            current.append([c.strip() for c in line.strip().strip("|").split("|")])
        elif current:
            tables.append(current)
            current = []
    if current:
        tables.append(current)
    return tables


def check_file(path: Path, files: dict[str, Path], index_text: str) -> list[str]:
    errors: list[str] = []
    err = errors.append
    text = path.read_text(encoding="utf-8")
    num = path.name[:4]

    if not FILENAME_RE.match(path.name):
        err("filename must be NNNN-lowercase-kebab-title.md")

    # Front matter
    fm = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not fm:
        err("missing YAML front matter (status, date, decision-makers)")
        meta = {}
    else:
        meta = dict(
            (k.strip(), v.strip())
            for k, v in (ln.split(":", 1) for ln in fm.group(1).splitlines() if ":" in ln)
        )
        if not STATUS_RE.match(meta.get("status", "")):
            err(f"front matter status invalid: {meta.get('status')!r}")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", meta.get("date", "")):
            err("front matter date must be YYYY-MM-DD")
        if not meta.get("decision-makers"):
            err("front matter decision-makers is empty")

    body = text[fm.end():] if fm else text
    title = re.search(r"^# (.+)$", body, re.M)
    if not title:
        err("missing H1 title")

    h2 = sections(body, 2)
    present = [h for h in h2 if h in REQUIRED_H2]
    missing = [h for h in REQUIRED_H2 if h not in h2]
    if missing:
        err(f"missing sections: {missing}")
    elif present != REQUIRED_H2:
        err(f"sections out of order: {present}")

    drivers_sec = h2.get("Decision Drivers", "")
    options_sec = h2.get("Considered Options", "")
    outcome_sec = h2.get("Decision Outcome", "")
    proscons_sec = h2.get("Pros and Cons of the Options", "")

    # Drivers: D1..Dn, sequential, each with a bold name and description
    drivers = DRIVER_RE.findall(drivers_sec)
    if not drivers:
        err("no drivers found (format: * **D1 Name**: why it matters)")
    elif drivers != [f"D{i}" for i in range(1, len(drivers) + 1)]:
        err(f"drivers must be numbered D1..Dn in order, got {drivers}")
    driver_bullets = re.findall(r"^\* ", drivers_sec, re.M)
    if len(driver_bullets) != len(drivers):
        err("every Decision Drivers bullet must use: * **Dn Name**: description")

    # Options vs pros/cons sections
    options = re.findall(r"^\* (.+)$", options_sec, re.M)
    pc_headings = re.findall(r"^### (.+)$", proscons_sec, re.M)
    if len(options) != len(pc_headings):
        err(f"{len(options)} considered options but {len(pc_headings)} pros/cons sections")

    # Outcome
    if "Chosen option" not in outcome_sec and not re.search(r"\*\*[^*]+:\*\* ", outcome_sec):
        err('Decision Outcome must state the choice ("Chosen option: ...")')
    h3_outcome = re.findall(r"^### (.+)$", outcome_sec, re.M)
    for h in REQUIRED_H3_IN_OUTCOME:
        if h not in h3_outcome:
            err(f"Decision Outcome is missing '### {h}'")

    # Rating tables (drivers as rows, options as columns)
    tables = [t for t in parse_tables(outcome_sec) if t and t[0] and t[0][0] == "Driver"]
    if not tables:
        err("no rating table in Decision Outcome (header must start with '| Driver |')")
    rated: set[str] = set()
    for t_idx, table in enumerate(tables, 1):
        header, rows = table[0], table[2:]
        chosen = [c for c in header[1:] if re.fullmatch(r"\*\*.+ \(chosen\)\*\*", c)]
        if meta.get("status") in ("proposed", "accepted") and len(chosen) != 1:
            err(f"table {t_idx}: exactly one option column must be '**Name (chosen)**' (found {len(chosen)})")
        if chosen and header[1] != chosen[0]:
            err(f"table {t_idx}: the chosen option must be the first option column")
        if len(header) < 3:
            err(f"table {t_idx}: needs at least two option columns")
        for row in rows:
            m = re.match(r"(D\d+) ", row[0] + " ")
            if not m:
                err(f"table {t_idx}: row label {row[0]!r} must start with a driver id (e.g. 'D1 Name')")
                continue
            if m.group(1) not in drivers:
                err(f"table {t_idx}: row {m.group(1)} is not a declared driver")
            rated.add(m.group(1))
            if len(row) != len(header):
                err(f"table {t_idx}: row {m.group(1)} has {len(row)} cells, header has {len(header)}")
            bad = [c for c in row[1:] if c not in STARS]
            if bad:
                err(f"table {t_idx}: row {m.group(1)} has invalid ratings {bad} (use ★★★ ★★☆ ★☆☆ ☆☆☆)")
    unrated = [d for d in drivers if d not in rated]
    if tables and unrated:
        err(f"drivers not rated in any table: {unrated}")

    # Pros/cons bullets reference drivers
    bullets = re.findall(r"^\* .*$", proscons_sec, re.M)
    for b in bullets:
        if not PRO_CON_RE.match(b):
            err(f"pros/cons bullet must start '* Good|Bad|Neutral, because **Dn ...': {b[:70]}")
    used = set(re.findall(r"\*\*(D\d+)", proscons_sec))
    unused = [d for d in drivers if d not in used]
    if unused:
        err(f"drivers never argued in pros/cons: {unused}")
    for heading, sec in sections(proscons_sec, 3).items():
        if not re.search(r"^\* ", sec, re.M):
            err(f"option '{heading}' has no pros/cons bullets")

    # Links
    plain = strip_code(text)
    for ref in BARE_REF_RE.findall(plain):
        if ref != num:
            err(f"bare reference ADR-{ref}: link it as [ADR-{ref}]({files.get(ref, Path('?')).name})")
    for target in re.findall(r"\]\(([^)#\s]+)\)", plain):
        if re.match(r"^[a-z]+:", target):
            continue
        if not (path.parent / target).resolve().exists():
            err(f"broken link: {target}")

    # Index entry
    row = re.search(rf"^\| \[{num}\]\({re.escape(path.name)}\) \| (.+?) \| (.+?) \|$", index_text, re.M)
    if not row:
        err(f"no row for {path.name} in docs/decisions/README.md")
    else:
        if title and row.group(1) != title.group(1).strip():
            err(f"index title differs from H1: {row.group(1)!r}")
        status = meta.get("status", "")
        if status and not status.startswith(row.group(2).split(" ")[0]):
            err(f"index status {row.group(2)!r} differs from front matter {status!r}")
    return errors


def fix_links(path: Path, files: dict[str, Path]) -> int:
    text = path.read_text(encoding="utf-8")
    num, count = path.name[:4], 0

    def repl(m: re.Match[str]) -> str:
        nonlocal count
        ref = m.group(1)
        if ref == num or ref not in files:
            return m.group(0)
        count += 1
        return f"[ADR-{ref}]({files[ref].name})"

    # Only rewrite outside code spans/blocks.
    out, pos = [], 0
    for m in re.finditer(r"```.*?```|`[^`\n]*`", text, re.S):
        out.append(BARE_REF_RE.sub(repl, text[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(BARE_REF_RE.sub(repl, text[pos:]))
    if count:
        path.write_text("".join(out), encoding="utf-8")
    return count


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", type=Path)
    ap.add_argument("--fix-links", action="store_true")
    ap.add_argument("--next-number", action="store_true")
    ap.add_argument("--dir", type=Path, default=None, help="decisions directory (default: docs/decisions)")
    args = ap.parse_args()

    decisions = args.dir or repo_root() / "docs" / "decisions"
    files = adr_files(decisions)
    if args.next_number:
        print(f"{max((int(n) for n in files), default=-1) + 1:04d}")
        return 0

    targets = [p.resolve() for p in args.files] if args.files else list(files.values())
    if args.fix_links:
        for p in targets:
            if n := fix_links(p, files):
                print(f"{p.name}: linked {n} reference(s)")

    index_path = decisions / "README.md"
    index_text = index_path.read_text(encoding="utf-8") if index_path.exists() else ""
    failed = False

    # Repo-level checks
    nums = sorted(int(n) for n in files)
    if nums != list(range(len(nums))):
        print(f"repo: ADR numbers must be contiguous from 0000, got {nums}")
        failed = True
    stray = [p.name for p in decisions.glob("*.md") if p.name not in ("README.md", "adr-template.md")
             and not FILENAME_RE.match(p.name)]
    if stray:
        print(f"repo: unexpected files in {decisions}: {stray}")
        failed = True

    for p in targets:
        errors = check_file(p, files, index_text)
        print(f"{'OK  ' if not errors else 'FAIL'} {p.name}")
        for e in errors:
            print(f"     - {e}")
        failed |= bool(errors)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
