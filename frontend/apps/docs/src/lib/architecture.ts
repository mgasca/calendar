import type { Adr, Story } from './adr';
import { repository, storySlug } from './adr';

/**
 * The FINOS CALM model of the system (ADR-0039) and the pages the site renders from it. The model is
 * validated against the CALM schema by `calm validate` in `just lint`; this module checks what the
 * schema cannot: that every reference between elements, ADRs and stories resolves, and that the
 * ADR list in the model matches the decision log.
 */
export const architectureDirectory = new URL('../../../../../docs/architecture/', import.meta.url);
export const modelFile = 'calendar.architecture.json';
export const mappingFile = 'url-mapping.json';

type Json = Record<string, unknown>;

export interface ModelInterface {
  id: string;
  /** Every property of the interface except its id, as written in the model. */
  details: Json;
}

export interface ControlRequirement {
  url: string;
  config: Json;
}

export interface Control {
  name: string;
  description: string;
  requirements: ControlRequirement[];
}

export interface ModelNode {
  id: string;
  type: string;
  name: string;
  description: string;
  interfaces: ModelInterface[];
  controls: Control[];
  /** ADR ids (`ADR-0027`) listed in the element's metadata. */
  adrs: string[];
  /** Story ids (`0005`) listed in the element's metadata. */
  stories: string[];
  metadata: Json;
}

export interface Endpoint {
  node: string;
  interfaces: string[];
}

export type Link =
  | { kind: 'connects'; source: Endpoint; destination: Endpoint }
  | { kind: 'interacts'; actor: string; nodes: string[] }
  | { kind: 'deployed-in' | 'composed-of'; container: string; nodes: string[] };

export interface ModelRelationship {
  id: string;
  description: string;
  protocol: string | undefined;
  link: Link;
  controls: Control[];
  adrs: string[];
  metadata: Json;
}

export interface Transition {
  relationship: string;
  sequence: number;
  description: string;
  /** True when the step travels from the relationship's destination back to its source. */
  reversed: boolean;
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  requirementUrl: string | undefined;
  transitions: Transition[];
  controls: Control[];
  adrs: string[];
  stories: string[];
  metadata: Json;
}

export interface AdrReference {
  /** `ADR-NNNN`, the id elements use. */
  id: string;
  number: string;
  title: string;
  /** `accepted`, `superseded`, ... as written in the model. */
  status: string;
  file: string;
  url: string;
}

export interface StoryReference {
  /** Four digits, or `XXXX` while unscheduled. */
  id: string;
  title: string;
  status: string;
  url: string;
}

export interface View {
  title: string;
  description: string;
  nodes: string[];
}

export interface Architecture {
  id: string;
  name: string;
  description: string;
  adrs: AdrReference[];
  stories: StoryReference[];
  views: { context: View; containers: View };
  controls: Control[];
  nodes: ModelNode[];
  relationships: ModelRelationship[];
  flows: Flow[];
  metadata: Json;
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function text(object: Json, key: string, where: string): string {
  const value = object[key];
  if (!isText(value) || value === '')
    throw new Error(`${where}: ${key} must be a non-empty string`);
  return value;
}

function optionalText(object: Json, key: string, where: string): string | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (!isText(value)) throw new Error(`${where}: ${key} must be a string`);
  return value;
}

function records(object: Json, key: string, where: string): Json[] {
  const value = object[key] ?? [];
  if (!isList(value) || !value.every(isRecord)) {
    throw new Error(`${where}: ${key} must be a list of objects`);
  }
  return value;
}

function texts(object: Json, key: string, where: string): string[] {
  const value = object[key] ?? [];
  if (!isList(value) || !value.every(isText))
    throw new Error(`${where}: ${key} must be a list of strings`);
  return value;
}

function record(object: Json, key: string, where: string): Json {
  const value = object[key] ?? {};
  if (!isRecord(value)) throw new Error(`${where}: ${key} must be an object`);
  return value;
}

/** CALM metadata is an object or a list of objects; the model uses objects. */
function metadataOf(object: Json, where: string): Json {
  const value = object.metadata ?? {};
  if (isList(value)) {
    if (!value.every(isRecord)) throw new Error(`${where}: metadata must hold objects`);
    return Object.assign({}, ...value) as Json;
  }
  if (!isRecord(value)) throw new Error(`${where}: metadata must be an object`);
  return value;
}

function adrIds(metadata: Json, where: string): string[] {
  const ids = texts(metadata, 'adrs', where);
  for (const id of ids) {
    if (!/^ADR-\d{4}$/.test(id))
      throw new Error(`${where}: ADR reference must be ADR-NNNN, got ${id}`);
  }
  return ids;
}

function storyIds(metadata: Json, where: string): string[] {
  const single = optionalText(metadata, 'story', where);
  return [...(single === undefined ? [] : [single]), ...texts(metadata, 'stories', where)];
}

function parseControls(object: Json, where: string): Control[] {
  const controls = record(object, 'controls', where);
  return Object.entries(controls).map(([name, value]) => {
    const at = `${where} control ${name}`;
    if (!/^[a-zA-Z0-9-]+$/.test(name))
      throw new Error(`${at}: name must be alphanumeric with hyphens`);
    if (!isRecord(value)) throw new Error(`${at}: must be an object`);
    const requirements = records(value, 'requirements', at).map((requirement) => ({
      url: text(requirement, 'requirement-url', at),
      config: record(requirement, 'config', at),
    }));
    if (requirements.length === 0) throw new Error(`${at}: needs at least one requirement`);
    return { name, description: text(value, 'description', at), requirements };
  });
}

function parseEndpoint(value: unknown, where: string): Endpoint {
  if (!isRecord(value)) throw new Error(`${where}: endpoint must be an object`);
  return { node: text(value, 'node', where), interfaces: texts(value, 'interfaces', where) };
}

function parseLink(object: Json, where: string): Link {
  const type = record(object, 'relationship-type', where);
  const kinds = Object.keys(type);
  const [kind] = kinds;
  if (kinds.length !== 1 || kind === undefined) {
    throw new Error(`${where}: relationship-type must hold exactly one kind`);
  }
  const body = record(type, kind, where);
  switch (kind) {
    case 'connects':
      return {
        kind,
        source: parseEndpoint(body.source, where),
        destination: parseEndpoint(body.destination, where),
      };
    case 'interacts':
      return { kind, actor: text(body, 'actor', where), nodes: texts(body, 'nodes', where) };
    case 'deployed-in':
    case 'composed-of':
      return {
        kind,
        container: text(body, 'container', where),
        nodes: texts(body, 'nodes', where),
      };
    default:
      throw new Error(`${where}: unsupported relationship kind ${kind}`);
  }
}

function parseView(views: Json, key: string): View {
  const where = `view ${key}`;
  const view = record(views, key, where);
  const nodes = texts(view, 'nodes', where);
  if (nodes.length === 0) throw new Error(`${where}: needs at least one node`);
  return {
    title: text(view, 'title', where),
    description: text(view, 'description', where),
    nodes,
  };
}

/** Parses the model's JSON into typed elements, checking shapes but not references. */
export function parseArchitecture(source: string): Architecture {
  const root: unknown = JSON.parse(source);
  if (!isRecord(root)) throw new Error('Architecture must be a JSON object');
  const where = 'architecture';
  const id = text(root, 'unique-id', where);
  const metadata = metadataOf(root, where);
  const adrs = records(metadata, 'adrs', where).map((entry) => {
    const at = `${where} ADR entry`;
    const reference = {
      id: text(entry, 'id', at),
      number: '',
      title: text(entry, 'title', at),
      status: text(entry, 'status', at),
      file: text(entry, 'file', at),
      url: text(entry, 'url', at),
    };
    const number = /^ADR-(\d{4})$/.exec(reference.id)?.[1];
    if (number === undefined) throw new Error(`${at}: id must be ADR-NNNN, got ${reference.id}`);
    return { ...reference, number };
  });
  const stories = records(metadata, 'stories', where).map((entry) => {
    const at = `${where} story entry`;
    return {
      id: text(entry, 'id', at),
      title: text(entry, 'title', at),
      status: text(entry, 'status', at),
      url: text(entry, 'url', at),
    };
  });
  const views = record(metadata, 'views', where);
  const nodes = records(root, 'nodes', where).map((node) => {
    const nodeId = text(node, 'unique-id', 'node');
    const at = `node ${nodeId}`;
    const nodeMetadata = metadataOf(node, at);
    return {
      id: nodeId,
      type: text(node, 'node-type', at),
      name: text(node, 'name', at),
      description: text(node, 'description', at),
      interfaces: records(node, 'interfaces', at).map((entry) => {
        const { 'unique-id': interfaceId, ...details } = entry;
        if (!isText(interfaceId) || interfaceId === '')
          throw new Error(`${at}: interface needs a unique-id`);
        return { id: interfaceId, details };
      }),
      controls: parseControls(node, at),
      adrs: adrIds(nodeMetadata, at),
      stories: storyIds(nodeMetadata, at),
      metadata: nodeMetadata,
    };
  });
  const relationships = records(root, 'relationships', where).map((relationship) => {
    const relationshipId = text(relationship, 'unique-id', 'relationship');
    const at = `relationship ${relationshipId}`;
    const relationshipMetadata = metadataOf(relationship, at);
    return {
      id: relationshipId,
      description: optionalText(relationship, 'description', at) ?? '',
      protocol: optionalText(relationship, 'protocol', at),
      link: parseLink(relationship, at),
      controls: parseControls(relationship, at),
      adrs: adrIds(relationshipMetadata, at),
      metadata: relationshipMetadata,
    };
  });
  const flows = records(root, 'flows', where).map((flow) => {
    const flowId = text(flow, 'unique-id', 'flow');
    const at = `flow ${flowId}`;
    const flowMetadata = metadataOf(flow, at);
    const transitions = records(flow, 'transitions', at).map((transition) => {
      const sequence = transition['sequence-number'];
      if (typeof sequence !== 'number' || !Number.isInteger(sequence)) {
        throw new Error(`${at}: sequence-number must be an integer`);
      }
      const direction = optionalText(transition, 'direction', at) ?? 'source-to-destination';
      if (direction !== 'source-to-destination' && direction !== 'destination-to-source') {
        throw new Error(`${at}: unknown direction ${direction}`);
      }
      return {
        relationship: text(transition, 'relationship-unique-id', at),
        sequence,
        description: text(transition, 'description', at),
        reversed: direction === 'destination-to-source',
      };
    });
    if (transitions.length === 0) throw new Error(`${at}: needs at least one transition`);
    return {
      id: flowId,
      name: text(flow, 'name', at),
      description: text(flow, 'description', at),
      requirementUrl: optionalText(flow, 'requirement-url', at),
      transitions,
      controls: parseControls(flow, at),
      adrs: adrIds(flowMetadata, at),
      stories: storyIds(flowMetadata, at),
      metadata: flowMetadata,
    };
  });
  return {
    id,
    name: text(root, 'name', where),
    description: text(root, 'description', where),
    adrs,
    stories,
    views: { context: parseView(views, 'context'), containers: parseView(views, 'containers') },
    controls: parseControls(root, where),
    nodes,
    relationships,
    flows,
    metadata,
  };
}

export interface ReferenceContext {
  adrs: Adr[];
  stories: Story[];
  /** Requirement URLs that `url-mapping.json` maps to an existing local schema. */
  mappedUrls: Set<string>;
}

function unique(ids: string[], what: string) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Duplicate ${what}: ${id}`);
    seen.add(id);
  }
}

function checkControls(controls: Control[], mappedUrls: Set<string>, where: string) {
  unique(
    controls.map((control) => control.name),
    `control on ${where}`,
  );
  for (const control of controls) {
    for (const requirement of control.requirements) {
      if (!mappedUrls.has(requirement.url)) {
        throw new Error(
          `${where} control ${control.name}: requirement ${requirement.url} is not in ${mappingFile}`,
        );
      }
    }
  }
}

/**
 * Checks every reference the CALM schema cannot: nodes, interfaces and relationships named by
 * other elements, flows over existing relationships with contiguous steps, ADR ids that exist in
 * the decision log with the same title and status, story ids that exist, views over existing
 * nodes and control requirements that map to a local schema.
 */
export function checkArchitecture(architecture: Architecture, context: ReferenceContext): void {
  unique(
    architecture.nodes.map((node) => node.id),
    'node',
  );
  const nodes = new Map(architecture.nodes.map((node) => [node.id, node]));
  unique(
    architecture.relationships.map((relationship) => relationship.id),
    'relationship',
  );
  unique(
    architecture.flows.map((flow) => flow.id),
    'flow',
  );
  unique(
    architecture.adrs.map((adr) => adr.id),
    'ADR entry',
  );
  unique(
    architecture.stories.map((story) => story.id),
    'story entry',
  );

  const log = new Map(context.adrs.map((adr) => [adr.number, adr]));
  for (const reference of architecture.adrs) {
    const adr = log.get(reference.number);
    if (!adr) throw new Error(`${reference.id} is not in the decision log`);
    // The model names ADR files from the repository root; the log names them in docs/decisions.
    if (`docs/decisions/${adr.file}` !== reference.file)
      throw new Error(
        `${reference.id}: file is docs/decisions/${adr.file}, model says ${reference.file}`,
      );
    if (adr.title !== reference.title)
      throw new Error(`${reference.id}: title differs from the decision log`);
    const logStatus = adr.status.startsWith('superseded') ? 'superseded' : adr.status;
    if (logStatus !== reference.status) {
      throw new Error(`${reference.id}: status is ${adr.status}, model says ${reference.status}`);
    }
    if (reference.url !== `https://mgasca.github.io/calendar/adr/${reference.number}/`) {
      throw new Error(`${reference.id}: url must be the site's adr/${reference.number}/ route`);
    }
  }
  const storiesBySlug = new Map(context.stories.map((story) => [storySlug(story.file), story]));
  for (const reference of architecture.stories) {
    const slug = /\/stories\/([^/]+)\/$/.exec(reference.url)?.[1];
    const story = slug === undefined ? undefined : storiesBySlug.get(slug);
    if (!story) throw new Error(`Story ${reference.id}: url does not name a published story`);
    if (story.status !== reference.status) {
      throw new Error(
        `Story ${reference.id}: status is ${story.status}, model says ${reference.status}`,
      );
    }
  }
  const adrIdSet = new Set(architecture.adrs.map((adr) => adr.id));
  const storyIdSet = new Set(architecture.stories.map((story) => story.id));
  const checkMentions = (adrs: string[], stories: string[], where: string) => {
    for (const id of adrs) {
      if (!adrIdSet.has(id)) throw new Error(`${where}: ${id} is not in the model's ADR list`);
    }
    for (const id of stories) {
      if (!storyIdSet.has(id))
        throw new Error(`${where}: story ${id} is not in the model's story list`);
    }
  };

  const requireNode = (id: string, where: string) => {
    const node = nodes.get(id);
    if (!node) throw new Error(`${where}: unknown node ${id}`);
    return node;
  };
  const requireEndpoint = (endpoint: Endpoint, where: string) => {
    const node = requireNode(endpoint.node, where);
    for (const id of endpoint.interfaces) {
      if (!node.interfaces.some((entry) => entry.id === id)) {
        throw new Error(`${where}: node ${node.id} has no interface ${id}`);
      }
    }
  };

  checkControls(architecture.controls, context.mappedUrls, 'architecture');
  for (const node of architecture.nodes) {
    unique(
      node.interfaces.map((entry) => entry.id),
      `interface on ${node.id}`,
    );
    checkControls(node.controls, context.mappedUrls, `node ${node.id}`);
    checkMentions(node.adrs, node.stories, `node ${node.id}`);
  }
  for (const relationship of architecture.relationships) {
    const where = `relationship ${relationship.id}`;
    const { link } = relationship;
    if (link.kind === 'connects') {
      requireEndpoint(link.source, where);
      requireEndpoint(link.destination, where);
    } else {
      requireNode(link.kind === 'interacts' ? link.actor : link.container, where);
      for (const id of link.nodes) requireNode(id, where);
    }
    checkControls(relationship.controls, context.mappedUrls, where);
    checkMentions(relationship.adrs, [], where);
  }
  const relationships = new Set(architecture.relationships.map((relationship) => relationship.id));
  for (const flow of architecture.flows) {
    const where = `flow ${flow.id}`;
    flow.transitions.forEach((transition, index) => {
      if (transition.sequence !== index + 1) {
        throw new Error(`${where}: steps must be numbered 1..n in order`);
      }
      if (!relationships.has(transition.relationship)) {
        throw new Error(`${where}: unknown relationship ${transition.relationship}`);
      }
    });
    checkControls(flow.controls, context.mappedUrls, where);
    checkMentions(flow.adrs, flow.stories, where);
  }
  for (const view of Object.values(architecture.views)) {
    for (const id of view.nodes) requireNode(id, `view ${view.title}`);
  }
}

/** Shortens a sentence for a diagram label: its first clause, cut at a word boundary. */
export function shortLabel(sentence: string, max = 72): string {
  const clause = sentence.split(/; | \(|: /)[0] ?? sentence;
  if (clause.length <= max) return clause;
  const space = clause.lastIndexOf(' ', max);
  return `${clause.slice(0, space > 0 ? space : max)}…`;
}

const mermaidId = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_');

/** Escapes the characters Mermaid reads as syntax inside message and label text. */
export function mermaidText(value: string): string {
  const entities: Record<string, string> = {
    ';': '#59;',
    '#': '#35;',
    '(': '#40;',
    ')': '#41;',
    '<': '#lt;',
    '>': '#gt;',
    '"': '#quot;',
  };
  return value.replace(/[;#()<>"]/g, (character) => entities[character] ?? character);
}

function shape(node: ModelNode): string {
  const label = mermaidText(node.name);
  switch (node.type) {
    case 'actor':
      return `([${label}])`;
    case 'database':
      return `[(${label})]`;
    case 'data-asset':
      return `[[${label}]]`;
    default:
      return `["${label}"]`;
  }
}

/**
 * Escapes text for a Markdown table cell. Backslashes go first, so a backslash before a pipe in the
 * input cannot turn the pipe's escape back into a cell separator; newlines would end the row.
 */
export function escapeCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function table(header: string[], rows: string[][]): string {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n');
}

/**
 * Renders a control's inline configuration or an element's metadata as nested bullets. With
 * `docsRoot`, the relative path from the page to `docs/`, a value that names a Markdown document
 * under `docs/` (such as a runbook) becomes a link to it, so a stale path fails the build.
 */
export function renderValue(value: unknown, depth = 0, docsRoot?: string): string[] {
  const indent = '  '.repeat(depth);
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, entry]) => {
      if (isRecord(entry) || (isList(entry) && entry.some((item) => isRecord(item)))) {
        return [`${indent}* **${key}**:`, ...renderValue(entry, depth + 1, docsRoot)];
      }
      return [`${indent}* **${key}**: ${scalarList(entry, docsRoot)}`];
    });
  }
  if (isList(value)) {
    return value.flatMap((entry) =>
      isRecord(entry)
        ? renderValue(entry, depth, docsRoot)
        : [`${indent}* ${scalarList(entry, docsRoot)}`],
    );
  }
  return [`${indent}* ${scalarList(value, docsRoot)}`];
}

function scalarList(value: unknown, docsRoot?: string): string {
  if (isList(value)) return value.map((entry) => scalar(entry, docsRoot)).join(', ');
  return scalar(value, docsRoot);
}

const documentPath = /^docs\/[\w-]+\/[\w./-]+\.md$/;

function scalar(value: unknown, docsRoot?: string): string {
  if (isText(value)) {
    return docsRoot !== undefined && documentPath.test(value)
      ? `[${value}](${docsRoot}${value.slice('docs/'.length)})`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Architecture pages render as if they were the model file, so `docs/` is one level up. */
const docsRootFromElementPage = '../';

export interface Page {
  /** Collection id and route: `architecture`, `architecture/containers`, `architecture/flows/<id>`. */
  id: string;
  title: string;
  body: string;
  sidebar: { order: number; label: string; hidden?: boolean };
}

/** The route of a page under the site base. */
export function pageRoute(id: string): string {
  return `${id}/`;
}

/**
 * The repository-relative path the page pretends to have, so links between architecture pages are
 * rewritten to routes like links between ADRs. The files do not exist; the routes do.
 */
export function pagePath(id: string): string {
  return id === 'architecture'
    ? 'docs/architecture/pages/index.md'
    : `docs/architecture/pages/${id.slice('architecture/'.length)}.md`;
}

class Renderer {
  private readonly nodes: Map<string, ModelNode>;
  private readonly relationships: Map<string, ModelRelationship>;
  private readonly adrs: Map<string, AdrReference>;
  private readonly stories: Map<string, StoryReference>;
  private readonly storyFiles: Map<string, string>;
  private readonly architecture: Architecture;

  constructor(architecture: Architecture, context: Pick<ReferenceContext, 'stories'>) {
    this.architecture = architecture;
    this.nodes = new Map(architecture.nodes.map((node) => [node.id, node]));
    this.relationships = new Map(architecture.relationships.map((item) => [item.id, item]));
    this.adrs = new Map(architecture.adrs.map((adr) => [adr.id, adr]));
    this.stories = new Map(architecture.stories.map((story) => [story.id, story]));
    this.storyFiles = new Map(context.stories.map((story) => [storySlug(story.file), story.file]));
  }

  private node(id: string): ModelNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown node ${id}`);
    return node;
  }

  /** A link to another architecture page, relative to the model's directory like every page body. */
  private link(id: string): string {
    return pagePath(id).slice('docs/architecture/'.length);
  }

  private nodeLink(id: string): string {
    return `[${this.node(id).name}](${this.link(`architecture/components/${id}`)})`;
  }

  private adrLink(id: string): string {
    const adr = this.adrs.get(id);
    if (!adr) throw new Error(`Unknown ${id}`);
    return `[${id}](../decisions/${adr.file.slice('docs/decisions/'.length)})`;
  }

  private adrLine(id: string): string {
    const adr = this.adrs.get(id);
    if (!adr) throw new Error(`Unknown ${id}`);
    return `${this.adrLink(id)} ${adr.title} (${adr.status})`;
  }

  private storyLink(id: string): string {
    const story = this.stories.get(id);
    if (!story) throw new Error(`Unknown story ${id}`);
    const slug = /\/stories\/([^/]+)\/$/.exec(story.url)?.[1] ?? '';
    const file = this.storyFiles.get(slug);
    if (file === undefined) throw new Error(`Story ${id} has no card file`);
    return `[${story.id} ${story.title}](../stories/${file})`;
  }

  private decisions(adrs: string[], stories: string[]): string {
    const lines = [
      ...adrs.map((id) => `* ${this.adrLine(id)}`),
      ...stories.map((id) => `* Story ${this.storyLink(id)}`),
    ];
    return lines.length ? `## Decisions and stories\n\n${lines.join('\n')}` : '';
  }

  private controls(controls: Control[], heading = '## Controls'): string {
    if (controls.length === 0) return '';
    const sections = controls.map((control) =>
      [
        `### ${control.name}`,
        '',
        control.description,
        '',
        ...control.requirements.flatMap((requirement) => [
          `Requirement schema: <${requirement.url}>`,
          '',
          ...renderValue(requirement.config),
          '',
        ]),
      ].join('\n'),
    );
    return `${heading}\n\n${sections.join('\n')}`;
  }

  /** The view node a relationship endpoint collapses onto, following composition and deployment. */
  private collapse(id: string, view: Set<string>): string | undefined {
    if (view.has(id)) return id;
    const containers = this.architecture.relationships.flatMap(({ link }) =>
      (link.kind === 'composed-of' || link.kind === 'deployed-in') && link.nodes.includes(id)
        ? [{ kind: link.kind, container: link.container }]
        : [],
    );
    containers.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'composed-of' ? -1 : 1));
    for (const { container } of containers) {
      const found = this.collapse(container, view);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  /** The directed pairs a relationship draws as edges; containment draws none. */
  private edgeEnds(relationship: ModelRelationship): [string, string][] {
    const { link } = relationship;
    if (link.kind === 'connects') return [[link.source.node, link.destination.node]];
    if (link.kind === 'interacts') return link.nodes.map((node) => [link.actor, node]);
    return [];
  }

  /**
   * The two parties of a flow step over a relationship: source and destination of a connection,
   * the actor and the first node of an interaction, the first member and its container otherwise.
   */
  private stepEnds(relationship: ModelRelationship): [string, string] {
    const { link } = relationship;
    if (link.kind === 'connects') return [link.source.node, link.destination.node];
    const [first] = link.nodes;
    if (first === undefined) throw new Error(`Relationship ${relationship.id} names no nodes`);
    return link.kind === 'interacts' ? [link.actor, first] : [first, link.container];
  }

  private contextDiagram(view: View): string {
    const members = new Set(view.nodes);
    const lines = view.nodes.map((id) => `  ${mermaidId(id)}${shape(this.node(id))}`);
    const seen = new Set<string>();
    for (const relationship of this.architecture.relationships) {
      for (const [from, to] of this.edgeEnds(relationship)) {
        const source = this.collapse(from, members);
        const target = this.collapse(to, members);
        if (source === undefined || target === undefined || source === target) continue;
        const key = `${source}->${target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = mermaidText(shortLabel(relationship.description, 40));
        lines.push(`  ${mermaidId(source)} -->|"${label}"| ${mermaidId(target)}`);
      }
    }
    return ['```mermaid', 'flowchart LR', ...lines, '```'].join('\n');
  }

  private containerDiagram(view: View): string {
    const members = new Set(view.nodes);
    const parent = new Map<string, string>();
    for (const { link } of this.architecture.relationships) {
      if (link.kind !== 'deployed-in' || !members.has(link.container)) continue;
      for (const id of link.nodes) if (members.has(id)) parent.set(id, link.container);
    }
    const children = new Map<string, string[]>();
    for (const id of view.nodes) {
      const container = parent.get(id) ?? '';
      children.set(container, [...(children.get(container) ?? []), id]);
    }
    const render = (container: string, depth: number): string[] =>
      (children.get(container) ?? []).flatMap((id) => {
        const indent = '  '.repeat(depth);
        const nested = children.get(id);
        if (nested === undefined) return [`${indent}${mermaidId(id)}${shape(this.node(id))}`];
        return [
          `${indent}subgraph ${mermaidId(id)}["${mermaidText(this.node(id).name)}"]`,
          ...render(id, depth + 1),
          `${indent}end`,
        ];
      });
    const edges: string[] = [];
    for (const relationship of this.architecture.relationships) {
      for (const [from, to] of this.edgeEnds(relationship)) {
        if (!members.has(from) || !members.has(to)) continue;
        const label = relationship.protocol === undefined ? '' : `|${relationship.protocol}|`;
        edges.push(`  ${mermaidId(from)} -->${label} ${mermaidId(to)}`);
      }
    }
    return ['```mermaid', 'flowchart TB', ...render('', 1), ...edges, '```'].join('\n');
  }

  private sequenceDiagram(flow: Flow): string {
    const order: string[] = [];
    const steps: string[] = [];
    for (const transition of flow.transitions) {
      const relationship = this.relationships.get(transition.relationship);
      if (!relationship) throw new Error(`Unknown relationship ${transition.relationship}`);
      {
        const [a, b] = this.stepEnds(relationship);
        const [from, to] = transition.reversed ? [b, a] : [a, b];
        for (const id of [from, to]) if (!order.includes(id)) order.push(id);
        const arrow = transition.reversed ? '-->>' : '->>';
        const label = mermaidText(
          `${String(transition.sequence)}. ${shortLabel(transition.description)}`,
        );
        steps.push(`  ${mermaidId(from)} ${arrow} ${mermaidId(to)}: ${label}`);
      }
    }
    const participants = order.map(
      (id) => `  participant ${mermaidId(id)} as ${mermaidText(this.node(id).name)}`,
    );
    return ['```mermaid', 'sequenceDiagram', ...participants, ...steps, '```'].join('\n');
  }

  private relationshipRows(filter: (relationship: ModelRelationship) => boolean): string[][] {
    return this.architecture.relationships.filter(filter).flatMap((relationship) => {
      const { link } = relationship;
      const pairs: [string, string][] =
        link.kind === 'connects'
          ? [[link.source.node, link.destination.node]]
          : link.kind === 'interacts'
            ? link.nodes.map((node) => [link.actor, node])
            : link.nodes.map((node) => [node, link.container]);
      return pairs.map(([from, to]) => [
        this.nodeLink(from),
        link.kind === 'deployed-in' ? 'runs in' : link.kind === 'composed-of' ? 'is part of' : '→',
        this.nodeLink(to),
        relationship.description,
        relationship.protocol ?? '',
      ]);
    });
  }

  private elementRows(ids: string[]): string[][] {
    return ids.map((id) => {
      const node = this.node(id);
      return [this.nodeLink(id), node.type, node.description];
    });
  }

  overview(): Page {
    const { context } = this.architecture.views;
    const members = new Set(context.nodes);
    const inView = (relationship: ModelRelationship) =>
      this.edgeEnds(relationship).some(([from, to]) => members.has(from) && members.has(to));
    const adrRows = this.architecture.adrs.map((adr) => {
      const used = [
        ...this.architecture.nodes
          .filter((node) => node.adrs.includes(adr.id))
          .map((node) => node.name),
        ...this.architecture.flows
          .filter((flow) => flow.adrs.includes(adr.id))
          .map((flow) => flow.name),
      ];
      return [this.adrLink(adr.id), adr.title, adr.status, used.join(', ')];
    });
    const body = [
      this.architecture.description,
      '',
      `The source is the FINOS CALM 1.3 model [\`${modelFile}\`](${modelFile})${this.adrs.has('ADR-0039') ? ` (chosen in ${this.adrLink('ADR-0039')})` : ''}. ` +
        '`calm validate --strict` checks it against the CALM schema in `just lint`, and the documentation build checks that ' +
        'every ADR, story, node and relationship it names exists. Every diagram on these pages is generated from the model; the table ' +
        'beneath each one lists the same elements.',
      '',
      `## ${context.title}`,
      '',
      context.description,
      '',
      this.contextDiagram(context),
      '',
      '### Elements',
      '',
      table(['Element', 'Type', 'Description'], this.elementRows(context.nodes)),
      '',
      '### Relationships',
      '',
      table(['From', '', 'To', 'What', 'Protocol'], this.relationshipRows(inView)),
      '',
      '## Views',
      '',
      `* [${this.architecture.views.containers.title}](${this.link('architecture/containers')}): the parts that run, where they run and how they connect.`,
      `* [Components](${this.link('architecture/components')}): every element with its interfaces, controls and decisions.`,
      `* [Controls](${this.link('architecture/controls')}): the non-functional requirements and where each applies.`,
      '',
      '## Flows',
      '',
      ...this.architecture.flows.map(
        (flow) =>
          `* [${flow.name}](${this.link(`architecture/flows/${flow.id}`)}): ${shortLabel(flow.description, 120)}`,
      ),
      '',
      '## Decisions',
      '',
      'Every ADR in the decision log, with the elements and flows that depend on it.',
      '',
      table(['ADR', 'Title', 'Status', 'Used by'], adrRows),
    ].join('\n');
    return {
      id: 'architecture',
      title: 'Architecture',
      body,
      sidebar: { order: 0, label: 'Overview' },
    };
  }

  containers(): Page {
    const view = this.architecture.views.containers;
    const members = new Set(view.nodes);
    const inView = (relationship: ModelRelationship) => {
      const { link } = relationship;
      if (link.kind === 'composed-of') return false;
      if (link.kind === 'deployed-in') return members.has(link.container);
      return this.edgeEnds(relationship).some(([from, to]) => members.has(from) && members.has(to));
    };
    const body = [
      view.description,
      '',
      this.containerDiagram(view),
      '',
      '## Elements',
      '',
      table(['Element', 'Type', 'Description'], this.elementRows(view.nodes)),
      '',
      '## Relationships',
      '',
      table(['From', '', 'To', 'What', 'Protocol'], this.relationshipRows(inView)),
    ].join('\n');
    return {
      id: 'architecture/containers',
      title: view.title,
      body,
      sidebar: { order: 1, label: view.title },
    };
  }

  components(): Page[] {
    const index: Page = {
      id: 'architecture/components',
      title: 'Components',
      body: [
        'Every element of the model. Each page lists the interfaces the element exposes, the relationships it takes part in, the controls it must satisfy and the decisions behind it.',
        '',
        table(
          ['Component', 'Type', 'Description', 'Decisions'],
          this.architecture.nodes.map((node) => [
            this.nodeLink(node.id),
            node.type,
            node.description,
            node.adrs.map((id) => this.adrLink(id)).join(', '),
          ]),
        ),
      ].join('\n'),
      sidebar: { order: 2, label: 'Components' },
    };
    const pages = this.architecture.nodes.map((node): Page => {
      const involves = (relationship: ModelRelationship) => {
        const { link } = relationship;
        if (link.kind === 'connects') {
          return link.source.node === node.id || link.destination.node === node.id;
        }
        return (
          link.nodes.includes(node.id) ||
          (link.kind === 'interacts' ? link.actor : link.container) === node.id
        );
      };
      const other = Object.entries(node.metadata).filter(
        ([key]) => !['adrs', 'stories', 'story'].includes(key),
      );
      const body = [
        `**Type:** ${node.type}`,
        '',
        node.description,
        '',
        ...(node.interfaces.length
          ? [
              '## Interfaces',
              '',
              table(
                ['Interface', 'Details'],
                node.interfaces.map((entry) => [
                  `\`${entry.id}\``,
                  Object.entries(entry.details)
                    .map(([key, value]) => `**${key}**: ${scalarList(value)}`)
                    .join('; '),
                ]),
              ),
              '',
            ]
          : []),
        '## Relationships',
        '',
        table(['From', '', 'To', 'What', 'Protocol'], this.relationshipRows(involves)),
        '',
        this.controls(node.controls),
        '',
        this.decisions(node.adrs, node.stories),
        '',
        ...(other.length
          ? [
              '## Metadata',
              '',
              ...renderValue(Object.fromEntries(other), 0, docsRootFromElementPage),
            ]
          : []),
      ].join('\n');
      return {
        id: `architecture/components/${node.id}`,
        title: node.name,
        body,
        sidebar: { order: 100, label: node.name, hidden: true },
      };
    });
    return [index, ...pages];
  }

  controlsPage(): Page {
    const applications: { control: Control; where: string }[] = [
      ...this.architecture.controls.map((control) => ({ control, where: 'The whole system' })),
      ...this.architecture.nodes.flatMap((node) =>
        node.controls.map((control) => ({ control, where: this.nodeLink(node.id) })),
      ),
      ...this.architecture.relationships.flatMap((relationship) =>
        relationship.controls.map((control) => ({
          control,
          where: `Relationship ${relationship.id}: ${this.relationshipRows(
            (item) => item.id === relationship.id,
          )
            .map((row) => `${row[0] ?? ''} ${row[1] ?? ''} ${row[2] ?? ''}`)
            .join('; ')}`,
        })),
      ),
      ...this.architecture.flows.flatMap((flow) =>
        flow.controls.map((control) => ({
          control,
          where: `Flow [${flow.name}](${this.link(`architecture/flows/${flow.id}`)})`,
        })),
      ),
    ];
    const names = [...new Set(applications.map(({ control }) => control.name))].sort();
    const sections = names.map((name) => {
      const uses = applications.filter(({ control }) => control.name === name);
      const schemas = [
        ...new Set(uses.flatMap(({ control }) => control.requirements.map((r) => r.url))),
      ];
      return [
        `## ${name}`,
        '',
        ...schemas.map((url) => `Requirement schema: <${url}>`),
        '',
        ...uses.map(({ control, where }) => `* ${where}: ${control.description}`),
        '',
      ].join('\n');
    });
    const body = [
      'The non-functional requirements the model records as CALM controls, and the elements each applies to. Each control names a requirement schema (a JSON Schema in `docs/architecture/controls/`) and carries an inline configuration that conforms to it; the configuration is shown on the element or flow page.',
      '',
      table(
        ['Control', 'Applies to'],
        names.map((name) => [
          `\`${name}\``,
          applications
            .filter(({ control }) => control.name === name)
            .map(({ where }) => where)
            .join('; '),
        ]),
      ),
      '',
      ...sections,
    ].join('\n');
    return {
      id: 'architecture/controls',
      title: 'Controls',
      body,
      sidebar: { order: 3, label: 'Controls' },
    };
  }

  flows(): Page[] {
    return this.architecture.flows.map((flow, order): Page => {
      const rows = flow.transitions.map((transition) => {
        const relationship = this.relationships.get(transition.relationship);
        if (!relationship) throw new Error(`Unknown relationship ${transition.relationship}`);
        const [a, b] = this.stepEnds(relationship);
        const [from, to] = transition.reversed ? [b, a] : [a, b];
        return [
          String(transition.sequence),
          this.nodeLink(from),
          this.nodeLink(to),
          transition.description,
        ];
      });
      const body = [
        flow.description,
        '',
        ...(flow.requirementUrl === undefined ? [] : [`Requirement: <${flow.requirementUrl}>`, '']),
        this.sequenceDiagram(flow),
        '',
        '## Steps',
        '',
        table(['#', 'From', 'To', 'What happens'], rows),
        '',
        this.controls(flow.controls),
        '',
        this.decisions(flow.adrs, flow.stories),
        '',
        ...(Object.keys(flow.metadata).some((key) => !['adrs', 'stories', 'story'].includes(key))
          ? [
              '## Metadata',
              '',
              ...renderValue(
                Object.fromEntries(
                  Object.entries(flow.metadata).filter(
                    ([key]) => !['adrs', 'stories', 'story'].includes(key),
                  ),
                ),
                0,
                docsRootFromElementPage,
              ),
            ]
          : []),
      ].join('\n');
      return {
        id: `architecture/flows/${flow.id}`,
        title: flow.name,
        body,
        sidebar: { order: 10 + order, label: flow.name },
      };
    });
  }
}

/** Renders every page of the Architecture section from the model. */
export function architecturePages(
  architecture: Architecture,
  context: Pick<ReferenceContext, 'stories'>,
): Page[] {
  const renderer = new Renderer(architecture, context);
  return [
    renderer.overview(),
    renderer.containers(),
    ...renderer.components(),
    renderer.controlsPage(),
    ...renderer.flows(),
  ];
}

/** Sidebar entries for the Architecture group, read from the model at configuration time. */
export function architectureSidebar(flows: { id: string }[]) {
  return [
    { slug: 'architecture' },
    { slug: 'architecture/containers' },
    { slug: 'architecture/components' },
    { slug: 'architecture/controls' },
    { label: 'Flows', items: flows.map((flow) => ({ slug: `architecture/flows/${flow.id}` })) },
  ];
}

/** Where a page's "Edit page" link points: the model itself. */
export const modelEditUrl = `${repository}/edit/main/docs/architecture/${modelFile}`;
