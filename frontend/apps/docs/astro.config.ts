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
    // Renders ```mermaid blocks in the browser (ADR-0039); it must register before Starlight.
    mermaid({ autoTheme: true, enableLog: false }),
    starlight({
      title: 'Calendar · Docs',
      description:
        'Architecture decisions, user stories, the architecture model, runbooks and benchmarks for Calendar, ' +
        'with their context, alternatives, consequences and user guides.',
      social: [{ icon: 'github', label: 'GitHub', href: repository }],
      customCss: ['./src/styles/docs.css'],
      sidebar: [
        { slug: 'index' },
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
        { label: 'Architecture', items: architectureSidebar(flows) },
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
