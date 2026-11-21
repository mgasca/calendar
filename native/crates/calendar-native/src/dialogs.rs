//! The add and edit dialogs for events and tasks, as the web app's `EventForm.tsx`, `TaskForm.tsx`, `EditEvent.tsx`,
//! `EditTask.tsx`, `AddEvent.tsx` and `AddTask.tsx`: the form's fields as text fields, its rules (`forms.rs`), what
//! a save, a 400, a 409 or a 404 does, deleting an event from its dialog, and the notice after a save.

use crate::forms::{self, Deadline, EventDraft, EventField, Occurrence, TaskDraft, TaskField, event_draft, task_draft};
use crate::{App, load};
use calendar_client::generated::{UpdateEventRequestVersion, UpdateTaskRequestVersion};
use calendar_client::{ApiError, SaveError};
use chrono::NaiveDate;
use rune::TextEdit;
use std::collections::BTreeMap;
use uuid::Uuid;

/// Where an edit dialog's copy of the item stands.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Load {
  /// Fetching the item before the form shows ("Loading event…").
  Loading,
  /// The form shows the item.
  Ready,
  /// It could not be fetched ("Couldn't load the event." and "Try again").
  Failed,
}

/// The event dialog.
// Its flags are the web form's own states (all day, gone, saving, confirming, deleting), not a hidden state machine.
#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Debug)]
pub struct EventDialog {
  /// `None` while adding.
  pub id: Option<Uuid>,
  pub version: Option<UpdateEventRequestVersion>,
  /// The day the dialog was opened from (Add on a Day page), for "Show day".
  pub shown_day: Option<NaiveDate>,
  pub load: Load,
  pub title: TextEdit,
  pub all_day: bool,
  pub start_date: TextEdit,
  pub start_time: TextEdit,
  pub start_occurrence: Occurrence,
  pub end_date: TextEdit,
  pub end_time: TextEdit,
  pub end_occurrence: Occurrence,
  pub location: TextEdit,
  pub notes: TextEdit,
  pub errors: BTreeMap<EventField, String>,
  /// The item no longer exists (404): Save and Delete are disabled.
  pub gone: bool,
  pub saving: bool,
  pub confirm_delete: bool,
  pub deleting: bool,
  /// The start as last seen, so an edited start moves the end with it.
  last_start: (String, String),
  /// Each errored field's text when its error appeared.
  seen: BTreeMap<EventField, String>,
}

/// The task dialog.
#[derive(Clone, Debug)]
pub struct TaskDialog {
  pub id: Option<Uuid>,
  pub version: Option<UpdateTaskRequestVersion>,
  pub shown_day: Option<NaiveDate>,
  pub load: Load,
  pub title: TextEdit,
  pub deadline: Deadline,
  pub due_date: TextEdit,
  pub due_time: TextEdit,
  pub occurrence: Occurrence,
  pub priority: String,
  pub notes: TextEdit,
  pub errors: BTreeMap<TaskField, String>,
  pub gone: bool,
  pub saving: bool,
  seen: BTreeMap<TaskField, String>,
}

/// The dialog on screen.
#[derive(Clone, Debug)]
pub enum Dialog {
  Event(Box<EventDialog>),
  Task(Box<TaskDialog>),
}

/// A message after a save: "Planning added for Mon 23 Nov.", with "Show day" when it went on another day.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notice {
  pub text: String,
  pub show_day: Option<NaiveDate>,
}

fn edit(text: &str) -> TextEdit {
  TextEdit::new(text)
}

impl EventDialog {
  fn with(draft: &EventDraft, id: Option<Uuid>, shown_day: Option<NaiveDate>) -> Self {
    let mut dialog = EventDialog {
      id,
      version: None,
      shown_day,
      load: Load::Ready,
      title: edit(&draft.title),
      all_day: draft.all_day,
      start_date: edit(""),
      start_time: edit(""),
      start_occurrence: None,
      end_date: edit(""),
      end_time: edit(""),
      end_occurrence: None,
      location: edit(""),
      notes: edit(""),
      errors: BTreeMap::new(),
      gone: false,
      saving: false,
      confirm_delete: false,
      deleting: false,
      last_start: (String::new(), String::new()),
      seen: BTreeMap::new(),
    };
    dialog.fill(draft);
    dialog.title.focused = true;
    dialog
  }

  fn fill(&mut self, draft: &EventDraft) {
    self.title.replace_text(&draft.title);
    self.all_day = draft.all_day;
    self.start_date.replace_text(&draft.start_date);
    self.start_time.replace_text(&draft.start_time);
    self.start_occurrence = draft.start_occurrence;
    self.end_date.replace_text(&draft.end_date);
    self.end_time.replace_text(&draft.end_time);
    self.end_occurrence = draft.end_occurrence;
    self.location.replace_text(&draft.location);
    self.notes.replace_text(&draft.notes);
    self.last_start = (draft.start_date.clone(), draft.start_time.clone());
  }

  /// The form as typed.
  #[must_use]
  pub fn draft(&self) -> EventDraft {
    EventDraft {
      title: self.title.text.clone(),
      all_day: self.all_day,
      start_date: self.start_date.text.clone(),
      start_time: self.start_time.text.clone(),
      start_occurrence: self.start_occurrence,
      end_date: self.end_date.text.clone(),
      end_time: self.end_time.text.clone(),
      end_occurrence: self.end_occurrence,
      location: self.location.text.clone(),
      notes: self.notes.text.clone(),
    }
  }

  fn focus(&mut self, field: EventField) {
    match field {
      EventField::Title => self.title.focused = true,
      EventField::Start | EventField::StartOccurrence => self.start_date.focused = true,
      EventField::End | EventField::EndOccurrence => self.end_date.focused = true,
      EventField::Location => self.location.focused = true,
      EventField::Notes => self.notes.focused = true,
      EventField::Form => {}
    }
  }

  /// The busy state that disables the form (the web app's disabled `<fieldset>`).
  #[must_use]
  pub fn busy(&self) -> bool {
    self.saving || self.deleting || self.load == Load::Loading
  }
}

impl TaskDialog {
  fn with(draft: &TaskDraft, id: Option<Uuid>, shown_day: Option<NaiveDate>) -> Self {
    let mut dialog = TaskDialog {
      id,
      version: None,
      shown_day,
      load: Load::Ready,
      title: edit(""),
      deadline: Deadline::None,
      due_date: edit(""),
      due_time: edit(""),
      occurrence: None,
      priority: String::new(),
      notes: edit(""),
      errors: BTreeMap::new(),
      gone: false,
      saving: false,
      seen: BTreeMap::new(),
    };
    dialog.fill(draft);
    dialog.title.focused = true;
    dialog
  }

  fn fill(&mut self, draft: &TaskDraft) {
    self.title.replace_text(&draft.title);
    self.deadline = draft.deadline;
    self.due_date.replace_text(&draft.due_date);
    self.due_time.replace_text(&draft.due_time);
    self.occurrence = draft.occurrence;
    self.priority.clone_from(&draft.priority);
    self.notes.replace_text(&draft.notes);
  }

  #[must_use]
  pub fn draft(&self) -> TaskDraft {
    TaskDraft {
      title: self.title.text.clone(),
      deadline: self.deadline,
      due_date: self.due_date.text.clone(),
      due_time: self.due_time.text.clone(),
      occurrence: self.occurrence,
      priority: self.priority.clone(),
      notes: self.notes.text.clone(),
    }
  }

  fn focus(&mut self, field: TaskField) {
    match field {
      TaskField::Title => self.title.focused = true,
      TaskField::Date | TaskField::Occurrence => self.due_date.focused = true,
      TaskField::Time => self.due_time.focused = true,
      TaskField::Notes => self.notes.focused = true,
      TaskField::Form => {}
    }
  }

  #[must_use]
  pub fn busy(&self) -> bool {
    self.saving || self.load == Load::Loading
  }
}

/// The open event dialog, if any.
pub fn event(app: &mut App) -> Option<&mut EventDialog> {
  match &mut app.dialog {
    Some(Dialog::Event(d)) => Some(d),
    _ => None,
  }
}

/// The open task dialog, if any.
pub fn task(app: &mut App) -> Option<&mut TaskDialog> {
  match &mut app.dialog {
    Some(Dialog::Task(d)) => Some(d),
    _ => None,
  }
}

/// "Add event" on the Day page for `date`.
pub fn add_event(app: &mut App, date: NaiveDate) {
  let draft = forms::new_event(date, app.clock.today(), app.clock.now(), app.clock.zone);
  app.dialog = Some(Dialog::Event(Box::new(EventDialog::with(&draft, None, Some(date)))));
  crate::pickers::reset(app);
  app.notice = None;
}

/// "Add task" on the Day page (`Some(date)`) or My tasks (`None`).
pub fn add_task(app: &mut App, date: Option<NaiveDate>) {
  app.dialog = Some(Dialog::Task(Box::new(TaskDialog::with(&forms::new_task(date), None, date))));
  crate::pickers::reset(app);
  app.notice = None;
}

/// An event's title: opens it to edit, after fetching its latest copy.
pub fn edit_event(app: &mut App, id: Uuid) {
  let mut dialog = EventDialog::with(
    &forms::new_event(app.clock.today(), app.clock.today(), app.clock.now(), app.clock.zone),
    Some(id),
    None,
  );
  dialog.load = Load::Loading;
  app.dialog = Some(Dialog::Event(Box::new(dialog)));
  crate::pickers::reset(app);
  app.notice = None;
  fetch_event(app, id, None);
}

/// A task's title: opens it to edit, after fetching its latest copy.
pub fn edit_task(app: &mut App, id: Uuid) {
  let mut dialog = TaskDialog::with(&forms::new_task(None), Some(id), None);
  dialog.load = Load::Loading;
  app.dialog = Some(Dialog::Task(Box::new(dialog)));
  crate::pickers::reset(app);
  app.notice = None;
  fetch_task(app, id, None);
}

/// Fetches event `id` into its dialog; `after_conflict` is the message a 409 reload shows.
fn fetch_event(app: &mut App, id: Uuid, after_conflict: Option<&'static str>) {
  let api = app.api.clone();
  app.effects.run(async move { api.event(id).await }, move |app: &mut App, result| {
    let zone = app.clock.zone;
    let Some(dialog) = event(app).filter(|d| d.id == Some(id)) else {
      return;
    };
    dialog.saving = false;
    dialog.deleting = false;
    match result {
      Ok(stored) => {
        dialog.fill(&event_draft(&stored, zone));
        dialog.version = Some(stored.version.into());
        dialog.load = Load::Ready;
        dialog.errors.clear();
        if let Some(message) = after_conflict {
          dialog.errors.insert(EventField::Form, message.to_owned());
        }
      }
      Err(error) if error.status == Some(404) => {
        dialog.load = Load::Ready;
        dialog.gone = true;
        dialog.errors = BTreeMap::from([(EventField::Form, "This event no longer exists.".to_owned())]);
        load::refetch(app);
      }
      Err(_) => dialog.load = Load::Failed,
    }
  });
}

fn fetch_task(app: &mut App, id: Uuid, after_conflict: Option<&'static str>) {
  let api = app.api.clone();
  app.effects.run(async move { api.task(id).await }, move |app: &mut App, result| {
    let zone = app.clock.zone;
    let Some(dialog) = task(app).filter(|d| d.id == Some(id)) else {
      return;
    };
    dialog.saving = false;
    match result {
      Ok(stored) => {
        dialog.fill(&task_draft(&stored, zone));
        dialog.version = Some(stored.version.into());
        dialog.load = Load::Ready;
        dialog.errors.clear();
        if let Some(message) = after_conflict {
          dialog.errors.insert(TaskField::Form, message.to_owned());
        }
      }
      Err(error) if error.status == Some(404) => {
        dialog.load = Load::Ready;
        dialog.gone = true;
        dialog.errors = BTreeMap::from([(TaskField::Form, "This task no longer exists.".to_owned())]);
        load::refetch(app);
      }
      Err(_) => dialog.load = Load::Failed,
    }
  });
}

/// "Try again" after an edit dialog could not load its item.
pub fn retry_load(app: &mut App) {
  match &mut app.dialog {
    Some(Dialog::Event(d)) if d.load == Load::Failed => {
      d.load = Load::Loading;
      if let Some(id) = d.id {
        fetch_event(app, id, None);
      }
    }
    Some(Dialog::Task(d)) if d.load == Load::Failed => {
      d.load = Load::Loading;
      if let Some(id) = d.id {
        fetch_task(app, id, None);
      }
    }
    _ => {}
  }
}

/// "Cancel", "Close" or Escape: closes the dialog unless it is busy.
pub fn close(app: &mut App) {
  let busy = match &app.dialog {
    Some(Dialog::Event(d)) => d.busy(),
    Some(Dialog::Task(d)) => d.busy() && d.load != Load::Loading,
    None => false,
  };
  if !busy {
    app.dialog = None;
    crate::pickers::reset(app);
  }
}

/// "Show day" in a notice.
pub fn show_day(app: &mut App) {
  if let Some(date) = app.notice.as_ref().and_then(|n| n.show_day) {
    app.notice = None;
    load::go(app, crate::route::Route::Day(date));
  }
}

/// Keeps the event's length when its start is edited (the web app's `moveStart`); called from `poll`.
pub fn follow_start(app: &mut App) {
  let Some(dialog) = event(app) else { return };
  let now = (dialog.start_date.text.clone(), dialog.start_time.text.clone());
  if now == dialog.last_start {
    return;
  }
  let mut draft = dialog.draft();
  draft.start_date.clone_from(&dialog.last_start.0);
  draft.start_time.clone_from(&dialog.last_start.1);
  draft.move_start(now.0.clone(), now.1.clone());
  if draft.end_date != dialog.end_date.text {
    dialog.end_date.replace_text(&draft.end_date);
  }
  if draft.end_time != dialog.end_time.text {
    dialog.end_time.replace_text(&draft.end_time);
  }
  dialog.start_occurrence = None;
  dialog.end_occurrence = None;
  dialog.errors.remove(&EventField::Start);
  dialog.last_start = now;
}

/// "Save event".
pub fn save_event(app: &mut App) {
  let zone = app.clock.zone;
  let Some(dialog) = event(app) else { return };
  if dialog.busy() || dialog.gone {
    return;
  }
  let body = match forms::validate_event(&dialog.draft(), zone) {
    Ok(body) => body,
    Err(errors) => {
      if let Some(first) = errors.keys().next().copied() {
        dialog.focus(first);
      }
      dialog.errors = errors;
      return;
    }
  };
  dialog.errors.clear();
  dialog.saving = true;
  let (id, version, shown_day) = (dialog.id, dialog.version.clone(), dialog.shown_day);
  let title = body.0.title.clone();
  let start_day = body
    .0
    .start_date
    .flatten()
    .or_else(|| body.0.start.flatten().map(|at| crate::format::local_date(at, zone)));
  let api = app.api.clone();
  app.effects.run(
    async move {
      match (id, version) {
        (Some(id), Some(version)) => api.update_event(id, body.update(version)).await,
        _ => api.create_event(body.0).await,
      }
    },
    move |app: &mut App, result| match result {
      Ok(_) => {
        app.dialog = None;
        crate::pickers::reset(app);
        app.notice = Some(match id {
          Some(_) => Notice {
            text: format!("{title} saved."),
            show_day: None,
          },
          None => Notice {
            text: format!(
              "{title} added for {}.",
              start_day.map(|day| app.locale.short_day(day)).unwrap_or_default()
            ),
            show_day: start_day.filter(|day| Some(*day) != shown_day),
          },
        });
        load::refetch(app);
      }
      Err(error) => event_failed(app, id, &error),
    },
  );
}

fn event_failed(app: &mut App, id: Option<Uuid>, error: &SaveError) {
  let Some(dialog) = event(app) else { return };
  match error.error.status {
    Some(400) => {
      dialog.saving = false;
      dialog.errors = forms::event_server_errors(&error.body);
      if let Some(first) = dialog.errors.keys().next().copied() {
        dialog.focus(first);
      }
    }
    Some(409) => {
      if let Some(id) = id {
        fetch_event(
          app,
          id,
          Some("This event was changed elsewhere. The latest version is shown; check it and save again."),
        );
      }
    }
    Some(404) => {
      dialog.saving = false;
      dialog.gone = true;
      dialog.errors = BTreeMap::from([(EventField::Form, "This event no longer exists.".to_owned())]);
      load::refetch(app);
    }
    _ => {
      dialog.saving = false;
      dialog.errors = BTreeMap::from([(EventField::Form, "Couldn\u{2019}t save the event. Try again.".to_owned())]);
    }
  }
}

/// "Delete event" in the event dialog: asks within the dialog first.
pub fn ask_delete_event(app: &mut App) {
  if let Some(dialog) = event(app).filter(|d| !d.busy() && !d.gone) {
    dialog.confirm_delete = true;
  }
}

/// "Keep event".
pub fn keep_event(app: &mut App) {
  if let Some(dialog) = event(app).filter(|d| !d.deleting) {
    dialog.confirm_delete = false;
  }
}

/// "Delete" in the event dialog's confirmation.
pub fn delete_event(app: &mut App) {
  let Some(dialog) = event(app).filter(|d| d.confirm_delete && !d.deleting) else {
    return;
  };
  let Some(id) = dialog.id else { return };
  dialog.deleting = true;
  let title = dialog.title.text.clone();
  let api = app.api.clone();
  app.effects.run(
    async move { api.delete_event(id).await },
    move |app: &mut App, result| match result {
      Ok(()) => {
        app.dialog = None;
        crate::pickers::reset(app);
        app.notice = Some(Notice {
          text: format!("{title} deleted."),
          show_day: None,
        });
        load::refetch(app);
      }
      Err(error) => delete_failed(app, id, &error),
    },
  );
}

fn delete_failed(app: &mut App, id: Uuid, error: &ApiError) {
  let Some(dialog) = event(app) else { return };
  dialog.confirm_delete = false;
  match error.status {
    Some(409) => fetch_event(
      app,
      id,
      Some("This event was changed elsewhere. The latest version is shown; check it and save again."),
    ),
    Some(404) => {
      dialog.deleting = false;
      dialog.gone = true;
      dialog.errors = BTreeMap::from([(EventField::Form, "This event no longer exists.".to_owned())]);
      load::refetch(app);
    }
    _ => {
      dialog.deleting = false;
      dialog.errors = BTreeMap::from([(EventField::Form, "Couldn\u{2019}t delete the event. Try again.".to_owned())]);
    }
  }
}

/// "Save task".
pub fn save_task(app: &mut App) {
  let zone = app.clock.zone;
  let Some(dialog) = task(app) else { return };
  if dialog.busy() || dialog.gone {
    return;
  }
  let body = match forms::validate_task(&dialog.draft(), zone) {
    Ok(body) => body,
    Err(errors) => {
      if let Some(first) = errors.keys().next().copied() {
        dialog.focus(first);
      }
      dialog.errors = errors;
      return;
    }
  };
  dialog.errors.clear();
  dialog.saving = true;
  let (id, version, shown_day) = (dialog.id, dialog.version.clone(), dialog.shown_day);
  let title = body.title.clone();
  let due_day = body
    .due_date
    .flatten()
    .or_else(|| body.due_at.flatten().map(|at| crate::format::local_date(at, zone)));
  let api = app.api.clone();
  app.effects.run(
    async move {
      match (id, version) {
        (Some(id), Some(version)) => api.update_task(id, forms::task_update(body, version)).await,
        _ => api.create_task(body).await,
      }
    },
    move |app: &mut App, result| match result {
      Ok(_) => {
        app.dialog = None;
        crate::pickers::reset(app);
        app.notice = Some(match (id, due_day) {
          (Some(_), _) => Notice {
            text: "Task saved.".to_owned(),
            show_day: None,
          },
          (None, Some(day)) if Some(day) != shown_day => Notice {
            text: format!("\u{201c}{title}\u{201d} added for {}.", app.locale.short_day(day)),
            show_day: Some(day),
          },
          (None, _) => Notice {
            text: format!("\u{201c}{title}\u{201d} added."),
            show_day: None,
          },
        });
        load::refetch(app);
      }
      Err(error) => task_failed(app, id, &error),
    },
  );
}

fn task_failed(app: &mut App, id: Option<Uuid>, error: &SaveError) {
  let Some(dialog) = task(app) else { return };
  match error.error.status {
    Some(400) => {
      dialog.saving = false;
      dialog.errors = forms::task_server_errors(&error.body);
      if let Some(first) = dialog.errors.keys().next().copied() {
        dialog.focus(first);
      }
    }
    Some(409) => {
      if let Some(id) = id {
        fetch_task(
          app,
          id,
          Some("This task was changed elsewhere. The latest version is shown; check it and save again."),
        );
      }
    }
    Some(404) => {
      dialog.saving = false;
      dialog.gone = true;
      dialog.errors = BTreeMap::from([(TaskField::Form, "This task no longer exists.".to_owned())]);
      load::refetch(app);
    }
    _ => {
      dialog.saving = false;
      dialog.errors = BTreeMap::from([(TaskField::Form, "Couldn\u{2019}t save the task. Try again.".to_owned())]);
    }
  }
}

fn event_text(d: &EventDialog, field: EventField) -> String {
  match field {
    EventField::Title => d.title.text.clone(),
    EventField::Start | EventField::StartOccurrence => format!("{} {}", d.start_date.text, d.start_time.text),
    EventField::End | EventField::EndOccurrence => format!("{} {}", d.end_date.text, d.end_time.text),
    EventField::Location => d.location.text.clone(),
    EventField::Notes => d.notes.text.clone(),
    EventField::Form => String::new(),
  }
}

fn task_text(d: &TaskDialog, field: TaskField) -> String {
  match field {
    TaskField::Title => d.title.text.clone(),
    TaskField::Date | TaskField::Occurrence => d.due_date.text.clone(),
    TaskField::Time => d.due_time.text.clone(),
    TaskField::Notes => d.notes.text.clone(),
    TaskField::Form => String::new(),
  }
}

/// A field's error clears once that field is edited, as the web app clears it on change; called from `poll`. The
/// text a field had when its error appeared is kept in `seen`; when it differs, the error goes.
pub fn clear_edited_errors(app: &mut App) {
  /// `texts` holds each errored field's current text, read before this borrows the dialog mutably.
  fn sweep<F: Ord + Copy>(errors: &mut BTreeMap<F, String>, seen: &mut BTreeMap<F, String>, texts: Vec<(F, String)>) {
    for (field, now) in texts {
      match seen.get(&field) {
        Some(before) if *before != now => {
          errors.remove(&field);
          seen.remove(&field);
        }
        Some(_) => {}
        None => {
          seen.insert(field, now);
        }
      }
    }
    seen.retain(|field, _| errors.contains_key(field));
  }
  // Runs every frame while a dialog is open (pre-merge review of #1025): with no field errors it does nothing, and it
  // copies only the errored fields' text, never the dialog.
  match &mut app.dialog {
    Some(Dialog::Event(d)) => {
      let texts: Vec<_> = d
        .errors
        .keys()
        .filter(|f| **f != EventField::Form)
        .map(|f| (*f, event_text(d, *f)))
        .collect();
      if !texts.is_empty() || !d.seen.is_empty() {
        sweep(&mut d.errors, &mut d.seen, texts);
      }
    }
    Some(Dialog::Task(d)) => {
      let texts: Vec<_> = d
        .errors
        .keys()
        .filter(|f| **f != TaskField::Form)
        .map(|f| (*f, task_text(d, *f)))
        .collect();
      if !texts.is_empty() || !d.seen.is_empty() {
        sweep(&mut d.errors, &mut d.seen, texts);
      }
    }
    None => {}
  }
}
