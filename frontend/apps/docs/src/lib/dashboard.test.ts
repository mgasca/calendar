import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  dashboardEntries,
  dashboardId,
  dashboardPages,
  dashboardSidebar,
  escapeText,
  formatDuration,
  formatSeconds,
  history,
  parseSnapshot,
  readDashboardData,
  SnapshotError,
  type DashboardData,
} from './dashboard';

// The same files the .NET rules test (tools/delivery-dashboard/tests) reads, so the two readers
// cannot drift apart on a valid snapshot.
const validDirectory = new URL('./fixtures/dashboard/valid/snapshots/', import.meta.url);

async function validFiles() {
  return (await readdir(validDirectory)).filter((name) => name.endsWith('.json')).sort();
}

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A snapshots folder holding the given files (name to text). */
async function folder(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-'));
  temporary.push(root);
  const snapshots = join(root, 'snapshots');
  await mkdir(snapshots);
  for (const [name, text] of Object.entries(files)) await writeFile(join(snapshots, name), text);
  return pathToFileURL(`${snapshots}/`);
}

async function validText(name: string) {
  return readFile(new URL(name, validDirectory), 'utf8');
}

async function present(): Promise<DashboardData> {
  return readDashboardData(validDirectory);
}

function render(slug: string, data: DashboardData) {
  const page = dashboardPages.find((candidate) => candidate.slug === slug);
  if (!page) throw new Error(`No dashboard page ${slug}`);
  return page.render(data);
}

describe('reading snapshots', () => {
  it('reads every valid fixture, oldest first, and shows a version 1 file without the new sections', async () => {
    const data = await present();
    expect(data.state).toBe('present');
    if (data.state !== 'present') return;
    expect(data.snapshots.map((snapshot) => `${snapshot.date}.json`)).toEqual(await validFiles());
    expect(data.snapshots.map((snapshot) => snapshot.version)).toContain(1);
    expect(data.snapshots.map((snapshot) => snapshot.version)).toContain(2);
    const old = data.snapshots[0];
    expect(old?.ci.trend).toBeNull();
    expect(old?.ci.queue).toBeNull();
    expect(old?.ci.jobs.every((job) => job.baseline === null && job.trend === null)).toBe(true);
  });

  it('is "no snapshot yet" when the folder does not exist or holds no snapshot', async () => {
    expect(
      await readDashboardData(pathToFileURL(join(tmpdir(), 'no-such-dashboard-folder/'))),
    ).toEqual({
      state: 'absent',
    });
    expect(await readDashboardData(await folder({}))).toEqual({ state: 'absent' });
  });

  const text = '2026-11-09.json';
  const broken: [string, (valid: string) => string, string][] = [
    ['text that is not JSON', () => '{ not json', 'not valid JSON'],
    [
      'a missing field',
      (valid) => valid.replace('"basis": "measured",', ''),
      '$.ci.basis: field is missing',
    ],
    [
      'a field outside the schema',
      (valid) => valid.replace('"repository"', '"author": "x", "repository"'),
      '$.author: field is not in the schema',
    ],
    [
      'a machine path',
      (valid) => valid.replace('"Frontend"', '"/home/someone/dev"'),
      'looks like a machine path',
    ],
    [
      'a session handle',
      (valid) => valid.replace('"Frontend"', '"session_1a2b3c4d"'),
      'looks like a session or task handle',
    ],
    [
      'an unknown version',
      (valid) => valid.replace('"version": 3', '"version": 9'),
      '$.version: must be 1 to 3',
    ],
    [
      'a bad verdict',
      (valid) => valid.replace('"slower"', '"awful"'),
      '$.ci.jobs[0].trend.verdict: must be one of',
    ],
    [
      'seconds out of order',
      (valid) => valid.replace('"minSeconds": 64', '"minSeconds": 999'),
      'minSeconds <= medianSeconds',
    ],
  ];
  it.each(broken)(
    'fails the build, naming the file and the rule, for %s',
    async (_name, mutate, rule) => {
      const directory = await folder({ [text]: mutate(await validText(text)) });
      const failure = await readDashboardData(directory).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SnapshotError);
      expect((failure as Error).message).toContain(text);
      expect((failure as Error).message).toContain(rule);
    },
  );

  it('accepts the optional sections that other slices add, and still scans their strings', async () => {
    const valid = await validText('2026-11-08.json');
    expect(parseSnapshot('x.json', valid).date).toBe('2026-11-08');
    const leaking = valid.replace('"scopes"', '"/home/someone"');
    expect(leaking).not.toBe(valid);
    expect(() => parseSnapshot('x.json', leaking)).toThrow('looks like a machine path');
    // The fixture carries the sections, so a duplicate key would not replace them: set the field on the parsed object.
    for (const key of ['agents', 'quality']) {
      const scalar = JSON.stringify({ ...JSON.parse(valid), [key]: 3 });
      expect(() => parseSnapshot('x.json', scalar)).toThrow(`$.${key}: must be an object`);
    }
  });

  it('fails when version 2 lacks the version 2 fields', () => {
    const valid = JSON.parse(
      '{"version":2,"date":"2026-11-09","generatedAt":"2026-11-09T06:47:05Z","repository":"a/b",' +
        '"ci":{"workflow":"ci.yml","basis":"measured","runs":0,"window":null,"jobs":[]}}',
    ) as unknown;
    expect(() => parseSnapshot('x.json', JSON.stringify(valid))).toThrow(
      '$.ci.trend: field is missing',
    );
  });

  it('fails on a file whose date differs from its name, and on a stray file', async () => {
    const wrongName = await folder({ '2026-11-10.json': await validText(text) });
    await expect(readDashboardData(wrongName)).rejects.toThrow(
      /2026-11-10\.json.*does not match the file name/s,
    );
    const stray = await folder({ 'notes.txt': 'hello' });
    await expect(readDashboardData(stray)).rejects.toThrow(/notes\.txt.*unexpected file/s);
  });
});

describe('escaping', () => {
  it('turns markup, links and extra columns in a job name into plain text', () => {
    const escaped = escapeText('a | b <script>x</script> [l](http://e) `c` *d* _e_ & "q"');
    expect(escaped).not.toMatch(/<script>/i);
    expect(escaped).not.toMatch(/(?<!\\)\|/);
    expect(escaped).not.toMatch(/(?<!\\)[`*_[\]]/);
    expect(escaped).toContain('&lt;script&gt;');
    expect(escaped).toContain('&amp;');
  });

  it('prints the hostile job name of the fixture inside one table cell and no HTML', async () => {
    const body = render('ci-speed', await present());
    expect(body).toContain('&lt;b&gt;site&lt;/b&gt;');
    expect(body).not.toContain('<b>');
    const rows = body.split('\n').filter((line) => line.includes('&lt;b&gt;site'));
    expect(rows.length).toBeGreaterThan(0);
    const cells = (row: string) => row.split(/(?<!\\)\|/).length;
    const backend = body.split('\n').find((line) => line.startsWith('| Backend |')) ?? '';
    expect(cells(rows[0] ?? '')).toBe(cells(backend));
  });
});

describe('the CI-speed page', () => {
  it('shows each job with count, min, median, p90, max, baseline, threshold and verdict from the latest snapshot', async () => {
    const body = render('ci-speed', await present());
    expect(body).toContain('Snapshot of 2026-11-09');
    expect(body).toContain('**measured**');
    const backend = body.split('\n').find((line) => line.startsWith('| Backend |')) ?? '';
    for (const part of [
      'check',
      '30',
      '64 s',
      '118 s',
      '2 min 11 s',
      '2 min 20 s',
      '81 s (30 runs)',
      '2 min 6 s',
      'slower',
    ])
      expect(backend).toContain(part);
    expect(backend).toContain('+36.5 s');
  });

  it('marks a job with too few recent runs inconclusive and a job without a baseline as such', async () => {
    const body = render('ci-speed', await present());
    expect(body).toContain('inconclusive</span> | 8 of 20 recent runs needed');
    const older = await readDashboardData(
      await folder({ '2026-11-07.json': await validText('2026-11-07.json') }),
    );
    expect(render('ci-speed', older)).toContain('no baseline pinned');
    expect(render('ci-speed', older)).toContain('no trend section');
  });

  it('gives the queue time with its sample and window', async () => {
    const body = render('ci-speed', await present());
    expect(body).toContain('29 of the 30 sampled runs');
    expect(body).toContain('2026-11-07 09:00 UTC to 2026-11-09 05:30 UTC');
  });

  it('draws the history from the daily files and needs two snapshots for it', async () => {
    const body = render('ci-speed', await present());
    expect(body).toContain('class="dashboard-spark"');
    const data = await readDashboardData(
      await folder({ '2026-11-09.json': await validText('2026-11-09.json') }),
    );
    expect(render('ci-speed', data)).toContain('a history needs at least two');
    if ((await present()).state === 'present') {
      const all = await present();
      if (all.state === 'present') {
        const backend = history(all.snapshots).find((series) => series.job === 'Backend');
        expect(backend?.dates).toEqual(['2026-11-07', '2026-11-08', '2026-11-09']);
        expect(backend?.medians).toEqual([81, 82, 118]);
      }
    }
  });

  it('says that no snapshot exists yet instead of an empty page or a failure', () => {
    const body = render('ci-speed', { state: 'absent' });
    expect(body).toContain('No snapshot yet');
    expect(body).toContain('dashboard-data');
    expect(render('', { state: 'absent' })).toContain('No snapshot yet');
  });
});

describe('the quality page', () => {
  /** The latest valid fixture with the value at a dotted path of its quality section replaced. */
  async function withQuality(path: string, value: unknown) {
    const json = JSON.parse(await validText('2026-11-09.json')) as { quality: unknown };
    const keys = path.split('.');
    const last = keys.pop() ?? '';
    let target: unknown = json.quality;
    for (const key of keys) target = (target as Record<string, unknown>)[key];
    (target as Record<string, unknown>)[last] = value;
    return JSON.stringify(json);
  }

  it('shows run classes, failure rates with intervals and links to the public runs, marked measured or inferred', async () => {
    const page = render('quality', await present());
    expect(page).toContain('## Pushes to `main`');
    expect(page).toContain('## Pull requests');
    expect(page).toContain('**measured**');
    expect(page).toContain('**inferred**');
    expect(page).toContain('| Passed after a rerun |');
    expect(page).toContain('not failures');
    expect(page).toContain('CI result (required check)');
    expect(page).toMatch(/\d+\.\d %/);
    expect(page).toContain('95.0 % interval');
    expect(page).toContain(
      'https://github.com/mgasca/calendar/actions/workflows/ci.yml?query=branch%3Amain%20event%3Apush%20is%3Afailure',
    );
    expect(page).toContain('https://github.com/mgasca/calendar/actions/runs/42620951160');
  });

  it('marks a job with too few trials inconclusive and shows no rate for it', async () => {
    const page = render('quality', await present());
    const row = page.split('\n').find((line) => line.startsWith('| ADR conventions'));
    expect(row).toContain('inconclusive');
    expect(row).toContain('| none | none |');
    expect(row).not.toMatch(/\d %/);
  });

  it('says that the guard numbers are inferred, from the step they share with the other tool tests', async () => {
    const page = render('quality', await present());
    expect(page).toContain('## Delivery guards over time');
    expect(page).toContain('Test and lint tooling');
    expect(page).toContain('not necessarily a guard');
  });

  it('draws a history from the snapshots that have a quality section and needs two', async () => {
    const page = render('quality', await present());
    expect(page).toContain('## History');
    expect(page).toContain('| 2026-11-08 |');
    const single = await folder({ '2026-11-09.json': await validText('2026-11-09.json') });
    expect(render('quality', await readDashboardData(single))).toContain(
      'a history needs at least two',
    );
  });

  it('says so when the latest snapshot has no quality section, and when there is no snapshot', async () => {
    const old = await folder({ '2026-11-07.json': await validText('2026-11-07.json') });
    expect(render('quality', await readDashboardData(old))).toContain('has no quality section');
    expect(render('quality', { state: 'absent' })).toContain('No snapshot yet');
  });

  it('escapes a job name and prints no HTML from it', async () => {
    const text = await withQuality('scopes.0.jobs.0.job', '<img src=x onerror=alert(1)> | **x**');
    const page = render('quality', {
      state: 'present',
      snapshots: [parseSnapshot('2026-11-09.json', text)],
    });
    expect(page).not.toContain('<img');
    expect(page).toContain('&lt;img');
  });

  it.each([
    [
      'a rate on an inconclusive row',
      'scopes.0.jobs.0.rate',
      0,
      'inconclusive row must carry no rate',
    ],
    [
      'a verdict that disagrees with the trials',
      'scopes.0.jobs.1.verdict',
      'inconclusive',
      'verdict: must be conclusive',
    ],
    [
      'a total that is not the sum',
      'scopes.0.runs.total',
      99,
      'must equal the sum of the run classes',
    ],
    ['a field outside the schema', 'scopes.0.author', 'x', 'author: field is not in the schema'],
    [
      'a machine path in a job name',
      'scopes.0.jobs.0.job',
      '/home/someone/dev',
      'looks like a machine path',
    ],
    ['a search that is not an Actions search', 'scopes.0.listQuery', 'x" onclick="y', 'listQuery'],
    ['an interval that excludes the rate', 'scopes.0.jobs.1.low', 0.9, 'low <= rate <= high'],
  ])('fails the build for %s', async (_name, path, value, rule) => {
    const text = await withQuality(path, value);
    expect(() => parseSnapshot('2026-11-09.json', text)).toThrow(rule);
  });
});

describe('the agent activity page', () => {
  /** The latest valid fixture with the value at a dotted path of its agents section replaced. */
  async function withAgents(path: string, value: unknown) {
    const json = JSON.parse(await validText('2026-11-09.json')) as { agents: unknown };
    const keys = path.split('.');
    const last = keys.pop() ?? '';
    let target: unknown = json.agents;
    for (const key of keys) target = (target as Record<string, unknown>)[key];
    (target as Record<string, unknown>)[last] = value;
    return JSON.stringify(json);
  }

  it('states that these are proxies, not token or money cost, and what is not covered', async () => {
    const page = render('agents', await present());
    expect(page).toContain('Proxies, not cost');
    expect(page).toContain('not token or money cost');
    expect(page).toContain('older issues are not covered');
    expect(page).toContain('**Measured:**');
    expect(page).toContain('**Inferred:**');
  });

  it('shows issues by number with links, and an issue without count comments as having no cost data', async () => {
    const page = render('agents', await present());
    expect(page).toContain('[#601](https://github.com/mgasca/calendar/issues/601)');
    const row = page.split('\n').find((line) => line.startsWith('| [#601]'));
    expect(row).toContain('no cost data');
    expect(row).toContain('| – | – |');
    const counted = page.split('\n').find((line) => line.startsWith('| [#598]'));
    expect(counted).toContain('| 2 | 3 | 5 |');
  });

  it('shows the totals and a history from the snapshots that have the section', async () => {
    const page = render('agents', await present());
    expect(page).toContain('| Tasks started | 6 | inferred |');
    expect(page).toContain('## History');
    expect(page).toContain('| 2026-11-08 |');
    const single = await folder({ '2026-11-09.json': await validText('2026-11-09.json') });
    expect(render('agents', await readDashboardData(single))).toContain(
      'a history needs at least two',
    );
  });

  it('prints no login, title or comment text: the page shows numbers and links only', async () => {
    const page = render('agents', await present());
    expect(page).not.toMatch(/author|login|@[a-z]/i);
  });

  it('says so when the latest snapshot has no agent section, and when there is no snapshot', async () => {
    const old = await folder({ '2026-11-07.json': await validText('2026-11-07.json') });
    expect(render('agents', await readDashboardData(old))).toContain('has no agent section');
    expect(render('agents', { state: 'absent' })).toContain('No snapshot yet');
  });

  it.each([
    [
      'a total that is not the sum',
      'activity.comments',
      999,
      'must equal the sum over the listed issues',
    ],
    ['tasks without a count comment', 'issues.0.tasks', 4, 'must be null without a count comment'],
    ['a field outside the schema', 'issues.0.author', 'x', 'author: field is not in the schema'],
    ['a machine path in a field name', 'issues.0./home/someone', 1, 'looks like a machine path'],
    ['a bad basis', 'basis.counts', 'exact', 'basis.counts: must be one of'],
    ['more listed issues than scanned', 'sample.scanned', 1, 'cannot hold more issues'],
    ['an issue listed twice', 'issues.1.issue', 601, 'must be listed once'],
  ])('fails the build for %s', async (_name, path, value, rule) => {
    const text = await withAgents(path, value);
    expect(() => parseSnapshot('2026-11-09.json', text)).toThrow(rule);
  });
});

describe('the pages and the sidebar', () => {
  it('derives the sidebar from the page list, one entry per page', () => {
    const entries = dashboardEntries({ state: 'absent' });
    expect(entries.map((entry) => entry.id)).toEqual(dashboardPages.map(dashboardId));
    expect(dashboardSidebar().map((item) => item.slug)).toEqual(entries.map((entry) => entry.id));
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  });

  it('lists every other page on the overview', async () => {
    const overview = render('', await present());
    for (const page of dashboardPages.filter((candidate) => candidate.slug !== ''))
      expect(overview).toContain(`[${page.label}](${page.slug}/)`);
  });
});

describe('formatting', () => {
  it('writes short times in seconds and long ones in minutes', () => {
    expect(formatSeconds(81)).toBe('81 s');
    expect(formatSeconds(12.34)).toBe('12.3 s');
    expect(formatSeconds(140.5)).toBe('2 min 21 s');
  });

  it('writes flow durations in the largest whole unit', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(5400)).toBe('90 min');
    expect(formatDuration(3 * 3600)).toBe('3 h');
    expect(formatDuration(3 * 86400)).toBe('3 days');
  });
});

describe('the flow page', () => {
  it('shows open pull requests, waiting reviews, lead time, issue to merge, stacks and epics with their samples', async () => {
    const body = render('flow', await present());
    expect(body).toContain('Snapshot of 2026-11-09');
    expect(body).toContain('**measured**');
    expect(body).toContain('2026-10-10 06:47 UTC to 2026-11-09 06:47 UTC');
    expect(body).toContain('6 (1 draft)');
    expect(body).toContain('| Waiting for a first review | 2 |  |  | 4.5 days |');
    expect(body).toContain(
      '| Pull request opened to merged into `main` | 42 | 90 min | 24 h | 3 days |',
    );
    expect(body).toContain('| 3 | [#607](https://github.com/mgasca/calendar/pull/607), [#608]');
    expect(body).toContain(
      '| [#595](https://github.com/mgasca/calendar/issues/595) | 2 | 6 | 33 % |',
    );
    expect(body).toContain('4 pull requests were merged into another pull request');
  });

  it('marks a thin sample inconclusive instead of showing a figure', async () => {
    const body = render('flow', await present());
    expect(body).toContain('| Issue opened to the merge that closed it | 3 | inconclusive |');
  });

  it('defines each metric, including how stacks and squash merges count, and ranks no person', async () => {
    const body = render('flow', await present());
    for (const term of ['Lead time', 'Issue to merge', 'Stack', 'squash-merged', 'No ranking'])
      expect(body).toContain(term);
  });

  it('says there is no flow section when the latest snapshot predates it', async () => {
    const data = await readDashboardData(
      await folder({ '2026-11-08.json': await validText('2026-11-08.json') }),
    );
    expect(render('flow', data)).toContain('no flow section');
    expect(render('flow', { state: 'absent' })).toContain('No snapshot yet');
  });

  const thin = '"sample": 3,\n      "stat": null';
  const flowBroken: [string, (valid: string) => string, string][] = [
    [
      'a distribution on a thin sample',
      (valid) =>
        valid.replace(
          thin,
          '"sample": 3, "stat": {"count":3,"medianSeconds":1,"p90Seconds":1,"maxSeconds":1}',
        ),
      '$.flow.issueToMerge.stat: must be null while the sample is below 5',
    ],
    [
      'more drafts than pull requests',
      (valid) => valid.replace('"drafts": 1', '"drafts": 9'),
      '$.flow.openPullRequests.drafts: must not exceed count',
    ],
    [
      'an epic with more closed issues than listed',
      (valid) => valid.replace('"done": 2', '"done": 9'),
      '$.flow.epics[1].done: must not exceed total',
    ],
    [
      'a field outside the schema',
      (valid) => valid.replace('"minSample": 5,', '"minSample": 5, "login": "x",'),
      '$.flow.login: field is not in the schema',
    ],
    [
      'a machine path used as a field name',
      (valid) => valid.replace('"epics"', '"/home/someone"'),
      'looks like a machine path',
    ],
  ];
  it.each(flowBroken)('fails the build for %s', async (_name, mutate, rule) => {
    const text = await validText('2026-11-09.json');
    const mutated = mutate(text);
    expect(mutated).not.toBe(text);
    const failure = await readDashboardData(await folder({ '2026-11-09.json': mutated })).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SnapshotError);
    expect((failure as Error).message).toContain(rule);
  });
});

describe('superseded runs (issue 618)', () => {
  it('shows the weeks with their control, and no statistic for a week below the minimum', async () => {
    const body = render('ci-speed', await present());
    expect(body).toContain('## Superseded pull request runs');
    expect(body).toContain('| 2026-11-02 | 4 | 20 s | 40 s | 3 min 20 s | 3 | 5 s |');
    expect(body).toContain(
      '| 2026-11-09 | 1 | not enough runs | not enough runs | not enough runs | 1 | not enough runs |',
    );
    expect(body).toContain('**Inferred**: the pairing');
    expect(body).toContain('**Measured**: the wait of the newer run');
    expect(body).toContain('1 cancelled run that had already ended were left out');
  });

  it('says an older snapshot did not sample pull request runs', async () => {
    const older = await readDashboardData(
      await folder({ '2026-11-08.json': await validText('2026-11-08.json') }),
    );
    expect(render('ci-speed', older)).toContain('schema version below 3');
  });

  it('rejects the section in version 2, a missing one in version 3 and bad sums', async () => {
    const text = await validText('2026-11-09.json');
    const asV2 = text.replace('"version": 3', '"version": 2');
    expect(() => parseSnapshot('a.json', asV2)).toThrow('before version 3');
    const json = JSON.parse(text) as Record<string, unknown>;
    delete json.superseded;
    expect(() => parseSnapshot('a.json', JSON.stringify(json))).toThrow('field is missing');
    expect(() => parseSnapshot('a.json', text.replace('"pairs": 5,', '"pairs": 6,'))).toThrow(
      'pairs add up to 5, but sample.pairs is 6',
    );
    expect(() =>
      parseSnapshot('a.json', text.replace('"week": "2026-11-02"', '"week": "2026-11-03"')),
    ).toThrow('must be the Monday');
  });

  it('accepts null for a snapshot that did not sample', async () => {
    const json = JSON.parse(await validText('2026-11-09.json')) as Record<string, unknown>;
    json.superseded = null;
    expect(parseSnapshot('a.json', JSON.stringify(json)).superseded).toBeNull();
  });
});
