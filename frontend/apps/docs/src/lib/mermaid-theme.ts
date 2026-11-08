// The Calendar look of the Mermaid diagrams (story 0046). Mermaid inlines each SVG into the page
// and applies `themeCSS` last, so these rules paint the nodes, edges and sequence parts from the
// shared theme tokens, which follow `data-theme` on <html>. No colour value is written here: the
// palette is @calendar/theme's, so the diagrams cannot drift from it. The rules sit in Mermaid's
// own CSS rather than page CSS because Mermaid sizes labels with them (page CSS arrives too late)
// and its own id-scoped rules need `!important` to be overridden.

import { ownershipBoxMarker, ownershipLegend } from './architecture';

const important = (rules: string) => rules.replace(/;/g, ' !important;');

/** Selector → declarations; every colour is a `var(--color-*)` reference. */
const RULES: Record<string, string> = {
  // Flowchart nodes, subgraphs, edges and arrowheads.
  '.node rect, .node circle, .node ellipse, .node polygon, .node path':
    'fill: var(--color-surface); stroke: var(--color-border-strong); stroke-width: 1.5px;',
  '.cluster rect': 'fill: var(--color-surface-sunken); stroke: var(--color-border-strong);',
  '.edgePath .path, .flowchart-link, .messageLine0, .messageLine1':
    'stroke: var(--color-text-muted); stroke-width: 1.5px;',
  '.marker, .arrowMarkerPath, marker path, #arrowhead path':
    'fill: var(--color-text-muted); stroke: var(--color-text-muted);',
  ...Object.fromEntries(
    (Object.keys(ownershipLegend) as (keyof typeof ownershipLegend)[]).flatMap((ownership) => {
      const { fill, stroke } = ownershipLegend[ownership];
      const paint = `fill: ${fill}; stroke: ${stroke};`;
      return [
        [
          `.node.${ownership} rect, .node.${ownership} circle, .node.${ownership} ellipse, .node.${ownership} polygon, .node.${ownership} path`,
          paint,
        ],
        [`.cluster.${ownership} rect`, paint],
      ];
    }),
  ),
  // Text.
  '.nodeLabel, .nodeLabel p, .label, .label text, .cluster-label, .cluster-label span, .edgeLabel span, .messageText, .loopText, .loopText tspan, .labelText, .noteText, .actor, text.actor > tspan':
    'fill: var(--color-text); color: var(--color-text);',
  // Edge labels sit on a patch of the page background so an arrow never crosses its text.
  '.labelBkg': 'background-color: var(--color-bg); border-radius: 4px;',
  '.edgeLabel p':
    'background-color: var(--color-bg); color: var(--color-text); padding: 2px 6px; border-radius: 4px;',
  '.edgeLabel rect': 'fill: var(--color-bg); opacity: 1;',
  // Sequence diagrams: participants, lifelines, activations, notes and loop frames.
  'rect.actor':
    'fill: var(--color-surface); stroke: var(--color-border-strong); stroke-width: 1.5px;',
  '.actor-line': 'stroke: var(--color-border-strong);',
  '.activation0, .activation1, .activation2':
    'fill: var(--color-accent-soft); stroke: var(--color-accent);',
  '.note': 'fill: var(--color-current-bg); stroke: var(--color-current-border);',
  '.loopLine': 'stroke: var(--color-border-strong);',
  '.labelBox': 'fill: var(--color-surface-raised); stroke: var(--color-border-strong);',
  ...Object.fromEntries(
    (Object.keys(ownershipBoxMarker) as (keyof typeof ownershipBoxMarker)[]).map((ownership) => [
      `rect.rect[fill='${ownershipBoxMarker[ownership]}']`,
      `fill: ${ownershipLegend[ownership].fill}; stroke: ${ownershipLegend[ownership].stroke}; stroke-width: 1px;`,
    ]),
  ),
  '.sequenceNumber': 'fill: var(--color-on-accent);',
  '#sequencenumber': 'fill: var(--color-accent);',
};

/** The `themeCSS` string for astro-mermaid's `mermaidConfig`. */
export const mermaidThemeCss: string = Object.entries(RULES)
  .map(([selector, rules]) => `${selector} { ${important(rules)} }`)
  .join(' ');
