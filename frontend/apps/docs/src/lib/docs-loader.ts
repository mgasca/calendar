import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
import type { Loader } from 'astro/loaders';
import {
  parseLog,
  parseStories,
  repository,
  statusCategory,
  storySlug,
  storyStatusCategory,
} from './adr';

export const decisionsDirectory = new URL('../../../../../docs/decisions/', import.meta.url);
export const storiesDirectory = new URL('../../../../../docs/stories/', import.meta.url);

async function readSources(directory: URL, pattern: RegExp) {
  const names = (await readdir(directory)).filter((name) => pattern.test(name));
  return new Map(
    await Promise.all(
      names.map(async (name) => [name, await readFile(new URL(name, directory), 'utf8')] as const),
    ),
  );
}

export async function readLog() {
  const sources = await readSources(decisionsDirectory, /^\d{4}-.+\.md$/);
  const index = await readFile(new URL('README.md', decisionsDirectory), 'utf8');
  return { index, records: parseLog(index, sources) };
}

export async function readStories(adrs: Map<string, string>) {
  const sources = await readSources(storiesDirectory, /^(\d{4}|XXXX)-.+\.md$/);
  const index = await readFile(new URL('README.md', storiesDirectory), 'utf8');
  return { index, records: parseStories(index, sources, adrs) };
}

/** Reads and validates both collections together, since stories reference ADR numbers. */
export async function readDocuments() {
  const adr = await readLog();
  const story = await readStories(
    new Map(adr.records.map((record) => [record.number, record.file])),
  );
  return { adr, story };
}

/**
 * Maps every published document, by repository-relative path, to its route under the site base.
 * The remark plugin uses this to turn links between ADRs, stories and indexes into site routes.
 */
export async function documentRoutes() {
  const { adr, story } = await readDocuments();
  const routes = new Map([
    ['docs/decisions/README.md', ''],
    ['docs/stories/README.md', 'stories/'],
  ]);
  for (const record of adr.records)
    routes.set(`docs/decisions/${record.file}`, `adr/${record.number}/`);
  for (const record of story.records) {
    routes.set(`docs/stories/${record.file}`, `stories/${storySlug(record.file)}/`);
  }
  return routes;
}

/** Links an ADR from a story; parseStories has already rejected numbers without a record. */
function adrLink(number: string, adrFiles: Map<string, string>) {
  const file = adrFiles.get(number);
  if (file === undefined) throw new Error(`Unknown ADR: ${number}`);
  return `[ADR-${number}](../decisions/${file})`;
}

export function docsLoader(): Loader {
  return {
    name: 'canonical-docs',
    async load(context) {
      const sync = async () => {
        const { adr, story } = await readDocuments();
        const adrFiles = new Map(adr.records.map((record) => [record.number, record.file]));
        context.store.clear();
        const entries = [
          {
            id: 'index',
            title: 'ADR Log',
            body: adr.index.replace(/^# Architecture Decision Records\s*/m, ''),
            directory: decisionsDirectory,
            file: 'README.md',
            sidebar: { order: -1, label: 'ADR Log', hidden: true },
          },
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
        ];
        for (const entry of entries) {
          const isStory = entry.directory === storiesDirectory;
          const data = await context.parseData({
            id: entry.id,
            data: {
              title: entry.title,
              sidebar: entry.sidebar,
              editUrl: `${repository}/edit/main/docs/${isStory ? 'stories' : 'decisions'}/${entry.file}`,
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
        const directories = [decisionsDirectory, storiesDirectory].map((url) => fileURLToPath(url));
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
