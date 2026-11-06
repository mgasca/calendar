import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deployment, runbookSlug, storySlug } from '../src/lib/adr';
import { architecturePages, pageRoute } from '../src/lib/architecture';
import { readAgentThoughts, readDocuments } from '../src/lib/docs-loader';

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

/** The labels of the sidebar's groups, nested ones included, in page order. */
function sidebarGroups(html: string) {
  const sidebar = /<sl-sidebar-pane\b[^>]*>([\s\S]*?)<\/sl-sidebar-pane>/.exec(html)?.[1] ?? '';
  return [...sidebar.matchAll(/<span class="large[^"]*">([^<]*)<\/span>/g)].map((m) => m[1] ?? '');
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

describe('site root', () => {
  it('redirects to the architecture overview and lists Architecture first in the sidebar', async () => {
    const index = await readFile('dist/index.html', 'utf8');
    expect(index).toContain(`http-equiv="refresh"`);
    expect(index).toContain(`url=${base}architecture/`);
    const overview = await readFile('dist/architecture/index.html', 'utf8');
    const routes = sidebarRoutes(overview);
    expect(routes[0]).toBe(`${base}architecture/`);
    // The decision log has no page of its own, so nothing in the sidebar links to the root.
    expect(routes).not.toContain(base);
    expect(routes.indexOf(`${base}architecture/controls/`)).toBeLessThan(
      routes.findIndex((href) => href.startsWith(`${base}adr/`)),
    );
  });
});

describe('published agent thoughts', () => {
  it('puts the Agent thoughts group directly after Architecture in the sidebar', async () => {
    const overview = await readFile('dist/architecture/index.html', 'utf8');
    const routes = sidebarRoutes(overview);
    // Everything before the first route outside Architecture belongs to it; the group follows.
    const next = routes.find((href) => !href.startsWith(`${base}architecture/`));
    expect(next).toBe(`${base}agent-thoughts/`);
    const groups = sidebarGroups(overview);
    expect(groups[0]).toBe('Architecture');
    expect(groups.indexOf('Agent thoughts')).toBe(groups.indexOf('Any decision records') - 1);
  });

  it('renders every report with navigation, its date, author, revision and edit link', async () => {
    // Only the reports are needed: reading the whole corpus costs about half a second per call.
    const agentThought = await readAgentThoughts();
    const reportRoutes = agentThought.records.map(
      (record) => `${base}agent-thoughts/${record.number}/`,
    );
    const index = await readFile('dist/agent-thoughts/index.html', 'utf8');
    for (const route of reportRoutes) expect(index).toContain(`href="${route}"`);
    for (const record of agentThought.records) {
      const route = `${base}agent-thoughts/${record.number}/`;
      const html = await readFile(`dist/agent-thoughts/${record.number}/index.html`, 'utf8');
      const routes = sidebarRoutes(html);
      expect(routes.filter((href) => href.startsWith(`${base}agent-thoughts/`))).toEqual([
        `${base}agent-thoughts/`,
        ...reportRoutes,
      ]);
      const activeLinks = html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
      expect(activeLinks.length).toBeGreaterThan(0);
      expect(activeLinks.every((link) => link.includes(`href="${route}"`))).toBe(true);
      expect(html).toMatch(new RegExp(`<h1[^>]*>${record.number} · `));
      expect(html).toContain(`<strong>Date:</strong> ${record.date}`);
      expect(html).toContain(`<strong>Author:</strong> ${record.author}`);
      expect(html).toContain(`href="https://github.com/mgasca/calendar/tree/${record.revision}"`);
      expect(html).toContain(`/edit/main/docs/agent-thoughts/${record.file}"`);
    }
  });
});

describe('published ADRs', () => {
  it('renders every record with navigation, current selection, headings and base-aware links', async () => {
    const { adr } = await readDocuments();
    const { records } = adr;
    for (const record of records) {
      const route = `${base}adr/${record.number}/`;
      const html = await readFile(`dist/adr/${record.number}/index.html`, 'utf8');
      const routes = sidebarRoutes(html);
      expect(routes.filter((href) => href.startsWith(`${base}adr/`))).toEqual(
        records.map((item) => `${base}adr/${item.number}/`),
      );
      expect(routes).not.toContain(base);
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
      if (record.issue) expect(html).toContain(`href="${record.issue}"`);
      for (const url of record.pr) expect(html).toContain(`href="${url}"`);
      for (const adr of record.adrs) {
        expect(html).toContain(`href="${base}adr/${adr}/"`);
      }
    }
  });
});

describe('published architecture', () => {
  it('ships the ELK layout the overview asks for', async () => {
    // Mermaid falls back to its default layout without a word when a diagram names a layout that
    // was never registered. Mermaid 12 bundles ELK as its own lazily loaded chunk.
    const overview = await readFile('dist/architecture/index.html', 'utf8');
    expect(overview).toContain('layout: elk');
    const assets = await readdir('dist/_astro');
    expect(assets.some((name) => /^elk-.*\.js$/.test(name))).toBe(true);
  });

  it("turns off Mermaid's own render-on-load in the page script", async () => {
    // Loading ELK leaves a gap before astro-mermaid configures Mermaid; if the window `load` event
    // lands in it, Mermaid renders the diagrams itself without keeping their source, and the next
    // theme switch fails with "Error rendering diagram". astro.config.ts closes the gap by setting
    // the `startOnLoad` property as soon as the module loads; the config's `startOnLoad: false` is
    // an object literal, so only that assignment matches here. The race itself needs a browser.
    const scripts = (await readdir('dist/_astro')).filter((name) => name.endsWith('.js'));
    const sources = await Promise.all(
      scripts.map((name) => readFile(`dist/_astro/${name}`, 'utf8')),
    );
    expect(sources.some((source) => /\.startOnLoad\s*=\s*(?:!1|false)\b/.test(source))).toBe(true);
  });

  it('renders every page from the model with a diagram, its text table and links to decisions and stories', async () => {
    const { architecture, story } = await readDocuments();
    const pages = architecturePages(architecture, { stories: story.records });
    const overview = await readFile('dist/architecture/index.html', 'utf8');
    for (const slug of [
      'architecture/containers',
      'architecture/components',
      'architecture/controls',
    ]) {
      expect(overview).toContain(`href="${base}${slug}/"`);
    }
    for (const page of pages) {
      const html = await readFile(`dist/${pageRoute(page.id)}index.html`, 'utf8');
      expect(html).toMatch(/<h1[^>]*>/);
      const routes = sidebarRoutes(html);
      expect(routes).toContain(`${base}architecture/`);
      for (const flow of architecture.flows)
        expect(routes).toContain(`${base}architecture/flows/${flow.id}/`);
      // Component pages stay out of the sidebar; everything else in the section is listed.
      expect(routes.includes(`${base}${pageRoute(page.id)}`)).toBe(!page.sidebar.hidden);
      if (page.body.includes('```mermaid')) {
        expect(html, page.id).toContain('<pre class="mermaid">');
        expect(html, page.id).toContain('<table');
      }
    }
    const stories = new Map(architecture.stories.map((item) => [item.id, item.url]));
    for (const node of architecture.nodes) {
      const html = await readFile(`dist/architecture/components/${node.id}/index.html`, 'utf8');
      for (const id of node.adrs)
        expect(html, node.id).toContain(`href="${base}adr/${id.slice('ADR-'.length)}/"`);
    }
    for (const flow of architecture.flows) {
      const html = await readFile(`dist/architecture/flows/${flow.id}/index.html`, 'utf8');
      for (const id of flow.adrs)
        expect(html, flow.id).toContain(`href="${base}adr/${id.slice('ADR-'.length)}/"`);
      for (const id of flow.stories) {
        const slug = /\/stories\/([^/]+)\/$/.exec(stories.get(id) ?? '')?.[1] ?? '';
        expect(html, flow.id).toContain(`href="${base}stories/${slug}/"`);
      }
    }
  });
});

describe('published runbooks', () => {
  it('renders every runbook in index order, with navigation, headings and ADR links', async () => {
    const { runbook } = await readDocuments();
    const runbookRoutes = runbook.records.map(
      (record) => `${base}runbooks/${runbookSlug(record.file)}/`,
    );
    const index = await readFile('dist/runbooks/index.html', 'utf8');
    for (const route of runbookRoutes) expect(index).toContain(`href="${route}"`);
    for (const record of runbook.records) {
      const route = `${base}runbooks/${runbookSlug(record.file)}/`;
      const html = await readFile(`dist/runbooks/${runbookSlug(record.file)}/index.html`, 'utf8');
      const routes = sidebarRoutes(html);
      expect(routes.filter((href) => href.startsWith(`${base}runbooks/`))).toEqual([
        `${base}runbooks/`,
        ...runbookRoutes,
      ]);
      const activeLinks = html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
      expect(activeLinks.length).toBeGreaterThan(0);
      expect(activeLinks.every((link) => link.includes(`href="${route}"`))).toBe(true);
      expect(html).toMatch(new RegExp(`<h1[^>]*>${record.title}<`));
      expect(html).toContain('id="before-you-start"');
      // Every runbook cites at least one decision, and the citation is a site route.
      expect(html).toMatch(new RegExp(`href="${base}adr/\\d{4}/"`));
      expect(html).toContain(`/edit/main/docs/runbooks/${record.file}"`);
    }
  });
});

describe('published benchmarks', () => {
  it('renders every record with navigation, its subject and a GitHub link to its harness', async () => {
    const { benchmark, architecture } = await readDocuments();
    const recordRoutes = benchmark.records.map((record) => `${base}benchmarks/${record.number}/`);
    const index = await readFile('dist/benchmarks/index.html', 'utf8');
    for (const route of recordRoutes) expect(index).toContain(`href="${route}"`);
    for (const record of benchmark.records) {
      const route = `${base}benchmarks/${record.number}/`;
      const html = await readFile(`dist/benchmarks/${record.number}/index.html`, 'utf8');
      const routes = sidebarRoutes(html);
      expect(routes.filter((href) => href.startsWith(`${base}benchmarks/`))).toEqual([
        `${base}benchmarks/`,
        ...recordRoutes,
      ]);
      const activeLinks = html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
      expect(activeLinks.length).toBeGreaterThan(0);
      expect(activeLinks.every((link) => link.includes(`href="${route}"`))).toBe(true);
      expect(html).toMatch(new RegExp(`<h1[^>]*>${record.number} · `));
      expect(html).toContain(`<strong>Subject:</strong> ${record.subject}`);
      expect(html).toContain(`/edit/main/docs/benchmarks/${record.file}"`);
    }
    // Runbooks named in the model's metadata link to their published pages, not to GitHub.
    const runbookPaths = /docs\/runbooks\/([a-z0-9-]+)\.md/g;
    for (const node of architecture.nodes) {
      const named = [...JSON.stringify(node.metadata).matchAll(runbookPaths)].map(
        (m) => m[1] ?? '',
      );
      if (!named.length) continue;
      const html = await readFile(`dist/architecture/components/${node.id}/index.html`, 'utf8');
      const main = /<main\b[\s\S]*<\/main>/.exec(html)?.[0] ?? '';
      for (const slug of named) expect(main, node.id).toContain(`href="${base}runbooks/${slug}/"`);
    }
  });
});
