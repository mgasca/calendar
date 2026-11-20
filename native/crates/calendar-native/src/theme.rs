//! The two Calendar themes, Paper & Sage (light) and Midnight Studio (dark), as semantic tokens.
//!
//! The values are the web app's (`frontend/packages/theme/src/tokens.css`, ADR-0047), copied, and a test fails
//! when they drift. Views pick a token by meaning (`surface`, `text_muted`), never by appearance, and never read the
//! theme to choose a colour.

use rune::Color;

/// One theme's colour tokens, named after the web app's `--color-*` custom properties.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tokens {
  pub bg: Color,
  pub surface: Color,
  pub surface_raised: Color,
  pub surface_sunken: Color,
  pub text: Color,
  pub text_muted: Color,
  pub border: Color,
  pub border_strong: Color,
  pub accent: Color,
  pub accent_hover: Color,
  pub accent_soft: Color,
  pub on_accent: Color,
  pub focus: Color,
  pub current_bg: Color,
  pub current_border: Color,
  pub completed_text: Color,
  pub overdue_bg: Color,
  pub overdue_text: Color,
  pub error: Color,
  pub error_soft: Color,
  pub on_error: Color,
  pub loading_text: Color,
  pub empty_text: Color,
  pub now_line: Color,
  /// Behind a dialog: `--color-backdrop`, an `rgb(… / alpha)` in `tokens.css`, so not in the hex tables below.
  pub backdrop: Color,
}

/// The light (`false`) or dark (`true`) theme.
#[must_use]
pub fn tokens(dark: bool) -> Tokens {
  let source = if dark { DARK } else { LIGHT };
  let c = |name: &str| -> Color {
    let (_, value) = source.iter().find(|(n, _)| *n == name).expect("every token has a value");
    rune::color::hex(value).expect("token values are #rrggbb")
  };
  Tokens {
    bg: c("bg"),
    surface: c("surface"),
    surface_raised: c("surface-raised"),
    surface_sunken: c("surface-sunken"),
    text: c("text"),
    text_muted: c("text-muted"),
    border: c("border"),
    border_strong: c("border-strong"),
    accent: c("accent"),
    accent_hover: c("accent-hover"),
    accent_soft: c("accent-soft"),
    on_accent: c("on-accent"),
    focus: c("focus"),
    current_bg: c("current-bg"),
    current_border: c("current-border"),
    completed_text: c("completed-text"),
    overdue_bg: c("overdue-bg"),
    overdue_text: c("overdue-text"),
    error: c("error"),
    error_soft: c("error-soft"),
    on_error: c("on-error"),
    loading_text: c("loading-text"),
    empty_text: c("empty-text"),
    now_line: c("now-line"),
    backdrop: rune::color::hex(if dark { BACKDROP_DARK } else { BACKDROP_LIGHT }).expect("a #rrggbbaa backdrop"),
  }
}

/// `--color-backdrop`: `rgb(31 42 34 / 0.45)` (light) and `rgb(4 6 14 / 0.7)` (dark), as `#rrggbbaa`.
pub const BACKDROP_LIGHT: &str = "#1f2a2273";
pub const BACKDROP_DARK: &str = "#04060eb3";

/// Paper & Sage, `:root[data-theme='light']` in `tokens.css`.
pub const LIGHT: &[(&str, &str)] = &[
  ("bg", "#f6f1e7"),
  ("surface", "#fbf8f1"),
  ("surface-raised", "#ffffff"),
  ("surface-sunken", "#ece6d8"),
  ("text", "#1f2a22"),
  ("text-muted", "#4f5a4b"),
  ("border", "#d6cfbc"),
  ("border-strong", "#6f7d69"),
  ("accent", "#2f5d3a"),
  ("accent-hover", "#234a2d"),
  ("accent-soft", "#dce8d3"),
  ("on-accent", "#ffffff"),
  ("focus", "#2f5d3a"),
  ("current-bg", "#e1ebd6"),
  ("current-border", "#4a7a52"),
  ("completed-text", "#5a6556"),
  ("overdue-bg", "#f8e5de"),
  ("overdue-text", "#8a2c19"),
  ("error", "#a8301c"),
  ("error-soft", "#f8e2dc"),
  ("on-error", "#ffffff"),
  ("loading-text", "#4f5a4b"),
  ("empty-text", "#4f5a4b"),
  ("now-line", "#b3361f"),
];

/// Midnight Studio, `:root[data-theme='dark']` in `tokens.css`.
pub const DARK: &[(&str, &str)] = &[
  ("bg", "#0f1424"),
  ("surface", "#161d33"),
  ("surface-raised", "#1f2844"),
  ("surface-sunken", "#0b0f1c"),
  ("text", "#e8eaf6"),
  ("text-muted", "#a9b1cd"),
  ("border", "#2a3454"),
  ("border-strong", "#7580a8"),
  ("accent", "#b9a6ff"),
  ("accent-hover", "#d0c3ff"),
  ("accent-soft", "#2b2653"),
  ("on-accent", "#14102b"),
  ("focus", "#b9a6ff"),
  ("current-bg", "#26264f"),
  ("current-border", "#9a8bf0"),
  ("completed-text", "#9aa3c2"),
  ("overdue-bg", "#3b1f2b"),
  ("overdue-text", "#ffb4a8"),
  ("error", "#ff8f80"),
  ("error-soft", "#3d2029"),
  ("on-error", "#2a0a06"),
  ("loading-text", "#a9b1cd"),
  ("empty-text", "#a9b1cd"),
  ("now-line", "#ff8f80"),
];
