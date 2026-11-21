//! Calendar's second UI, built with Rune (ADR-0067).
//!
//! The app is one piece of state ([`App`]) and a view of it ([`view`]). The same code runs as a desktop window
//! (`src/main.rs`), as WASM in the browser ([`start`]), and headless in tests, where Rune renders element trees and
//! PNGs with no display.

#![forbid(unsafe_code)]

pub mod theme;

use rune::tok::type_;
use rune::{AppSpec, Cx, El, col, el, row, text};

/// The views the shell switches between. Each arrives with its own slice (#1004).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Page {
  #[default]
  Today,
  Week,
  Tasks,
}

impl Page {
  pub const ALL: [Page; 3] = [Page::Today, Page::Week, Page::Tasks];

  /// The label the web app's navigation uses.
  #[must_use]
  pub fn label(self) -> &'static str {
    match self {
      Page::Today => "Today",
      Page::Week => "Week",
      Page::Tasks => "My tasks",
    }
  }

  /// The stable element key tests and scripts find the nav item by.
  #[must_use]
  pub fn key(self) -> &'static str {
    match self {
      Page::Today => "nav-today",
      Page::Week => "nav-week",
      Page::Tasks => "nav-tasks",
    }
  }
}

/// The app's whole state.
#[derive(Debug, Default)]
pub struct App {
  pub page: Page,
}

/// The window's content: the shell header and the current page.
pub fn view(app: &App, cx: &mut Cx<App>) -> El {
  let t = theme::tokens(cx.system_dark());
  let nav = Page::ALL
    .into_iter()
    .fold(row().key("nav").role("navigation").label("Main").gap(4.0), |nav, page| {
      let current = app.page == page;
      nav.child(
        el()
          .key(page.key())
          .role("button")
          .label(page.label())
          // The current page reads as pressed, as `aria-current="page"` marks it in the web app.
          .checked(current)
          .focusable(true)
          .px(12.0)
          .py(6.0)
          .radius(6.0)
          .fill(if current { t.accent_soft } else { t.surface })
          .on_press(move |app: &mut App| app.page = page)
          .child(text(page.label()).color(if current { t.text } else { t.text_muted })),
      )
    });
  let header = row()
    .key("header")
    .role("banner")
    .w_full()
    .items_center()
    .px(16.0)
    .py(12.0)
    .gap(16.0)
    .fill(t.surface)
    .child(text("Calendar").key("app-title").font(type_::TITLE).color(t.text))
    .child(nav);
  let body = col()
    .key("page")
    .role("main")
    .w_full()
    .grow(1.0)
    .padding(16.0)
    .child(text(app.page.label()).key("page-title").font(type_::TITLE).color(t.text));
  col().w_full().h_full().fill(t.bg).child(header).child(body)
}

/// The window, its size and the named scenes headless runs render (`--scene week`).
#[must_use]
pub fn spec() -> AppSpec<App> {
  AppSpec {
    scenes: &[
      ("today", |app| app.page = Page::Today),
      ("week", |app| app.page = Page::Week),
      ("tasks", |app| {
        app.page = Page::Tasks;
      }),
    ],
    ..AppSpec::new("Calendar", (960.0, 640.0), App::default, view)
  }
}

/// The browser entry point; `just native build-web` builds it.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen(start))]
pub fn start() {
  rune::run(spec());
}
