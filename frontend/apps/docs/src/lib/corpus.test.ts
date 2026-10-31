import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readDocuments, storiesDirectory } from './docs-loader';

// Parsing every ADR and story costs seconds, so load them once for the file. These tests live apart
// from adr.test.ts so Vitest runs them in their own worker, beside the cheap unit tests.
type Documents = Awaited<ReturnType<typeof readDocuments>>;
let documents: Documents;
beforeAll(async () => {
  documents = await readDocuments();
}, 30_000);

const storyFiles = readdirSync(fileURLToPath(storiesDirectory))
  .filter((name) => /^(\d{4}|XXXX)-.+\.md$/.test(name))
  .sort();

const required = [
  '## Story',
  '## Background',
  '## Design decisions',
  '## Implementation notes',
  '## User guide',
];

describe('repository documents', () => {
  it('reads every repository ADR and index together', () => {
    const { records } = documents.adr;
    expect(records.length).toBeGreaterThanOrEqual(18);
    expect(records[0]?.number).toBe('0000');
  });

  it('reads every repository story and both indexes together', () => {
    const { records } = documents.story;
    expect(storyFiles.length).toBeGreaterThan(0);
    expect(records.map((record) => record.file).sort()).toEqual(storyFiles);
    expect(records.map((record) => record.number)).toEqual(
      records.map((record) => record.file.slice(0, 4)),
    );
  });

  it.each(storyFiles)('gives %s the five required sections in order, allowing extras', (file) => {
    const record = documents.story.records.find((candidate) => candidate.file === file);
    expect(record).toBeDefined();
    const body = (record?.body ?? '').replace(/^```[\s\S]*?^```/gm, '');
    const sections = (body.match(/^## .+$/gm) ?? []).filter((heading) =>
      required.includes(heading),
    );
    expect({ file, sections }).toEqual({ file, sections: required });
  });
});
