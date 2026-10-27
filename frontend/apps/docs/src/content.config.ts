import { defineCollection } from 'astro:content';
import { docsSchema } from '@astrojs/starlight/schema';
import { adrLoader } from './lib/adr-loader';

export const collections = {
  docs: defineCollection({ loader: adrLoader(), schema: docsSchema() }),
};
