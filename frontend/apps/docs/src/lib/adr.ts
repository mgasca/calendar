import matter from 'gray-matter';
import { posix } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString } from 'mdast-util-to-string';
import { visit } from 'unist-util-visit';
import type { Definition, Root } from 'mdast';

const parser = unified().use(remarkParse).use(remarkGfm);
// Document bodies need only title parsing; GFM remains available for status and link handling.
const titleParser = unified().use(remarkParse);
export const repository = 'https://github.com/mgasca/calendar';
export interface Adr {
  number: string;
  file: string;
  title: string;
  status: string;
  body: string;
}

/** Reads a document's front matter, its single title and the article beneath the title. */
function parseDocument(source: string, file: string) {
  const parsed = matter(source);
  const headings = titleParser
    .parse(parsed.content)
    .children.filter((node) => node.type === 'heading' && node.depth === 1);
  const heading = headings[0];
  if (headings.length !== 1 || !heading) throw new Error(`Expected one title: ${file}`);
  const start = heading.position?.start.offset;
  const end = heading.position?.end.offset;
  if (start === undefined || end === undefined) throw new Error(`Missing title position: ${file}`);
  // Starlight owns the page heading; keep only the canonical article beneath it.
  return {
    metadata: parsed.data as Record<string, unknown>,
    title: toString(heading),
    body: parsed.content.slice(0, start) + parsed.content.slice(end),
  };
}

const adrFileName = /^(\d{4})-[a-z0-9-]+\.md$/;

/**
 * Builds the decision log from the ADR sources alone (ADR-0040): the file name gives the number
 * and the order, the single H1 gives the title and the front matter gives the status. There is no
 * index table to keep in step, so two ADRs in flight never conflict on one.
 */
export function parseLog(sources: Map<string, string>): Adr[] {
  const seen = new Map<string, string>();
  const records = [...sources.keys()].sort().map((file) => {
    const number = adrFileName.exec(file)?.[1];
    if (number === undefined) throw new Error(`Invalid ADR filename: ${file}`);
    const other = seen.get(number);
    if (other !== undefined) throw new Error(`Duplicate ADR ${number}: ${other} and ${file}`);
    seen.set(number, file);
    const source = sources.get(file);
    if (source === undefined) throw new Error(`Missing ADR: ${file}`);
    const { metadata, title, body } = parseDocument(source, file);
    if (typeof metadata.status !== 'string' || !metadata.status.trim()) {
      throw new Error(`ADR without a status: ${file}`);
    }
    // `superseded by [ADR-0038](0038-….md)` reads as plain text, the same label the site shows.
    const status = toString(parser.parse(metadata.status));
    return { number, file, title, status, body };
  });
  if (!records.length) throw new Error('ADR log is empty');
  return records;
}

export const storyStatuses = ['planned', 'in-progress', 'implemented'];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export interface Story {
  /** Four digits once scheduled, or `XXXX` while planned. */
  number: string;
  file: string;
  title: string;
  status: string;
  date: string;
  /** GitHub issue the story started from, if it started as one. */
  issue?: string | undefined;
  /** Pull requests that delivered the story, in delivery order; empty until there is one. */
  pr: string[];
  /** ADR numbers this story relies on, as listed in its front matter. */
  adrs: string[];
  body: string;
}

/** Reads story titles and metadata from the discovered files. */
export function parseStories(sources: Map<string, string>, adrs: Map<string, string>): Story[] {
  const seen = new Set<string>();
  const records = [...sources.keys()].sort().map((file) => {
    const number = /^(\d{4}|XXXX)-[a-z0-9-]+\.md$/.exec(file)?.[1];
    if (number === undefined) throw new Error(`Invalid story filename: ${file}`);
    const slug = storySlug(file);
    if (seen.has(slug)) throw new Error(`Duplicate story: ${file}`);
    seen.add(slug);
    const source = sources.get(file);
    if (source === undefined) throw new Error(`Missing story: ${file}`);
    const { metadata, title: heading, body } = parseDocument(source, file);
    if (!heading.startsWith(`${number} `))
      throw new Error(`Story title must start with its number: ${file}`);
    const title = heading.slice(number.length + 1);
    const status = metadata.status;
    if (typeof status !== 'string' || !storyStatuses.includes(status)) {
      throw new Error(`Unknown story status: ${file}`);
    }
    // YAML reads an unquoted 0016 as the octal 14, so require quoted four-digit strings.
    const date =
      metadata.date instanceof Date ? metadata.date.toISOString().slice(0, 10) : metadata.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Story date must be YYYY-MM-DD: ${file}`);
    }
    const issue = metadata.issue;
    if (
      issue !== undefined &&
      (typeof issue !== 'string' ||
        !/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(issue))
    ) {
      throw new Error(`Story issue must be a GitHub issue URL: ${file}`);
    }
    const pr = metadata.pr ?? [];
    if (!isStringArray(pr) || !pr.every((url) => URL.canParse(url))) {
      throw new Error(`Story pr must be a list of URLs: ${file}`);
    }
    if (!isStringArray(metadata.adrs)) {
      throw new Error(`Story adrs must be quoted ADR numbers, e.g. ["0004"]: ${file}`);
    }
    for (const adr of metadata.adrs) {
      if (!adrs.has(adr)) throw new Error(`Story references unknown ADR ${adr}: ${file}`);
    }
    return { number, file, title, status, date, issue, pr, adrs: metadata.adrs, body };
  });
  if (!records.length) throw new Error('Story collection is empty');
  return records;
}

export interface Runbook {
  file: string;
  title: string;
  body: string;
}

/** Discovers runbooks from their files, ordered by their explicit operational sequence. */
export function parseRunbooks(sources: Map<string, string>): Runbook[] {
  const orders = new Set<number>();
  const records = [...sources]
    .map(([file, source]) => {
      if (!/^[a-z0-9-]+\.md$/.test(file)) throw new Error(`Invalid runbook filename: ${file}`);
      const { metadata, title, body } = parseDocument(source, file);
      const order = metadata.order;
      if (
        typeof order !== 'number' ||
        !Number.isSafeInteger(order) ||
        order < 1 ||
        orders.has(order)
      ) {
        throw new Error(`Runbook order must be a unique positive integer: ${file}`);
      }
      orders.add(order);
      return { file, title, body, order };
    })
    .sort((a, b) => a.order - b.order);
  if (!records.length) throw new Error('Runbook collection is empty');
  return records.map(({ file, title, body }) => ({ file, title, body }));
}

/** URL segment for a runbook: its filename without the extension. */
export function runbookSlug(file: string) {
  return file.replace(/\.md$/, '');
}

export interface Benchmark {
  number: string;
  file: string;
  /** The record's title without its number. */
  title: string;
  /** What the record measures. */
  subject: string;
  /** Repository-relative path of the harness that produced the record. */
  harness: string;
  body: string;
}

/** Reads benchmark metadata from each record. */
export function parseBenchmarks(sources: Map<string, string>): Benchmark[] {
  return numberedDocuments(sources).map(({ number, file, title, body, metadata }) => {
    const { subject, harness } = metadata;
    if (typeof subject !== 'string' || !subject.trim())
      throw new Error(`Missing benchmark subject: ${file}`);
    if (
      typeof harness !== 'string' ||
      !/^[\w.-][\w./-]*$/.test(harness) ||
      harness.split('/').includes('..')
    ) {
      throw new Error(`Benchmark harness must be a repository-relative path: ${file}`);
    }
    return { number, file, title, body, subject, harness };
  });
}

function numberedDocuments(sources: Map<string, string>) {
  const seen = new Set<string>();
  const records = [...sources]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, source]) => {
      const number = adrFileName.exec(file)?.[1];
      if (!number || seen.has(number))
        throw new Error(`Invalid or duplicate document number: ${file}`);
      seen.add(number);
      const { title, body, metadata } = parseDocument(source, file);
      if (!title.startsWith(`${number} `))
        throw new Error(`Title must start with its number: ${file}`);
      return { number, file, title: title.slice(number.length + 1), body, metadata };
    });
  if (!records.length) throw new Error('Document collection is empty');
  return records;
}

export interface AgentThought {
  number: string;
  file: string;
  /** The report's title without its number. */
  title: string;
  /** When the perspective was captured, as its front matter gives it (YYYY-MM-DD). */
  date: string;
  author: string;
  /** The revision the report reviewed. */
  revision: string;
  body: string;
}

/** Reads report provenance from each report's front matter, in filename order. */
export function parseAgentThoughts(sources: Map<string, string>): AgentThought[] {
  return numberedDocuments(sources).map(({ number, file, title, body, metadata }) => {
    const date =
      metadata.date instanceof Date ? metadata.date.toISOString().slice(0, 10) : metadata.date;
    const { author, revision } = metadata;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new Error(`Invalid report date: ${file}`);
    if (typeof author !== 'string' || !author.trim())
      throw new Error(`Missing report author: ${file}`);
    if (typeof revision !== 'string' || !/^[0-9a-f]{7,40}$/.test(revision))
      throw new Error(`Invalid report revision: ${file}`);
    return { number, file, title, body, date, author, revision };
  });
}

export const narrativeStatuses = ['draft', 'final'];
/** A stitched narrative, `<system>-narrative.md`; the part directories beside them are never read. */
export const narrativeFileName = /^([a-z0-9]+(?:-[a-z0-9]+)*)-narrative\.md$/;
const narrativeKeys = new Set(['system', 'audience', 'date', 'status', 'slides']);

export interface Narrative {
  /** The file name without `-narrative.md`, which is also the part directory and the route. */
  slug: string;
  file: string;
  title: string;
  /** The narrated system's display name. */
  system: string;
  audience: string;
  date: string;
  status: string;
  /** The deck's path under the site base, `slides/<slug>/`, when the narrative has a deck. */
  slides?: string | undefined;
  body: string;
}

/** Reads and validates the stitched narratives (ADR-0059), in file-name order. */
export function parseNarratives(sources: Map<string, string>): Narrative[] {
  const systems = new Map<string, string>();
  return [...sources.keys()].sort().map((file) => {
    const slug = narrativeFileName.exec(file)?.[1];
    if (slug === undefined) throw new Error(`Invalid narrative filename: ${file}`);
    const source = sources.get(file);
    if (source === undefined) throw new Error(`Missing narrative: ${file}`);
    const { metadata, title, body } = parseDocument(source, file);
    for (const key of Object.keys(metadata)) {
      if (!narrativeKeys.has(key))
        throw new Error(`Unknown narrative front matter ${key}: ${file}`);
    }
    const { system, audience, status, slides } = metadata;
    if (typeof system !== 'string' || !system.trim())
      throw new Error(`Missing narrative system: ${file}`);
    const other = systems.get(system.trim().toLowerCase());
    if (other !== undefined)
      throw new Error(`Duplicate narrative of ${system}: ${other} and ${file}`);
    systems.set(system.trim().toLowerCase(), file);
    if (typeof audience !== 'string' || !audience.trim())
      throw new Error(`Missing narrative audience: ${file}`);
    const date =
      metadata.date instanceof Date ? metadata.date.toISOString().slice(0, 10) : metadata.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new Error(`Narrative date must be YYYY-MM-DD: ${file}`);
    if (typeof status !== 'string' || !narrativeStatuses.includes(status))
      throw new Error(`Narrative status must be draft or final: ${file}`);
    if (slides !== undefined && slides !== `slides/${slug}/`)
      throw new Error(`Narrative slides must be slides/${slug}/: ${file}`);
    return {
      slug,
      file,
      title,
      system: system.trim(),
      audience: audience.trim(),
      date,
      status,
      slides,
      body,
    };
  });
}

/** Maps a narrative status onto the existing status colours: final is accepted, draft is draft. */
export function narrativeStatusCategory(status: string) {
  return status === 'final' ? 'accepted' : 'draft';
}

/** URL segment for a story: its number, or its slug while it is unnumbered. */
export function storySlug(file: string) {
  const number = /^(\d{4})-/.exec(file)?.[1];
  return number ?? file.replace(/^XXXX-/, '').replace(/\.md$/, '');
}

/** Maps a story status onto the existing status colours: implemented is accepted, planned is neutral. */
export function storyStatusCategory(status: string) {
  if (status === 'implemented') return 'accepted';
  if (status === 'in-progress') return 'draft';
  return 'pending';
}

export function deployment(url = 'http://localhost:4321/') {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.search || parsed.hash) {
    throw new Error('DOCS_SITE_URL must be an HTTP(S) URL without query or fragment');
  }
  return { site: parsed.origin, base: `${parsed.pathname.replace(/\/$/, '')}/` };
}

// Paths that name an ADR, story, benchmark record, agent thought, runbook or narrative, or a
// narrative's Markdown part (never published, ADR-0059): linking one that is not published is an error.
const brokenDocumentLink =
  /^docs\/(?:(?:decisions|stories|benchmarks|agent-thoughts)\/(?:\d{4}|XXXX)-[^/]*|runbooks\/[a-z0-9-]+|narratives\/[^/]+(?:\/.+)?)\.md$/;

/**
 * Rewrites one link in the document at `from`, a repository-relative path. `links` maps
 * repository-relative document paths (ADRs, stories, runbooks, benchmarks, agent thoughts and
 * their indexes) to routes under `base`.
 */
export function rewriteLink(
  url: string,
  base: string,
  links: Map<string, string>,
  from: string,
): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) return url;
  const match = /^([^?#]*)(.*)$/.exec(url);
  if (!match) return url;
  const path = match[1] ?? '';
  const suffix = match[2] ?? '';
  if (!path) return url;
  if (path.startsWith('/')) throw new Error(`Unsupported repository link: ${url}`);
  const resolved = posix.normalize(posix.join(posix.dirname(from), path));
  const route = links.get(resolved);
  if (route !== undefined) return base + route + suffix;
  if (brokenDocumentLink.test(resolved)) {
    throw new Error(`Broken document link: ${url}`);
  }
  if (resolved.startsWith('../')) throw new Error(`Unsupported repository link: ${url}`);
  return `${repository}/blob/main/${resolved}${suffix}`;
}

export function remarkDocLinks(options: {
  /** Absolute path of the repository root, so each document's file path can be made relative. */
  root: string;
  base: string;
  links: Map<string, string> | (() => Promise<Map<string, string>>);
}) {
  return async (tree: Root, file: { path?: string | undefined }) => {
    if (!file.path) throw new Error('Document links need the source file path');
    const from = posix.relative(options.root, file.path);
    const links = typeof options.links === 'function' ? await options.links() : options.links;
    const definitions = new Map<string, Definition>();
    visit(tree, 'definition', (node) => {
      definitions.set(node.identifier, node);
    });
    visit(tree, 'imageReference', (node, index, parent) => {
      const definition = definitions.get(node.identifier);
      if (definition && parent && index !== undefined) {
        parent.children[index] = {
          type: 'image',
          url: definition.url,
          alt: node.alt,
          title: definition.title,
        };
      }
    });
    visit(tree, (node) => {
      if (node.type === 'link' || node.type === 'definition' || node.type === 'image') {
        node.url = rewriteLink(node.url, options.base, links, from);
        if (node.type === 'image')
          node.url = node.url.replace(
            `${repository}/blob/main/`,
            'https://raw.githubusercontent.com/mgasca/calendar/main/',
          );
      }
    });
  };
}

/** Group canonical status text for presentation without changing the record's wording. */
export function statusCategory(status: string) {
  const normalized = status.trim().toLowerCase();
  if (/^(superseded|superceded)\b/.test(normalized)) return 'superseded';
  if (normalized === 'accepted') return 'accepted';
  if (normalized === 'proposed' || normalized === 'draft') return 'draft';
  if (normalized === 'rejected') return 'rejected';
  return 'pending';
}
