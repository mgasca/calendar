import matter from 'gray-matter';
import { posix } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString } from 'mdast-util-to-string';
import { visit } from 'unist-util-visit';
import type { Definition, Root, Table } from 'mdast';

const parser = unified().use(remarkParse).use(remarkGfm);
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
  const headings = parser
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

/** Finds the one index table whose header is exactly `header`, e.g. `ADR|Title|Status`. */
function findTable(index: string, header: string, name: string): Table {
  let table: Table | undefined;
  visit(parser.parse(index), 'table', (node) => {
    if (node.children[0]?.children.map((cell) => toString(cell)).join('|') === header) {
      if (table) throw new Error(`Duplicate ${name} table`);
      table = node;
    }
  });
  if (!table) throw new Error(`Missing ${name} table`);
  return table;
}

export function parseLog(index: string, sources: Map<string, string>): Adr[] {
  const table = findTable(index, 'ADR|Title|Status', 'ADR log');
  const seen = new Set<string>();
  const records = table.children.slice(1).map((row) => {
    const [numberCell, titleCell, statusCell] = row.children;
    const link = numberCell?.children[0];
    if (row.children.length !== 3 || link?.type !== 'link' || !titleCell || !statusCell) {
      throw new Error('Malformed ADR log row');
    }
    const number = toString(link);
    const file = link.url;
    if (!/^\d{4}$/.test(number) || !new RegExp(`^${number}-[a-z0-9-]+\\.md$`).test(file)) {
      throw new Error(`Invalid ADR filename: ${file}`);
    }
    if (seen.has(number)) throw new Error(`Duplicate ADR: ${number}`);
    seen.add(number);
    const source = sources.get(file);
    if (source === undefined) throw new Error(`Missing ADR: ${file}`);
    const { metadata, title: heading, body } = parseDocument(source, file);
    const title = toString(titleCell);
    const status = toString(statusCell);
    if (heading !== title) throw new Error(`ADR title differs from log: ${file}`);
    if (typeof metadata.status !== 'string' || toString(parser.parse(metadata.status)) !== status) {
      throw new Error(`ADR status differs from log: ${file}`);
    }
    return { number, file, title, status, body };
  });
  if (!records.length) throw new Error('ADR log is empty');
  for (const file of sources.keys()) {
    if (!records.some((record) => record.file === file)) throw new Error(`Unlisted ADR: ${file}`);
  }
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

/**
 * Parses the stories index against the story sources. `adrs` maps each ADR number to its
 * filename, so front matter can only reference ADRs that exist.
 */
export function parseStories(
  index: string,
  sources: Map<string, string>,
  adrs: Map<string, string>,
): Story[] {
  const table = findTable(index, 'Story|Title|Status', 'story index');
  const seen = new Set<string>();
  const records = table.children.slice(1).map((row) => {
    const [numberCell, titleCell, statusCell] = row.children;
    const link = numberCell?.children[0];
    if (row.children.length !== 3 || link?.type !== 'link' || !titleCell || !statusCell) {
      throw new Error('Malformed story index row');
    }
    const number = toString(link);
    const file = link.url;
    if (!/^(\d{4}|XXXX)$/.test(number) || !new RegExp(`^${number}-[a-z0-9-]+\\.md$`).test(file)) {
      throw new Error(`Invalid story filename: ${file}`);
    }
    const slug = storySlug(file);
    if (seen.has(slug)) throw new Error(`Duplicate story: ${file}`);
    seen.add(slug);
    const source = sources.get(file);
    if (source === undefined) throw new Error(`Missing story: ${file}`);
    const { metadata, title: heading, body } = parseDocument(source, file);
    const title = toString(titleCell);
    const status = toString(statusCell);
    if (heading !== `${number} ${title}`)
      throw new Error(`Story title differs from index: ${file}`);
    if (metadata.status !== status || !storyStatuses.includes(status)) {
      throw new Error(`Story status differs from index or is unknown: ${file}`);
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
  if (!records.length) throw new Error('Story index is empty');
  for (const file of sources.keys()) {
    if (!records.some((record) => record.file === file)) throw new Error(`Unlisted story: ${file}`);
  }
  return records;
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

/**
 * Rewrites one link in the document at `from`, a repository-relative path. `links` maps
 * repository-relative document paths (ADRs, stories and both indexes) to routes under `base`.
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
  if (/^docs\/(?:decisions|stories)\/(?:\d{4}|XXXX)-.*\.md$/.test(resolved)) {
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
