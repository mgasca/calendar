import { describe, expect, it } from 'vitest';
import {
  deployment,
  narrativeStatusCategory,
  parseAgentThoughts,
  parseNarratives,
  parseBenchmarks,
  parseLog,
  parseRunbooks,
  parseStories,
  remarkDocLinks,
  rewriteLink,
  runbookSlug,
  storySlug,
  storyStatusCategory,
} from './adr';
import { readFile } from 'node:fs/promises';
import { storiesDirectory } from './docs-loader';
const file = '0001-test.md';
const source = '---\nstatus: proposed\n---\n# Test `code`\n\n## Context\nBody';
const sources = () => new Map([[file, source]]);

const storyFile = '0002-test-story.md';
const storySource = [
  '---',
  'status: implemented',
  'date: 2026-10-28',
  'issue: https://github.com/mgasca/calendar/issues/7',
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
  it('reads number, title, status and the article beneath the title from the file alone', () => {
    expect(parseLog(sources())).toEqual([
      {
        number: '0001',
        file,
        title: 'Test code',
        status: 'proposed',
        body: '\n\n## Context\nBody',
      },
    ]);
  });
  it('orders by number whatever the order of the sources', () => {
    const files = new Map([
      ['0010-late.md', source.replace('Test `code`', 'Late')],
      [file, source],
      ['0002-middle.md', source.replace('Test `code`', 'Middle')],
    ]);
    expect(parseLog(files).map((record) => record.number)).toEqual(['0001', '0002', '0010']);
  });
  it.each([
    ['no files', new Map<string, string>()],
    ['duplicate number', new Map([...sources(), ['0001-again.md', source]])],
    ['unsafe filename', new Map([['../0001-test.md', source]])],
    ['uppercase filename', new Map([['0001-Test.md', source]])],
    ['missing status', new Map([[file, source.replace('status: proposed\n', '')]])],
    ['empty status', new Map([[file, source.replace('status: proposed', 'status:')]])],
    ['two titles', new Map([[file, `${source}\n# Again\n`]])],
    ['no title', new Map([[file, source.replace('# Test `code`\n', '')]])],
  ])('rejects %s', (_label, files) => {
    expect(() => parseLog(files)).toThrow();
  });
});

describe('canonical story index', () => {
  it('keeps index order, front matter and the article beneath the title', () => {
    expect(parseStories(storySources(), adrs)).toEqual([
      {
        number: '0002',
        file: storyFile,
        title: 'Test story',
        status: 'implemented',
        date: '2026-10-28',
        issue: 'https://github.com/mgasca/calendar/issues/7',
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
    expect(parseStories(new Map([[storyFile, several]]), adrs)[0]?.pr).toEqual(urls);
    const none = storySource.replace(/^pr: .*\n/m, '');
    expect(parseStories(new Map([[storyFile, none]]), adrs)[0]?.pr).toEqual([]);
  });
  it('accepts an unnumbered planned story', () => {
    const planned = storySource.replace('implemented', 'planned');
    const [story] = parseStories(
      new Map([['XXXX-test-story.md', planned.replace('# 0002', '# XXXX')]]),
      adrs,
    );
    expect(story?.number).toBe('XXXX');
    expect(storySlug('XXXX-test-story.md')).toBe('test-story');
  });
  it.each([
    ['implemented', 'unknown'],
    ['"0001"', '0001'],
    ['"0001"', '"0009"'],
    ['2026-10-28', 'soon'],
    ['https://github.com/mgasca/calendar/pull/1', 'x'],
    ['https://github.com/mgasca/calendar/issues/7', 'x'],
  ])('rejects invalid metadata %s', (from, to) => {
    expect(() =>
      parseStories(new Map([[storyFile, storySource.replace(from, to)]]), adrs),
    ).toThrow();
  });
  it('discovers new files without a shared index and sorts them', () => {
    const files = new Map([
      ['0003-extra.md', storySource.replace('# 0002', '# 0003')],
      ...storySources(),
    ]);
    expect(parseStories(files, adrs).map((record) => record.number)).toEqual(['0002', '0003']);
  });
  it('rejects duplicate story numbers', () => {
    expect(() =>
      parseStories(new Map([...storySources(), ['0002-extra.md', storySource]]), adrs),
    ).toThrow();
  });
  it('keeps the story template in the structure that cards follow', async () => {
    // Comments need no stripping: none of their lines starts with a heading marker.
    const text = await readFile(new URL('story-template.md', storiesDirectory), 'utf8');
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    expect(front.split('\n').map((line) => line.split(':')[0])).toEqual([
      'status',
      'date',
      'issue',
      'pr',
      'adrs',
    ]);
    expect(text.match(/^#{2,3} .+$/gm)).toEqual([
      '## Story',
      '## Background',
      '### Agreed scope',
      '### Not in this story',
      '### Acceptance criteria',
      '## Design decisions',
      '### Any Decision Records',
      '### Other decisions (not ADR-worthy)',
      '## Implementation notes',
      '### Where things live',
      '### API',
      '### Testing',
      '### Lessons learned, known issues and follow-ups',
      '## User guide',
      '### The task the user performs',
    ]);
    expect(text).toContain('| ADR | Decision | Why it matters for this story |');
  });
});

describe('deployment links', () => {
  const root = '/repo';
  const base = '/calendar/';
  // The decision log index has no page, so it is absent here and resolves to the repository.
  const links = new Map([
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
    expect(rewrite('README.md', 'docs/decisions/0003-test.md', prefix)).toBe(
      'https://github.com/mgasca/calendar/blob/main/docs/decisions/README.md',
    );
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

it('normalizes a linked superseded status to its text', () => {
  const status = 'superseded by [ADR-0002](0002-second.md)';
  const files = new Map([
    ['0002-second.md', '---\nstatus: accepted\n---\n# Second\nBody'],
    [file, source.replace('proposed', status)],
  ]);
  expect(parseLog(files).map(({ number, status: label }) => [number, label])).toEqual([
    ['0001', 'superseded by ADR-0002'],
    ['0002', 'accepted'],
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

describe('filesystem runbooks', () => {
  const source = '---\norder: 1\n---\n# First\n';
  it('uses per-file operational order', () => {
    expect(
      parseRunbooks(
        new Map([
          ['a.md', source.replace('1', '2')],
          ['z.md', source],
        ]),
      ).map((record) => record.file),
    ).toEqual(['z.md', 'a.md']);
    expect(runbookSlug('first.md')).toBe('first');
  });
  it.each(['0', '-1', '1.5', 'text'])('rejects invalid order %s', (order) => {
    expect(() => parseRunbooks(new Map([['a.md', source.replace('1', order)]]))).toThrow();
  });
  it('rejects duplicate order', () => {
    expect(() =>
      parseRunbooks(
        new Map([
          ['a.md', source],
          ['b.md', source],
        ]),
      ),
    ).toThrow();
  });
});

describe('filesystem benchmarks', () => {
  const source = '---\nsubject: Parsing\nharness: tools/harness.cs\n---\n# 0001 Parse\n';
  it('reads record metadata without an index', () => {
    expect(parseBenchmarks(new Map([['0001-parse.md', source]]))[0]).toMatchObject({
      number: '0001',
      title: 'Parse',
      subject: 'Parsing',
      harness: 'tools/harness.cs',
    });
  });
  it.each(['../harness.cs', '/tmp/harness.cs', 'tools/../harness.cs', 'has spaces'])(
    'rejects unsafe harness %s',
    (harness) => {
      expect(() =>
        parseBenchmarks(new Map([['0001-parse.md', source.replace('tools/harness.cs', harness)]])),
      ).toThrow();
    },
  );
  it('rejects duplicate numbers', () => {
    expect(() =>
      parseBenchmarks(
        new Map([
          ['0001-parse.md', source],
          ['0001-other.md', source],
        ]),
      ),
    ).toThrow();
  });
});

describe('runbook and benchmark links', () => {
  const base = '/calendar/';
  const links = new Map([
    ['docs/decisions/0001-test.md', 'adr/0001/'],
    ['docs/runbooks/README.md', 'runbooks/'],
    ['docs/runbooks/azure-bootstrap.md', 'runbooks/azure-bootstrap/'],
    ['docs/benchmarks/README.md', 'benchmarks/'],
    ['docs/benchmarks/0001-parse.md', 'benchmarks/0001/'],
    ['docs/architecture/pages/components/api.md', 'architecture/components/api/'],
  ]);
  const rewrite = (url: string, from: string) => rewriteLink(url, base, links, from);
  it('routes links between runbooks, benchmarks, their indexes and ADRs', () => {
    const runbook = 'docs/runbooks/azure-database.md';
    expect(rewrite('azure-bootstrap.md#terms', runbook)).toBe(
      `${base}runbooks/azure-bootstrap/#terms`,
    );
    expect(rewrite('README.md', runbook)).toBe(`${base}runbooks/`);
    expect(rewrite('../decisions/0001-test.md', runbook)).toBe(`${base}adr/0001/`);
    expect(rewrite('0001-parse.md', 'docs/benchmarks/README.md')).toBe(`${base}benchmarks/0001/`);
    expect(rewrite('../runbooks/azure-bootstrap.md', 'docs/stories/0008-review.md')).toBe(
      `${base}runbooks/azure-bootstrap/`,
    );
    // Architecture pages render as the model file, so their metadata links start from docs/architecture.
    expect(
      rewrite('../runbooks/azure-bootstrap.md', 'docs/architecture/calendar.architecture.json'),
    ).toBe(`${base}runbooks/azure-bootstrap/`);
  });
  it('fails links to runbooks and benchmark records that are not published', () => {
    expect(() => rewrite('azure-missing.md', 'docs/runbooks/README.md')).toThrow(
      'Broken document link',
    );
    expect(() => rewrite('0002-missing.md', 'docs/benchmarks/README.md')).toThrow(
      'Broken document link',
    );
    expect(() => rewrite('../runbooks/azure-missing.md', 'docs/decisions/0001-test.md')).toThrow(
      'Broken document link',
    );
  });
  it('still sends the harness and other repository files to GitHub', () => {
    expect(
      rewrite(
        '../../frontend/apps/docs/benchmarks/parse.bench.ts',
        'docs/benchmarks/0001-parse.md',
      ),
    ).toBe(
      'https://github.com/mgasca/calendar/blob/main/frontend/apps/docs/benchmarks/parse.bench.ts',
    );
  });
});

describe('filesystem agent thoughts', () => {
  const source =
    '---\ndate: "2026-11-06"\nauthor: Codex\nrevision: "914a6d15"\n---\n# 0001 Purpose\n';
  it('reads provenance without an index and sorts by number', () => {
    const records = parseAgentThoughts(
      new Map([
        ['0002-next.md', source.replace('0001', '0002')],
        ['0001-purpose.md', source],
      ]),
    );
    expect(records.map((record) => record.number)).toEqual(['0001', '0002']);
    expect(records[0]).toMatchObject({ date: '2026-11-06', author: 'Codex', revision: '914a6d15' });
  });
  it.each([
    ['2026-11-06', 'soon'],
    ['Codex', ''],
    ['914a6d15', 'main'],
    ['# 0001', '# 0002'],
  ])('rejects invalid provenance or title %s', (from, to) => {
    expect(() =>
      parseAgentThoughts(new Map([['0001-purpose.md', source.replace(from, to)]])),
    ).toThrow();
  });
});

describe('agent thought links', () => {
  const base = '/calendar/';
  const links = new Map([
    ['docs/agent-thoughts/README.md', 'agent-thoughts/'],
    ['docs/agent-thoughts/0001-purpose.md', 'agent-thoughts/0001/'],
    ['docs/stories/0025-consolidate.md', 'stories/0025/'],
  ]);
  const rewrite = (url: string, from: string) => rewriteLink(url, base, links, from);
  it('routes links between the reports, their index and the other collections', () => {
    expect(rewrite('0001-purpose.md', 'docs/agent-thoughts/README.md')).toBe(
      `${base}agent-thoughts/0001/`,
    );
    expect(rewrite('../stories/0025-consolidate.md', 'docs/agent-thoughts/0001-purpose.md')).toBe(
      `${base}stories/0025/`,
    );
    expect(rewrite('docs/agent-thoughts/0001-purpose.md', 'README.md')).toBe(
      `${base}agent-thoughts/0001/`,
    );
  });
  it('fails links to reports that are not published', () => {
    expect(() => rewrite('0002-missing.md', 'docs/agent-thoughts/README.md')).toThrow(
      'Broken document link',
    );
  });
});

describe('filesystem narratives (ADR-0059)', () => {
  const narrative = [
    '---',
    'system: Calendar',
    'audience: Review board',
    'date: 2026-11-13',
    'status: draft',
    'slides: slides/calendar/',
    '---',
    '<!-- Generated from docs/narratives/calendar/ -->',
    '',
    '# Calendar architecture narrative',
    '',
    '## Act 1: Setup',
  ].join('\n');
  const parse = (text: string, file = 'calendar-narrative.md') =>
    parseNarratives(new Map([[file, text]]));

  it('reads the system, audience, date, status, deck and title, keeping the note before the title', () => {
    const [record] = parse(narrative);
    expect(record).toMatchObject({
      slug: 'calendar',
      file: 'calendar-narrative.md',
      title: 'Calendar architecture narrative',
      system: 'Calendar',
      audience: 'Review board',
      date: '2026-11-13',
      status: 'draft',
      slides: 'slides/calendar/',
    });
    expect(record?.body).toContain('<!-- Generated from docs/narratives/calendar/ -->');
    expect(record?.body).toContain('## Act 1: Setup');
    expect(record?.body).not.toContain('# Calendar architecture narrative');
  });

  it('accepts a quoted date, no deck and an empty collection', () => {
    const [record] = parse(
      narrative.replace('date: 2026-11-13', "date: '2026-11-13'").replace(/^slides:.*\n/m, ''),
    );
    expect(record?.date).toBe('2026-11-13');
    expect(record?.slides).toBeUndefined();
    expect(parseNarratives(new Map())).toEqual([]);
  });

  it('orders narratives by file name', () => {
    const other = narrative
      .replace('system: Calendar', 'system: Ticket kata')
      .replace(/^slides:.*\n/m, '');
    const records = parseNarratives(
      new Map([
        ['ticket-kata-narrative.md', other],
        ['calendar-narrative.md', narrative],
      ]),
    );
    expect(records.map((record) => record.slug)).toEqual(['calendar', 'ticket-kata']);
  });

  it.each([
    ['Calendar-narrative.md'],
    ['calendar.md'],
    ['calendar--x-narrative.md'],
    ['-narrative.md'],
    ['01-setup.md'],
  ])('rejects the file name %s', (file) => {
    expect(() => parse(narrative, file)).toThrow('Invalid narrative filename');
  });

  it.each([
    ['system: Calendar\n', '', 'Missing narrative system'],
    ['system: Calendar', 'system: " "', 'Missing narrative system'],
    ['audience: Review board\n', '', 'Missing narrative audience'],
    ['date: 2026-11-13', 'date: 13/11/2026', 'Narrative date must be YYYY-MM-DD'],
    ['date: 2026-11-13\n', '', 'Narrative date must be YYYY-MM-DD'],
    ['status: draft', 'status: proposed', 'Narrative status must be draft or final'],
    [
      'slides: slides/calendar/',
      'slides: slides/other/',
      'Narrative slides must be slides/calendar/',
    ],
    ['slides: slides/calendar/', 'slides: /slides/calendar/', 'Narrative slides must be'],
    ['slides: slides/calendar/', 'slides: true', 'Narrative slides must be'],
    ['status: draft', 'status: draft\nowner: me', 'Unknown narrative front matter owner'],
    ['## Act 1: Setup', '# Second title', 'Expected one title'],
  ])('rejects %j replaced by %j', (from, to, message) => {
    expect(() => parse(narrative.replace(from, to))).toThrow(message);
  });

  it('rejects two narratives of the same system, ignoring case', () => {
    expect(() =>
      parseNarratives(
        new Map([
          ['calendar-narrative.md', narrative],
          [
            'calendar-app-narrative.md',
            narrative.replace('system: Calendar', 'system: calendar').replace(/^slides:.*\n/m, ''),
          ],
        ]),
      ),
    ).toThrow(
      'Duplicate narrative of Calendar: calendar-app-narrative.md and calendar-narrative.md',
    );
  });

  it.each([
    ['final', 'accepted'],
    ['draft', 'draft'],
  ])('styles narrative status %s as %s', (status, category) => {
    expect(narrativeStatusCategory(status)).toBe(category);
  });
});

describe('narrative links', () => {
  const base = '/calendar/';
  const links = new Map([
    ['docs/narratives/README.md', 'narratives/'],
    ['docs/narratives/calendar-narrative.md', 'narratives/calendar/'],
    ['docs/decisions/0001-test.md', 'adr/0001/'],
  ]);
  const rewrite = (url: string, from: string) => rewriteLink(url, base, links, from);
  it('routes links between the narratives, their index and the other collections', () => {
    expect(rewrite('calendar-narrative.md#act-1', 'docs/narratives/README.md')).toBe(
      `${base}narratives/calendar/#act-1`,
    );
    expect(rewrite('README.md', 'docs/narratives/calendar-narrative.md')).toBe(
      `${base}narratives/`,
    );
    expect(rewrite('../decisions/0001-test.md', 'docs/narratives/calendar-narrative.md')).toBe(
      `${base}adr/0001/`,
    );
    expect(rewrite('../narratives/calendar-narrative.md', 'docs/decisions/0001-test.md')).toBe(
      `${base}narratives/calendar/`,
    );
  });
  it('fails links to unpublished narratives and to Markdown parts', () => {
    for (const url of ['other-narrative.md', 'calendar/01-setup.md', 'calendar/ledger.md']) {
      expect(() => rewrite(url, 'docs/narratives/calendar-narrative.md'), url).toThrow(
        'Broken document link',
      );
    }
    expect(() =>
      rewrite('../narratives/calendar/slides.md', 'docs/decisions/0001-test.md'),
    ).toThrow('Broken document link');
  });
  it('sends a diagram source to GitHub like other repository files', () => {
    expect(rewrite('calendar/context.mmd', 'docs/narratives/calendar-narrative.md')).toBe(
      'https://github.com/mgasca/calendar/blob/main/docs/narratives/calendar/context.mmd',
    );
  });
});
