//! The pages, and the pieces they share: headings, buttons, task rows, and the loading, error and empty states.

pub mod day;
pub mod tasks;
pub mod week;

use crate::App;
use crate::fetch::Remote;
use crate::theme::Tokens;
use calendar_client::ApiError;
use rune::tok::type_;
use rune::{El, col, el, row, text};

/// Heading sizes for levels 1 to 3.
fn heading_size(level: u32) -> f32 {
  match level {
    1 => 22.0,
    2 => 16.0,
    _ => 14.0,
  }
}

/// A heading, read by assistive technology at `level`.
pub fn heading(key: &str, label: impl Into<String>, level: u32, t: &Tokens) -> El {
  text(label)
    .key(key)
    .role("heading")
    .level(level)
    .font(rune::TextStyle {
      size: heading_size(level),
      ..type_::TITLE
    })
    .color(t.text)
}

/// Secondary text: dates, places, counts.
pub fn meta(label: impl Into<String>, t: &Tokens) -> El {
  text(label).font(type_::BODY).color(t.text_muted)
}

/// A focusable button; the caller adds `.on_press(…)`.
pub fn button(key: &str, label: &str, t: &Tokens) -> El {
  el()
    .key(key)
    .role("button")
    .label(label)
    .px(10.0)
    .py(5.0)
    .radius(6.0)
    .border(1.0, t.border)
    .fill(t.surface_raised)
    .focusable(true)
    .child(text(label).font(type_::LABEL).color(t.text))
}

/// A button drawn where a later slice makes it work (#1005, #1006): shown, but disabled.
pub fn inert_button(key: &str, label: &str, t: &Tokens) -> El {
  button(key, label, t).focusable(false).disabled(true)
}

/// A small badge: "Now", "high priority", "Overdue".
pub fn badge(label: impl Into<String>, fill: rune::Color, color: rune::Color) -> El {
  text(label).font(type_::LABEL).color(color).fill(fill).px(6.0).py(2.0).radius(4.0)
}

/// A section: its heading, then its items.
pub fn section(key: &str, title: &str, level: u32, items: Vec<El>, t: &Tokens) -> El {
  items.into_iter().fold(
    col()
      .key(key)
      .role("region")
      .label(title)
      .gap(8.0)
      .w_full()
      .child(heading(&format!("{key}-heading"), title, level, t)),
    El::child,
  )
}

/// A list row on a surface.
pub fn item(key: &str, t: &Tokens) -> El {
  row()
    .key(key)
    .role("listitem")
    .w_full()
    .gap(8.0)
    .items_center()
    .px(12.0)
    .py(8.0)
    .radius(8.0)
    .fill(t.surface)
}

/// One task row: its checkbox (inert until #1005), title, priority badge and notes of its due state.
pub struct TaskRow<'a> {
  pub key: String,
  pub title: &'a str,
  pub done: bool,
  pub overdue: bool,
  pub priority: Option<&'a str>,
  pub meta: Option<String>,
}

pub fn task_row(task: TaskRow<'_>, t: &Tokens) -> El {
  let check = el()
    .key(format!("{}-check", task.key))
    .role("checkbox")
    .label(format!("Mark {} as done", task.title))
    .checked(task.done)
    .disabled(true)
    .size(16.0, 16.0)
    .radius(4.0)
    .border(1.5, t.border_strong)
    .fill(if task.done { t.accent } else { t.surface_raised });
  let mut title = text(task.title).color(if task.done { t.completed_text } else { t.text });
  if task.done {
    title = title.strike(0, task.title.len(), None);
  }
  let mut body = col().gap(2.0).grow(1.0).child(title);
  if let Some(meta_text) = task.meta {
    body = body.child(meta(meta_text, t));
  }
  let mut r = item(&task.key, t).child(check).child(body);
  if let Some(priority) = task.priority {
    r = r.child(badge(format!("{priority} priority"), t.accent_soft, t.text));
  }
  if task.overdue {
    r = r.fill(t.overdue_bg);
  }
  r.child(inert_button(&format!("{}-delete", task.key), &format!("Delete {}", task.title), t))
}

/// The states every page shares before or around its data: loading, the error with "Try again", the stale-data
/// notice. `None` when the page should draw its data alone.
pub fn remote_state<T>(
  remote: &Remote<T>,
  key: &str,
  loading: &str,
  failed: &str,
  stale: &str,
  retry: fn(&mut App),
  t: &Tokens,
) -> Option<El> {
  let error_box = |message: String, error: &ApiError| {
    col()
      .key(format!("{key}-error"))
      .role("alert")
      .gap(6.0)
      .px(12.0)
      .py(10.0)
      .radius(8.0)
      .fill(t.error_soft)
      .child(text(message).color(t.error))
      .child(
        text(error.message_or("Try again in a moment.").to_owned())
          .font(type_::BODY)
          .color(t.text),
      )
      .child(button(&format!("{key}-retry"), "Try again", t).on_press(move |app: &mut App| retry(app)))
  };
  match (&remote.data, &remote.error) {
    (None, Some(error)) => Some(error_box(failed.to_owned(), error)),
    (None, None) => Some(text(loading).key(format!("{key}-loading")).role("status").color(t.loading_text)),
    (Some(_), Some(error)) => Some(error_box(stale.to_owned(), error)),
    (Some(_), None) if remote.loading => Some(
      text("Updating…")
        .key(format!("{key}-updating"))
        .role("status")
        .font(type_::BODY)
        .color(t.text_muted),
    ),
    (Some(_), None) => None,
  }
}
