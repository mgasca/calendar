import { join } from 'node:path';

/** The file operations the link check needs, so a test can count them. */
export interface SiteFiles {
  readFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

/** Returns the built file behind a site-relative href, or undefined for links that leave the site. */
export function builtFile(href: string, base: string, root = 'dist'): string | undefined {
  if (!href.startsWith(base)) return undefined;
  const path = href.slice(base.length).split(/[?#]/)[0] ?? '';
  return join(root, path.endsWith('/') || path === '' ? join(path, 'index.html') : path);
}

interface Link {
  from: string;
  href: string;
  fragment: string | undefined;
}

/**
 * Lists every problem with the internal links of the built pages: a link to repository Markdown, a target that
 * was not built, or an anchor its target page does not have. Each page is read once, and each other target is
 * checked once however many links point at it (the built site has ~49,000 hrefs but ~2,200 distinct ones).
 */
export async function brokenLinks(
  pages: readonly string[],
  base: string,
  files: SiteFiles,
  root = 'dist',
): Promise<string[]> {
  const problems: string[] = [];
  const html = new Map<string, string>();
  const links = new Map<string, Link[]>();
  await Promise.all(
    pages.map(async (page) => {
      const text = await files.readFile(page);
      html.set(page, text);
      for (const [, href = ''] of text.matchAll(/href="([^"]*)"/g)) {
        // Absolute links leave the site; GitHub links to repository Markdown are expected.
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) continue;
        if (/\.md(?:[?#]|$)/.test(href))
          problems.push(`${page} -> ${href}: links to repository Markdown`);
        // Starlight's default icon link; the site does not ship a favicon yet.
        if (href === `${base}favicon.svg`) continue;
        const target = builtFile(href, base, root);
        if (target === undefined) continue;
        const link = { from: page, href, fragment: href.split('#')[1] };
        const existing = links.get(target);
        if (existing) existing.push(link);
        else links.set(target, [link]);
      }
    }),
  );
  const ids = new Map<string, Set<string>>();
  await Promise.all(
    [...links].map(async ([target, from]) => {
      const page = html.get(target);
      if (page === undefined && !(await files.exists(target))) {
        for (const link of from)
          problems.push(`${link.from} -> ${link.href}: ${target} was not built`);
        return;
      }
      for (const link of from) {
        if (!link.fragment || !target.endsWith('.html')) continue;
        let known = ids.get(target);
        if (!known) {
          const text = page ?? (await files.readFile(target));
          known = new Set([...text.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1] ?? ''));
          ids.set(target, known);
        }
        if (!known.has(link.fragment))
          problems.push(`${link.from} -> ${link.href}: no id="${link.fragment}"`);
      }
    }),
  );
  return problems.sort();
}
