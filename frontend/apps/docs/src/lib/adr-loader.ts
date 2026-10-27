import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
import type { Loader } from 'astro/loaders';
import { parseLog, repository } from './adr';

export const decisionsDirectory = new URL('../../../../../docs/decisions/', import.meta.url);
export async function readLog() {
  const names = (await readdir(decisionsDirectory)).filter((name) => /^\d{4}-.+\.md$/.test(name));
  const sources = new Map(
    await Promise.all(
      names.map(
        async (name) => [name, await readFile(new URL(name, decisionsDirectory), 'utf8')] as const,
      ),
    ),
  );
  const index = await readFile(new URL('README.md', decisionsDirectory), 'utf8');
  return { index, records: parseLog(index, sources) };
}

export function adrLoader(): Loader {
  return {
    name: 'canonical-adr-log',
    async load(context) {
      const sync = async () => {
        const { index, records } = await readLog();
        context.store.clear();
        const entries = [
          {
            id: 'index',
            title: 'ADR Log',
            body: index.replace(/^# Architecture Decision Records\s*/m, ''),
            file: 'README.md',
            sidebar: { order: -1, label: 'ADR Log', hidden: true },
          },
          ...records.map((record, order) => ({
            id: `adr/${record.number}`,
            title: `${record.number} · ${record.title}`,
            body: `**Status:** ${record.status}\n\n${record.body}`,
            file: record.file,
            sidebar: {
              order,
              label: `${record.number} · ${record.title}`,
              badge: { text: record.status, variant: 'note' },
            },
          })),
        ];
        for (const entry of entries) {
          const data = await context.parseData({
            id: entry.id,
            data: {
              title: entry.title,
              sidebar: entry.sidebar,
              editUrl: `${repository}/edit/main/docs/decisions/${entry.file}`,
            },
          });
          context.store.set({
            id: entry.id,
            data,
            body: entry.body,
            rendered: await context.renderMarkdown(entry.body),
            digest: context.generateDigest(entry),
            filePath: relative(
              fileURLToPath(context.config.root),
              fileURLToPath(new URL(entry.file, decisionsDirectory)),
            ),
          });
        }
      };
      await sync();
      if (context.watcher) {
        const directory = fileURLToPath(decisionsDirectory);
        context.watcher.add(directory);
        let pending = Promise.resolve();
        const reload = (path: string) => {
          if (resolve(path).startsWith(directory)) {
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
