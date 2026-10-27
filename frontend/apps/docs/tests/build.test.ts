import { readFile, access } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { deployment } from '../src/lib/adr';
import { readLog } from '../src/lib/adr-loader';

describe('published ADR log', () => {
  it('renders every record with navigation, current selection, headings and base-aware links', async () => {
    const { records } = await readLog();
    const { base } = deployment(process.env.DOCS_SITE_URL);
    const index = await readFile('dist/index.html', 'utf8');
    for (const record of records) {
      const route = `${base}adr/${record.number}/`;
      expect(index).toContain(`href="${route}"`);
      const html = await readFile(`dist/adr/${record.number}/index.html`, 'utf8');
      const sidebar = /<sl-sidebar-pane\b[^>]*>([\s\S]*?)<\/sl-sidebar-pane>/.exec(html)?.[1];
      expect(sidebar).toBeDefined();
      const sidebarRoutes = [...(sidebar ?? '').matchAll(/href="([^"]*)"/g)].map(
        (match) => match[1],
      );
      expect(sidebarRoutes.filter((href) => href?.startsWith(`${base}adr/`))).toEqual(
        records.map((item) => `${base}adr/${item.number}/`),
      );
      expect(sidebarRoutes.filter((href) => href === base)).toHaveLength(1);
      for (const item of records) expect(sidebar).toContain(`href="${base}adr/${item.number}/"`);
      const activeLinks = html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
      expect(activeLinks.length).toBeGreaterThan(0);
      expect(activeLinks.every((link) => link.includes(`href="${route}"`))).toBe(true);
      expect(html).toMatch(new RegExp(`<h1[^>]*>${record.number} · `));
      expect(html).toContain(`<strong>Status:</strong> ${record.status}`);
      expect(html).toContain('id="context-and-problem-statement"');
      expect(html).toContain('popovertarget="starlight__sidebar"');
      expect(html).toContain('pagefind');
      expect(html).not.toMatch(/href="(?:\.\/)?\d{4}-[^"/]+\.md/);
      expect(html).toContain(`${base}_astro/`);
    }
    await access('dist/pagefind/pagefind.js');
  });
});
