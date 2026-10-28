import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deployment, storySlug } from '../src/lib/adr';
import { readDocuments } from '../src/lib/docs-loader';

const { base } = deployment(process.env.DOCS_SITE_URL);

async function pages(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return pages(path);
      return entry.name.endsWith('.html') ? [path] : [];
    }),
  );
  return nested.flat();
}

/** Returns the built file behind a site-relative href, or undefined for links that leave the site. */
function builtFile(href: string): string | undefined {
  if (!href.startsWith(base)) return undefined;
  const path = href.slice(base.length).split(/[?#]/)[0] ?? '';
  return join('dist', path.endsWith('/') || path === '' ? join(path, 'index.html') : path);
}

function sidebarRoutes(html: string) {
  const sidebar = /<sl-sidebar-pane\b[^>]*>([\s\S]*?)<\/sl-sidebar-pane>/.exec(html)?.[1];
  expect(sidebar).toBeDefined();
  return [...(sidebar ?? '').matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '');
}

describe('published documentation links', () => {
  it('resolves every internal link and anchor, and leaves no repository Markdown links', async () => {
    const files = await pages('dist');
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const html = await readFile(file, 'utf8');
      for (const [, href = ''] of html.matchAll(/href="([^"]*)"/g)) {
        // Absolute links leave the site; GitHub links to repository Markdown are expected.
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) continue;
        expect(href, file).not.toMatch(/\.md(?:[?#]|$)/);
        if (!href.startsWith(base)) continue;
        // Starlight's default icon link; the site does not ship a favicon yet.
        if (href === `${base}favicon.svg`) continue;
        const target = builtFile(href);
        expect(target, `${file} -> ${href}`).toBeDefined();
        const fragment = href.split('#')[1];
        // Reading the page fails if it is missing, so no separate existence check is needed.
        if (fragment && target?.endsWith('.html')) {
          const targetHtml = await readFile(target, 'utf8');
          expect(targetHtml, `${file} -> ${href}`).toContain(`id="${fragment}"`);
        } else {
          await stat(target ?? '');
        }
      }
    }
  });
});

describe('published ADR log', () => {
  it('renders every record with navigation, current selection, headings and base-aware links', async () => {
    const { adr } = await readDocuments();
    const { records } = adr;
    const index = await readFile('dist/index.html', 'utf8');
    for (const record of records) {
      const route = `${base}adr/${record.number}/`;
      expect(index).toContain(`href="${route}"`);
      const html = await readFile(`dist/adr/${record.number}/index.html`, 'utf8');
      const routes = sidebarRoutes(html);
      expect(routes.filter((href) => href.startsWith(`${base}adr/`))).toEqual(
        records.map((item) => `${base}adr/${item.number}/`),
      );
      expect(routes.filter((href) => href === base)).toHaveLength(1);
      const activeLinks = html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
      expect(activeLinks.length).toBeGreaterThan(0);
      expect(activeLinks.every((link) => link.includes(`href="${route}"`))).toBe(true);
      expect(html).toMatch(new RegExp(`<h1[^>]*>${record.number} · `));
      expect(html).toContain(`<strong>Status:</strong> ${record.status}`);
      expect(html).toContain('id="context-and-problem-statement"');
      expect(html).toContain('popovertarget="starlight__sidebar"');
      expect(html).toContain('pagefind');
      expect(html).toContain(`${base}_astro/`);
    }
    await access('dist/pagefind/pagefind.js');
  });
});

describe('published user stories', () => {
  it('renders every story with navigation, status, ADR links and the story index', async () => {
    const { story } = await readDocuments();
    const storyRoutes = story.records.map((record) => `${base}stories/${storySlug(record.file)}/`);
    const index = await readFile('dist/stories/index.html', 'utf8');
    for (const route of storyRoutes) expect(index).toContain(`href="${route}"`);
    for (const record of story.records) {
      const route = `${base}stories/${storySlug(record.file)}/`;
      const html = await readFile(`dist/stories/${storySlug(record.file)}/index.html`, 'utf8');
      const routes = sidebarRoutes(html);
      expect(routes.filter((href) => href.startsWith(`${base}stories/`))).toEqual([
        `${base}stories/`,
        ...storyRoutes,
      ]);
      const activeLinks = html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
      expect(activeLinks.length).toBeGreaterThan(0);
      expect(activeLinks.every((link) => link.includes(`href="${route}"`))).toBe(true);
      expect(html).toMatch(new RegExp(`<h1[^>]*>${record.number} · `));
      expect(html).toContain(`<strong>Status:</strong> ${record.status}`);
      expect(html).toContain(`<strong>Date:</strong> ${record.date}`);
      if (record.pr) expect(html).toContain(`href="${record.pr}"`);
      for (const adr of record.adrs) {
        expect(html).toContain(`href="${base}adr/${adr}/"`);
      }
    }
  });
});
