import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import { deployment, remarkAdrLinks, repository } from './src/lib/adr';
import { readLog } from './src/lib/adr-loader';

const { site, base } = deployment(process.env.DOCS_SITE_URL);
export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  markdown: {
    processor: unified({
      remarkPlugins: [
        [
          remarkAdrLinks,
          {
            base,
            files: async () => new Set((await readLog()).records.map((record) => record.file)),
          },
        ],
      ],
    }),
  },
  integrations: [
    starlight({
      title: 'Calendar · ADR Log',
      description:
        'Architecture decisions for Calendar, with their context, alternatives and consequences.',
      social: [{ icon: 'github', label: 'GitHub', href: repository }],
      customCss: ['./src/styles/docs.css'],
      sidebar: [
        { slug: 'index' },
        {
          label: 'Architecture decisions',
          items: [{ autogenerate: { directory: '../../../docs/decisions' } }],
        },
      ],
    }),
  ],
});
