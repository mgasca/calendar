import { describe, expect, it } from 'vitest';
import { brokenLinks, type SiteFiles } from './siteLinks';

const base = '/calendar/';

/** An in-memory built site that counts every file operation the check makes. */
function site(contents: Record<string, string>) {
  const calls = { readFile: [] as string[], exists: [] as string[] };
  const files: SiteFiles = {
    readFile(path) {
      calls.readFile.push(path);
      const text = contents[path];
      return text === undefined
        ? Promise.reject(new Error(`ENOENT ${path}`))
        : Promise.resolve(text);
    },
    exists(path) {
      calls.exists.push(path);
      return Promise.resolve(path in contents);
    },
  };
  return { files, calls };
}

describe('brokenLinks', () => {
  it('reports Markdown links, unbuilt targets and missing anchors', async () => {
    const { files } = site({
      'dist/a/index.html': [
        '<a href="/calendar/b/#here">',
        '<a href="/calendar/b/#gone">',
        '<a href="/calendar/missing/">',
        '<a href="docs/stories/README.md">',
        '<a href="https://github.com/x/y/blob/main/README.md">',
        '<a href="#local">',
        '<a href="/calendar/favicon.svg">',
      ].join(''),
      'dist/b/index.html': '<h2 id="here">Here</h2><div data-id="gone"></div>',
    });
    expect(await brokenLinks(['dist/a/index.html', 'dist/b/index.html'], base, files)).toEqual([
      'dist/a/index.html -> /calendar/b/#gone: no id="gone"',
      'dist/a/index.html -> /calendar/missing/: dist/missing/index.html was not built',
      'dist/a/index.html -> docs/stories/README.md: links to repository Markdown',
    ]);
  });

  it('reads each page once and checks each other target once, however many links point at it', async () => {
    const links = Array.from({ length: 50 }, (_, i) =>
      [
        `<a href="/calendar/b/#s${String(i % 2)}">`,
        '<a href="/calendar/b/">',
        '<a href="/calendar/logo.png">',
        '<a href="/calendar/c/#top">',
      ].join(''),
    ).join('');
    const { files, calls } = site({
      'dist/a/index.html': links,
      'dist/b/index.html': `${links}<p id="s0"></p><p id="s1"></p>`,
      // A target page outside the list that was read: read once for its ids.
      'dist/c/index.html': '<main id="top"></main>',
      'dist/logo.png': 'png',
    });
    expect(await brokenLinks(['dist/a/index.html', 'dist/b/index.html'], base, files)).toEqual([]);
    expect(calls.readFile.sort()).toEqual([
      'dist/a/index.html',
      'dist/b/index.html',
      'dist/c/index.html',
    ]);
    expect(calls.exists.sort()).toEqual(['dist/c/index.html', 'dist/logo.png']);
  });
});
