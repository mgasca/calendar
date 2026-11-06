import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  agentThoughtsDirectory,
  readDocuments,
  runbooksDirectory,
  storiesDirectory,
} from './docs-loader';

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

const runbookFiles = readdirSync(fileURLToPath(runbooksDirectory))
  .filter((name) => /^[a-z0-9-]+\.md$/.test(name))
  .sort();

const agentThoughtFiles = readdirSync(fileURLToPath(agentThoughtsDirectory))
  .filter((name) => /^\d{4}-.+\.md$/.test(name))
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

describe('repository runbooks and benchmarks', () => {
  it('reads every runbook in the order of its index, each with a Before you start section', () => {
    const { records } = documents.runbook;
    expect(runbookFiles.length).toBeGreaterThan(0);
    expect(records.map((record) => record.file).sort()).toEqual(runbookFiles);
    expect(records.map((record) => record.file)).toEqual([
      'azure-bootstrap.md',
      'azure-infrastructure.md',
      'azure-database.md',
    ]);
    for (const record of records) {
      expect(record.body, record.file).toMatch(/^## Before you start$/m);
    }
  });

  it('reads every benchmark record with a harness that exists', () => {
    const { records } = documents.benchmark;
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records[0]).toMatchObject({
      number: '0001',
      harness: 'frontend/apps/docs/benchmarks/parse.bench.ts',
    });
    for (const record of records) {
      expect(record.body, record.file).toMatch(/^- \*\*Harness:\*\*/m);
    }
  });
});

describe('repository agent thoughts', () => {
  it('reads every report in number order, each with its date, author and reviewed revision', () => {
    const { records } = documents.agentThought;
    expect(agentThoughtFiles.length).toBeGreaterThan(0);
    // Number order is file order, so the first row is the first report everywhere (story 0031).
    expect(records.map((record) => record.file)).toEqual(agentThoughtFiles);
    for (const record of records) {
      expect(record.file.startsWith(`${record.number}-`), record.file).toBe(true);
      expect(record.date, record.file).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(record.author, record.file).not.toBe('');
      expect(record.revision, record.file).toMatch(/^[0-9a-f]{7,40}$/);
    }
  });
});
