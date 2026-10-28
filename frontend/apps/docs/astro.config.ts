import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import { deployment, remarkDocLinks, repository } from './src/lib/adr';
import { documentRoutes } from './src/lib/docs-loader';

const { site, base } = deployment(process.env.DOCS_SITE_URL);
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
    starlight({
      title: 'Calendar · Docs',
      description:
        'Architecture decisions and user stories for Calendar, with their context, alternatives, consequences and user guides.',
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
      ],
    }),
  ],
});
