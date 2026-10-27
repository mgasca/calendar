import { describe, expect, it } from 'vitest';
import { deployment, parseLog, rewriteLink } from './adr';
import { readLog } from './adr-loader';
const file = '0001-test.md';
const row = '| [0001](0001-test.md) | Test `code` | proposed |';
const log = `| ADR | Title | Status |\n| --- | --- | --- |\n${row}`;
const source = '---\nstatus: proposed\n---\n# Test `code`\n\n## Context\nBody';
const sources = () => new Map([[file, source]]);

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

describe('deployment links', () => {
  const files = new Set([file]);
  it.each(['/', '/calendar/'])('rewrites ADR and overview links under %s', (base) => {
    expect(rewriteLink(`./${file}#context`, base, files)).toBe(`${base}adr/0001/#context`);
    expect(rewriteLink('README.md', base, files)).toBe(base);
    expect(rewriteLink('../../docs/decisions/0001-test.md?x=1#context', base, files)).toBe(
      `${base}adr/0001/?x=1#context`,
    );
  });
  it('resolves repository-only links, templates and reference definitions', () => {
    expect(rewriteLink('adr-template.md', '/', files)).toBe(
      'https://github.com/mgasca/calendar/blob/main/docs/decisions/adr-template.md',
    );
    expect(rewriteLink('../../.claude/skills/adr-draft/SKILL.md', '/', files)).toContain(
      '/blob/main/.claude/skills/adr-draft/SKILL.md',
    );
  });
  it.each(['https://example.com/x', '#context', 'mailto:hello@example.com'])(
    'preserves %s',
    (link) => {
      expect(rewriteLink(link, '/calendar/', files)).toBe(link);
    },
  );
  it('fails broken ADR references', () => {
    expect(() => rewriteLink('9999-missing.md', '/', files)).toThrow('Broken ADR');
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

it('refreshes known files and rewrites inline/reference images to raw content', async () => {
  const { unified } = await import('unified');
  const { default: remarkParse } = await import('remark-parse');
  const { remarkAdrLinks } = await import('./adr');
  const parser = unified().use(remarkParse);
  const files = new Set<string>();
  const transform = remarkAdrLinks({ base: '/calendar/', files: () => Promise.resolve(files) });
  files.add(file);
  const tree = parser.parse(
    `[ADR](${file})\n\n![Inline](chart.png)\n\n![Reference][chart]\n\n[chart]: chart.png`,
  );
  await transform(tree);
  const serialized = JSON.stringify(tree);
  expect(serialized).toContain('/calendar/adr/0001/');
  const imageUrl =
    'https://raw.githubusercontent.com/mgasca/calendar/main/docs/decisions/chart.png';
  expect(serialized.split(imageUrl).length - 1).toBe(2);
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
