import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  bindingProblems,
  listedTests,
  userFacingFlows,
  type Model,
  type Pending,
} from './check.ts';

const packageDir = fileURLToPath(new URL('../..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../..', import.meta.url));
const TESTS_PREFIX = 'frontend/apps/e2e/tests/';

const readJson = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T;

/** The suite's tests as Playwright lists them: no browser and no stack needed. */
async function listSuite() {
  const { stdout } = await promisify(execFile)(
    'pnpm',
    ['exec', 'playwright', 'test', '--list', '--reporter=json'],
    {
      cwd: packageDir,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0' },
    },
  );
  return listedTests(JSON.parse(stdout), TESTS_PREFIX);
}

describe('the flow binding (ADR-0061)', () => {
  it('binds every user-facing flow of the architecture model to a tagged test or the pending list', async () => {
    const [model, pending, tests] = await Promise.all([
      readJson<Model>(`${repoRoot}docs/architecture/calendar.architecture.json`),
      readJson<Pending>(`${packageDir}pending-flows.json`),
      listSuite(),
    ]);

    expect(userFacingFlows(model).length).toBeGreaterThan(0);
    expect(tests.length).toBeGreaterThan(0);
    expect(bindingProblems(model, tests, pending)).toEqual([]);
  });
});

describe('bindingProblems', () => {
  const model: Model = {
    flows: [
      {
        'unique-id': 'view-flow',
        transitions: [
          { 'relationship-unique-id': 'user-uses-web-app' },
          { 'relationship-unique-id': 'web-app-calls-api' },
        ],
        metadata: { 'e2e-test': `${TESTS_PREFIX}view.spec.ts` },
      },
      {
        'unique-id': 'edit-flow',
        transitions: [{ 'relationship-unique-id': 'user-uses-web-app' }],
      },
      {
        'unique-id': 'migrate-flow',
        transitions: [{ 'relationship-unique-id': 'ci-runs-migrator' }],
      },
    ],
  };
  const viewTest = {
    title: 'views',
    file: `${TESTS_PREFIX}view.spec.ts`,
    tags: ['@flow:view-flow'],
  };

  it('derives user-facing flows from the user-uses-web-app relationship', () => {
    expect(userFacingFlows(model)).toEqual(['view-flow', 'edit-flow']);
  });

  it('passes when each user-facing flow is tested and linked, or pending', () => {
    expect(bindingProblems(model, [viewTest], { 'edit-flow': '#2' })).toEqual([]);
  });

  it('fails naming a user-facing flow that has no test and is not pending', () => {
    expect(bindingProblems(model, [viewTest], {})).toEqual([
      "User-facing flow 'edit-flow' has no test tagged @flow:edit-flow and is not on the pending list.",
    ]);
  });

  it('fails naming a tag the model does not define', () => {
    const unknown = {
      title: 'ghost',
      file: `${TESTS_PREFIX}ghost.spec.ts`,
      tags: ['flow:ghost-flow'],
    };
    expect(bindingProblems(model, [viewTest, unknown], { 'edit-flow': '#2' })).toEqual([
      `Test 'ghost' (${TESTS_PREFIX}ghost.spec.ts) is tagged @flow:ghost-flow, a flow the model does not define.`,
    ]);
  });

  it('fails on a test without a flow tag and on a tag naming a flow that is not user-facing', () => {
    const untagged = { title: 'loose', file: `${TESTS_PREFIX}loose.spec.ts`, tags: [] };
    const operator = {
      title: 'migrates',
      file: `${TESTS_PREFIX}migrate.spec.ts`,
      tags: ['flow:migrate-flow'],
    };
    expect(bindingProblems(model, [viewTest, untagged, operator], { 'edit-flow': '#2' })).toEqual([
      `Test 'loose' (${TESTS_PREFIX}loose.spec.ts) has no @flow:<unique-id> tag.`,
      `Test 'migrates' (${TESTS_PREFIX}migrate.spec.ts) is tagged @flow:migrate-flow, which is not a user-facing flow.`,
    ]);
  });

  it('fails when the pending list is stale or names a flow that is not user-facing', () => {
    expect(
      bindingProblems(model, [viewTest], {
        'edit-flow': '#2',
        'view-flow': '#1',
        'migrate-flow': '#3',
      }),
    ).toEqual([
      "Flow 'view-flow' has a test, so remove it from the pending list.",
      "The pending list names 'migrate-flow', which is not a user-facing flow of the model.",
    ]);
  });

  it('fails when a covered flow does not link its test, or links a file without it', () => {
    const editTest = {
      title: 'edits',
      file: `${TESTS_PREFIX}edit.spec.ts`,
      tags: ['flow:edit-flow'],
    };
    const misplaced = { ...viewTest, file: `${TESTS_PREFIX}elsewhere.spec.ts` };
    expect(bindingProblems(model, [misplaced, editTest], {})).toEqual([
      `Flow 'view-flow' links ${TESTS_PREFIX}view.spec.ts in the model, but no test in that file is tagged @flow:view-flow.`,
      `Flow 'edit-flow' has a test, but its model entry has no metadata "e2e-test" linking it.`,
    ]);
  });
});

describe('listedTests', () => {
  it('reads nested suites and makes files repository-relative', () => {
    const report = {
      suites: [
        {
          file: 'a.spec.ts',
          specs: [{ title: 'top', file: 'a.spec.ts', tags: ['flow:x'] }],
          suites: [
            { file: 'a.spec.ts', specs: [{ title: 'nested', file: 'a.spec.ts', tags: [] }] },
          ],
        },
      ],
      errors: [],
    };
    expect(listedTests(report, TESTS_PREFIX)).toEqual([
      { title: 'top', file: `${TESTS_PREFIX}a.spec.ts`, tags: ['flow:x'] },
      { title: 'nested', file: `${TESTS_PREFIX}a.spec.ts`, tags: [] },
    ]);
  });

  it('fails when the suite cannot be listed', () => {
    expect(() =>
      listedTests({ suites: [], errors: [{ message: 'SyntaxError in x.spec.ts' }] }, ''),
    ).toThrow(/SyntaxError in x.spec.ts/);
  });
});
