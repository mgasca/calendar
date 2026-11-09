import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// `corepack pnpm --dir frontend …` run from the repository root makes Corepack start its default pnpm,
// which then refuses the version pinned in frontend/package.json (ERR_PNPM_BAD_PM_VERSION, story 0054).
// Guidance must use a `just frontend` recipe or `cd frontend` first.
const root = new URL('../../../../../', import.meta.url);
const guidanceFiles = [
  'AGENTS.md',
  'backend/AGENTS.md',
  'frontend/AGENTS.md',
  '.claude/skills/run-calendar/SKILL.md',
  '.claude/skills/story-draft/SKILL.md',
  'docs/architecture/README.md',
  'docs/runbooks/web-theme-and-styling.md',
];

describe('guidance commands', () => {
  it.each(guidanceFiles)('%s does not run pnpm with --dir from the repository root', (file) => {
    const text = readFileSync(fileURLToPath(new URL(file, root)), 'utf8');
    expect(text).not.toMatch(/pnpm\s+--dir\s+frontend/);
  });
});
