import { parseAll } from "@std/yaml";

export type YamlNode = YamlScalar | YamlSequence | YamlMapping;
export class YamlScalar {
  constructor(public value: string) {}
}
export class YamlSequence {
  constructor(public items: YamlNode[]) {}
}
export class YamlMapping {
  constructor(public entries: [string, YamlNode][]) {}
  get(key: string): YamlNode | undefined {
    return this.entries.find(([name]) => name === key)?.[1];
  }
  text(key: string): string | null {
    const node = this.get(key);
    return node instanceof YamlScalar ? node.value : null;
  }
  map(key: string): YamlMapping | undefined {
    const node = this.get(key);
    return node instanceof YamlMapping ? node : undefined;
  }
  list(key: string): YamlNode[] {
    const node = this.get(key);
    return node instanceof YamlSequence ? node.items : node instanceof YamlScalar ? [node] : [];
  }
}
function convert(node: unknown): YamlNode {
  if (Array.isArray(node)) return new YamlSequence(node.map(convert));
  if (typeof node === "object" && node !== null) {
    return new YamlMapping(Object.entries(node).map(([key, value]) => [key, convert(value)]));
  }
  return new YamlScalar(node === null || node === undefined ? "" : String(node));
}
export function parseYaml(yaml: string): YamlNode {
  // A representation model must keep scalars as text: in particular `on`, `true`, and numeric env values.
  const documents = parseAll(yaml, { schema: "failsafe" });
  if (documents.length !== 1) throw new Error(`expected one YAML document, found ${documents.length}.`);
  return convert(documents[0]);
}
export class WorkflowJob {
  constructor(public id: string, public name: string, public body: YamlMapping) {}
  get steps(): YamlMapping[] {
    return this.body.list("steps").filter((node): node is YamlMapping => node instanceof YamlMapping);
  }
}
export class Workflow {
  constructor(public root: YamlMapping, public jobs: WorkflowJob[]) {}
  static parse(yaml: string): Workflow {
    const root = parseYaml(yaml), jobs = root instanceof YamlMapping ? root.map("jobs") : undefined;
    if (!(root instanceof YamlMapping) || !jobs) throw new Error("the workflow has no `jobs` mapping.");
    return new Workflow(
      root,
      jobs.entries.filter((entry): entry is [string, YamlMapping] => entry[1] instanceof YamlMapping).map((
        [id, body],
      ) => new WorkflowJob(id, body.text("name") ?? id, body)),
    );
  }
  jobNamed(name: string): WorkflowJob | undefined {
    return this.jobs.find((job) => job.name === name);
  }
  static run(step: YamlMapping): string {
    return step.text("run") ?? "";
  }
  envValues(variable: string): [string, string][] {
    const values: [string, string][] = [], top = this.root.map("env")?.text(variable);
    if (top !== undefined && top !== null) values.push(["the workflow env", top]);
    for (const job of this.jobs) {
      const atJob = job.body.map("env")?.text(variable);
      if (atJob !== undefined && atJob !== null) values.push([`the \`${job.name}\` job's env`, atJob]);
      for (const step of job.steps) {
        const atStep = step.map("env")?.text(variable);
        if (atStep !== undefined && atStep !== null) values.push([`a step of \`${job.name}\``, atStep]);
      }
    }
    return values;
  }
}
