import { describe, expect, it } from 'vitest';
import config from '../../vitest.config';

describe('docs test configuration (#755)', () => {
  it('measures coverage with Istanbul, which leaves third-party parsers uninstrumented', () => {
    // V8 coverage made `test:coverage` about four times slower; see vitest.config.ts.
    expect(config.test?.coverage?.provider).toBe('istanbul');
  });
});
