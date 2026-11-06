import { describe, expect, it } from 'vitest';

import config from '../vite.config.ts';

// The web tests share one jsdom per worker instead of building one per file (#275, record 0005). Turning isolation
// back on keeps every test passing and only makes the suite slower, so nothing else would notice (#387).
describe('the web test project', () => {
  it('runs without per-file isolation', () => {
    const web = config.test?.projects?.find(
      (project) => typeof project === 'object' && 'test' in project && project.test.name === 'web',
    );

    expect(web).toBeDefined();
    expect(web && typeof web === 'object' && 'test' in web ? web.test.isolate : undefined).toBe(
      false,
    );
  });
});
