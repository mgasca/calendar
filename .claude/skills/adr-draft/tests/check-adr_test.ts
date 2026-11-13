import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  adrFiles,
  checkFile,
  checkModel,
  checkRepository,
  checkStories,
  fixLinks,
  inventory,
  nextNumber,
  parseFirstAdded,
  readRecords,
} from "../scripts/check-adr/adr-validator.ts";

const first = "0000-first-decision.md", second = "0001-second-decision.md";
const validModel = {
  nodes: [{ "unique-id": "api", metadata: { adrs: ["ADR-0000"] }, description: "See https://site/adr/0001/." }],
  flows: [],
  metadata: {
    "adr-url-pattern": "https://site/adr/NNNN/ (ADR-0099 is an example, not a citation)",
    adrs: [{ id: "ADR-0000", title: "First decision", status: "accepted", file: `docs/decisions/${first}` }, {
      id: "ADR-0001",
      title: "Second decision",
      status: "proposed",
      file: `docs/decisions/${second}`,
    }],
  },
};
function fixture(run: (tree: Tree) => void): void {
  const tree = new Tree();
  try {
    run(tree);
  } finally {
    Deno.removeSync(tree.root, { recursive: true });
  }
}
class Tree {
  root = Deno.makeTempDirSync({ prefix: "adr-tests-" });
  decisions = join(this.root, "docs/decisions");
  stories = join(this.root, "docs/stories");
  model = join(this.root, "docs/architecture/model.json");
  constructor() {
    for (const path of [this.decisions, this.stories, join(this.root, "docs/architecture")]) {
      Deno.mkdirSync(path, { recursive: true });
    }
    const fixtures = fromFileUrl(new URL("./fixtures/valid/", import.meta.url));
    for (const file of Deno.readDirSync(fixtures)) {
      Deno.copyFileSync(join(fixtures, file.name), join(this.decisions, file.name));
    }
    this.writeModel(structuredClone(validModel));
  }
  mutate(name: string, find: string, replacement: string): void {
    const path = join(this.decisions, name), text = Deno.readTextFileSync(path);
    assertStringIncludes(text, find);
    Deno.writeTextFileSync(path, text.replaceAll(find, replacement));
  }
  check(name = first): string[] {
    return checkFile(join(this.decisions, name), adrFiles(this.decisions)).errors;
  }
  records() {
    return readRecords(this.decisions);
  }
  modelErrors(): string[] {
    return checkModel(this.model, this.records());
  }
  writeModel(model: unknown): void {
    Deno.writeTextFileSync(this.model, JSON.stringify(model, null, 2));
  }
  supersede(note: string | null = null): void {
    this.mutate(second, "status: proposed", `status: superseded by [ADR-0000](${first})`);
    const model = structuredClone(validModel);
    Object.assign(model.metadata.adrs[1]!, {
      status: "superseded",
      "superseded-by": "ADR-0000",
      ...(note === null ? {} : { note }),
    });
    this.writeModel(model);
  }
  amendment(heading: string, bullet: string | null): void {
    this.mutate(first, "### Consequences", `${heading}\n\nWhat changed.\n\n### Consequences`);
    if (bullet !== null) {
      Deno.writeTextFileSync(
        join(this.decisions, first),
        Deno.readTextFileSync(join(this.decisions, first)) + `\n## More Information\n\n${bullet}\n`,
      );
    }
  }
  story(status: string, adrs = '["0000", "0001"]'): void {
    Deno.writeTextFileSync(
      join(this.stories, "0007-a-story.md"),
      `---\nstatus: ${status}\ndate: 2026-01-01\nadrs: ${adrs}\n---\n\n# 0007 A story\n`,
    );
  }
}
const contains = (errors: string[], expected: string) =>
  assert(errors.some((error) => error.includes(expected)), JSON.stringify(errors));
Deno.test("ValidFixtures_HaveNoErrors", () =>
  fixture((t) => {
    assertEquals(checkRepository(t.decisions), []);
    assertEquals(t.modelErrors(), []);
    assertEquals(checkStories(t.stories, t.records()), []);
    for (const name of adrFiles(t.decisions).values()) assertEquals(t.check(name), []);
  }));
Deno.test("ValidTree_PassesEverySweepRule", () =>
  fixture((t) => {
    assertEquals(checkRepository(t.decisions), []);
    assertEquals(t.modelErrors(), []);
    assertEquals(checkStories(t.stories, t.records()), []);
    assertEquals(t.check(first), []);
    assertEquals(t.check(second), []);
  }));
Deno.test("NextNumber_IsOneAfterHighest", () => fixture((t) => assertEquals(nextNumber(t.decisions), "0002")));
const brokenRules = [
  ["status: accepted", "status: maybe", "front matter status invalid"],
  ["date: 2026-01-01", "date: Jan 1", "front matter date must be YYYY-MM-DD"],
  ["decision-makers: tester", "decision-makers:", "decision-makers is empty"],
  ["# First decision\n", "First decision\n", "missing H1 title"],
  ["## Decision Drivers", "## Drivers", "missing sections"],
  ["* **D2 Cost**: cheaper is better.", "* **D3 Cost**: cheaper is better.", "numbered D1..Dn"],
  ["* **D2 Cost**: cheaper is better.", "* Cost: cheaper is better.", "every Decision Drivers bullet"],
  ["\n### Option B\n", "\n", "2 considered options but 1 pros/cons sections"],
  ['Chosen option: "Option A"', 'We pick "Option A"', "must state the choice"],
  ["### Confirmation", "### Verification", "missing '### Confirmation'"],
  ["**Option A (chosen)**", "Option A", "exactly one option column"],
  ["| **Option A (chosen)** | Option B |", "| Option A | **Option B (chosen)** |", "must be the first option column"],
  ["| D1 Speed | ★★★ | ★☆☆ |", "| D1 Speed | ★★★ | 1 |", "invalid ratings"],
  ["| D2 Cost | ★★☆ | ★★☆ |", "| D9 Cost | ★★☆ | ★★☆ |", "row D9 is not a declared driver"],
  ["| D2 Cost | ★★☆ | ★★☆ |", "| Cost | ★★☆ | ★★☆ |", "must start with a driver id"],
  ["* Good, because **D1 Speed**: fast.", "* Good: fast.", "pros/cons bullet must start"],
  ["[ADR-0001](0001-second-decision.md)", "ADR-0001", "bare reference ADR-0001"],
  ["(0001-second-decision.md)", "(0009-missing.md)", "broken link: 0009-missing.md"],
];
for (const [find, replacement, expected] of brokenRules) {
  Deno.test(`BrokenRule_IsReported: ${expected}`, () =>
    fixture((t) => {
      t.mutate(first, find!, replacement!);
      contains(t.check(), expected!);
    }));
}
Deno.test("DriverNeverRated_IsReported", () =>
  fixture((t) => {
    t.mutate(first, "| D2 Cost | ★★☆ | ★★☆ |\n", "");
    contains(t.check(), "drivers not rated in any table: [D2]");
  }));
Deno.test("DriverNeverArgued_IsReported", () =>
  fixture((t) => {
    t.mutate(first, "* Neutral, because **D2 Cost**: average.", "* Neutral, because **D1 Speed**: average.");
    contains(t.check(), "drivers never argued in pros/cons: [D2]");
  }));
Deno.test("SectionsOutOfOrder_AreReported", () =>
  fixture((t) => {
    const text = Deno.readTextFileSync(join(t.decisions, first)),
      drivers = text.slice(text.indexOf("## Decision Drivers"), text.indexOf("## Considered Options"));
    t.mutate(first, drivers, "");
    t.mutate(first, "## Pros and Cons of the Options", drivers + "## Pros and Cons of the Options");
    contains(t.check(), "sections out of order");
  }));
Deno.test("ReadmeWithoutAnIndexTable_IsNotAnAdrAndNotStray", () =>
  fixture((t) => {
    Deno.writeTextFileSync(join(t.decisions, "README.md"), "# Conventions\n\nNo table here.\n");
    assertEquals(checkRepository(t.decisions), []);
    assertEquals([...adrFiles(t.decisions).keys()], ["0000", "0001"]);
  }));
Deno.test("NumberingGapAndStrayFiles_AreReported", () =>
  fixture((t) => {
    Deno.renameSync(join(t.decisions, second), join(t.decisions, "0005-second-decision.md"));
    Deno.writeTextFileSync(join(t.decisions, "notes.md"), "stray");
    const errors = checkRepository(t.decisions);
    contains(errors, "contiguous from 0000");
    contains(errors, "notes.md");
  }));
Deno.test("FixLinks_LinksBareReferencesButNotCodeOrSelf", () =>
  fixture((t) => {
    t.mutate(first, `[ADR-0001](${second})`, "ADR-0001 and ADR-0000");
    assertEquals(fixLinks(join(t.decisions, first), adrFiles(t.decisions)), 1);
    const text = Deno.readTextFileSync(join(t.decisions, first));
    assertStringIncludes(text, `[ADR-0001](${second}) and ADR-0000`);
    assertStringIncludes(text, "`ADR-0099`");
    assertEquals(t.check(), []);
  }));
const modelMutations: [string, (model: typeof validModel) => void, string][] = [
  [
    "status",
    (m) => m.metadata.adrs[1]!.status = "accepted",
    "M2 ADR-0001: model status 'accepted', file says 'proposed'",
  ],
  [
    "title",
    (m) => m.metadata.adrs[1]!.title = "Other",
    "M2 ADR-0001: model title 'Other', file title 'Second decision'",
  ],
  ["file", (m) => m.metadata.adrs[1]!.file = "docs/decisions/0001-gone.md", "M2 ADR-0001: model file"],
  [
    "node citation",
    (m) => m.nodes[0]!.metadata.adrs = ["ADR-0007"],
    "M2 ADR-0007: cited by the model at nodes[0].metadata.adrs[0], but there is no",
  ],
  [
    "flow citation",
    (m) => Object.assign(m, { flows: [{ description: "/adr/0042/" }] }),
    "M2 ADR-0042: cited by the model at flows[0]",
  ],
];
for (const [name, mutate, expected] of modelMutations) {
  Deno.test(`ModelDrift_IsReported: ${name}`, () =>
    fixture((t) => {
      const model = structuredClone(validModel);
      mutate(model);
      t.writeModel(model);
      contains(t.modelErrors(), expected);
    }));
}
Deno.test("RecordMissingFromModel_IsReported", () =>
  fixture((t) => {
    const model = structuredClone(validModel);
    model.metadata.adrs.pop();
    t.writeModel(model);
    contains(t.modelErrors(), "M2 ADR-0001: missing from metadata.adrs in model.json");
  }));
Deno.test("ModelEntryWithoutRecord_IsReported", () =>
  fixture((t) => {
    Deno.removeSync(join(t.decisions, second));
    contains(t.modelErrors(), "M2 ADR-0001: metadata.adrs entry has no record in docs/decisions");
  }));
Deno.test("DuplicateModelEntry_IsReported", () =>
  fixture((t) => {
    const model = structuredClone(validModel);
    model.metadata.adrs.push(model.metadata.adrs[0]!);
    t.writeModel(model);
    contains(t.modelErrors(), "M2 ADR-0000: more than one metadata.adrs entry");
  }));
Deno.test("SupersededByDiffersFromFile_IsReported", () =>
  fixture((t) => {
    t.supersede();
    Deno.writeTextFileSync(
      t.model,
      Deno.readTextFileSync(t.model).replace('"superseded-by": "ADR-0000"', '"superseded-by": "ADR-0002"'),
    );
    contains(t.modelErrors(), "M2 ADR-0001: model superseded-by 'ADR-0002', file says 'ADR-0000'");
  }));
Deno.test("CitingASupersededRecord_IsReported", () =>
  fixture((t) => {
    t.supersede();
    const errors = t.modelErrors();
    assertEquals(errors.length, 1);
    assert(
      errors[0]!.startsWith("M2 ADR-0001: cited by the model at nodes[0].description, but superseded by ADR-0000"),
    );
  }));
Deno.test("CitingASupersededRecordWithANote_IsAllowed", () =>
  fixture((t) => {
    t.supersede("Only part of it is withdrawn.");
    assertEquals(t.modelErrors(), []);
  }));
Deno.test("ModelTitle_IsComparedAsPlainText", () =>
  fixture((t) => {
    t.mutate(second, "# Second decision", "# Second `decision` with [a link](https://example.org) and **bold**");
    const model = structuredClone(validModel);
    model.metadata.adrs[1]!.title = "Second decision with a link and bold";
    t.writeModel(model);
    assertEquals(t.modelErrors(), []);
  }));
Deno.test("SupersedingRecordThatNamesItsPredecessor_Passes", () =>
  fixture((t) => {
    t.supersede();
    assertEquals(t.check(second), []);
  }));
Deno.test("SupersedingRecordThatNeverNamesItsPredecessor_IsReported", () =>
  fixture((t) => {
    t.supersede();
    t.mutate(first, `See [ADR-0001](${second}).`, "See the other record.");
    contains(t.check(second), "M3: ADR-0000 supersedes this record but never names ADR-0001");
  }));
for (
  const [status, expected] of [
    [`status: superseded by [ADR-0005](${first})`, "M3: superseded by ADR-0005, which does not exist"],
    [`status: superseded by [ADR-0000](${second})`, `M3: the superseded-by link names ${second}`],
    [`status: superseded by [ADR-0001](${second})`, "M3: a record cannot supersede itself"],
  ]
) {
  Deno.test(`BrokenSupersession_IsReported: ${status}`, () =>
    fixture((t) => {
      t.mutate(second, "status: proposed", status!);
      contains(t.check(second), expected!);
    }));
}
Deno.test("NumberUsedByTwoFiles_IsReported", () =>
  fixture((t) => {
    Deno.copyFileSync(join(t.decisions, second), join(t.decisions, "0001-another-decision.md"));
    contains(
      checkRepository(t.decisions),
      `M6 ADR-0001: number used by more than one file [0001-another-decision.md, ${second}]; a new record takes --next-number`,
    );
  }));
Deno.test("AmendmentHeadingWithoutDate_IsReported", () =>
  fixture((t) => {
    t.amendment("### Amendment: undated", null);
    contains(t.check(), "M7: amendment heading '### Amendment: undated' has no date");
  }));
Deno.test("DatedAmendmentWithoutItsBullet_IsReported", () =>
  fixture((t) => {
    t.amendment("### Amendment, 2026-02-01: a change", "* **Amendment, 2026-01-31:** a different day.");
    contains(
      t.check(),
      "M7: 1 amendment heading(s) dated 2026-02-01 but 0 More Information bullet(s) '* **Amendment, 2026-02-01:**'",
    );
  }));
Deno.test("DatedAmendmentWithItsBullet_AndABulletAlone_Pass", () =>
  fixture((t) => {
    t.amendment(
      "### Amendment, 2026-02-01: a change",
      "* **Amendment, 2026-02-01 (scope):** the change.\n* **Amendment, 2026-01-15:** made in place, no heading.",
    );
    assertEquals(t.check(), []);
  }));
for (const status of ["planned", "implemented"]) {
  Deno.test(`StoryCitingASupersededRecord_IsReportedOnlyWhenPlanned: ${status}`, () =>
    fixture((t) => {
      t.supersede();
      t.story(status);
      assertEquals(
        checkStories(t.stories, t.records()),
        status === "planned" ? ["J6 story 0007: planned card cites ADR-0001, superseded by ADR-0000"] : [],
      );
    }));
}
Deno.test("PlannedStoryCitingCurrentRecords_Passes", () =>
  fixture((t) => {
    t.story("planned");
    assertEquals(checkStories(t.stories, t.records()), []);
  }));
Deno.test("Inventory_HasOneEntryPerRecordWithEveryField", () =>
  fixture((t) => {
    t.supersede("kept");
    t.amendment("### Amendment, 2026-02-01: a change", "* **Amendment, 2026-02-01:** the change.");
    t.mutate(
      first,
      "A test checks it.",
      "Run `just tools adr` and `dotnet run x.cs`, read `docs/decisions/README.md` and `.node-version`, pin `10.0.300` and `postgres:18.6-alpine`; `HttpOnly` is not a token.",
    );
    const entries = JSON.parse(inventory(t.records(), t.model, { [first]: "2026-01-02" }));
    assertEquals(entries.length, 2);
    const a = entries[0], b = entries[1];
    assertEquals({
      number: a.number,
      file: a.file,
      title: a.title,
      date: a.date,
      status: a.status,
      supersededBy: a.supersededBy,
      firstOnMain: a.firstOnMain,
    }, {
      number: "0000",
      file: first,
      title: "First decision",
      date: "2026-01-01",
      status: "accepted",
      supersededBy: null,
      firstOnMain: "2026-01-02",
    });
    assertEquals(a.model.id, "ADR-0000");
    assertEquals(a.amendments, [{ heading: "Amendment, 2026-02-01: a change", date: "2026-02-01" }]);
    assertEquals(a.citedTokens, {
      commands: ["just tools adr", "dotnet run x.cs"],
      paths: ["docs/decisions/README.md", ".node-version"],
      versions: ["10.0.300", "postgres:18.6-alpine"],
    });
    assertEquals([b.status, b.supersededBy, b.firstOnMain, b.model.note], ["superseded", "ADR-0000", null, "kept"]);
  }));
Deno.test("Inventory_WithoutGitOrModel_OmitsFirstOnMainAndHasNullModel", () =>
  fixture((t) => {
    const first = JSON.parse(inventory(t.records(), null, null))[0];
    assert(!Object.hasOwn(first, "firstOnMain"));
    assertEquals(first.model, null);
  }));
Deno.test("ParseFirstAdded_KeepsTheOldestDate", () => {
  assertEquals(
    parseFirstAdded(
      "2026-03-01\n\ndocs/decisions/0001-b.md\n2026-02-01\n\ndocs/decisions/0000-a.md\n2026-01-01\n\ndocs/decisions/0001-b.md\n",
    ),
    { "0000-a.md": "2026-02-01", "0001-b.md": "2026-01-01" },
  );
});
