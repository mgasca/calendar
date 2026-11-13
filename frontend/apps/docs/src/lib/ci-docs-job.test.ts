import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../../../../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);

// The steps of the Docs site job, by name, each with its `if:` condition (folded `>-` blocks joined).
function docsSteps() {
  const job = workflow.split('\n  docs:\n')[1]?.split(/\n {2}\w[\w-]*:\n/)[0] ?? '';
  return job
    .split('\n      - ')
    .slice(1)
    .map((step) => {
      const name = /^(?:name: )(.+)$/m.exec(step)?.[1] ?? '';
      const folded = /^ {8}if: >-\n((?: {10}.+\n?)+)/m.exec(step)?.[1];
      const inline = /^ {8}if: (?!>-)(.+)$/m.exec(step)?.[1];
      const condition = (folded ?? inline ?? '').replace(/\s+/g, ' ').trim();
      return { name, condition };
    });
}

describe('Docs site CI job (#755)', () => {
  const steps = docsSteps();
  const index = (name: string) => steps.findIndex((step) => step.name === name);

  it('builds at a project subpath exactly once on every path', () => {
    // The publication URL is a project subpath, so the example subpath build runs only without it.
    const pages = steps[index('Read GitHub Pages configuration')];
    const subpath = steps[index('Verify docs site at a project subpath')];
    const publication = steps[index('Build and verify publication artifact')];
    expect(pages?.condition).toContain("github.event_name == 'push'");
    expect(subpath?.condition).toBe("steps.pages.outcome != 'success'");
    expect(publication?.condition).toBe("steps.pages.outcome == 'success'");
  });

  it('reads the Pages configuration before the steps that depend on it', () => {
    const pages = index('Read GitHub Pages configuration');
    expect(pages).toBeGreaterThanOrEqual(0);
    expect(pages).toBeLessThan(index('Verify docs site at a project subpath'));
    expect(pages).toBeLessThan(index('Build and verify publication artifact'));
  });
});
