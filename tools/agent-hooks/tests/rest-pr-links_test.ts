// Story 0070: `gh pr edit` fails on a gh older than 2.82.1 (Projects classic), so agents rewrite PR bodies through
// `gh api`; the link check gives that route the same `Closes`/`Refs` reminder and the bash guard still refuses
// private details on it.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { evaluateBash } from "../bash-guard.ts";
import { describePrLink, describeStackPrs } from "../pull-request-link-check.ts";
import { FakeProbe } from "./fake-probe.ts";

const reminder = "neither `Closes #N` nor `Refs #N`";
function probe() {
  const p = new FakeProbe();
  p.texts["42"] = { number: 42, baseRefName: "main", body: "Refs #964" };
  p.texts["43"] = { number: 43, baseRefName: "docs/story-0070", body: "Refs #964" };
  p.files["body.md"] = "Summary only";
  p.files["linked.md"] = "Refs #964\n\nSummary";
  p.files["closing.md"] = "Closes #964";
  return p;
}

Deno.test("A REST PATCH of a PR body gets the reminder gh pr edit gets", async () => {
  const p = probe();
  const viaApi = await describePrLink("gh api -X PATCH repos/mgasca/calendar/pulls/42 -F body=@body.md", "/r", p);
  const viaCli = await describePrLink("gh pr edit 42 -R mgasca/calendar --body-file body.md", "/r", probe());
  assertStringIncludes(viaApi ?? "", "PR #42 targets main");
  assertStringIncludes(viaApi ?? "", reminder);
  assertEquals(viaApi, viaCli);
  assertEquals(p.textQueries, [["42", "mgasca/calendar"]]);
});

Deno.test("Every way of passing a PATCH body is read", async () => {
  for (
    const command of [
      "gh api -X PATCH repos/o/r/pulls/42 -F body=@body.md",
      "gh api --method PATCH repos/o/r/pulls/42 --field body=@body.md",
      "gh api --method=patch /repos/o/r/pulls/42 --field=body=@body.md",
      "gh api -XPATCH repos/o/r/pulls/42 -Fbody=@body.md",
      "gh api -X PATCH repos/o/r/pulls/42 -f body='Summary only'",
      "gh api -X PATCH repos/o/r/pulls/42 --raw-field 'body=Summary only'",
      "gh api -X PATCH repos/o/r/pulls/42 -f title=t -F body=@body.md -H 'Accept: application/json'",
      "gh api repos/o/r/pulls/42 -X PATCH -F body=@- <<'EOF'\nSummary only\nEOF",
    ]
  ) {
    assertStringIncludes(await describePrLink(command, "/r", probe()) ?? "", reminder, command);
  }
});

Deno.test("A PATCH body with Closes or Refs gets no reminder", async () => {
  for (const file of ["linked.md", "closing.md"]) {
    assertEquals(await describePrLink(`gh api -X PATCH repos/o/r/pulls/42 -F body=@${file}`, "/r", probe()), null);
  }
});

Deno.test("A raw -f field is literal, so @file there is not read", async () => {
  // `-f body=@closing.md` sends the text "@closing.md", which links nothing.
  const note = await describePrLink("gh api -X PATCH repos/o/r/pulls/42 -f body=@closing.md", "/r", probe());
  assertStringIncludes(note ?? "", reminder);
});

Deno.test("A PATCH on a stack layer adds the native-stack sentence", async () => {
  const note = await describePrLink("gh api -X PATCH repos/o/r/pulls/43 -F body=@body.md", "/r", probe());
  assertStringIncludes(note ?? "", "PR #43 targets docs/story-0070");
  assertStringIncludes(note ?? "", "ADR-0065");
});

Deno.test("A PATCH that retargets reads the current body, as gh pr edit --base does", async () => {
  const p = probe();
  p.texts["44"] = { number: 44, baseRefName: "docs/story-0070", body: "Summary" };
  const note = await describePrLink("gh api -X PATCH repos/o/r/pulls/44 -f base=main", "/r", p);
  assertStringIncludes(note ?? "", "this PR is being retargeted to main");
  assertEquals(await describePrLink("gh api -X PATCH repos/o/r/pulls/42 -f base=main", "/r", probe()), null);
});

Deno.test("A REST POST that opens a PR gets the reminder gh pr create gets", async () => {
  const command = "gh api repos/o/r/pulls -f title=t -f head=feature -f base=main -F body=@body.md";
  const note = await describePrLink(command, "/r", probe());
  assertStringIncludes(note ?? "", "this PR targets main");
  assert(!note!.includes("ADR-0065"));
  const onStack = await describePrLink(command.replace("base=main", "base=docs/story-0070"), "/r", probe());
  assertStringIncludes(onStack ?? "", "this PR targets docs/story-0070");
  assertEquals(
    await describePrLink("gh api -X POST repos/o/r/pulls -f base=main -f body='Closes #1'", "/r", probe()),
    null,
  );
});

Deno.test("Placeholder owner and repo leave the repository to gh", async () => {
  const p = probe();
  await describePrLink("gh api -X PATCH 'repos/{owner}/{repo}/pulls/42' -F body=@body.md", "/r", p);
  assertEquals(p.textQueries, [["42", null]]);
});

Deno.test("gh api calls that write no PR body stay silent", async () => {
  for (
    const command of [
      "gh api repos/o/r/pulls/42",
      "gh api -X GET repos/o/r/pulls/42 -f body=x",
      "gh api repos/o/r/pulls/42 -F body=@body.md", // POST to a single PR is not a PR write
      "gh api -X PATCH repos/o/r/pulls/42 -f title=t",
      "gh api -X PATCH repos/o/r/pulls/42/comments/1 -F body=@body.md",
      "gh api -X PATCH repos/o/r/issues/42 -F body=@body.md",
      "gh api repos/o/r/issues/42/comments -F body=@body.md",
      "gh api -X PATCH repos/o/r/pulls/42 -F body=@missing.md",
      "gh api -X PATCH repos/o/r/pulls/42 --input request.json",
    ]
  ) {
    assertEquals(await describePrLink(command, "/r", probe()), null, command);
  }
});

Deno.test("The bash guard refuses private details in a REST PATCH body", async () => {
  const p = probe();
  p.files["private.md"] = "Closes #964\n\nBuilt in .claude/worktrees/task-1/";
  const verdict = await evaluateBash("gh api -X PATCH repos/o/r/pulls/42 -F body=@private.md", "/r", p);
  assertEquals(verdict?.decision, "deny");
  assertStringIncludes(verdict?.reason ?? "", ".claude/worktrees/task-1/");
});

Deno.test("The stack note names the REST fallback next to gh pr edit", async () => {
  const p = probe();
  p.texts["45"] = { number: 45, baseRefName: "main", body: "Summary" };
  const note = await describeStackPrs("gh stack link 45", "/r", p);
  assertStringIncludes(note ?? "", "`gh pr edit <n> --body-file <file>`");
  assertStringIncludes(note ?? "", "`gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F body=@<file>`");
});
