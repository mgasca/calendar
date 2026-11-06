import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const workflow = readFileSync(
  new URL('../../../../../.github/workflows/pages.yml', import.meta.url),
  'utf8',
);
const script = workflow
  .split('      - name: Skip a snapshot a later publication replaced')[1]
  ?.split('          script: |\n')[1]
  ?.split('      - name: Deploy production and previews')[0]
  ?.replace(/^ {12}/gm, '');

async function publication(runId: number, attempt: string, current = 'snapshot') {
  if (!script) throw new Error('Missing current-snapshot workflow script');
  const outputs: Record<string, string> = {};
  await runInNewContext(`(async () => { ${script} })()`, {
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
    expect(workflow).toContain('GITHUB_SHA: ${{ steps.current.outputs.version }}');
  });

  it('does not deploy an obsolete snapshot, including on a retry', async () => {
    expect(await publication(100, '2', 'newer-snapshot')).toEqual({});
  });
});
