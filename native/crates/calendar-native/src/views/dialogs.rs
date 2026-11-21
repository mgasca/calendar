//! The add and edit dialogs and the notice after a save, drawn from `crate::dialogs`' state.

use super::pickers::{date_picker, time_picker};
use super::{button, heading, meta, styled_button};
use crate::App;
use crate::dialogs::{self, Dialog, EventDialog, Load, TaskDialog};
use crate::forms::{Deadline, EventField, Occurrence, PRIORITIES, TaskField};
use crate::pickers::Field;
use crate::theme::Tokens;
use chrono::{DateTime, Utc};
use rune::tok::type_;
use rune::{El, TextEdit, col, el, row, text, text_input};

/// `fn(&mut App) -> &mut TextEdit` for one field of the open dialog, or the scratch field once it has closed.
macro_rules! accessor {
  ($name:ident, $variant:ident, $field:ident) => {
    fn $name(app: &mut App) -> &mut TextEdit {
      match &mut app.dialog {
        Some(Dialog::$variant(d)) => &mut d.$field,
        _ => &mut app.scratch,
      }
    }
  };
}

accessor!(event_title, Event, title);
accessor!(event_start_date, Event, start_date);
accessor!(event_start_time, Event, start_time);
accessor!(event_end_date, Event, end_date);
accessor!(event_end_time, Event, end_time);
accessor!(event_location, Event, location);
accessor!(event_notes, Event, notes);
accessor!(task_title, Task, title);
accessor!(task_due_date, Task, due_date);
accessor!(task_due_time, Task, due_time);
accessor!(task_notes, Task, notes);

/// `fn(&App) -> Option<&str>`: one field's text for a picker to draw, `None` once its dialog has closed.
macro_rules! reader {
  ($name:ident, $variant:ident, $field:ident) => {
    fn $name(app: &App) -> Option<&str> {
      match &app.dialog {
        Some(Dialog::$variant(d)) => Some(d.$field.text.as_str()),
        _ => None,
      }
    }
  };
}

reader!(read_event_start_date, Event, start_date);
reader!(read_event_start_time, Event, start_time);
reader!(read_event_end_date, Event, end_date);
reader!(read_event_end_time, Event, end_time);
reader!(read_task_due_date, Task, due_date);
reader!(read_task_due_time, Task, due_time);

pub const START_DATE: Field = Field {
  key: "event-start-date",
  edit: event_start_date,
  edit_text: read_event_start_date,
  then: None,
};
pub const START_TIME: Field = Field {
  key: "event-start-time",
  edit: event_start_time,
  edit_text: read_event_start_time,
  then: None,
};
pub const END_DATE: Field = Field {
  key: "event-end-date",
  edit: event_end_date,
  edit_text: read_event_end_date,
  then: None,
};
pub const END_TIME: Field = Field {
  key: "event-end-time",
  edit: event_end_time,
  edit_text: read_event_end_time,
  then: None,
};
pub const DUE_DATE: Field = Field {
  key: "task-due-date",
  edit: task_due_date,
  edit_text: read_task_due_date,
  then: None,
};
pub const DUE_TIME: Field = Field {
  key: "task-due-time",
  edit: task_due_time,
  edit_text: read_task_due_time,
  then: None,
};

/// A labelled text field and its error, as the web app's `Field`.
#[allow(clippy::too_many_arguments)]
fn field(
  key: &str,
  label: &str,
  edit: &TextEdit,
  on_edit: fn(&mut App) -> &mut TextEdit,
  error: Option<&String>,
  multi_line: bool,
  disabled: bool,
  t: &Tokens,
) -> El {
  let mut input = text_input(edit, type_::BODY)
    .key(key)
    .label(label)
    .w_full()
    .px(8.0)
    .py(6.0)
    .radius(6.0)
    .border(1.0, if error.is_some() { t.error } else { t.border_strong })
    .fill(t.surface_sunken)
    .color(t.text);
  input = if multi_line { input.min_h(72.0) } else { input.single_line() };
  input = if disabled { input.disabled(true) } else { input.on_edit(on_edit) };
  let mut out = col()
    .gap(4.0)
    .w_full()
    .child(text(label).font(type_::LABEL).color(t.text))
    .child(input);
  if let Some(error) = error {
    out = out.child(
      text(error)
        .key(format!("{key}-error"))
        .role("alert")
        .font(type_::BODY)
        .color(t.error),
    );
  }
  out
}

/// One of a few options, as a pressed toggle (the web app's `<select>`).
fn option(key: &str, label: &str, chosen: bool, t: &Tokens) -> El {
  el()
    .key(key)
    .role("radio")
    .label(label)
    .checked(chosen)
    .focusable(true)
    .px(10.0)
    .py(5.0)
    .radius(6.0)
    .border(1.0, if chosen { t.accent } else { t.border })
    .fill(if chosen { t.accent_soft } else { t.surface_raised })
    .child(text(label).font(type_::LABEL).color(t.text))
}

/// "Start occurs twice. Choose an occurrence", with each instant and its offset.
#[allow(clippy::too_many_arguments)]
fn occurrence(
  key: &str,
  which: &str,
  times: [DateTime<Utc>; 2],
  chosen: Occurrence,
  error: Option<&String>,
  pick: fn(&mut App, u8),
  app: &App,
  t: &Tokens,
) -> El {
  let label = format!("{which} occurs twice. Choose an occurrence");
  let mut choices = row().key(key).role("radiogroup").label(&label).gap(6.0);
  for (n, at) in (0u8..).zip(times) {
    let local = app.locale.date_time_with_offset(at, app.clock.zone);
    choices = choices.child(option(&format!("{key}-{n}"), &local, chosen == Some(n), t).on_press(move |app: &mut App| pick(app, n)));
  }
  let mut out = col().gap(4.0).child(text(label).font(type_::LABEL).color(t.text)).child(choices);
  if let Some(error) = error {
    out = out.child(text(error).key(format!("{key}-error")).role("alert").color(t.error));
  }
  out
}

fn panel(key: &str, title: &str, t: &Tokens) -> El {
  col()
    .key(key)
    .role("dialog")
    .label(title)
    .modal(false, dialogs::close)
    .gap(12.0)
    .padding(20.0)
    .radius(12.0)
    .w(520.0)
    // At most the window's height, scrolling inside: an open month grid makes the event form taller than it (#1033).
    .min_h(0.0)
    .shrink()
    .fill(t.surface_raised)
    .scroll(rune::ScrollSpec { stick_bottom: false })
    .child(heading(&format!("{key}-heading"), title, 2, t))
}

fn backdrop(content: El, t: &Tokens) -> El {
  col()
    .key("form-backdrop")
    .absolute(0.0, 0.0)
    .w_full()
    .h_full()
    .padding(16.0)
    .center()
    .fill(t.backdrop)
    .child(content)
}

/// While an edit dialog fetches its item, or after it could not.
fn loading_state(panel: El, load: &Load, what: &str, t: &Tokens) -> Option<El> {
  match load {
    Load::Loading => Some(
      panel
        .child(
          text(format!("Loading {what}…"))
            .key("form-loading")
            .role("status")
            .color(t.loading_text),
        )
        .child(button("form-cancel", "Cancel", t).on_press(dialogs::close)),
    ),
    Load::Failed => Some(
      panel
        .child(
          text(format!("Couldn\u{2019}t load the {what}."))
            .key("form-load-error")
            .role("alert")
            .color(t.error),
        )
        .child(
          row()
            .gap(8.0)
            .child(button("form-retry", "Try again", t).on_press(dialogs::retry_load))
            .child(button("form-close", "Close", t).on_press(dialogs::close)),
        ),
    ),
    Load::Ready => None,
  }
}

fn form_error(error: Option<&String>, t: &Tokens) -> Option<El> {
  error.map(|message| {
    text(message)
      .key("form-error")
      .role("alert")
      .color(t.error)
      .fill(t.error_soft)
      .px(10.0)
      .py(8.0)
      .radius(6.0)
  })
}

/// The dialog on screen, over the page.
pub fn view(app: &App, t: &Tokens) -> Option<El> {
  match app.dialog.as_ref()? {
    Dialog::Event(d) => Some(backdrop(event_view(d, app, t), t)),
    Dialog::Task(d) => Some(backdrop(task_view(d, app, t), t)),
  }
}

// One dialog's layout, top to bottom, as the web app's `EventForm` is one component.
#[allow(clippy::too_many_lines)]
fn event_view(d: &EventDialog, app: &App, t: &Tokens) -> El {
  let title = if d.id.is_some() { "Edit event" } else { "Add event" };
  let panel = panel("event-form", title, t);
  if let Some(state) = loading_state(panel.clone(), &d.load, "event", t) {
    return state;
  }
  let busy = d.busy();
  let e = |f: EventField| d.errors.get(&f);
  let mut form = panel.child(field(
    "event-title",
    "Title",
    &d.title,
    event_title,
    e(EventField::Title),
    false,
    busy,
    t,
  ));
  let all_day = el()
    .key("event-all-day")
    .role("checkbox")
    .label("All day")
    .checked(d.all_day)
    .focusable(!busy)
    .size(16.0, 16.0)
    .radius(4.0)
    .border(1.5, t.border_strong)
    .fill(if d.all_day { t.accent } else { t.surface_raised });
  let all_day = if busy {
    all_day.disabled(true)
  } else {
    all_day.on_press(|app: &mut App| set_all_day(app))
  };
  form = form.child(row().gap(8.0).items_center().child(all_day).child(text("All day").color(t.text)));
  let (start_twice, end_twice) = d.draft().repeated(app.clock.zone);
  // Date and time share their row equally.
  let cell = |content: El| col().w(0.0).grow(1.0).child(content);
  let start_date = field(
    "event-start-date",
    "Start date",
    &d.start_date,
    event_start_date,
    e(EventField::Start),
    false,
    busy,
    t,
  );
  let end_date = field(
    "event-end-date",
    "End date",
    &d.end_date,
    event_end_date,
    e(EventField::End),
    false,
    busy,
    t,
  );
  let start_date = date_picker(start_date, START_DATE, "Start date", busy, app, t);
  let end_date = date_picker(end_date, END_DATE, "End date", busy, app, t);
  let mut start = row().gap(8.0).w_full().items_start().child(cell(start_date));
  let mut end = row().gap(8.0).w_full().items_start().child(cell(end_date));
  if !d.all_day {
    // The start and end errors show under their dates, as before.
    start = start.child(cell(time_picker(START_TIME, "Start time", busy, None, app, t)));
    end = end.child(cell(time_picker(END_TIME, "End time", busy, None, app, t)));
  }
  form = form.child(start);
  if let Some(times) = start_twice {
    form = form.child(occurrence(
      "event-start-occurrence",
      "Start",
      times,
      d.start_occurrence,
      e(EventField::StartOccurrence),
      pick_start,
      app,
      t,
    ));
  }
  form = form.child(end);
  if let Some(times) = end_twice {
    form = form.child(occurrence(
      "event-end-occurrence",
      "End",
      times,
      d.end_occurrence,
      e(EventField::EndOccurrence),
      pick_end,
      app,
      t,
    ));
  }
  if !d.all_day {
    form = form.child(meta(format!("Time zone: {}", app.clock.zone.name()), t).key("event-zone"));
  }
  form = form
    .child(field(
      "event-location",
      "Location",
      &d.location,
      event_location,
      e(EventField::Location),
      false,
      busy,
      t,
    ))
    .child(field(
      "event-notes",
      "Notes",
      &d.notes,
      event_notes,
      e(EventField::Notes),
      true,
      busy,
      t,
    ));
  if let Some(alert) = form_error(e(EventField::Form), t) {
    form = form.child(alert);
  }
  if d.confirm_delete {
    let delete = styled_button(
      "event-delete-confirm",
      if d.deleting { "Deleting…" } else { "Delete" },
      t.error,
      t.on_error,
      t,
    );
    let keep = button("event-keep", "Keep event", t);
    let (delete, keep) = if d.deleting {
      (delete.focusable(false).disabled(true), keep.focusable(false).disabled(true))
    } else {
      (delete.on_press(dialogs::delete_event), keep.on_press_tx(dialogs::keep_event))
    };
    let question = format!("Delete {}? This can\u{2019}t be undone.", d.title.text);
    return form
      .child(text(question).key("event-delete-question").color(t.text))
      .child(row().gap(8.0).child(delete).child(keep));
  }
  let save = button("event-save", if d.saving { "Saving…" } else { "Save event" }, t);
  let save = if busy || d.gone {
    save.focusable(false).disabled(true)
  } else {
    save.on_press(dialogs::save_event)
  };
  let mut actions = row().key("event-actions").gap(8.0).child(save);
  if d.id.is_some() {
    let delete = button("event-delete", "Delete event", t);
    actions = actions.child(if busy || d.gone {
      delete.focusable(false).disabled(true)
    } else {
      delete.on_press_tx(dialogs::ask_delete_event)
    });
  }
  let cancel = button("event-cancel", "Cancel", t);
  form.child(actions.child(if busy {
    cancel.focusable(false).disabled(true)
  } else {
    cancel.on_press(dialogs::close)
  }))
}

fn set_all_day(app: &mut App) {
  if let Some(d) = dialogs::event(app) {
    d.all_day = !d.all_day;
  }
}

fn pick_start(app: &mut App, n: u8) {
  if let Some(d) = dialogs::event(app) {
    d.start_occurrence = Some(n);
    d.errors.remove(&EventField::StartOccurrence);
  }
}

fn pick_end(app: &mut App, n: u8) {
  if let Some(d) = dialogs::event(app) {
    d.end_occurrence = Some(n);
    d.errors.remove(&EventField::EndOccurrence);
  }
}

#[allow(clippy::too_many_lines)]
fn task_view(d: &TaskDialog, app: &App, t: &Tokens) -> El {
  let title = if d.id.is_some() { "Edit task" } else { "Add task" };
  let panel = panel("task-form", title, t);
  if let Some(state) = loading_state(panel.clone(), &d.load, "task", t) {
    return state;
  }
  let busy = d.busy();
  let e = |f: TaskField| d.errors.get(&f);
  let mut form = panel.child(field(
    "task-title",
    "Title",
    &d.title,
    task_title,
    e(TaskField::Title),
    false,
    busy,
    t,
  ));
  let deadlines = Deadline::ALL.into_iter().fold(
    row().key("task-deadline").role("radiogroup").label("Deadline").gap(6.0),
    |r, kind| {
      let o = option(&format!("deadline-{kind:?}").to_lowercase(), kind.label(), d.deadline == kind, t);
      r.child(if busy {
        o.disabled(true)
      } else {
        o.on_press(move |app: &mut App| set_deadline(app, kind))
      })
    },
  );
  form = form.child(
    col()
      .gap(4.0)
      .child(text("Deadline").font(type_::LABEL).color(t.text))
      .child(deadlines),
  );
  if d.deadline != Deadline::None {
    let due_date = field(
      "task-due-date",
      "Due date",
      &d.due_date,
      task_due_date,
      e(TaskField::Date),
      false,
      busy,
      t,
    );
    form = form.child(date_picker(due_date, DUE_DATE, "Due date", busy, app, t));
  }
  if d.deadline == Deadline::Time {
    form = form
      .child(time_picker(DUE_TIME, "Due time", busy, e(TaskField::Time), app, t))
      .child(meta(format!("Time zone: {}", app.clock.zone.name()), t).key("task-zone"));
    if let Some(times) = repeated_due(d, app) {
      let error = e(TaskField::Occurrence);
      let mut picker = occurrence("task-occurrence", "This time", times, d.occurrence, error, pick_due, app, t);
      picker = picker.label("This time occurs twice. Choose an occurrence");
      form = form.child(picker);
    }
  }
  let priorities = PRIORITIES.into_iter().fold(
    row().key("task-priority").role("radiogroup").label("Priority").gap(6.0),
    |r, (value, label)| {
      let o = option(&format!("priority-{value}"), label, d.priority == value, t);
      r.child(if busy {
        o.disabled(true)
      } else {
        o.on_press(move |app: &mut App| set_priority(app, value))
      })
    },
  );
  form = form
    .child(
      col()
        .gap(4.0)
        .child(text("Priority").font(type_::LABEL).color(t.text))
        .child(priorities),
    )
    .child(field(
      "task-notes",
      "Notes",
      &d.notes,
      task_notes,
      e(TaskField::Notes),
      true,
      busy,
      t,
    ));
  if let Some(alert) = form_error(e(TaskField::Form), t) {
    form = form.child(alert);
  }
  let save = button("task-save", if d.saving { "Saving…" } else { "Save task" }, t);
  let save = if busy || d.gone {
    save.focusable(false).disabled(true)
  } else {
    save.on_press(dialogs::save_task)
  };
  let cancel = button("task-cancel", "Cancel", t);
  form.child(row().key("task-actions").gap(8.0).child(save).child(if busy {
    cancel.focusable(false).disabled(true)
  } else {
    cancel.on_press(dialogs::close)
  }))
}

fn repeated_due(d: &TaskDialog, app: &App) -> Option<[DateTime<Utc>; 2]> {
  let date = crate::format::parse_iso_date(d.due_date.text.trim())?;
  let time = chrono::NaiveTime::parse_from_str(d.due_time.text.trim(), "%H:%M").ok()?;
  match crate::forms::resolve(date.and_time(time), app.clock.zone) {
    crate::forms::Local::Twice(a, b) => Some([a, b]),
    _ => None,
  }
}

fn set_deadline(app: &mut App, kind: Deadline) {
  if let Some(d) = dialogs::task(app) {
    d.deadline = kind;
  }
}

fn set_priority(app: &mut App, value: &'static str) {
  if let Some(d) = dialogs::task(app) {
    value.clone_into(&mut d.priority);
  }
}

fn pick_due(app: &mut App, n: u8) {
  if let Some(d) = dialogs::task(app) {
    d.occurrence = Some(n);
    d.errors.remove(&TaskField::Occurrence);
  }
}

/// The message after a save or delete (`role="status"`), with "Show day" when the item went on another day.
pub fn notice(app: &App, t: &Tokens) -> Option<El> {
  let notice = app.notice.as_ref()?;
  // The web app's toast: a "Notifications" region whose message is a status, read once; it pauses its six seconds
  // while the pointer is over it (#1035; focus inside pauses it too, in `focus::poll`).
  let mut bar = row()
    .key("notice")
    .role("region")
    .label("Notifications")
    .gap(10.0)
    .items_center()
    .px(12.0)
    .py(8.0)
    .radius(8.0)
    .fill(t.accent_soft)
    .on_hover_change(|app: &mut App, hovered: bool, _tx: &mut rune::Tx| {
      if let Some(notice) = &mut app.notice {
        notice.hovered = hovered;
      }
    })
    .child(text(&notice.text).key("notice-message").role("status").color(t.text).grow(1.0));
  if notice.show_day.is_some() {
    bar = bar.child(button("notice-show-day", "Show day", t).on_press_tx(dialogs::show_day));
  }
  bar = bar.child(
    button("notice-dismiss", "Dismiss", t)
      .label("Dismiss notification")
      .on_press_tx(crate::focus::dismiss),
  );
  Some(bar)
}
