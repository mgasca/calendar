import { describe, expect, it } from 'vitest';
import {
  deployment,
  parseLog,
  parseStories,
  remarkDocLinks,
  rewriteLink,
  storySlug,
  storyStatusCategory,
} from './adr';
import { readdir } from 'node:fs/promises';
import { readDocuments, readLog, storiesDirectory } from './docs-loader';
const file = '0001-test.md';
const row = '| [0001](0001-test.md) | Test `code` | proposed |';
const log = `| ADR | Title | Status |\n| --- | --- | --- |\n${row}`;
const source = '---\nstatus: proposed\n---\n# Test `code`\n\n## Context\nBody';
const sources = () => new Map([[file, source]]);

const storyFile = '0002-test-story.md';
const storyRow = '| [0002](0002-test-story.md) | Test story | implemented |';
const storyIndex = `| Story | Title | Status |\n| --- | --- | --- |\n${storyRow}`;
const storySource = [
  '---',
  'status: implemented',
  'date: 2026-10-28',
  'pr: ["https://github.com/mgasca/calendar/pull/1"]',
  'adrs: ["0001"]',
  '---',
  '# 0002 Test story',
  '',
  '## Story',
  '',
  'Body',
].join('\n');
const adrs = new Map([['0001', file]]);
const storySources = () => new Map([[storyFile, storySource]]);

describe('canonical ADR log', () => {
  it('preserves ordering, includes proposed records and removes duplicate title', () => {
    expect(parseLog(log, sources())).toEqual([
      {
        number: '0001',
        file,
        title: 'Test code',
        status: 'proposed',
        body: '\n\n## Context\nBody',
      },
    ]);
  });
  it.each([
    ['missing table', 'hello', sources()],
    ['duplicate', `${log}\n${row}`, sources()],
    ['missing file', log, new Map<string, string>()],
    ['title mismatch', log.replace('Test `code`', 'Other'), sources()],
    ['status mismatch', log.replace('proposed', 'accepted'), sources()],
    ['unlisted record', log, new Map([...sources(), ['0002-extra.md', source]])],
    ['malformed row', log.replace('[0001](0001-test.md)', '0001'), sources()],
    ['unsafe path', log.replace('(0001-test.md)', '(../0001-test.md)'), sources()],
  ])('rejects %s', (_label, index, files) => {
    expect(() => parseLog(index, files)).toThrow();
  });
  it('reads every repository ADR and index together', async () => {
    const { records } = await readLog();
    expect(records.length).toBeGreaterThanOrEqual(18);
    expect(records[0]?.number).toBe('0000');
  });
});

describe('canonical story index', () => {
  it('keeps index order, front matter and the article beneath the title', () => {
    expect(parseStories(storyIndex, storySources(), adrs)).toEqual([
      {
        number: '0002',
        file: storyFile,
        title: 'Test story',
        status: 'implemented',
        date: '2026-10-28',
        pr: ['https://github.com/mgasca/calendar/pull/1'],
        adrs: ['0001'],
        body: '\n\n## Story\n\nBody',
      },
    ]);
  });
  it('keeps several pull requests in order and defaults to none', () => {
    const urls = [
      'https://github.com/mgasca/calendar/pull/1',
      'https://github.com/mgasca/calendar/pull/2',
    ];
    const several = storySource.replace(/^pr: .*$/m, `pr: ["${urls.join('", "')}"]`);
    expect(parseStories(storyIndex, new Map([[storyFile, several]]), adrs)[0]?.pr).toEqual(urls);
    const none = storySource.replace(/^pr: .*\n/m, '');
    expect(parseStories(storyIndex, new Map([[storyFile, none]]), adrs)[0]?.pr).toEqual([]);
  });
  it('accepts an unnumbered planned story', () => {
    const planned = storySource.replace('implemented', 'planned');
    const index = `| Story | Title | Status |\n| --- | --- | --- |\n| [XXXX](XXXX-test-story.md) | Test story | planned |`;
    const [story] = parseStories(
      index,
      new Map([['XXXX-test-story.md', planned.replace('# 0002', '# XXXX')]]),
      adrs,
    );
    expect(story?.number).toBe('XXXX');
    expect(storySlug('XXXX-test-story.md')).toBe('test-story');
  });
  it.each([
    ['missing table', 'hello', storySources()],
    ['missing file', storyIndex, new Map<string, string>()],
    ['unlisted story', storyIndex, new Map([...storySources(), ['0003-extra.md', storySource]])],
    ['title mismatch', storyIndex.replace('Test story', 'Other'), storySources()],
    ['status mismatch', storyIndex.replace('implemented |', 'planned |'), storySources()],
    ['unknown status', storySource.replace('implemented', 'done'), storySources()],
    ['unquoted ADR number', storySource.replace('"0001"', '0001'), storySources()],
    ['unknown ADR', storySource.replace('"0001"', '"0009"'), storySources()],
    ['bad date', storySource.replace('2026-10-28', 'soon'), storySources()],
    [
      'bad pull request',
      storySource.replace('https://github.com/mgasca/calendar/pull/1', 'x'),
      storySources(),
    ],
    [
      'scalar pull request',
      storySource.replace(
        '["https://github.com/mgasca/calendar/pull/1"]',
        'https://github.com/mgasca/calendar/pull/1',
      ),
      storySources(),
    ],
  ])('rejects %s', (_label, index, files) => {
    expect(() => parseStories(index, files, adrs)).toThrow();
  });
  it('reads every repository story and both indexes together', async () => {
    const { story } = await readDocuments();
    const files = (await readdir(storiesDirectory))
      .filter((name) => /^(\d{4}|XXXX)-.+\.md$/.test(name))
      .sort();
    expect(files.length).toBeGreaterThan(0);
    expect(story.records.map((record) => record.file).sort()).toEqual(files);
    expect(story.records.map((record) => record.number)).toEqual(
      story.records.map((record) => record.file.slice(0, 4)),
    );
  });
});

describe('deployment links', () => {
  const root = '/repo';
  const base = '/calendar/';
  const links = new Map([
    ['docs/decisions/README.md', ''],
    ['docs/decisions/0001-test.md', 'adr/0001/'],
    ['docs/decisions/0003-test.md', 'adr/0003/'],
    ['docs/stories/README.md', 'stories/'],
    ['docs/stories/0002-test-story.md', 'stories/0002/'],
  ]);
  const rewrite = (url: string, from: string, prefix = base) =>
    rewriteLink(url, prefix, links, from);
  it.each(['/', '/calendar/'])('links ADRs, stories and indexes under %s', (prefix) => {
    expect(rewrite(`./${file}#context`, 'docs/decisions/0003-test.md', prefix)).toBe(
      `${prefix}adr/0001/#context`,
    );
    expect(rewrite('README.md', 'docs/decisions/0003-test.md', prefix)).toBe(prefix);
    expect(
      rewrite('../stories/0002-test-story.md#story', 'docs/decisions/0003-test.md', prefix),
    ).toBe(`${prefix}stories/0002/#story`);
    expect(
      rewrite(
        '../../docs/decisions/0001-test.md?x=1#context',
        'docs/decisions/0003-test.md',
        prefix,
      ),
    ).toBe(`${prefix}adr/0001/?x=1#context`);
  });
  it('links stories to ADRs, stories and the stories index', () => {
    const from = 'docs/stories/0002-test-story.md';
    expect(rewrite('../decisions/0001-test.md', from)).toBe(`${base}adr/0001/`);
    expect(rewrite('0002-test-story.md#story', from)).toBe(`${base}stories/0002/#story`);
    expect(rewrite('README.md', from)).toBe(`${base}stories/`);
  });
  it('resolves repository-only links, templates and reference definitions', () => {
    expect(rewrite('adr-template.md', 'docs/decisions/0003-test.md')).toBe(
      'https://github.com/mgasca/calendar/blob/main/docs/decisions/adr-template.md',
    );
    expect(
      rewrite('../../frontend/apps/web/src/App.test.tsx#L214', 'docs/stories/0002-test-story.md'),
    ).toBe('https://github.com/mgasca/calendar/blob/main/frontend/apps/web/src/App.test.tsx#L214');
    expect(
      rewrite('../../.claude/skills/adr-draft/SKILL.md', 'docs/decisions/0003-test.md'),
    ).toContain('/blob/main/.claude/skills/adr-draft/SKILL.md');
  });
  it.each(['https://example.com/x', '#context', 'mailto:hello@example.com'])(
    'preserves %s',
    (link) => {
      expect(rewrite(link, 'docs/stories/0002-test-story.md')).toBe(link);
    },
  );
  it('fails broken ADR and story references', () => {
    expect(() => rewrite('9999-missing.md', 'docs/decisions/0003-test.md')).toThrow(
      'Broken document link',
    );
    expect(() => rewrite('../stories/XXXX-missing.md', 'docs/decisions/0003-test.md')).toThrow(
      'Broken document link',
    );
    expect(() => rewrite('../../../outside.md', 'docs/decisions/0003-test.md')).toThrow(
      'Unsupported repository link',
    );
  });
  it('derives root and project-site paths', () => {
    expect(deployment('https://mgasca.github.io/calendar')).toEqual({
      site: 'https://mgasca.github.io',
      base: '/calendar/',
    });
    expect(deployment('https://docs.example.com')).toEqual({
      site: 'https://docs.example.com',
      base: '/',
    });
    expect(() => deployment('https://docs.example.com/?bad=1')).toThrow();
  });
  it('rewrites links in the document being rendered, using its repository path', async () => {
    const { unified } = await import('unified');
    const { default: remarkParse } = await import('remark-parse');
    const parser = unified().use(remarkParse);
    const transform = remarkDocLinks({
      root,
      base,
      links: () => Promise.resolve(links),
    });
    const tree = parser.parse(
      `[ADR](${file})\n\n![Inline](chart.png)\n\n![Reference][chart]\n\n[chart]: chart.png`,
    );
    await transform(tree, { path: `${root}/docs/decisions/0003-test.md` });
    const serialized = JSON.stringify(tree);
    expect(serialized).toContain(`${base}adr/0001/`);
    const imageUrl =
      'https://raw.githubusercontent.com/mgasca/calendar/main/docs/decisions/chart.png';
    expect(serialized.split(imageUrl).length - 1).toBe(2);
  });
});

it('follows explicit log order and normalizes linked superseded status', () => {
  const status = 'superseded by [ADR-0002](0002-second.md)';
  const index = `| ADR | Title | Status |\n| --- | --- | --- |\n| [0002](0002-second.md) | Second | accepted |\n${row.replace('proposed', status)}`;
  const files = new Map([
    [file, source.replace('proposed', status)],
    ['0002-second.md', '---\nstatus: accepted\n---\n# Second\nBody'],
  ]);
  expect(parseLog(index, files).map(({ number, status: label }) => [number, label])).toEqual([
    ['0002', 'accepted'],
    ['0001', 'superseded by ADR-0002'],
  ]);
});

it.each([
  ['accepted', 'accepted'],
  ['proposed', 'draft'],
  ['draft', 'draft'],
  ['rejected', 'rejected'],
  ['superseded by ADR-0002', 'superseded'],
  ['superceded by ADR-0002', 'superseded'],
  [' Pending ', 'pending'],
  ['unknown', 'pending'],
])('styles %s as %s without changing canonical labels', async (status, category) => {
  const { statusCategory } = await import('./adr');
  expect(statusCategory(status)).toBe(category);
});

it.each([
  ['implemented', 'accepted'],
  ['in-progress', 'draft'],
  ['planned', 'pending'],
])('styles story status %s as %s', (status, category) => {
  expect(storyStatusCategory(status)).toBe(category);
});
