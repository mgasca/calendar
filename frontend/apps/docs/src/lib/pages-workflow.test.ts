import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const workflow = readFileSync(
  new URL('../../../../../.github/workflows/pages.yml', import.meta.url),
  'utf8',
);

// The `script: |` body of the named github-script step, up to the first line indented less
// than the block (the next step or a YAML comment before it), dedented.
function stepScript(name: string) {
  const step = workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - name: ')[0];
  const block = step?.split('          script: |\n')[1];
  const lines = block?.split('\n') ?? [];
  const end = lines.findIndex((line) => line.trim() !== '' && !line.startsWith(' '.repeat(12)));
  const script = lines
    .slice(0, end < 0 ? undefined : end)
    .join('\n')
    .replace(/^ {12}/gm, '');
  if (!script) throw new Error(`Missing workflow script for step "${name}"`);
  return script;
}

// The `env:` entries of the named step, with each `${{ … }}` expression resolved from `values`.
function stepEnv(name: string, values: Record<string, string>) {
  const step = workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - name: ')[0] ?? '';
  const block = step.split('        env:\n')[1]?.split('        with:\n')[0] ?? '';
  const env: Record<string, string> = {};
  for (const match of block.matchAll(/^ {10}(?<key>\w+): \$\{\{ (?<expression>.+?) \}\}$/gm)) {
    const key = match.groups?.key ?? '';
    const expression = match.groups?.expression ?? '';
    const value = values[expression];
    if (value === undefined) throw new Error(`Unresolved ${expression} in step "${name}"`);
    env[key] = value;
  }
  return env;
}

const currentScript = stepScript('Skip a snapshot a later publication replaced');

async function publication(runId: number, attempt: string, current = 'snapshot') {
  const outputs: Record<string, string> = {};
  await runInNewContext(`(async () => { ${currentScript} })()`, {
    require: createRequire(import.meta.url),
    process: { env: { SNAPSHOT: 'snapshot', GITHUB_RUN_ATTEMPT: attempt } },
    context: { repo: {}, runId },
    github: {
      rest: { repos: { getBranch: () => ({ data: { branch: '', commit: { sha: current } } }) } },
    },
    core: {
      setOutput: (name: string, value: string) => {
        outputs[name] = value;
      },
      notice: vi.fn(),
    },
  });
  return outputs;
}

interface Request {
  route: string;
  params: Record<string, unknown>;
}
type Reply = (request: Request) => unknown;

// The gh-pages commit that assemble made for this publication, and main's head.
const version = 'a'.repeat(40);
const headSha = 'b'.repeat(40);

// Runs the deploy step, with the env the workflow gives it, against a fake Pages API. Replies
// are consumed in order, and a reply that is an Error is thrown, as Octokit throws a
// RequestError. Like the real API (#504), creating a deployment answers 404 unless the build
// version names a commit of the repository.
function deploy(replies: Reply[], snapshot = version, accepted = [snapshot, headSha]) {
  const requests: Request[] = [];
  const outputs: Record<string, string> = {};
  let clock = 0;
  const commits = new Set(accepted);
  const deployScript = stepScript('Deploy production and previews');
  const env = stepEnv('Deploy production and previews', {
    'needs.assemble.outputs.artifact_id': '42',
    'needs.assemble.outputs.snapshot': snapshot,
    'steps.current.outputs.version': 'c'.repeat(40),
  });
  const run = runInNewContext(`(async () => { ${deployScript} })()`, {
    process: { env: { ...env, GITHUB_SHA: headSha } },
    context: { repo: { owner: 'o', repo: 'r' }, sha: headSha },
    Date: { now: () => clock },
    setTimeout: (resolve: () => void, ms: number) => {
      clock += ms;
      resolve();
    },
    github: {
      request: (route: string, params: Record<string, unknown>) => {
        const request = { route, params };
        requests.push(request);
        const build = params.pages_build_version;
        if (route.startsWith('POST') && route.endsWith('/pages/deployments')) {
          if (typeof build !== 'string' || !commits.has(build)) {
            throw Object.assign(new Error('Not Found'), { status: 404 });
          }
        }
        const reply = replies.shift();
        if (!reply) throw new Error(`Unexpected request ${route}`);
        const result = reply(request);
        if (result instanceof Error) throw result;
        return { data: result };
      },
    },
    core: {
      getIDToken: () => 'oidc',
      info: vi.fn(),
      warning: vi.fn(),
      setOutput: (name: string, value: string) => {
        outputs[name] = value;
      },
    },
  }) as Promise<void>;
  return { run, requests, outputs };
}

const created = () => ({ id: version, page_url: 'https://example.test/calendar/' });
const status = (value: string) => () => ({ status: value });
const refused = () =>
  Object.assign(
    new Error(
      `Deployment request failed for ${version} due to in progress deployment. Please cancel ${headSha} first or wait for it to complete.`,
    ),
    { status: 400 },
  );

describe('Pages publication identity', () => {
  // Each publication's gh-pages commit is its build version, so assemble must commit even
  // when the snapshot did not change; otherwise two publications would share one version.
  it('makes a gh-pages commit for every publication', () => {
    const assemble = stepScript('Assemble retained production and preview snapshot');
    expect(assemble).toMatch(/^git\('commit', '--allow-empty', /m);
    expect(assemble).toMatch(/^git\('push', 'origin', 'HEAD:gh-pages'\);$/m);
  });

  it('deploys the current snapshot', async () => {
    expect(await publication(100, '1')).toEqual({ deploy: 'true' });
  });

  it('does not deploy an obsolete snapshot, including on a retry', async () => {
    expect(await publication(100, '2', 'newer-snapshot')).toEqual({});
  });

  // #429: the runner ignores a step `env` that sets GITHUB_* or RUNNER_*, so such an override
  // only looks like it works. #339 set GITHUB_SHA for actions/deploy-pages this way.
  it('never relies on overriding a default GITHUB_* or RUNNER_* variable', () => {
    expect(workflow).not.toMatch(/^\s+(GITHUB|RUNNER)_[A-Z_]+:/m);
  });

  it('sends a different commit for each publication, never GITHUB_SHA', async () => {
    const other = 'd'.repeat(40);
    const second = deploy([() => ({ id: other, page_url: '' }), status('succeed')], other);
    await second.run;
    expect(second.requests[0]?.params.pages_build_version).toBe(other);
  });

  it('sends the publication commit as the build version to the Pages API', async () => {
    const { run, requests, outputs } = deploy([
      created,
      status('deployment_queued'),
      status('succeed'),
    ]);
    await run;
    expect(requests[0]).toEqual({
      route: 'POST /repos/{owner}/{repo}/pages/deployments',
      params: {
        owner: 'o',
        repo: 'r',
        artifact_id: 42,
        pages_build_version: version,
        oidc_token: 'oidc',
      },
    });
    expect(requests.slice(1).map((request) => request.params.id)).toEqual([version, version]);
    expect(outputs.page_url).toBe('https://example.test/calendar/');
  });

  it('retries a refusal that names an in-progress deployment', async () => {
    const { run, requests } = deploy([refused, refused, created, status('succeed')]);
    await run;
    expect(requests.map((request) => request.route)).toEqual([
      'POST /repos/{owner}/{repo}/pages/deployments',
      'POST /repos/{owner}/{repo}/pages/deployments',
      'POST /repos/{owner}/{repo}/pages/deployments',
      'GET /repos/{owner}/{repo}/pages/deployments/{id}',
    ]);
  });

  // Whether Pages accepts a gh-pages commit is unproven; a 404 must not stop publishing.
  it('falls back once to GITHUB_SHA when Pages answers 404 for the gh-pages commit', async () => {
    const fallback = deploy([() => ({ id: headSha, page_url: '' }), status('succeed')], version, [
      headSha,
    ]);
    await fallback.run;
    expect(fallback.requests.map((request) => request.params.pages_build_version)).toEqual([
      version,
      headSha,
      undefined,
    ]);
    expect(fallback.requests[2]?.params.id).toBe(headSha);
    await expect(deploy([], version, []).run).rejects.toThrow('Not Found');
  });

  it('fails on another refusal, a failed deployment and a timeout', async () => {
    const forbidden = () => Object.assign(new Error('Forbidden'), { status: 403 });
    await expect(deploy([forbidden]).run).rejects.toThrow('Forbidden');
    await expect(deploy([created, status('deployment_failed')]).run).rejects.toThrow(
      'deployment_failed',
    );
    const stuck = deploy(Array.from({ length: 30 }, () => refused));
    await expect(stuck.run).rejects.toThrow('in progress deployment');
    expect(stuck.requests).toHaveLength(21);
    const queued = Array.from({ length: 200 }, () => status('deployment_queued'));
    const cancel = vi.fn(() => ({}));
    const timedOut = deploy([created, ...queued.slice(0, 120), cancel]);
    await expect(timedOut.run).rejects.toThrow('timed out and was cancelled');
    expect(cancel).toHaveBeenCalledOnce();
    expect(timedOut.requests.at(-1)?.route).toBe(
      'POST /repos/{owner}/{repo}/pages/deployments/{id}/cancel',
    );
  });
});
