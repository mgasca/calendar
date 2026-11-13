/**
 * Slidev switches themes with a `dark` class on <html>; the Calendar tokens select their set with
 * `data-theme` (ADR-0047). This keeps the attribute in step with the class, so the deck's own
 * light/dark toggle (and its OS default) picks the matching token set. It is the deck's adapter,
 * like the docs site's theme adapter: slides never select a theme themselves.
 */
export default function setup() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const sync = () => {
    root.dataset.theme = root.classList.contains('dark') ? 'dark' : 'light';
  };
  sync();
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
}
