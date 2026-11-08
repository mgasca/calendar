import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { AstroIntegration } from 'astro';

// Story 0046 (#534). Starlight's Page.astro writes `data-theme="dark"` on <html> as a static
// default. Our start-up script replaces it before first paint, but with JavaScript off it stays
// and defeats the `prefers-color-scheme` fallback of @calendar/theme, which applies only while the
// attribute is absent (as in the web app). Removing the static attribute from the built pages
// leaves the script as the only writer of `data-theme`.

/** The page with `data-theme` removed from its `<html>` tag; anything else is left as it is. */
export function withoutStaticTheme(html: string): string {
  return html.replace(/<html\b[^>]*>/, (tag) => tag.replace(/\sdata-theme="[^"]*"/, ''));
}

async function htmlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return htmlFiles(path);
      return Promise.resolve(entry.name.endsWith('.html') ? [path] : []);
    }),
  );
  return nested.flat();
}

export const staticThemeFallback: AstroIntegration = {
  name: 'static-theme-fallback',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      for (const file of await htmlFiles(fileURLToPath(dir))) {
        const html = await readFile(file, 'utf8');
        const fixed = withoutStaticTheme(html);
        if (fixed !== html) await writeFile(file, fixed);
      }
    },
  },
};
