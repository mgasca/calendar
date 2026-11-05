import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
import { documentRoutes } from './src/lib/docs-loader';

const { site, base } = deployment(process.env.DOCS_SITE_URL);
// The flows become sidebar entries, so the model is read once here; the loader validates it.
const { flows } = parseArchitecture(
  readFileSync(new URL(modelFile, architectureDirectory), 'utf8'),
);
export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  // The site has no landing page of its own: the root opens the architecture overview. Astro does
  // not prefix redirect targets with the base, so it is added here.
  redirects: { '/': `${base}architecture/` },
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
    // Renders ```mermaid blocks in the browser (ADR-0039); it must register before Starlight. It
    // registers the ELK layout because `@mermaid-js/layout-elk` resolves from here; only the
    // architecture overview opts into it, in its frontmatter. `radius` rounds the rounded node
    // shape the generator emits; padding and spacing give the text and the edge labels room.
    // `themeCSS` puts each edge label on a solid, padded patch of the page background, so an arrow
    // never runs through its text; it is Mermaid's own CSS because Mermaid sizes the label with it
    // (page CSS arrives too late), and it needs `!important` over Mermaid's id-scoped label rules.
    // Shadows and rounded subgraphs are page CSS (src/styles/docs.css).
    mermaid({
      autoTheme: true,
      enableLog: false,
      mermaidConfig: {
        themeVariables: { radius: 8 },
        flowchart: { padding: 22, nodeSpacing: 60, rankSpacing: 90 },
        themeCSS: [
          '.labelBkg { background-color: var(--sl-color-bg) !important; border-radius: 4px; }',
          '.edgeLabel p { background-color: var(--sl-color-bg) !important; padding: 2px 6px; border-radius: 4px; }',
          '.edgeLabel rect { fill: var(--sl-color-bg) !important; opacity: 1 !important; }',
        ].join(' '),
      },
    }),
    starlight({
      title: 'Calendar · Docs',
      description:
        'Architecture decisions, user stories, the architecture model, runbooks and benchmarks for Calendar, ' +
        'with their context, alternatives, consequences and user guides.',
      social: [{ icon: 'github', label: 'GitHub', href: repository }],
      customCss: ['./src/styles/docs.css'],
      sidebar: [
        { label: 'Architecture', items: architectureSidebar(flows) },
        {
          label: 'Architecture decisions',
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
