//! The native themes are the web app's: every `--color-*` token in `tokens.css` has the same value here.

use calendar_native::theme::{DARK, LIGHT, tokens};
use std::collections::BTreeMap;

/// The `--color-*: #rrggbb;` declarations of the first block whose selector line contains `selector`.
fn css_tokens(selector: &str) -> BTreeMap<String, String> {
  let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../frontend/packages/theme/src/tokens.css");
  let css = std::fs::read_to_string(path).expect("frontend/packages/theme/src/tokens.css is readable");
  let start = css.find(selector).unwrap_or_else(|| panic!("tokens.css has {selector}"));
  let block = &css[start..start + css[start..].find('}').expect("the block closes")];
  block
    .lines()
    .filter_map(|line| line.trim().strip_prefix("--color-"))
    .filter_map(|decl| decl.trim_end_matches(';').split_once(':'))
    .filter(|(_, value)| value.trim().starts_with('#'))
    .map(|(name, value)| (name.trim().to_owned(), value.trim().to_owned()))
    .collect()
}

fn ours(table: &[(&str, &str)]) -> BTreeMap<String, String> {
  table.iter().map(|(n, v)| ((*n).to_owned(), (*v).to_owned())).collect()
}

#[test]
fn the_light_theme_matches_paper_and_sage() {
  assert_eq!(ours(LIGHT), css_tokens(":root[data-theme='light']"));
}

#[test]
fn the_dark_theme_matches_midnight_studio() {
  assert_eq!(ours(DARK), css_tokens(":root[data-theme='dark']"));
}

#[test]
fn every_token_parses() {
  let _ = tokens(false);
  let _ = tokens(true);
}
