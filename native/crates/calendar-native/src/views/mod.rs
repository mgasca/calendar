//! The pages, and the pieces they share: headings, buttons, task rows, and the loading, error and empty states.

pub mod day;
pub mod dialogs;
pub mod pickers;
pub mod tasks;
pub mod triage;
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
  styled_button(key, label, t.surface_raised, t.text, t)
}

/// A button with its own fill and label colour: the danger button ("Delete" in the confirmation).
pub fn styled_button(key: &str, label: &str, fill: rune::Color, color: rune::Color, t: &Tokens) -> El {
  el()
    .key(key)
    .role("button")
    .label(label)
    .px(10.0)
    .py(5.0)
    .radius(6.0)
    .border(1.0, t.border)
    .fill(fill)
    .focusable(true)
    .child(text(label).font(type_::LABEL).color(color))
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

/// One task row: its checkbox, title, due text, notes, priority badge and Delete.
pub struct TaskRow<'a> {
  pub id: uuid::Uuid,
  pub key: String,
  pub title: &'a str,
  pub done: bool,
  pub overdue: bool,
  pub priority: Option<&'a str>,
  pub meta: Option<String>,
  /// The task's notes, as their own paragraph (My tasks shows them; the agenda rows do not).
  pub notes: Option<&'a str>,
  /// Whether Delete names the task: "Delete {title}" and a titled confirmation on Day and Week; a plain
  /// "Delete" and "1 task" on My tasks, as the web app's `TaskItem` and `TaskList` differ.
  pub named: bool,
}

pub fn task_row(task: TaskRow<'_>, app: &App, t: &Tokens) -> El {
  let check = checkbox(&format!("{}-check", task.key), task.id, task.title, task.done, app)
    .size(16.0, 16.0)
    .radius(4.0)
    .border(1.5, t.border_strong)
    .fill(if task.done { t.accent } else { t.surface_raised });
  let mut label = text(task.title).color(if task.done { t.completed_text } else { t.text });
  if task.done {
    label = label.strike(0, task.title.len(), None);
  }
  let open = task.id;
  let title = el()
    .key(format!("{}-title", task.key))
    .role("button")
    .label(task.title)
    .focusable(true)
    .on_press(move |app: &mut App| crate::dialogs::edit_task(app, open))
    .child(label);
  let mut body = col().gap(2.0).grow(1.0).child(title);
  if let Some(meta_text) = task.meta {
    body = body.child(meta(meta_text, t));
  }
  if let Some(notes) = task.notes {
    body = body.child(
      text(notes)
        .key(format!("{}-notes", task.key))
        .font(type_::BODY)
        .color(t.text)
        .wrap(),
    );
  }
  let mut r = item(&task.key, t).child(check).child(body);
  if let Some(priority) = task.priority {
    r = r.child(badge(format!("{priority} priority"), t.accent_soft, t.text));
  }
  if task.overdue {
    r = r.fill(t.overdue_bg);
  }
  let id = task.id;
  let title = task.named.then(|| task.title.to_owned());
  // "Delete" on screen; on Day and Week also "Delete {title}" to assistive technology, as the web app's `aria-label`.
  let delete = button(&format!("{}-delete", task.key), "Delete", t);
  let delete = if task.named {
    delete.label(format!("Delete {}", task.title))
  } else {
    delete
  };
  r.child(delete.on_press(move |app: &mut App| crate::actions::ask_delete(app, id, title.as_deref())))
}

/// A task's checkbox: pressing it completes or reopens the task; it is disabled while that request runs.
pub fn checkbox(key: &str, id: uuid::Uuid, title: &str, done: bool, app: &App) -> El {
  let pending = app.actions.pending.contains(&id);
  let check = el().key(key).role("checkbox").label(format!("Mark {title} as done")).checked(done);
  if pending {
    check.disabled(true)
  } else {
    check
      .focusable(true)
      .on_press(move |app: &mut App| crate::actions::toggle(app, id, !done))
  }
}

/// The last toggle failure, as the web app's `TaskToggleError`.
pub fn toggle_error(app: &App, t: &Tokens) -> Option<El> {
  let message = app.actions.toggle_error.as_deref()?;
  Some(
    col()
      .key("toggle-error")
      .role("alert")
      .px(12.0)
      .py(10.0)
      .radius(8.0)
      .fill(t.error_soft)
      .child(text(message).color(t.error)),
  )
}

/// The delete confirmation, over the page: "Confirm deletion", Delete and Cancel (the web app's `ConfirmDialog`).
pub fn delete_dialog(app: &App, t: &Tokens) -> Option<El> {
  let dialog = app.actions.delete.as_ref()?;
  let mut buttons = row().gap(8.0);
  let mut delete = styled_button("confirm-delete", "Delete", t.error, t.on_error, t);
  let mut cancel = button("cancel-delete", "Cancel", t);
  if dialog.pending {
    delete = delete.focusable(false).disabled(true);
    cancel = cancel.focusable(false).disabled(true);
  } else {
    delete = delete.on_press(crate::actions::confirm_delete);
    cancel = cancel.on_press(crate::actions::cancel_delete);
  }
  buttons = buttons.child(delete).child(cancel);
  let mut body = col()
    .key("delete-dialog")
    .role("dialog")
    .label("Confirm deletion")
    .modal(false, crate::actions::cancel_delete)
    .gap(12.0)
    .padding(20.0)
    .radius(12.0)
    .w(420.0)
    .fill(t.surface_raised)
    .child(heading("delete-heading", "Confirm deletion", 2, t))
    .child(
      text(format!(
        "Delete {}? This can\u{2019}t be undone.",
        dialog
          .title
          .as_ref()
          .map_or_else(|| "1 task".to_owned(), |title| format!("\u{201c}{title}\u{201d}"))
      ))
      .color(t.text),
    );
  if let Some(error) = &dialog.error {
    body = body.child(text(error).key("delete-error").role("alert").color(t.error));
  }
  Some(
    col()
      .key("dialog-backdrop")
      .absolute(0.0, 0.0)
      .w_full()
      .h_full()
      .center()
      .fill(t.backdrop)
      .child(body.child(buttons)),
  )
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

/// An item's title that opens it to edit (the web app's `item-open` button, `aria-haspopup="dialog"`).
pub fn title_button(key: String, title: &str, color: rune::Color, open: impl Fn(&mut App) + 'static) -> El {
  el()
    .key(key)
    .role("button")
    .label(title)
    .focusable(true)
    .on_press(open)
    .child(text(title).color(color))
}
