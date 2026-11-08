import { describe, expect, it } from 'vitest';

import { withoutStaticTheme } from './static-theme';

describe('withoutStaticTheme (#534)', () => {
  it('removes data-theme from the <html> tag and keeps its other attributes', () => {
    expect(
      withoutStaticTheme(
        '<!doctype html><html lang="en" dir="ltr" data-theme="dark" data-has-toc class="x"><head>',
      ),
    ).toBe('<!doctype html><html lang="en" dir="ltr" data-has-toc class="x"><head>');
  });

  it('leaves data-theme elsewhere in the page alone', () => {
    const page = '<html lang="en"><body><div data-theme="dark"></div></body></html>';
    expect(withoutStaticTheme(page)).toBe(page);
  });

  it('leaves a page without the attribute unchanged', () => {
    const page = '<html lang="en"><head></head></html>';
    expect(withoutStaticTheme(page)).toBe(page);
  });
});
