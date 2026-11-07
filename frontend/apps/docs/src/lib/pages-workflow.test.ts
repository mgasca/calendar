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

const version = 'a'.repeat(40);
const headSha = 'b'.repeat(40);

// Runs the deploy step against a fake Pages API: replies are consumed in order, and a reply
// that is an Error is thrown, as Octokit throws a RequestError.
function deploy(replies: Reply[]) {
  const requests: Request[] = [];
  const outputs: Record<string, string> = {};
  let clock = 0;
  const deployScript = stepScript('Deploy production and previews');
  const run = runInNewContext(`(async () => { ${deployScript} })()`, {
    process: {
      env: { BUILD_VERSION: version, ARTIFACT_ID: '42', GITHUB_SHA: headSha },
    },
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
  it('gives separate publications and retries distinct SHA-shaped build versions', async () => {
    const versions = await Promise.all([
      publication(100, '1'),
      publication(101, '1'),
      publication(100, '2'),
    ]);
    for (const output of versions) {
      expect(output.deploy).toBe('true');
      expect(output.version).toMatch(/^[a-f0-9]{40}$/);
    }
    expect(new Set(versions.map((output) => output.version)).size).toBe(3);
  });

  it('does not deploy an obsolete snapshot, including on a retry', async () => {
    expect(await publication(100, '2', 'newer-snapshot')).toEqual({});
  });

  // #429: the runner ignores a step `env` that sets GITHUB_* or RUNNER_*, so such an override
  // only looks like it works. #339 set GITHUB_SHA for actions/deploy-pages this way.
  it('never relies on overriding a default GITHUB_* or RUNNER_* variable', () => {
    expect(workflow).not.toMatch(/^\s+(GITHUB|RUNNER)_[A-Z_]+:/m);
  });

  it('sends the run-specific build version, not GITHUB_SHA, to the Pages API', async () => {
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
