//! The shell's element tree, driven headlessly with Rune's `Runtime`: no window, no GPU.

use calendar_native::{App, Page, view};
use rune::{Env, Runtime};

fn runtime(dark: bool) -> Runtime<App> {
  let mut rt = Runtime::new(
    App::default(),
    view,
    (960.0, 640.0),
    Env {
      system_dark: dark,
      scale: 1.0,
    },
  );
  rt.frame(0.0);
  rt
}

fn press(rt: &mut Runtime<App>, key: &str) {
  let (x, y) = rt.find(key).unwrap_or_else(|| panic!("no element keyed {key}"));
  rt.pointer_down(x, y);
  rt.pointer_up(x, y);
  rt.frame(1.0 / 60.0);
}

#[test]
fn the_app_opens_on_today() {
  let rt = runtime(false);
  assert_eq!(rt.state.page, Page::Today);
  for key in ["app-title", "nav", "nav-today", "nav-week", "nav-tasks", "page-title"] {
    assert!(rt.find(key).is_some(), "the shell shows {key}");
  }
}

#[test]
fn each_nav_item_opens_its_page() {
  let mut rt = runtime(true);
  for page in [Page::Week, Page::Tasks, Page::Today] {
    press(&mut rt, page.key());
    assert_eq!(rt.state.page, page, "pressing {} opens it", page.label());
  }
}

#[test]
fn the_nav_names_the_web_apps_pages() {
  let labels: Vec<_> = Page::ALL.into_iter().map(Page::label).collect();
  assert_eq!(labels, ["Today", "Week", "My tasks"]);
}
