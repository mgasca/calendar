/**
 * Builds narrative decks (ADR-0060): `node src/build-decks.ts --out <dir> [--system <name>]
 * [--narratives <dir>]`. Every `docs/narratives/<system>/slides.md` (or only the one named) is built
 * into `<dir>/<system>/` for the base that DOCS_SITE_URL gives the docs site, so the decks publish at
 * `slides/<system>/` beside the narratives.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildDeck, findDecks, narrativesDirectory, siteBase } from './decks.ts';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'dist' },
    system: { type: 'string' },
    narratives: { type: 'string', default: narrativesDirectory },
    root: { type: 'boolean', default: false },
  },
});
const out = resolve(values.out);
// --root builds for the root path, for a local look at one deck outside the docs site.
const site = values.root ? '/' : siteBase(process.env.DOCS_SITE_URL);
const decks = (await findDecks(resolve(values.narratives))).filter(
  (deck) => values.system === undefined || deck.system === values.system,
);
if (values.system !== undefined && !decks.length) {
  throw new Error(`No deck: docs/narratives/${values.system}/slides.md does not exist`);
}
for (const deck of decks) await buildDeck(deck, out, site);
console.log(`Built ${String(decks.length)} deck(s) into ${out} for base ${site}slides/`);
