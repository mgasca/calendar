/* eslint-disable @typescript-eslint/restrict-template-expressions -- the page prints counts and seconds on purpose; every other template value is already a string */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The delivery dashboard's data and pages (story 0053, ADR-0049).
 *
 * The daily workflow commits one JSON snapshot per day to the `dashboard-data` branch; the docs
 * build copies that branch's `snapshots/` folder into `.dashboard-data/` (git-ignored) and the pages
 * below are rendered from it at build time, with no client-side call to GitHub. The .NET tool
 * `tools/delivery-dashboard` owns the schema and the privacy rules and checks every snapshot before
 * it is published; this module checks the shape again before rendering, because the branch is
 * outside the pull request flow, and escapes everything it prints.
 */

/** The snapshot schema versions this reader accepts (tools/delivery-dashboard/Snapshot.cs). */
export const oldestVersion = 1;
export const currentVersion = 2;

export interface SnapshotWindow {
  from: string;
  to: string;
}

export interface JobBaseline {
  count: number;
  medianSeconds: number;
  thresholdSeconds: number;
}

export type Verdict = 'noShift' | 'slower' | 'faster' | 'inconclusive';

export interface JobTrend {
  verdict: Verdict;
  recentRuns: number;
  shiftSeconds: number;
  lowSeconds: number;
  highSeconds: number;
  minEffectSeconds: number;
}

export interface JobRow {
  job: string;
  path: 'check' | 'publication';
  count: number;
  minSeconds: number;
  medianSeconds: number;
  p90Seconds: number;
  maxSeconds: number;
  baseline: JobBaseline | null;
  trend: JobTrend | null;
}

export interface CiSection {
  workflow: string;
  basis: 'measured' | 'inferred';
  runs: number;
  window: SnapshotWindow | null;
  trend: { runs: number; required: number; window: SnapshotWindow | null } | null;
  queue: { runs: number; medianSeconds: number; p90Seconds: number; maxSeconds: number } | null;
  jobs: JobRow[];
}

export interface Snapshot {
  version: number;
  date: string;
  generatedAt: string;
  repository: string;
  ci: CiSection;
}

/** What the build found: no snapshots yet (data branch absent or empty), or the snapshots, oldest first. */
export type DashboardData = { state: 'absent' } | { state: 'present'; snapshots: Snapshot[] };

/** A snapshot file that breaks the schema or the privacy rules; the build fails with this message. */
export class SnapshotError extends Error {
  readonly file: string;
  readonly problems: string[];

  constructor(file: string, problems: string[]) {
    super(
      `Delivery dashboard: ${file} is not a valid snapshot:\n${problems.map((problem) => `  ${problem}`).join('\n')}`,
    );
    this.name = 'SnapshotError';
    this.file = file;
    this.problems = problems;
  }
}

const rootKeys = ['version', 'date', 'generatedAt', 'repository', 'ci'];
const ciKeysV1 = ['workflow', 'basis', 'runs', 'window', 'jobs'];
const jobKeysV1 = [
  'job',
  'path',
  'count',
  'minSeconds',
  'medianSeconds',
  'p90Seconds',
  'maxSeconds',
];
const verdicts = ['noShift', 'slower', 'faster', 'inconclusive'];

// The privacy rules of tools/delivery-dashboard/SnapshotRules.cs: defence in depth, since the
// branch is written by a workflow, not reviewed in a pull request.
const privateText: [RegExp, string][] = [
  [
    /(?:^|[\s"'(=])(?:\/(?:home|tmp|Users|var|root|etc|mnt|opt|usr)\b|[A-Za-z]:\\)/i,
    'looks like a machine path',
  ],
  [
    /\b(?:session|task|agent|local|subagent)[_-][0-9a-z]{6,}\b/i,
    'looks like a session or task handle',
  ],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, 'looks like a UUID'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/i, 'looks like an e-mail address'],
];

type Json = unknown;
const isObject = (value: Json): value is Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

class Checker {
  readonly problems: string[] = [];

  keys(value: Json, path: string, allowed: string[]): value is Record<string, Json> {
    if (!isObject(value)) {
      this.problems.push(`${path}: must be an object`);
      return false;
    }
    let ok = true;
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        this.problems.push(`${path}.${key}: field is not in the schema`);
        ok = false;
      }
    }
    for (const key of allowed) {
      if (!(key in value)) {
        this.problems.push(`${path}.${key}: field is missing`);
        ok = false;
      }
    }
    return ok;
  }

  scan(value: Json, path: string) {
    if (typeof value === 'string') {
      for (const [pattern, message] of privateText)
        if (pattern.test(value)) this.problems.push(`${path}: ${message}`);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        this.scan(item, `${path}[${index}]`);
      });
    } else if (isObject(value)) {
      for (const [key, item] of Object.entries(value)) {
        for (const [pattern, message] of privateText)
          if (pattern.test(key)) this.problems.push(`${path}.${key} (field name): ${message}`);
        this.scan(item, `${path}.${key}`);
      }
    }
  }

  date(value: Json, path: string) {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(value))
    )
      this.problems.push(`${path}: must be a date as yyyy-MM-dd`);
  }

  time(value: Json, path: string) {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ||
      Number.isNaN(Date.parse(value))
    )
      this.problems.push(`${path}: must be a UTC time as yyyy-MM-ddTHH:mm:ssZ`);
  }

  oneOf(value: Json, path: string, allowed: string[]) {
    if (typeof value !== 'string' || !allowed.includes(value))
      this.problems.push(`${path}: must be one of ${allowed.join(', ')}`);
  }

  count(value: Json, path: string, least: number) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= least) return value;
    this.problems.push(`${path}: must be a whole number of at least ${least}`);
    return 0;
  }

  seconds(value: Json, path: string) {
    if (typeof value === 'number' && value >= 0) return value;
    this.problems.push(`${path}: must be a number of seconds of at least 0`);
    return undefined;
  }

  window(value: Json, path: string, runs: number) {
    if (value === null) {
      if (runs > 0) this.problems.push(`${path}: must be set when runs is above 0`);
    } else if (this.keys(value, path, ['from', 'to'])) {
      this.time(value.from, `${path}.from`);
      this.time(value.to, `${path}.to`);
    }
  }

  ascending(values: (number | undefined)[], path: string, order: string) {
    if (values.every((value) => value !== undefined)) {
      const numbers = values;
      if (numbers.some((value, index) => index > 0 && value < (numbers[index - 1] ?? 0)))
        this.problems.push(`${path}: ${order} must hold`);
    }
  }
}

/**
 * Parses a snapshot's text. Throws a SnapshotError naming the file and every field that breaks the
 * schema (versions 1 and 2) or the privacy rules, so a build never renders a half-understood file.
 */
export function parseSnapshot(file: string, text: string): Snapshot {
  let json: Json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new SnapshotError(file, [
      `$: not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    ]);
  }
  const check = new Checker();
  check.scan(json, '$');
  if (check.keys(json, '$', rootKeys)) {
    const version = json.version;
    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < oldestVersion ||
      version > currentVersion
    ) {
      check.problems.push(`$.version: must be ${oldestVersion} to ${currentVersion}`);
    } else {
      checkRoot(check, json, version >= 2);
    }
  }
  if (check.problems.length > 0) throw new SnapshotError(file, check.problems);
  const snapshot = json as Snapshot;
  // Version 1 has no baseline, trend or queue: show them as absent, not as undefined.
  snapshot.ci.trend ??= null;
  snapshot.ci.queue ??= null;
  for (const job of snapshot.ci.jobs) {
    job.baseline ??= null;
    job.trend ??= null;
  }
  return snapshot;
}

function checkRoot(check: Checker, root: Record<string, Json>, v2: boolean) {
  check.date(root.date, '$.date');
  check.time(root.generatedAt, '$.generatedAt');
  if (typeof root.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(root.repository))
    check.problems.push('$.repository: must be owner/name');
  const ciKeys = v2 ? [...ciKeysV1, 'trend', 'queue'] : ciKeysV1;
  if (!check.keys(root.ci, '$.ci', ciKeys)) return;
  const ci = root.ci;
  if (typeof ci.workflow !== 'string' || !/^[\w.-]+\.ya?ml$/.test(ci.workflow))
    check.problems.push('$.ci.workflow: must be a workflow file name');
  check.oneOf(ci.basis, '$.ci.basis', ['measured', 'inferred']);
  const runs = check.count(ci.runs, '$.ci.runs', 0);
  check.window(ci.window, '$.ci.window', runs);
  if (v2) {
    checkTrend(check, ci.trend);
    checkQueue(check, ci.queue);
  }
  if (!Array.isArray(ci.jobs)) {
    check.problems.push('$.ci.jobs: must be an array');
    return;
  }
  ci.jobs.forEach((job: Json, index) => {
    checkJob(check, job, `$.ci.jobs[${index}]`, v2);
  });
}

function checkTrend(check: Checker, trend: Json) {
  if (trend === null || !check.keys(trend, '$.ci.trend', ['runs', 'required', 'window'])) return;
  const runs = check.count(trend.runs, '$.ci.trend.runs', 0);
  check.count(trend.required, '$.ci.trend.required', 1);
  check.window(trend.window, '$.ci.trend.window', runs);
}

function checkQueue(check: Checker, queue: Json) {
  if (
    queue === null ||
    !check.keys(queue, '$.ci.queue', ['runs', 'medianSeconds', 'p90Seconds', 'maxSeconds'])
  )
    return;
  check.count(queue.runs, '$.ci.queue.runs', 1);
  check.ascending(
    ['medianSeconds', 'p90Seconds', 'maxSeconds'].map((key) =>
      check.seconds(queue[key], `$.ci.queue.${key}`),
    ),
    '$.ci.queue',
    'medianSeconds <= p90Seconds <= maxSeconds',
  );
}

function checkJob(check: Checker, job: Json, path: string, v2: boolean) {
  if (!check.keys(job, path, v2 ? [...jobKeysV1, 'baseline', 'trend'] : jobKeysV1)) return;
  if (typeof job.job !== 'string' || job.job.trim() === '' || job.job.length > 100)
    check.problems.push(`${path}.job: must be a non-empty string of at most 100 characters`);
  check.oneOf(job.path, `${path}.path`, ['check', 'publication']);
  check.count(job.count, `${path}.count`, 1);
  check.ascending(
    ['minSeconds', 'medianSeconds', 'p90Seconds', 'maxSeconds'].map((key) =>
      check.seconds(job[key], `${path}.${key}`),
    ),
    path,
    'minSeconds <= medianSeconds <= p90Seconds <= maxSeconds',
  );
  if (!v2) return;
  const baseline = job.baseline;
  if (
    baseline !== null &&
    check.keys(baseline, `${path}.baseline`, ['count', 'medianSeconds', 'thresholdSeconds'])
  ) {
    check.count(baseline.count, `${path}.baseline.count`, 1);
    check.seconds(baseline.medianSeconds, `${path}.baseline.medianSeconds`);
    check.seconds(baseline.thresholdSeconds, `${path}.baseline.thresholdSeconds`);
  }
  const trend = job.trend;
  if (
    trend !== null &&
    check.keys(trend, `${path}.trend`, [
      'verdict',
      'recentRuns',
      'shiftSeconds',
      'lowSeconds',
      'highSeconds',
      'minEffectSeconds',
    ])
  ) {
    check.oneOf(trend.verdict, `${path}.trend.verdict`, verdicts);
    check.count(trend.recentRuns, `${path}.trend.recentRuns`, 0);
    check.seconds(trend.minEffectSeconds, `${path}.trend.minEffectSeconds`);
    for (const key of ['shiftSeconds', 'lowSeconds', 'highSeconds'])
      if (typeof trend[key] !== 'number')
        check.problems.push(`${path}.trend.${key}: must be a number of seconds`);
  }
}

/** Where the build finds the snapshots: `DASHBOARD_DATA_DIR`, else `.dashboard-data/snapshots/` of the docs app. */
export function dashboardDataDirectory(): URL {
  const override = process.env.DASHBOARD_DATA_DIR;
  if (override) return pathToFileURL(override.endsWith('/') ? override : `${override}/`);
  return new URL('../../.dashboard-data/snapshots/', import.meta.url);
}

const snapshotFile = /^(\d{4}-\d{2}-\d{2})\.json$/;

/**
 * Reads every snapshot in the folder, oldest first. A missing folder or one without snapshots is
 * the "no snapshot yet" state (the daily workflow has not run); a present file that breaks the
 * schema, the privacy rules or its own name fails the build and names the file.
 */
export async function readDashboardData(
  directory: URL = dashboardDataDirectory(),
): Promise<DashboardData> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' };
    throw error;
  }
  names.sort();
  const snapshots: Snapshot[] = [];
  for (const name of names) {
    const match = snapshotFile.exec(name);
    if (!match) {
      throw new SnapshotError(name, [
        '$: unexpected file in the snapshots folder; only yyyy-MM-dd.json is allowed',
      ]);
    }
    const snapshot = parseSnapshot(name, await readFile(new URL(name, directory), 'utf8'));
    if (snapshot.date !== match[1])
      throw new SnapshotError(name, [`$.date: ${snapshot.date} does not match the file name`]);
    snapshots.push(snapshot);
  }
  return snapshots.length === 0 ? { state: 'absent' } : { state: 'present', snapshots };
}

// -- Rendering ----------------------------------------------------------------------------------

/**
 * Escapes text read from the data branch (a job name) for a Markdown table cell: Markdown
 * punctuation is backslash-escaped and HTML is turned into entities, so a name never becomes
 * markup, a link or an extra column.
 */
export function escapeText(text: string): string {
  return text
    .replace(/[\\`*_[\]|~#!{}()+-]/g, (char) => `\\${char}`)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, ' ');
}

/** Escapes text for an HTML attribute (entities only; the value sits inside double quotes). */
function escapeAttribute(text: string) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function formatSeconds(seconds: number): string {
  if (seconds >= 120) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} min ${Math.round(seconds - minutes * 60)} s`;
  }
  return `${Number(seconds.toFixed(1))} s`;
}

const signed = (seconds: number) => `${seconds > 0 ? '+' : ''}${Number(seconds.toFixed(1))} s`;

const day = (time: string) => time.slice(0, 10);
const minute = (time: string) => `${time.slice(0, 10)} ${time.slice(11, 16)} UTC`;

function table(header: string[], rows: string[][]) {
  // The div scrolls a wide table on a narrow screen; the blank lines let Markdown render the table inside it.
  return [
    '<div class="dashboard-table">',
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
    '</div>',
  ].join('\n');
}

/** The verdict word and what supports it, as two table cells. */
function verdictCells(row: JobRow, trend: CiSection['trend']): [string, string] {
  if (row.baseline === null || row.trend === null)
    return ['<span class="dashboard-verdict">no baseline pinned</span>', 'none'];
  const shift = `${signed(row.trend.shiftSeconds)} (${signed(row.trend.lowSeconds)} to ${signed(row.trend.highSeconds)}) from ${row.trend.recentRuns} runs`;
  switch (row.trend.verdict) {
    case 'slower':
      return ['<span class="dashboard-verdict dashboard-verdict-slower">slower</span>', shift];
    case 'faster':
      return [
        '<span class="dashboard-verdict dashboard-verdict-faster">faster</span> (re-pin?)',
        shift,
      ];
    case 'inconclusive':
      return [
        '<span class="dashboard-verdict">inconclusive</span>',
        `${row.trend.recentRuns} of ${trend?.required ?? '?'} recent runs needed`,
      ];
    default:
      return ['<span class="dashboard-verdict">no shift</span>', shift];
  }
}

function windowText(window: SnapshotWindow | null) {
  return window ? `${minute(window.from)} to ${minute(window.to)}` : 'no runs';
}

/** A small line chart of the values, scaled to its own range; the caption carries the numbers. */
function sparkline(values: number[], label: string) {
  if (values.length < 2) return 'one snapshot';
  const width = 120;
  const height = 24;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * (width - 4) + 2;
      const y = height - 2 - ((value - low) / range) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg class="dashboard-spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeAttribute(label)}"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

interface Series {
  job: string;
  path: string;
  dates: string[];
  medians: number[];
}

/** The median of every job and path across the snapshots, for the history. */
export function history(snapshots: Snapshot[]): Series[] {
  const series = new Map<string, Series>();
  for (const snapshot of snapshots) {
    for (const row of snapshot.ci.jobs) {
      const key = `${row.job}\u0000${row.path}`;
      const entry = series.get(key) ?? { job: row.job, path: row.path, dates: [], medians: [] };
      entry.dates.push(snapshot.date);
      entry.medians.push(row.medianSeconds);
      series.set(key, entry);
    }
  }
  return [...series.values()].sort(
    (a, b) => a.job.localeCompare(b.job, 'en') || a.path.localeCompare(b.path, 'en'),
  );
}

/** How many of the latest snapshots the history shows. */
export const historyLength = 30;

const noSnapshotNotice = [
  ':::note[No snapshot yet]',
  'The delivery dashboard is built from the daily snapshots that the `Dashboard snapshot` workflow commits to the `dashboard-data` branch.',
  'This build found none: the branch does not exist yet, or it holds no snapshot. Nothing on this page is measured until the workflow has run once.',
  ':::',
].join('\n');

export interface DashboardPage {
  /** The page's slug under `dashboard/`, empty for the overview. */
  slug: string;
  title: string;
  /** The sidebar label. */
  label: string;
  render(data: DashboardData): string;
}

const adr45 = '../../../../../docs/decisions/0045-run-time-regression-gates-for-ci-jobs.md';
const story =
  '../../../../../docs/stories/0053-show-how-fast-and-how-smoothly-changes-reach-main.md';
const adr49 =
  '../../../../../docs/decisions/0049-build-the-delivery-dashboard-from-daily-snapshots-on-the-docs-site.md';

function ciSpeed(data: DashboardData): string {
  if (data.state === 'absent') return noSnapshotNotice;
  const latest = data.snapshots.at(-1);
  if (!latest) return noSnapshotNotice;
  const { ci } = latest;
  const lines: string[] = [];
  lines.push(
    `**Snapshot of ${latest.date}** (taken ${minute(latest.generatedAt)}). Every number on this page is **${ci.basis}**: ` +
      `computed from the start and finish times GitHub recorded for each job of the newest ${ci.runs} successful push runs of \`${ci.workflow}\` on \`main\`, ` +
      `created ${windowText(ci.window)}. A job's own sample can be smaller than that (a job runs only on its path), so each row gives its run count.`,
    '',
    `Baselines, thresholds and verdicts are those of [ADR-0045](${adr45}); the page and the gate read the same pinned baseline. The decision for this dashboard is [ADR-0049](${adr49}) and the story is [0053](${story}).`,
    '',
    '## Run times per job and path',
    '',
  );
  const rows = ci.jobs.map((row) => [
    escapeText(row.job),
    row.path,
    String(row.count),
    formatSeconds(row.minSeconds),
    formatSeconds(row.medianSeconds),
    formatSeconds(row.p90Seconds),
    formatSeconds(row.maxSeconds),
    row.baseline
      ? `${formatSeconds(row.baseline.medianSeconds)} (${row.baseline.count} runs)`
      : 'none pinned',
    row.baseline ? formatSeconds(row.baseline.thresholdSeconds) : 'none',
    ...verdictCells(row, ci.trend),
  ]);
  lines.push(
    rows.length === 0
      ? 'The sampled runs held no gated job.'
      : table(
          [
            'Job',
            'Path',
            'Runs',
            'Min',
            'Median',
            'p90',
            'Max',
            'Baseline median',
            'Threshold',
            'Trend verdict',
            'Shift vs baseline (95 % interval)',
          ],
          rows,
        ),
    '',
  );
  lines.push('## What the verdict compares', '');
  if (ci.trend === null) {
    lines.push(
      'This snapshot has no trend section: it was written without the pinned baseline, or by an older version of the snapshot tool (schema version 1). No verdict is shown and none is implied.',
    );
  } else {
    lines.push(
      `**Measured**, ${ci.trend.runs} recent successful push runs on \`main\` after the baseline's last run (${windowText(ci.trend.window)}); the check concludes only from ${ci.trend.required} runs. ` +
        'A job is **slower** when a one-sided exact Mann-Whitney test is significant and the Hodges-Lehmann shift reaches the minimum effect; ' +
        '**faster** is a suggestion to re-pin, never an alarm; with fewer runs the verdict is **inconclusive**, not "no shift". The **threshold** is the run time above which a single run fails the CI gate.',
    );
  }
  lines.push('', '## Queue time', '');
  if (ci.queue === null) {
    lines.push('This snapshot has no queue measurement.');
  } else {
    lines.push(
      `**Measured**, ${ci.queue.runs} of the ${ci.runs} sampled runs (${windowText(ci.window)}): the wait between a run being created and its first job starting.`,
      '',
      table(
        ['Median', 'p90', 'Max'],
        [[ci.queue.medianSeconds, ci.queue.p90Seconds, ci.queue.maxSeconds].map(formatSeconds)],
      ),
      '',
      'Time that pull request runs lose to a newer push cancelling them (superseded-run waste) is not on this page: it needs pull request runs, which this snapshot does not sample.',
    );
  }
  const recent = data.snapshots.slice(-historyLength);
  lines.push('', '## History of the median', '');
  if (recent.length < 2) {
    lines.push(
      `Only ${recent.length} snapshot${recent.length === 1 ? '' : 's'} so far (${recent.map((s) => s.date).join(', ')}): a history needs at least two.`,
    );
  } else {
    lines.push(
      `**Measured**, the median of each job and path in the last ${recent.length} daily snapshots (${day(recent[0]?.generatedAt ?? '')} to ${day(recent.at(-1)?.generatedAt ?? '')}). ` +
        'Consecutive snapshots overlap (each samples the newest runs), so a point is a rolling median, not an independent measurement.',
      '',
      table(
        ['Job', 'Path', 'Snapshots', 'First', 'Latest', 'Change', 'Median over time'],
        history(recent).map((series) => {
          const first = series.medians[0] ?? 0;
          const last = series.medians.at(-1) ?? 0;
          return [
            escapeText(series.job),
            series.path,
            String(series.medians.length),
            formatSeconds(first),
            formatSeconds(last),
            signed(last - first),
            sparkline(
              series.medians,
              `Median from ${formatSeconds(first)} to ${formatSeconds(last)} over ${series.medians.length} snapshots`,
            ),
          ];
        }),
      ),
    );
  }
  return lines.join('\n');
}

function overview(data: DashboardData): string {
  const intro =
    'The delivery dashboard shows how fast and how smoothly changes reach `main`. It is rendered at build time from the daily snapshots on the `dashboard-data` branch, ' +
    'so it shows the latest snapshot, not the current minute. Every number says whether it is **measured** (computed from recorded timestamps) or **inferred** (an estimate), and gives its sample and window.';
  const state =
    data.state === 'absent'
      ? noSnapshotNotice
      : `Latest snapshot: **${data.snapshots.at(-1)?.date ?? ''}**. ${data.snapshots.length} snapshot${data.snapshots.length === 1 ? '' : 's'} in this build.`;
  const pages = dashboardPages
    .filter((page) => page.slug !== '')
    .map((page) => `- [${page.label}](${page.slug}/)`);
  return [intro, '', state, '', '## Pages', '', ...pages].join('\n');
}

/** Every dashboard page. A new slice adds one entry here; the sidebar and the loader follow. */
export const dashboardPages: DashboardPage[] = [
  { slug: '', title: 'Delivery dashboard', label: 'Overview', render: overview },
  { slug: 'ci-speed', title: 'CI speed', label: 'CI speed', render: ciSpeed },
];

export const dashboardId = (page: DashboardPage) =>
  page.slug ? `dashboard/${page.slug}` : 'dashboard';

/** The sidebar group, in page order. */
export function dashboardSidebar() {
  return dashboardPages.map((page) => ({ slug: dashboardId(page), label: page.label }));
}

/** The loader entries of the dashboard pages. */
export function dashboardEntries(data: DashboardData) {
  return dashboardPages.map((page, order) => ({
    id: dashboardId(page),
    title: page.title,
    body: page.render(data),
    sidebar: { order, label: page.label },
  }));
}

/** The folder the pages are built from, for the watcher. */
export const dashboardDataPath = () => fileURLToPath(dashboardDataDirectory());
