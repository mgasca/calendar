import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import mermaid from 'astro-mermaid';
import { deployment, remarkDocLinks, repository } from './src/lib/adr';
import {
  architectureDirectory,
  architectureSidebar,
  modelFile,
  parseArchitecture,
} from './src/lib/architecture';
import { dashboardSidebar } from './src/lib/dashboard';
import { documentRoutes } from './src/lib/docs-loader';
import { staticThemeFallback } from './src/lib/static-theme';
import { mermaidThemeCss } from './src/lib/mermaid-theme';
import { colour, readPalettes } from './src/lib/theme-palette';

const palettes = readPalettes();
const { site, base } = deployment(process.env.DOCS_SITE_URL);
// The flows become sidebar entries, so the model is read once here; the loader validates it.
const { flows } = parseArchitecture(
  readFileSync(new URL(modelFile, architectureDirectory), 'utf8'),
);
// The site opens on the first agent thought, which says why the repository exists (story 0031).
// The loader uses the same filename order and validates each report.
const firstAgentThought = readdirSync(new URL('../../../docs/agent-thoughts/', import.meta.url))
  .filter((name) => /^\d{4}-.+\.md$/.test(name))
  .sort()[0]
  ?.slice(0, 4);
if (firstAgentThought === undefined)
  throw new Error('docs/agent-thoughts has no report to open on');

/**
 * Turns off Mermaid's own render-on-load the moment the module evaluates. Mermaid adds a window
 * `load` listener that renders every `.mermaid` element unless `startOnLoad` is false, and
 * astro-mermaid sets that only in its own module script, after Mermaid has loaded (with Mermaid 11
 * it also waited for the separate ELK package, which made the gap wide). When `load` fires in that
 * gap (a slow network), Mermaid renders the diagrams itself, with its default config and without
 * keeping their source, and the next theme switch re-renders the SVG's text and fails. This
 * callback runs in the same microtask checkpoint as astro-mermaid's, before any `load` task.
 */
const mermaidNoAutoStart: AstroIntegration = {
  name: 'mermaid-no-auto-start',
  hooks: {
    'astro:config:setup': ({ injectScript }) => {
      injectScript(
        'page',
        "if (document.querySelector('pre.mermaid')) {" +
          " import('mermaid').then(({ default: mermaid }) => { mermaid.startOnLoad = false; }); }",
      );
    },
  },
};

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  // The site has no landing page of its own: the root opens the first agent thought. Astro does not
  // prefix redirect targets with the base, so it is added here.
  redirects: { '/': `${base}agent-thoughts/${firstAgentThought}/` },
  markdown: {
    processor: unified({
      remarkPlugins: [
        [
          remarkDocLinks,
          {
            root: fileURLToPath(new URL('../../../', import.meta.url)),
            base,
            links: documentRoutes,
          },
        ],
      ],
    }),
  },
  integrations: [
    mermaidNoAutoStart,
    // Removes Starlight's static data-theme from the built pages so the OS fallback works without JS.
    staticThemeFallback,
    // Renders ```mermaid blocks in the browser (ADR-0039); it must register before Starlight.
    // Mermaid 12 bundles ELK and makes it the default layout; `layout: 'dagre'` and
    // `look: 'classic'` keep the Mermaid 11 layout and look, and only the architecture overview
    // opts into ELK, in its frontmatter. `radius` rounds the rounded node shape the generator
    // emits; padding and spacing give the text and the edge labels room.
    // `themeCSS` (src/lib/mermaid-theme.ts) paints the nodes, edges and sequence parts from the shared
    // theme tokens, which follow data-theme, so no colour is copied here; it is Mermaid's own CSS
    // because Mermaid sizes the edge labels with it (page CSS arrives too late). Shadows and rounded subgraphs are page CSS (src/styles/docs.css).
    mermaid({
      autoTheme: true,
      enableLog: false,
      mermaidConfig: {
        layout: 'dagre',
        look: 'classic',
        themeVariables: { radius: 8 },
        flowchart: { padding: 22, nodeSpacing: 60, rankSpacing: 90 },
        themeCSS: mermaidThemeCss,
      },
    }),
    starlight({
      title: 'Calendar · Docs',
      description:
        'Agent thoughts, any decision records, user stories, the architecture model, runbooks and benchmarks for Calendar, ' +
        'with their context, alternatives, consequences and user guides.',
      social: [{ icon: 'github', label: 'GitHub', href: repository }],
      // One theme controller: Starlight's own provider and picker (and its starlight-theme key) are
      // replaced by the Calendar ones (story 0046).
      components: {
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      // The code blocks use GitHub's syntax colours, on the page's own code surface: the editor
      // background is the shared token's value, so Expressive Code adjusts syntax contrast against it.
      expressiveCode: {
        themes: ['github-light', 'github-dark'],
        customizeTheme: (theme) => {
          const palette = theme.type === 'dark' ? palettes.dark : palettes.light;
          theme.colors['editor.background'] = colour(palette, 'surface-sunken');
          theme.colors['editor.foreground'] = colour(palette, 'text');
          return theme;
        },
        styleOverrides: {
          borderRadius: 'var(--radius-md)',
          borderColor: 'var(--color-border-strong)',
          codeBackground: 'var(--color-surface-sunken)',
          codeForeground: 'var(--color-text)',
        },
      },
      customCss: [
        '@calendar/theme/fonts.css',
        '@calendar/theme/tokens.css',
        './src/styles/theme-adapter.css',
        './src/styles/theme-control.css',
        './src/styles/theme-content.css',
        './src/styles/docs.css',
      ],
      sidebar: [
        {
          label: 'Agent thoughts',
          items: [
            { slug: 'agent-thoughts', label: 'All agent thoughts' },
            { autogenerate: { directory: '../../../docs/agent-thoughts' } },
          ],
        },
        { label: 'Architecture', items: architectureSidebar(flows) },
        // One entry per page of src/lib/dashboard.ts, so a new dashboard page needs no change here.
        { label: 'Delivery dashboard', items: dashboardSidebar() },
        {
          label: 'Any decision records',
          items: [{ autogenerate: { directory: '../../../docs/decisions' } }],
        },
        {
          label: 'User stories',
          items: [
            { slug: 'stories', label: 'All stories' },
            { autogenerate: { directory: '../../../docs/stories' } },
          ],
        },
        {
          label: 'Runbooks',
          items: [
            { slug: 'runbooks', label: 'All runbooks' },
            { autogenerate: { directory: '../../../docs/runbooks' } },
          ],
        },
        {
          label: 'Benchmarks',
          items: [
            { slug: 'benchmarks', label: 'All benchmarks' },
            { autogenerate: { directory: '../../../docs/benchmarks' } },
          ],
        },
      ],
    }),
  ],
});
