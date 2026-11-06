import { access, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
import type { Loader } from 'astro/loaders';
import type { Adr, Story } from './adr';
import {
  parseAgentThoughts,
  parseBenchmarks,
  parseLog,
  parseRunbooks,
  parseStories,
  repository,
  runbookSlug,
  statusCategory,
  storySlug,
  storyStatusCategory,
} from './adr';
import type { Architecture } from './architecture';
import {
  architectureDirectory,
  architecturePages,
  checkArchitecture,
  mappingFile,
  modelEditUrl,
  modelFile,
  pagePath,
  pageRoute,
  parseArchitecture,
} from './architecture';

const repositoryRoot = new URL('../../../../../', import.meta.url);
export const decisionsDirectory = new URL('docs/decisions/', repositoryRoot);
export const storiesDirectory = new URL('docs/stories/', repositoryRoot);
export const runbooksDirectory = new URL('docs/runbooks/', repositoryRoot);
export const benchmarksDirectory = new URL('docs/benchmarks/', repositoryRoot);
export const agentThoughtsDirectory = new URL('docs/agent-thoughts/', repositoryRoot);
/** The folder under `docs/` behind each Markdown collection, for edit links. */
const folders = new Map([
  [decisionsDirectory.href, 'decisions'],
  [storiesDirectory.href, 'stories'],
  [runbooksDirectory.href, 'runbooks'],
  [benchmarksDirectory.href, 'benchmarks'],
  [agentThoughtsDirectory.href, 'agent-thoughts'],
]);

async function readSources(directory: URL, pattern: RegExp) {
  const names = (await readdir(directory)).filter((name) => pattern.test(name));
  return new Map(
    await Promise.all(
      names.map(async (name) => [name, await readFile(new URL(name, directory), 'utf8')] as const),
    ),
  );
}

export async function readLog() {
  // README.md holds the conventions only; the log itself comes from the files (ADR-0040).
  const sources = await readSources(decisionsDirectory, /^\d{4}-.+\.md$/);
  return { records: parseLog(sources) };
}

export async function readStories(adrs: Map<string, string>) {
  const sources = await readSources(storiesDirectory, /^(\d{4}|XXXX)-.+\.md$/);
  const index = await readFile(new URL('README.md', storiesDirectory), 'utf8');
  return { index, records: parseStories(index, sources, adrs) };
}

/** Reads the runbooks in the order their index gives; `README.md` is the index, not a runbook. */
export async function readRunbooks() {
  const sources = await readSources(runbooksDirectory, /^[a-z0-9-]+\.md$/);
  const index = await readFile(new URL('README.md', runbooksDirectory), 'utf8');
  return { index, records: parseRunbooks(index, sources) };
}

/** Reads the benchmark records; the harness each one names must exist in the repository. */
export async function readBenchmarks() {
  const sources = await readSources(benchmarksDirectory, /^\d{4}-.+\.md$/);
  const index = await readFile(new URL('README.md', benchmarksDirectory), 'utf8');
  const records = parseBenchmarks(index, sources);
  for (const record of records) {
    try {
      await access(new URL(record.harness, repositoryRoot));
    } catch {
      throw new Error(`Benchmark harness not found: ${record.harness} (${record.file})`);
    }
  }
  return { index, records };
}

/** Reads the agent thoughts in index order, which is number order; there is no template (story 0031). */
export async function readAgentThoughts() {
  const sources = await readSources(agentThoughtsDirectory, /^\d{4}-.+\.md$/);
  const index = await readFile(new URL('README.md', agentThoughtsDirectory), 'utf8');
  return { index, records: parseAgentThoughts(index, sources) };
}

/**
 * Reads the CALM model (ADR-0039) and checks its references against the decision log and the
 * stories. `url-mapping.json` must map every control requirement URL to a schema that exists.
 */
export async function readArchitecture(adrs: Adr[], stories: Story[]): Promise<Architecture> {
  const source = await readFile(new URL(modelFile, architectureDirectory), 'utf8');
  const mapping: unknown = JSON.parse(
    await readFile(new URL(mappingFile, architectureDirectory), 'utf8'),
  );
  if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) {
    throw new Error(`${mappingFile} must be an object`);
  }
  const mappedUrls = new Set<string>();
  for (const [url, path] of Object.entries(mapping as Record<string, unknown>)) {
    if (typeof path !== 'string') throw new Error(`${mappingFile}: ${url} must map to a path`);
    await access(new URL(path, architectureDirectory));
    mappedUrls.add(url);
  }
  const architecture = parseArchitecture(source);
  checkArchitecture(architecture, { adrs, stories, mappedUrls });
  return architecture;
}

/** Reads and validates all collections together, since stories and the model reference ADR numbers. */
export async function readDocuments() {
  const adr = await readLog();
  const story = await readStories(
    new Map(adr.records.map((record) => [record.number, record.file])),
  );
  const architecture = await readArchitecture(adr.records, story.records);
  const runbook = await readRunbooks();
  const benchmark = await readBenchmarks();
  const agentThought = await readAgentThoughts();
  return { adr, story, architecture, runbook, benchmark, agentThought };
}

type Documents = Awaited<ReturnType<typeof readDocuments>>;

/**
 * The route map the remark plugin reads, computed once per corpus read. The loader primes it from
 * its own read on every sync, so a build or `astro check` reads the corpus once, not once per
 * rendered document (#273); any other caller before the first sync computes it once.
 */
let routes: Promise<Map<string, string>> | undefined;

/**
 * Maps every published document, by repository-relative path, to its route under the site base.
 * The remark plugin uses this to turn links between documents and indexes into site routes.
 */
export function documentRoutes(): Promise<Map<string, string>> {
  routes ??= readDocuments().then(routesOf);
  return routes;
}

/** Forgets the cached route map, so the next `documentRoutes()` reads the corpus again. */
export function resetDocumentRoutes() {
  routes = undefined;
}

function routesOf({ adr, story, architecture, runbook, benchmark, agentThought }: Documents) {
  // The decision log index has no page of its own: the sidebar lists every ADR with its status,
  // so a link to docs/decisions/README.md goes to the repository.
  const routes = new Map([
    ['docs/stories/README.md', 'stories/'],
    ['docs/runbooks/README.md', 'runbooks/'],
    ['docs/benchmarks/README.md', 'benchmarks/'],
    ['docs/agent-thoughts/README.md', 'agent-thoughts/'],
  ]);
  for (const record of adr.records)
    routes.set(`docs/decisions/${record.file}`, `adr/${record.number}/`);
  for (const record of story.records) {
    routes.set(`docs/stories/${record.file}`, `stories/${storySlug(record.file)}/`);
  }
  for (const record of runbook.records) {
    routes.set(`docs/runbooks/${record.file}`, `runbooks/${runbookSlug(record.file)}/`);
  }
  for (const record of benchmark.records) {
    routes.set(`docs/benchmarks/${record.file}`, `benchmarks/${record.number}/`);
  }
  for (const record of agentThought.records) {
    routes.set(`docs/agent-thoughts/${record.file}`, `agent-thoughts/${record.number}/`);
  }
  for (const page of architecturePages(architecture, { stories: story.records })) {
    routes.set(pagePath(page.id), pageRoute(page.id));
  }
  return routes;
}

/** Links an ADR from a story; parseStories has already rejected numbers without a record. */
function adrLink(number: string, adrFiles: Map<string, string>) {
  const file = adrFiles.get(number);
  if (file === undefined) throw new Error(`Unknown ADR: ${number}`);
  return `[ADR-${number}](../decisions/${file})`;
}

/** Where a page's "Edit page" link points: the model for architecture pages, else the Markdown file. */
function editUrl(directory: URL, file: string) {
  if (directory === architectureDirectory) return modelEditUrl;
  const folder = folders.get(directory.href);
  if (folder === undefined) throw new Error(`Unknown document directory: ${directory.href}`);
  return `${repository}/edit/main/docs/${folder}/${file}`;
}

export function docsLoader(): Loader {
  return {
    name: 'canonical-docs',
    async load(context) {
      const sync = async () => {
        const documents = await readDocuments();
        const { adr, story, architecture, runbook, benchmark, agentThought } = documents;
        // One read serves the entries below and every link the remark plugin rewrites in them.
        routes = Promise.resolve(routesOf(documents));
        const adrFiles = new Map(adr.records.map((record) => [record.number, record.file]));
        context.store.clear();
        const entries = [
          ...adr.records.map((record, order) => ({
            id: `adr/${record.number}`,
            title: `${record.number} · ${record.title}`,
            body: `**Status:** ${record.status}\n\n${record.body}`,
            directory: decisionsDirectory,
            file: record.file,
            sidebar: {
              order,
              label: record.title,
              attrs: {
                'data-doc-number': record.number,
                'aria-label': `${record.number} · ${record.status} · ${record.title}`,
              },
              badge: {
                text: record.status,
                class: `adr-status adr-status-${statusCategory(record.status)}`,
              },
            },
          })),
          {
            id: 'stories',
            title: 'User stories',
            body: story.index.replace(/^# Stories\s*/m, ''),
            directory: storiesDirectory,
            file: 'README.md',
            sidebar: { order: -1, label: 'User stories', hidden: true },
          },
          ...story.records.map((record, order) => ({
            id: `stories/${storySlug(record.file)}`,
            title: `${record.number} · ${record.title}`,
            // Relative ADR links resolve from docs/stories, like the story's own links.
            body: [
              [
                `**Status:** ${record.status}`,
                `**Date:** ${record.date}`,
                record.issue
                  ? `[Issue #${record.issue.slice(record.issue.lastIndexOf('/') + 1)}](${record.issue})`
                  : '',
                ...record.pr.map((url) => `[PR #${url.slice(url.lastIndexOf('/') + 1)}](${url})`),
              ]
                .filter(Boolean)
                .join(' · '),
              record.adrs.length
                ? `**ADRs:** ${record.adrs.map((number) => adrLink(number, adrFiles)).join(' · ')}`
                : '',
              record.body,
            ]
              .filter(Boolean)
              .join('\n\n'),
            directory: storiesDirectory,
            file: record.file,
            sidebar: {
              order,
              label: record.title,
              attrs: {
                'data-doc-number': record.number,
                'aria-label': `${record.number} · ${record.status} · ${record.title}`,
              },
              badge: {
                text: record.status,
                class: `adr-status adr-status-${storyStatusCategory(record.status)}`,
              },
            },
          })),
          // Architecture pages are rendered from the model; links in them resolve from its directory.
          ...architecturePages(architecture, { stories: story.records }).map((page) => ({
            id: page.id,
            title: page.title,
            body: page.body,
            directory: architectureDirectory,
            file: modelFile,
            sidebar: page.sidebar,
          })),
          {
            id: 'agent-thoughts',
            title: 'Agent thoughts',
            body: agentThought.index.replace(/^# Agent thoughts\s*/m, ''),
            directory: agentThoughtsDirectory,
            file: 'README.md',
            sidebar: { order: -1, label: 'Agent thoughts', hidden: true },
          },
          // Each report opens with what the index records about it: when, by whom, of which revision.
          ...agentThought.records.map((record, order) => ({
            id: `agent-thoughts/${record.number}`,
            title: `${record.number} · ${record.title}`,
            body: [
              [
                `**Date:** ${record.date}`,
                `**Author:** ${record.author}`,
                `**Reviewed revision:** [\`${record.revision}\`](${repository}/tree/${record.revision})`,
              ].join(' · '),
              record.body,
            ].join('\n\n'),
            directory: agentThoughtsDirectory,
            file: record.file,
            sidebar: {
              order,
              label: record.title,
              attrs: {
                'data-doc-number': record.number,
                'aria-label': `${record.number} · ${record.title}`,
              },
            },
          })),
          {
            id: 'runbooks',
            title: 'Runbooks',
            body: runbook.index.replace(/^# Runbooks\s*/m, ''),
            directory: runbooksDirectory,
            file: 'README.md',
            sidebar: { order: -1, label: 'Runbooks', hidden: true },
          },
          // Runbooks keep the order of their index, which is the order to follow them in.
          ...runbook.records.map((record, order) => ({
            id: `runbooks/${runbookSlug(record.file)}`,
            title: record.title,
            body: record.body,
            directory: runbooksDirectory,
            file: record.file,
            sidebar: { order, label: record.title },
          })),
          {
            id: 'benchmarks',
            title: 'Benchmarks',
            body: benchmark.index.replace(/^# Benchmarks\s*/m, ''),
            directory: benchmarksDirectory,
            file: 'README.md',
            sidebar: { order: -1, label: 'Benchmarks', hidden: true },
          },
          ...benchmark.records.map((record, order) => ({
            id: `benchmarks/${record.number}`,
            title: `${record.number} · ${record.title}`,
            body: `**Subject:** ${record.subject}\n\n${record.body}`,
            directory: benchmarksDirectory,
            file: record.file,
            sidebar: {
              order,
              label: record.title,
              attrs: {
                'data-doc-number': record.number,
                'aria-label': `${record.number} · ${record.title}`,
              },
            },
          })),
        ];
        for (const entry of entries) {
          const data = await context.parseData({
            id: entry.id,
            data: {
              title: entry.title,
              sidebar: entry.sidebar,
              editUrl: editUrl(entry.directory, entry.file),
            },
          });
          const fileURL = new URL(entry.file, entry.directory);
          context.store.set({
            id: entry.id,
            data,
            body: entry.body,
            rendered: await context.renderMarkdown(entry.body, { fileURL }),
            digest: context.generateDigest(entry),
            filePath: relative(fileURLToPath(context.config.root), fileURLToPath(fileURL)),
          });
        }
      };
      await sync();
      if (context.watcher) {
        const directories = [
          decisionsDirectory,
          storiesDirectory,
          architectureDirectory,
          runbooksDirectory,
          benchmarksDirectory,
          agentThoughtsDirectory,
        ].map((url) => fileURLToPath(url));
        for (const directory of directories) context.watcher.add(directory);
        let pending = Promise.resolve();
        const reload = (path: string) => {
          if (directories.some((directory) => resolve(path).startsWith(directory))) {
            pending = pending.then(sync).catch((error: unknown) => {
              context.logger.error(error instanceof Error ? error.message : String(error));
            });
          }
        };
        context.watcher.on('change', reload).on('add', reload).on('unlink', reload);
      }
    },
  };
}
