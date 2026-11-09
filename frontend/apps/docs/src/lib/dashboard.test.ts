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
      (valid) => valid.replace('"version": 2', '"version": 9'),
      '$.version: must be 1 to 2',
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
    expect(escaped).not.toMatch(/<script>/);
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
});
