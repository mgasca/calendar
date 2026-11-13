/**
 * The flow binding of ADR-0061: every user-facing flow of the architecture model has a test tagged
 * `@flow:<unique-id>` (or sits on the pending list until its slice lands), every tag names a flow the model
 * defines, and each covered flow's model entry links the file that holds its test.
 */

/** The relationship that makes a flow user-facing: a person uses the web app. */
export const USER_FACING_RELATIONSHIP = 'user-uses-web-app';

/** The metadata key under which a flow in the model links its end-to-end test file (repository-relative). */
export const TEST_LINK_KEY = 'e2e-test';

/** The tag prefix, without Playwright's `@`. */
const TAG_PREFIX = 'flow:';

/** The parts of the CALM model the binding reads. */
export interface Model {
  readonly flows?: readonly {
    readonly 'unique-id': string;
    readonly transitions?: readonly { readonly 'relationship-unique-id': string }[];
    readonly metadata?: Readonly<Record<string, unknown>>;
  }[];
}

/** A test as `playwright test --list` reports it, with its file relative to the repository root. */
export interface ListedTest {
  readonly title: string;
  readonly file: string;
  readonly tags: readonly string[];
}

/** The flows on the pending list, each with the issue that will cover it. */
export type Pending = Readonly<Record<string, string>>;

/** The ids of the model's flows that a person drives through the web app. */
export function userFacingFlows(model: Model): string[] {
  return (model.flows ?? [])
    .filter((flow) =>
      (flow.transitions ?? []).some(
        (t) => t['relationship-unique-id'] === USER_FACING_RELATIONSHIP,
      ),
    )
    .map((flow) => flow['unique-id']);
}

/** The flow ids a test is tagged with. */
export const flowTags = (test: ListedTest) =>
  test.tags
    .map((tag) => tag.replace(/^@/, ''))
    .filter((tag) => tag.startsWith(TAG_PREFIX))
    .map((tag) => tag.slice(TAG_PREFIX.length));

/** Every way the model, the tests and the pending list disagree; empty when they are bound. */
export function bindingProblems(
  model: Model,
  tests: readonly ListedTest[],
  pending: Pending,
): string[] {
  const problems: string[] = [];
  const flows = new Map((model.flows ?? []).map((flow) => [flow['unique-id'], flow]));
  const userFacing = new Set(userFacingFlows(model));
  const testsByFlow = new Map<string, ListedTest[]>();

  for (const test of tests) {
    const tags = flowTags(test);
    if (tags.length === 0)
      problems.push(`Test '${test.title}' (${test.file}) has no @flow:<unique-id> tag.`);
    for (const id of tags) {
      if (!flows.has(id))
        problems.push(
          `Test '${test.title}' (${test.file}) is tagged @flow:${id}, a flow the model does not define.`,
        );
      else if (!userFacing.has(id))
        problems.push(
          `Test '${test.title}' (${test.file}) is tagged @flow:${id}, which is not a user-facing flow.`,
        );
      testsByFlow.set(id, [...(testsByFlow.get(id) ?? []), test]);
    }
  }

  for (const id of Object.keys(pending)) {
    if (!userFacing.has(id))
      problems.push(
        `The pending list names '${id}', which is not a user-facing flow of the model.`,
      );
    else if (testsByFlow.has(id))
      problems.push(`Flow '${id}' has a test, so remove it from the pending list.`);
  }

  for (const id of userFacing) {
    const covered = testsByFlow.get(id) ?? [];
    if (covered.length === 0 && !(id in pending)) {
      problems.push(
        `User-facing flow '${id}' has no test tagged @flow:${id} and is not on the pending list.`,
      );
    }
    const link = flows.get(id)?.metadata?.[TEST_LINK_KEY];
    if (covered.length > 0 && typeof link !== 'string') {
      problems.push(
        `Flow '${id}' has a test, but its model entry has no metadata "${TEST_LINK_KEY}" linking it.`,
      );
    } else if (typeof link === 'string' && !covered.some((test) => test.file === link)) {
      problems.push(
        `Flow '${id}' links ${link} in the model, but no test in that file is tagged @flow:${id}.`,
      );
    }
  }
  return problems;
}

/** The tests in Playwright's `--list --reporter=json` output, with files made relative to `repoPrefix`. */
export function listedTests(report: unknown, repoPrefix: string): ListedTest[] {
  interface Suite {
    file?: string;
    specs?: { title?: string; file?: string; tags?: string[] }[];
    suites?: Suite[];
  }
  const tests: ListedTest[] = [];
  const walk = (suite: Suite) => {
    for (const spec of suite.specs ?? []) {
      tests.push({
        title: spec.title ?? '',
        file: `${repoPrefix}${spec.file ?? suite.file ?? ''}`,
        tags: spec.tags ?? [],
      });
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  const root = report as { suites?: Suite[]; errors?: { message?: string }[] };
  const errors = (root.errors ?? []).map((error) => error.message ?? 'unknown error');
  if (errors.length > 0) throw new Error(`playwright test --list failed:\n${errors.join('\n')}`);
  for (const suite of root.suites ?? []) walk(suite);
  return tests;
}
