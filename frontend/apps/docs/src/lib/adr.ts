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

export function parseLog(index: string, sources: Map<string, string>): Adr[] {
  const tree = parser.parse(index);
  let table: Table | undefined;
  visit(tree, 'table', (node) => {
    if (node.children[0]?.children.map((cell) => toString(cell)).join('|') === 'ADR|Title|Status') {
      if (table) throw new Error('Duplicate ADR log table');
      table = node;
    }
  });
  if (!table) throw new Error('Missing ADR log table');
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
    const parsed = matter(source);
    const headings = parser
      .parse(parsed.content)
      .children.filter((node) => node.type === 'heading' && node.depth === 1);
    const heading = headings[0];
    const title = toString(titleCell);
    const status = toString(statusCell);
    if (headings.length !== 1 || !heading || toString(heading) !== title) {
      throw new Error(`ADR title differs from log: ${file}`);
    }
    const metadata: Record<string, unknown> = parsed.data;
    if (typeof metadata.status !== 'string' || toString(parser.parse(metadata.status)) !== status) {
      throw new Error(`ADR status differs from log: ${file}`);
    }
    // Starlight owns the page heading; keep only the canonical article beneath it.
    const end = heading.position?.end.offset;
    const start = heading.position?.start.offset;
    if (start === undefined || end === undefined)
      throw new Error(`Missing title position: ${file}`);
    return {
      number,
      file,
      title,
      status,
      body: parsed.content.slice(0, start) + parsed.content.slice(end),
    };
  });
  if (!records.length) throw new Error('ADR log is empty');
  for (const file of sources.keys()) {
    if (!records.some((record) => record.file === file)) throw new Error(`Unlisted ADR: ${file}`);
  }
  return records;
}

export function deployment(url = 'http://localhost:4321/') {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.search || parsed.hash) {
    throw new Error('DOCS_SITE_URL must be an HTTP(S) URL without query or fragment');
  }
  return { site: parsed.origin, base: `${parsed.pathname.replace(/\/$/, '')}/` };
}

export function rewriteLink(url: string, base: string, files: Set<string>): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) return url;
  const match = /^([^?#]*)(.*)$/.exec(url);
  if (!match) return url;
  const path = match[1] ?? '';
  const suffix = match[2] ?? '';
  if (!path) return url;
  const resolved = posix.normalize(posix.join('docs/decisions', path));
  if (resolved === 'docs/decisions/README.md') return base + suffix;
  const file = posix.basename(resolved);
  if (posix.dirname(resolved) === 'docs/decisions' && files.has(file)) {
    return `${base}adr/${file.slice(0, 4)}/${suffix}`;
  }
  if (/^docs\/decisions\/\d{4}.*\.md$/.test(resolved)) throw new Error(`Broken ADR link: ${url}`);
  if (resolved.startsWith('../') || path.startsWith('/'))
    throw new Error(`Unsupported repository link: ${url}`);
  return `${repository}/blob/main/${resolved}${suffix}`;
}

export function remarkAdrLinks(options: {
  base: string;
  files: Set<string> | (() => Promise<Set<string>>);
}) {
  return async (tree: Root) => {
    const files = typeof options.files === 'function' ? await options.files() : options.files;
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
        node.url = rewriteLink(node.url, options.base, files);
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
