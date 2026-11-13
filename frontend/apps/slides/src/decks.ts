import { spawn } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** The app's Slidev theme: the Calendar tokens and fonts (ADR-0047), passed to every build. */
export const themeDirectory = fileURLToPath(new URL('../theme/', import.meta.url));
/** docs/narratives/ in this repository. */
export const narrativesDirectory = fileURLToPath(
  new URL('../../../../docs/narratives/', import.meta.url),
);
const slidevBin = fileURLToPath(new URL('../node_modules/.bin/slidev', import.meta.url));

/** A part directory's name, which is the narrative's `<system>` (ADR-0059). */
const systemName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface Deck {
  system: string;
  /** Absolute path of `docs/narratives/<system>/slides.md`. */
  source: string;
}

/** Every `<system>/slides.md` under `directory`, by system name; part directories without one are skipped. */
export async function findDecks(directory: string = narrativesDirectory): Promise<Deck[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const decks = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && systemName.test(entry.name))
      .map(async (entry) => {
        const names = await readdir(`${directory}/${entry.name}`);
        return names.includes('slides.md')
          ? { system: entry.name, source: `${directory}/${entry.name}/slides.md` }
          : undefined;
      }),
  );
  return decks
    .filter((deck): deck is Deck => deck !== undefined)
    .sort((a, b) => a.system.localeCompare(b.system));
}

/** The site's base path from DOCS_SITE_URL, as the docs site reads it: `/` or `/calendar/`. */
export function siteBase(url = 'http://localhost:4321/') {
  const parsed = new URL(url);
  return `${parsed.pathname.replace(/\/$/, '')}/`;
}

/** The base a deck is built for: it is published at `<site base>slides/<system>/`. */
export function deckBase(site: string, system: string) {
  return `${site}slides/${system}/`;
}

/** The `slidev build` arguments for one deck. */
export function buildArguments(deck: Deck, out: string, site: string) {
  return [
    'build',
    deck.source,
    '--theme',
    themeDirectory,
    '--base',
    deckBase(site, deck.system),
    '--out',
    `${out}/${deck.system}`,
  ];
}

/** Builds one deck with Slidev into `<out>/<system>/`, replacing an earlier build. */
export async function buildDeck(deck: Deck, out: string, site: string) {
  await rm(`${out}/${deck.system}`, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(slidevBin, buildArguments(deck, out, site), { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`slidev build failed for ${deck.system} (exit ${String(code)})`));
    });
  });
}
