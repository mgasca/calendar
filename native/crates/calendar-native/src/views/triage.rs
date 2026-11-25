//! The triage page, as the web app's `features/triage/Triage.tsx`.

use super::{badge, button, heading, meta, remote_state, styled_button};
use crate::bulk::Action;
use crate::format;
use crate::theme::Tokens;
use crate::triage::{self, Reschedule};
use crate::{App, load};
use calendar_client::generated::TaskResponse;
use rune::tok::type_;
use rune::{El, TextEdit, col, el, row, text, text_input};

fn check(key: String, label: String, checked: bool, enabled: bool, t: &Tokens) -> El {
  let c = el()
    .key(key)
    .role("checkbox")
    .label(label)
    .checked(checked)
    .size(16.0, 16.0)
    .radius(4.0)
    .border(1.5, t.border_strong)
    .fill(if checked { t.accent } else { t.surface_raised });
  if enabled { c.focusable(true) } else { c.disabled(true) }
}

/// A toolbar button, disabled while a request runs.
fn tool(key: &str, label: &str, pending: bool, press: fn(&mut App), t: &Tokens) -> El {
  let b = button(key, label, t);
  if pending {
    b.focusable(false).disabled(true)
  } else {
    b.on_press(press)
  }
}

// One page's layout, top to bottom, as the web app's `Triage` is one component.
#[allow(clippy::too_many_lines)]
pub fn view(app: &App, t: &Tokens) -> El {
  let state = &app.triage;
  let mut page = col()
    .key("triage")
    .gap(12.0)
    .w_full()
    .child(heading("triage-heading", "Overdue tasks", 1, t));
  if let Some(notice) = &state.notice {
    page = page.child(text(notice).key("triage-notice").role("status").color(t.text));
  }
  let total = triage::total(app);
  let loaded = app.tasks.data.as_ref().map_or(0, |l| l.items.len());
  if format::len(loaded) < total && !state.all {
    let b = button("triage-select-all", &format!("Select all {total} overdue"), t);
    // In a row, so the button keeps its own width.
    page = page.child(row().child(if state.pending {
      b.focusable(false).disabled(true)
    } else {
      b.on_press(triage::select_all)
    }));
  }
  let count = triage::count(app);
  if count > 0 {
    page = page.child(
      row()
        .key("triage-actions")
        .role("toolbar")
        .label("Selected task actions")
        .gap(6.0)
        .items_center()
        .child(text(format!("{count} selected")).key("triage-count").color(t.text))
        .child(tool(
          "triage-complete",
          "Complete",
          state.pending,
          |app| triage::act(app, Action::Complete),
          t,
        ))
        .child(tool(
          "triage-reschedule-date",
          "Reschedule date",
          state.pending,
          |app| triage::open_reschedule(app, false),
          t,
        ))
        .child(tool(
          "triage-reschedule-time",
          "Reschedule exact time",
          state.pending,
          |app| triage::open_reschedule(app, true),
          t,
        ))
        .child(tool(
          "triage-clear",
          "Clear deadline",
          state.pending,
          |app| triage::act(app, Action::ClearDeadline),
          t,
        ))
        .child(tool("triage-delete", "Delete", state.pending, triage::ask_delete, t)),
    );
  }
  if loaded > 0 {
    let every = !state.all && state.selected.len() == loaded;
    let c = check(
      "triage-select-loaded".into(),
      "Select all loaded tasks".into(),
      every,
      !state.pending,
      t,
    );
    let c = if state.pending { c } else { c.on_press(triage::toggle_loaded) };
    page = page.child(
      row()
        .gap(8.0)
        .items_center()
        .child(c)
        .child(text("Select all loaded").color(t.text)),
    );
  }
  if let Some(error_state) = remote_state(
    &app.tasks,
    "triage",
    "Loading overdue tasks…",
    "Couldn\u{2019}t load overdue tasks.",
    "Couldn\u{2019}t load overdue tasks.",
    load::reload,
    t,
  ) {
    page = page.child(error_state);
  }
  let Some(list) = &app.tasks.data else { return page };
  let tokens = *t;
  page = page.child(
    col()
      .key("triage-list")
      .role("list")
      .label("Overdue tasks")
      .w_full()
      .growth(rune::GrowthSpec::default())
      .virtual_rows(
        list.items.len(),
        72.0,
        |app: &App, i| {
          app
            .tasks
            .data
            .as_ref()
            .and_then(|l| l.items.get(i))
            .map_or_else(|| format!("row-{i}"), |task| task.id.to_string())
            .into()
        },
        move |app: &App, i| match app.tasks.data.as_ref().and_then(|l| l.items.get(i)) {
          Some(task) => col().py(3.0).child(triage_row(task, app, &tokens)),
          None => col(),
        },
      ),
  );
  if list.next_cursor.is_some() {
    let label = if app.tasks.loading { "Loading…" } else { "Load more" };
    let b = button("triage-more", label, t);
    page = page.child(row().child(if app.tasks.loading {
      b.focusable(false).disabled(true)
    } else {
      b.on_press(load::more_tasks)
    }));
  }
  page
}

fn triage_row(task: &TaskResponse, app: &App, t: &Tokens) -> El {
  let state = &app.triage;
  let id = task.id;
  let ticked = state.all || state.selected.contains(&id);
  let enabled = !state.all && !state.pending;
  let c = check(format!("triage-{id}-check"), format!("Select {}", task.title), ticked, enabled, t);
  let c = if enabled {
    c.on_press(move |app: &mut App| triage::toggle(app, id))
  } else {
    c
  };
  let zone = app.clock.zone;
  let due = task
    .due_at
    .flatten()
    .map(|at| at.with_timezone(&zone).date_naive())
    .or(task.due_date.flatten());
  let due_text = match (task.due_at.flatten(), task.due_date.flatten()) {
    (Some(at), _) => app.locale.medium_date_time(at, zone),
    (None, Some(date)) => date.to_string(),
    (None, None) => String::new(),
  };
  let mut body = col()
    .gap(2.0)
    .grow(1.0)
    .child(text(&task.title).color(t.text))
    .child(meta(due_text, t));
  if let Some(Some(notes)) = &task.notes {
    body = body.child(text(notes).key(format!("triage-{id}-notes")).font(type_::BODY).color(t.text).wrap());
  }
  let mut r = row()
    .key(format!("triage-{id}"))
    .role("listitem")
    .w_full()
    .gap(8.0)
    .items_center()
    .px(12.0)
    .py(8.0)
    .radius(8.0)
    .fill(t.surface)
    .child(c)
    .child(body)
    .child(badge(
      format!("{} priority", task.priority.as_deref().unwrap_or("medium")),
      t.accent_soft,
      t.text,
    ));
  if let Some(due) = due {
    // Always "days", as the web app's badge says.
    r = r.child(badge(
      format!("{} days overdue", format::days_between(due, app.clock.today())),
      t.overdue_bg,
      t.overdue_text,
    ));
  }
  r
}

fn reschedule_date(app: &mut App) -> &mut TextEdit {
  match &mut app.triage.reschedule {
    Some(r) => &mut r.date,
    None => &mut app.scratch,
  }
}

fn reschedule_time(app: &mut App) -> &mut TextEdit {
  match &mut app.triage.reschedule {
    Some(r) => &mut r.time,
    None => &mut app.scratch,
  }
}

fn input(key: &str, label: &str, edit: &TextEdit, on_edit: fn(&mut App) -> &mut TextEdit, t: &Tokens) -> El {
  col().gap(4.0).w_full().child(text(label).font(type_::LABEL).color(t.text)).child(
    text_input(edit, type_::BODY)
      .key(key)
      .label(label)
      .single_line()
      .w_full()
      .px(8.0)
      .py(6.0)
      .radius(6.0)
      .border(1.0, t.border_strong)
      .fill(t.surface_sunken)
      .color(t.text)
      .on_edit(on_edit),
  )
}

fn overlay(content: El, t: &Tokens) -> El {
  col()
    .key("triage-backdrop")
    .absolute(0.0, 0.0)
    .w_full()
    .h_full()
    .center()
    .fill(t.backdrop)
    .child(content)
}

/// The reschedule dialog or the delete confirmation, over the page.
pub fn dialog(app: &App, t: &Tokens) -> Option<El> {
  let state = &app.triage;
  if let Some(r) = &state.reschedule {
    return Some(overlay(reschedule_view(r, app, t), t));
  }
  if state.confirm_delete {
    let count = triage::count(app);
    let delete = styled_button("triage-delete-confirm", "Delete", t.error, t.on_error, t);
    let cancel = button("triage-delete-cancel", "Cancel", t);
    let (delete, cancel) = if state.pending {
      (delete.focusable(false).disabled(true), cancel.focusable(false).disabled(true))
    } else {
      (
        delete.on_press(|app: &mut App| triage::act(app, Action::Delete)),
        cancel.on_press(triage::cancel_delete),
      )
    };
    let panel = col()
      .key("triage-delete-dialog")
      .role("dialog")
      .label("Confirm deletion")
      .modal(false, triage::cancel_delete)
      .gap(12.0)
      .padding(20.0)
      .radius(12.0)
      .w(420.0)
      .fill(t.surface_raised)
      .child(heading("triage-delete-heading", "Confirm deletion", 2, t))
      .child(
        text(format!(
          "Delete {}? This can\u{2019}t be undone.",
          format::count(count, "task", "tasks")
        ))
        .color(t.text),
      )
      .child(row().gap(8.0).child(delete).child(cancel));
    return Some(overlay(panel, t));
  }
  None
}

fn reschedule_view(r: &Reschedule, app: &App, t: &Tokens) -> El {
  let title = if r.exact { "Reschedule exact time" } else { "Reschedule tasks" };
  let mut panel = col()
    .key("reschedule-dialog")
    .role("dialog")
    .label(title)
    .modal(false, triage::close_reschedule)
    .gap(12.0)
    .padding(20.0)
    .radius(12.0)
    .w(420.0)
    .fill(t.surface_raised)
    .child(heading("reschedule-heading", title, 2, t))
    .child(input("reschedule-date", "Due date", &r.date, reschedule_date, t));
  if r.exact {
    panel = panel.child(input("reschedule-time", "Due time", &r.time, reschedule_time, t));
    if let (Some(date), Ok(time)) = (
      format::parse_iso_date(r.date.text.trim()),
      chrono::NaiveTime::parse_from_str(r.time.text.trim(), "%H:%M"),
    ) && let crate::forms::Local::Twice(earlier, later) = crate::forms::resolve(date.and_time(time), app.clock.zone)
    {
      let mut choices = row()
        .key("reschedule-occurrence")
        .role("radiogroup")
        .label("Choose occurrence")
        .gap(6.0);
      for (n, at) in (0u8..).zip([earlier, later]) {
        let label = app.locale.date_time_with_offset(at, app.clock.zone);
        choices = choices.child(
          button(&format!("reschedule-occurrence-{n}"), &label, t)
            .checked(r.occurrence == Some(n))
            .on_press(move |app: &mut App| {
              if let Some(r) = &mut app.triage.reschedule {
                r.occurrence = Some(n);
              }
            }),
        );
      }
      panel = panel.child(
        col()
          .gap(4.0)
          .child(text("Choose occurrence").font(type_::LABEL).color(t.text))
          .child(choices),
      );
    }
  }
  let ready = triage::reschedule_action(r, app.clock.zone);
  if let Err(Some(message)) = ready {
    panel = panel.child(text(message).key("reschedule-error").role("alert").color(t.error));
  }
  let apply = button("reschedule-apply", "Apply", t);
  let apply = if ready.is_ok() && !app.triage.pending {
    apply.on_press(triage::apply_reschedule)
  } else {
    apply.focusable(false).disabled(true)
  };
  let cancel = button("reschedule-cancel", "Cancel", t);
  let cancel = if app.triage.pending {
    cancel.focusable(false).disabled(true)
  } else {
    cancel.on_press(triage::close_reschedule)
  };
  panel.child(row().gap(8.0).child(apply).child(cancel))
}
