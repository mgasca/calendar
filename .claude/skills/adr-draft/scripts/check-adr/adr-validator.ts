import { basename, dirname, join, resolve } from "@std/path";

export const filePattern = /^([0-9]{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const requiredH2 = [
  "Context and Problem Statement",
  "Decision Drivers",
  "Considered Options",
  "Decision Outcome",
  "Pros and Cons of the Options",
];
const bareReference = /(?<!\[)ADR-([0-9]{4})(?!\]\()/g;
const supersededPattern = /^superseded by \[ADR-([0-9]{4})\]\(([^)]+)\)$/;
const datePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const fencePattern = /```.*?```/gs;
const inlinePattern = /`[^`\n]*`/g;
const amendmentPattern = /^### (Amendment\b.*)$/gm;
const amendmentDate = (heading: string) => /^Amendment, ([0-9]{4}-[0-9]{2}-[0-9]{2})\b/.exec(heading)?.[1] ?? null;
export function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
export function sections(markdown: string, level: number): [string, string][] {
  const headings = [...markdown.matchAll(new RegExp(`^${"#".repeat(level)} (.+)$`, "gm"))];
  return headings.map((
    m,
    i,
  ) => [m[1]!.trim(), markdown.slice(m.index! + m[0].length, headings[i + 1]?.index ?? markdown.length)]);
}
export function frontMatter(text: string, errors: string[] = []): { meta: Record<string, string>; body: string } {
  const match = /^---\n(.*?)\n---\n/s.exec(text);
  if (!match) {
    errors.push("missing YAML front matter (status, date, decision-makers)");
    return { meta: {}, body: text };
  }
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  if (
    !/^(proposed|accepted|rejected|deprecated|superseded by \[ADR-[0-9]{4}\]\([0-9]{4}-[a-z0-9-]+\.md\))$/.test(
      meta.status ?? "",
    )
  ) errors.push(`front matter status invalid: '${meta.status ?? ""}'`);
  if (!datePattern.test(meta.date ?? "")) errors.push("front matter date must be YYYY-MM-DD");
  if (!meta["decision-makers"]) errors.push("front matter decision-makers is empty");
  return { meta, body: text.slice(match[0].length) };
}
export function adrFiles(directory: string): Map<string, string> {
  const files = [...Deno.readDirSync(directory)].filter((f) => f.isFile && filePattern.test(f.name)).map((f) => f.name)
    .sort();
  return new Map(files.map((name) => [name.slice(0, 4), name]));
}
export function nextNumber(directory: string): string {
  const numbers = [...adrFiles(directory).keys()].map(Number);
  return String(numbers.length ? Math.max(...numbers) + 1 : 0).padStart(4, "0");
}
export function checkRepository(directory: string): string[] {
  const errors: string[] = [];
  const numbers = [...adrFiles(directory).keys()].map(Number).sort((a, b) => a - b);
  if (numbers.some((n, i) => n !== i)) {
    errors.push(`ADR numbers must be contiguous from 0000, got [${numbers.join(", ")}]`);
  }
  const names = [...Deno.readDirSync(directory)].filter((f) => f.isFile && f.name.endsWith(".md")).map((f) => f.name)
    .sort();
  const grouped = new Map<string, string[]>();
  for (const name of names.filter((n) => filePattern.test(n))) {
    const number = name.slice(0, 4);
    grouped.set(number, [...(grouped.get(number) ?? []), name]);
  }
  for (const [number, duplicates] of grouped) {
    if (duplicates.length > 1) {
      errors.push(
        `M6 ADR-${number}: number used by more than one file [${
          duplicates.join(", ")
        }]; a new record takes --next-number`,
      );
    }
  }
  const stray = names.filter((n) => n !== "README.md" && n !== "adr-template.md" && !filePattern.test(n));
  if (stray.length) errors.push(`unexpected files in ${directory}: [${stray.join(", ")}]`);
  return errors;
}
export interface AdrFileResult {
  fileName: string;
  errors: string[];
  ok: boolean;
}
export function checkFile(path: string, files: Map<string, string>): AdrFileResult {
  const name = basename(path), text = Deno.readTextFileSync(path), errors: string[] = [], number = name.slice(0, 4);
  if (!filePattern.test(name)) errors.push("filename must be NNNN-lowercase-kebab-title.md");
  const { meta, body } = frontMatter(text, errors);
  if (!/^# (.+)$/m.test(body)) errors.push("missing H1 title");
  const ordered = sections(body, 2), h2 = Object.fromEntries(ordered), headings = ordered.map(([h]) => h);
  const missing = requiredH2.filter((h) => !headings.includes(h));
  if (missing.length) errors.push(`missing sections: [${missing.join(", ")}]`);
  else {
    const present = [...new Set(headings.filter((h) => requiredH2.includes(h)))];
    if (present.join("\0") !== requiredH2.join("\0")) errors.push(`sections out of order: [${present.join(", ")}]`);
  }
  const driverSection = h2["Decision Drivers"] ?? "";
  const drivers = [...driverSection.matchAll(/^\* \*\*(D[0-9]+) [^*]+\*\*: \S/gm)].map((m) => m[1]!);
  if (!drivers.length) errors.push("no drivers found (format: * **D1 Name**: why it matters)");
  else if (drivers.some((d, i) => d !== `D${i + 1}`)) {
    errors.push(`drivers must be numbered D1..Dn in order, got [${drivers.join(", ")}]`);
  }
  if ([...driverSection.matchAll(/^\* /gm)].length !== drivers.length) {
    errors.push("every Decision Drivers bullet must use: * **Dn Name**: description");
  }
  const outcome = h2["Decision Outcome"] ?? "", pros = h2["Pros and Cons of the Options"] ?? "";
  const optionsCount = [...(h2["Considered Options"] ?? "").matchAll(/^\* /gm)].length;
  const prosSections = sections(pros, 3);
  if (optionsCount !== prosSections.length) {
    errors.push(`${optionsCount} considered options but ${prosSections.length} pros/cons sections`);
  }
  if (!outcome.includes("Chosen option") && !/\*\*[^*]+:\*\* /.test(outcome)) {
    errors.push('Decision Outcome must state the choice ("Chosen option: ...")');
  }
  const outcomeHeadings = sections(outcome, 3).map(([h]) => h);
  for (const heading of ["Consequences", "Confirmation"]) {
    if (!outcomeHeadings.includes(heading)) errors.push(`Decision Outcome is missing '### ${heading}'`);
  }
  const tables: string[][][] = [];
  let current: string[][] = [];
  for (const line of [...outcome.split("\n"), ""]) {
    if (line.startsWith("|")) current.push(line.trim().replace(/^\|+|\|+$/g, "").split("|").map((c) => c.trim()));
    else if (current.length) {
      if (current[0]![0] === "Driver") tables.push(current);
      current = [];
    }
  }
  if (!tables.length) errors.push("no rating table in Decision Outcome (header must start with '| Driver |')");
  else {
    const rated = new Set<string>();
    tables.forEach((table, i) => {
      const t = i + 1, header = table[0]!, chosen = header.slice(1).filter((c) => /^\*\*.+ \(chosen\)\*\*$/.test(c));
      if (["proposed", "accepted"].includes(meta.status ?? "") && chosen.length !== 1) {
        errors.push(`table ${t}: exactly one option column must be '**Name (chosen)**' (found ${chosen.length})`);
      }
      if (chosen.length && header[1] !== chosen[0]) {
        errors.push(`table ${t}: the chosen option must be the first option column`);
      }
      if (header.length < 3) errors.push(`table ${t}: needs at least two option columns`);
      for (const row of table.slice(2)) {
        const match = /^(D[0-9]+) /.exec(row[0] + " ");
        if (!match) {
          errors.push(`table ${t}: row label '${row[0]}' must start with a driver id (e.g. 'D1 Name')`);
          continue;
        }
        const driver = match[1]!;
        if (!drivers.includes(driver)) errors.push(`table ${t}: row ${driver} is not a declared driver`);
        rated.add(driver);
        if (row.length !== header.length) {
          errors.push(`table ${t}: row ${driver} has ${row.length} cells, header has ${header.length}`);
        }
        const bad = row.slice(1).filter((c) => !["★★★", "★★☆", "★☆☆", "☆☆☆"].includes(c));
        if (bad.length) {
          errors.push(`table ${t}: row ${driver} has invalid ratings [${bad.join(", ")}] (use ★★★ ★★☆ ★☆☆ ☆☆☆)`);
        }
      }
    });
    const unrated = drivers.filter((d) => !rated.has(d));
    if (unrated.length) errors.push(`drivers not rated in any table: [${unrated.join(", ")}]`);
  }
  for (const m of pros.matchAll(/^\* .*$/gm)) {
    if (!/^\* (Good|Bad|Neutral), because \*\*D[0-9]+/.test(m[0])) {
      errors.push(`pros/cons bullet must start '* Good|Bad|Neutral, because **Dn ...': ${m[0].slice(0, 70)}`);
    }
  }
  const used = new Set([...pros.matchAll(/\*\*(D[0-9]+)/g)].map((m) => m[1]!));
  const unused = drivers.filter((d) => !used.has(d));
  if (unused.length) errors.push(`drivers never argued in pros/cons: [${unused.join(", ")}]`);
  for (const [heading, content] of prosSections) {
    if (!/^\* /m.test(content)) errors.push(`option '${heading}' has no pros/cons bullets`);
  }
  const plain = text.replace(fencePattern, (m) => "\n".repeat([...m].filter((c) => c === "\n").length)).replace(
    inlinePattern,
    "``",
  );
  for (const m of plain.matchAll(bareReference)) {
    if (m[1]! !== number) {
      errors.push(`bare reference ADR-${m[1]!}: link it as [ADR-${m[1]!}](${files.get(m[1]!) ?? "?"})`);
    }
  }
  for (const m of plain.matchAll(/\]\(([^)#\s]+)\)/g)) {
    if (!/^[a-z]+:/.test(m[1]!) && !exists(resolve(dirname(path), m[1]!))) errors.push(`broken link: ${m[1]!}`);
  }
  const superseded = supersededPattern.exec(meta.status ?? "");
  if (superseded) {
    const target = superseded[1]!, targetFile = files.get(target);
    if (target === number) errors.push("M3: a record cannot supersede itself");
    else if (!targetFile) errors.push(`M3: superseded by ADR-${target}, which does not exist`);
    else {
      if (superseded[2]! !== targetFile) {
        errors.push(`M3: the superseded-by link names ${superseded[2]!}, but ADR-${target} is ${targetFile}`);
      }
      if (!Deno.readTextFileSync(join(dirname(path), targetFile)).includes(`ADR-${number}`)) {
        errors.push(`M3: ADR-${target} supersedes this record but never names ADR-${number}`);
      }
    }
  }
  const dates: string[] = [];
  for (const m of body.matchAll(amendmentPattern)) {
    const heading = m[1]!.trim(), date = amendmentDate(heading);
    if (!date) errors.push(`M7: amendment heading '### ${heading}' has no date (### Amendment, YYYY-MM-DD: summary)`);
    else dates.push(date);
  }
  const bulletDates = [
    ...(h2["More Information"] ?? "").matchAll(/^\* \*\*Amendment, ([0-9]{4}-[0-9]{2}-[0-9]{2})\b[^*]*:\*\*/gm),
  ].map((m) => m[1]!);
  for (const date of [...new Set(dates)].sort()) {
    const count = dates.filter((d) => d === date).length, bullets = bulletDates.filter((d) => d === date).length;
    if (bullets < count) {
      errors.push(
        `M7: ${count} amendment heading(s) dated ${date} but ${bullets} More Information bullet(s) '* **Amendment, ${date}:**'`,
      );
    }
  }
  return { fileName: name, errors, ok: errors.length === 0 };
}
export function fixLinks(path: string, files: Map<string, string>): number {
  const text = Deno.readTextFileSync(path), self = basename(path).slice(0, 4);
  let count = 0;
  const output = text.split(/(```.*?```|`[^`\n]*`)/gs).map((part, i) =>
    i % 2 ? part : part.replace(bareReference, (match, number: string) => {
      if (number === self || !files.has(number)) return match;
      count++;
      return `[ADR-${number}](${files.get(number)})`;
    })
  ).join("");
  if (count) Deno.writeTextFileSync(path, output);
  return count;
}
export interface AdrRecord {
  number: string;
  file: string;
  title: string;
  date: string;
  status: string;
  supersededBy: string | null;
  amendments: { heading: string; date: string | null }[];
  citedTokens: { paths: string[]; commands: string[]; versions: string[] };
}
export function readRecord(path: string): AdrRecord {
  const name = basename(path),
    { meta, body } = frontMatter(Deno.readTextFileSync(path)),
    superseded = supersededPattern.exec(meta.status ?? "");
  const title = (/^# (.+)$/m.exec(body)?.[1] ?? "").trim().replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(
    /\*\*|__|`/g,
    "",
  );
  const outcome = Object.fromEntries(sections(body, 2))["Decision Outcome"] ?? "";
  const citedTokens: AdrRecord["citedTokens"] = { paths: [], commands: [], versions: [] };
  const commandWords = [
    "just",
    "dotnet",
    "deno",
    "pnpm",
    "corepack",
    "npm",
    "npx",
    "node",
    "git",
    "gh",
    "jq",
    "docker",
    "az",
    "bash",
    "curl",
    "psql",
    "shellcheck",
  ];
  for (
    const span of new Set(
      [...outcome.replace(fencePattern, "").matchAll(inlinePattern)].map((m) => m[0].slice(1, -1).trim()).filter(
        Boolean,
      ),
    )
  ) {
    if (commandWords.includes(span.split(" ")[0]!)) citedTokens.commands.push(span);
    else if (/^(?:v?[0-9]+\.[0-9]+\S*|\S+[@:]v?[0-9]+\.[0-9]+\S*)$/.test(span)) citedTokens.versions.push(span);
    else if (/^(?![a-z]+:\/\/)(?=\S*\/|\S*\.[a-z][a-z0-9-]{0,11}$)\S+$/.test(span)) citedTokens.paths.push(span);
  }
  return {
    number: name.slice(0, 4),
    file: name,
    title,
    date: meta.date ?? "",
    status: superseded ? "superseded" : meta.status ?? "",
    supersededBy: superseded ? `ADR-${superseded[1]!}` : null,
    amendments: [...body.matchAll(amendmentPattern)].map((m) => ({
      heading: m[1]!.trim(),
      date: amendmentDate(m[1]!),
    })),
    citedTokens,
  };
}
export function readRecords(directory: string): AdrRecord[] {
  return [...adrFiles(directory).values()].map((f) => readRecord(join(directory, f)));
}
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : {};
}
function text(value: unknown, name: string): string | null {
  const result = object(value)[name];
  return typeof result === "string" ? result : null;
}
function modelEntries(model: unknown): unknown[] | null {
  const adrs = object(object(model).metadata).adrs;
  return Array.isArray(adrs) ? adrs : null;
}
export function checkModel(path: string, records: AdrRecord[]): string[] {
  const root: unknown = JSON.parse(Deno.readTextFileSync(path)), adrs = modelEntries(root), errors: string[] = [];
  if (!adrs) return [`M2 model: ${basename(path)} has no metadata.adrs array`];
  const byNumber = new Map(records.map((r) => [r.number, r])), entries = new Map<string, unknown>();
  for (const entry of adrs) {
    const id = text(entry, "id") ?? "", m = /^ADR-([0-9]{4})$/.exec(id);
    if (!m) errors.push(`M2 model: metadata.adrs entry id must be ADR-NNNN, got '${id}'`);
    else if (entries.has(m[1]!)) errors.push(`M2 ${id}: more than one metadata.adrs entry`);
    else entries.set(m[1]!, entry);
  }
  for (const r of records) {
    if (!entries.has(r.number)) errors.push(`M2 ADR-${r.number}: missing from metadata.adrs in ${basename(path)}`);
  }
  for (const [number, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    const r = byNumber.get(number), id = `ADR-${number}`;
    if (!r) {
      errors.push(`M2 ${id}: metadata.adrs entry has no record in docs/decisions`);
      continue;
    }
    if (text(entry, "title") !== r.title) {
      errors.push(`M2 ${id}: model title '${text(entry, "title") ?? ""}', file title '${r.title}'`);
    }
    if (text(entry, "status") !== r.status) {
      errors.push(`M2 ${id}: model status '${text(entry, "status") ?? ""}', file says '${r.status}'`);
    }
    if (text(entry, "superseded-by") !== r.supersededBy) {
      errors.push(
        `M2 ${id}: model superseded-by '${text(entry, "superseded-by") ?? ""}', file says '${r.supersededBy ?? ""}'`,
      );
    }
    if (basename(text(entry, "file") ?? "") !== r.file) {
      errors.push(`M2 ${id}: model file '${text(entry, "file") ?? ""}', record is ${r.file}`);
    }
  }
  const citations = new Map<string, string[]>();
  function collect(value: unknown, location: string): void {
    if (Array.isArray(value)) value.forEach((v, i) => collect(v, `${location}[${i}]`));
    else if (typeof value === "object" && value !== null) {
      for (const [key, v] of Object.entries(value)) collect(v, `${location}.${key}`);
    } else if (typeof value === "string") {
      for (const m of value.matchAll(/ADR-([0-9]{4})|\/adr\/([0-9]{4})\//g)) {
        const number = m[1]! ?? m[2]!;
        citations.set(number, [...(citations.get(number) ?? []), location]);
      }
    }
  }
  for (const [key, value] of Object.entries(object(root))) if (key !== "metadata") collect(value, key);
  for (const [number, places] of [...citations].sort(([a], [b]) => a.localeCompare(b))) {
    const where = places.length === 1 ? places[0] : `${places[0]} and ${places.length - 1} other place(s)`,
      record = byNumber.get(number);
    if (!record) errors.push(`M2 ADR-${number}: cited by the model at ${where}, but there is no such record`);
    else if (record.supersededBy && text(entries.get(number), "note") === null) {
      errors.push(
        `M2 ADR-${number}: cited by the model at ${where}, but superseded by ${record.supersededBy}; cite the newer record, or give its metadata.adrs entry a "note" saying what still stands`,
      );
    }
  }
  return errors;
}
export function checkStories(directory: string, records: AdrRecord[]): string[] {
  const errors: string[] = [], byNumber = new Map(records.map((r) => [r.number, r]));
  for (
    const name of [...Deno.readDirSync(directory)].filter((f) => f.isFile && filePattern.test(f.name)).map((f) =>
      f.name
    ).sort()
  ) {
    const { meta } = frontMatter(Deno.readTextFileSync(join(directory, name)));
    if (meta.status !== "planned") continue;
    for (const m of (meta.adrs ?? "").matchAll(/[0-9]{4}/g)) {
      const r = byNumber.get(m[0]);
      if (r?.supersededBy) {
        errors.push(`J6 story ${name.slice(0, 4)}: planned card cites ADR-${m[0]}, superseded by ${r.supersededBy}`);
      }
    }
  }
  return errors;
}
export function parseFirstAdded(log: string): Record<string, string> {
  const added: Record<string, string> = {};
  let date = "";
  for (const line of log.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (datePattern.test(line)) date = line;
    else if (date) added[basename(line)] = date;
  }
  return added;
}
export function inventory(
  records: AdrRecord[],
  modelPath: string | null,
  firstOnMain: Record<string, string> | null,
): string {
  const entries = new Map<string, unknown>();
  for (const entry of modelPath ? modelEntries(JSON.parse(Deno.readTextFileSync(modelPath))) ?? [] : []) {
    const m = /^ADR-([0-9]{4})$/.exec(text(entry, "id") ?? "");
    if (m && !entries.has(m[1]!)) entries.set(m[1]!, entry);
  }
  return JSON.stringify(
    records.map(({ citedTokens, ...record }) => ({
      ...record,
      ...(firstOnMain === null ? {} : { firstOnMain: firstOnMain[record.file] ?? null }),
      model: entries.get(record.number) ?? null,
      citedTokens,
    })),
    null,
    2,
  );
}
