//! The event and task forms' data, rules and requests, ported from the web app's `features/events/eventForm.ts`,
//! `features/tasks/taskForm.ts` and `features/agenda/deadline.ts`. Dates and times are typed as `YYYY-MM-DD` and
//! `HH:MM`, the values the web app's inputs submit; local times are resolved in the user's IANA zone, where a time
//! can fall in a daylight-saving gap or occur twice.

use calendar_client::generated::{
  CreateEventRequest, CreateTaskRequest, EventResponse, TaskResponse, UpdateEventRequest, UpdateTaskRequest,
};
use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, NaiveTime, Timelike, Utc};
use chrono_tz::Tz;
use std::collections::BTreeMap;

pub const TITLE_MAX: usize = 200;
pub const LOCATION_MAX: usize = 200;
pub const NOTES_MAX: usize = 4000;

/// A local date and time in `zone`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Local {
  /// In a daylight-saving gap: the time does not exist.
  Gap,
  One(DateTime<Utc>),
  /// The clocks went back: the time occurs twice, earlier first.
  Twice(DateTime<Utc>, DateTime<Utc>),
}

/// Resolves a wall-clock time in `zone` (the web app's `deadlineInstants`).
#[must_use]
pub fn resolve(local: NaiveDateTime, zone: Tz) -> Local {
  use chrono::offset::LocalResult;
  match local.and_local_timezone(zone) {
    LocalResult::None => Local::Gap,
    LocalResult::Single(at) => Local::One(at.with_timezone(&Utc)),
    LocalResult::Ambiguous(a, b) => {
      let (a, b) = (a.with_timezone(&Utc), b.with_timezone(&Utc));
      Local::Twice(a.min(b), a.max(b))
    }
  }
}

fn parse_date(value: &str) -> Option<NaiveDate> {
  crate::format::parse_iso_date(value.trim())
}

fn parse_time(value: &str) -> Option<NaiveTime> {
  let value = value.trim();
  (value.len() == 5).then(|| NaiveTime::parse_from_str(value, "%H:%M").ok()).flatten()
}

/// The text a time field shows: "09:30".
#[must_use]
pub fn time_text(time: NaiveTime) -> String {
  time.format("%H:%M").to_string()
}

/// A local time's two instants when it occurs twice, earlier first.
pub type Repeated = Option<[DateTime<Utc>; 2]>;

/// Which of a repeated local time's two instants the user chose: 0 earlier, 1 later.
pub type Occurrence = Option<u8>;

/// A field's local time as an instant, or the message the field shows.
fn instant(date: &str, time: &str, occurrence: Occurrence, zone: Tz) -> Result<DateTime<Utc>, (&'static str, bool)> {
  let date = parse_date(date).ok_or(("Enter a date as YYYY-MM-DD.", false))?;
  let time = parse_time(time).ok_or(("Enter a time as HH:MM.", false))?;
  match resolve(date.and_time(time), zone) {
    Local::Gap => Err(("This local time does not exist. Choose another time.", false)),
    Local::One(at) => Ok(at),
    Local::Twice(earlier, later) => match occurrence {
      Some(0) => Ok(earlier),
      Some(_) => Ok(later),
      None => Err(("Choose which occurrence of this time you mean.", true)),
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Events

/// The event form's fields, in the order the first invalid one takes focus.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum EventField {
  Title,
  Start,
  StartOccurrence,
  End,
  EndOccurrence,
  Location,
  Notes,
  /// Not a field: the form's own message.
  Form,
}

/// The event form as typed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EventDraft {
  pub title: String,
  pub all_day: bool,
  pub start_date: String,
  pub start_time: String,
  pub start_occurrence: Occurrence,
  pub end_date: String,
  pub end_time: String,
  pub end_occurrence: Occurrence,
  pub location: String,
  pub notes: String,
}

/// A new event on `date`: today starts at now rounded up to the next :00 or :30, another day at 09:00; one hour long.
#[must_use]
pub fn new_event(date: NaiveDate, today: NaiveDate, now: DateTime<Utc>, zone: Tz) -> EventDraft {
  let start = if date == today {
    let local = now
      .with_timezone(&zone)
      .naive_local()
      .with_second(0)
      .and_then(|t| t.with_nanosecond(0))
      .expect("a valid time");
    let minutes = i64::from(local.minute());
    let to_next = if minutes == 0 || minutes == 30 {
      0
    } else if minutes < 30 {
      30 - minutes
    } else {
      60 - minutes
    };
    local + Duration::minutes(to_next)
  } else {
    date.and_time(NaiveTime::from_hms_opt(9, 0, 0).expect("09:00"))
  };
  let end = start + Duration::hours(1);
  EventDraft {
    title: String::new(),
    all_day: false,
    start_date: start.date().to_string(),
    start_time: time_text(start.time()),
    start_occurrence: None,
    end_date: end.date().to_string(),
    end_time: time_text(end.time()),
    end_occurrence: None,
    location: String::new(),
    notes: String::new(),
  }
}

impl EventDraft {
  /// A new start that keeps the event's duration (one hour when the old one cannot be read); clears both
  /// occurrences (the web app's `moveStart`).
  pub fn move_start(&mut self, date: String, time: String) {
    let old = parse_date(&self.start_date)
      .zip(parse_time(&self.start_time))
      .map(|(d, t)| d.and_time(t));
    let end = parse_date(&self.end_date)
      .zip(parse_time(&self.end_time))
      .map(|(d, t)| d.and_time(t));
    let duration = old
      .zip(end)
      .map(|(s, e)| e - s)
      .filter(|d| *d > Duration::zero())
      .unwrap_or(Duration::hours(1));
    self.start_date = date;
    self.start_time = time;
    if let Some(start) = parse_date(&self.start_date)
      .zip(parse_time(&self.start_time))
      .map(|(d, t)| d.and_time(t))
    {
      let end = start + duration;
      self.end_date = end.date().to_string();
      self.end_time = time_text(end.time());
    }
    self.start_occurrence = None;
    self.end_occurrence = None;
  }

  /// The local times that occur twice, so the form shows their occurrence choice.
  #[must_use]
  pub fn repeated(&self, zone: Tz) -> (Repeated, Repeated) {
    let twice = |date: &str, time: &str| match parse_date(date).zip(parse_time(time)).map(|(d, t)| resolve(d.and_time(t), zone)) {
      Some(Local::Twice(a, b)) => Some([a, b]),
      _ => None,
    };
    if self.all_day {
      (None, None)
    } else {
      (twice(&self.start_date, &self.start_time), twice(&self.end_date, &self.end_time))
    }
  }
}

/// What the form sends, before `version` is added for an update.
#[derive(Clone, Debug)]
pub struct EventBody(pub CreateEventRequest);

/// Checks the form as the web app's `validateEvent` does; the errors are keyed by field, in focus order.
pub fn validate_event(draft: &EventDraft, zone: Tz) -> Result<EventBody, BTreeMap<EventField, String>> {
  let mut errors = BTreeMap::new();
  let title = draft.title.trim();
  if title.is_empty() {
    errors.insert(EventField::Title, "Enter a title.".to_owned());
  } else if title.chars().count() > TITLE_MAX {
    errors.insert(EventField::Title, format!("Title must be at most {TITLE_MAX} characters."));
  }
  if draft.location.chars().count() > LOCATION_MAX {
    errors.insert(EventField::Location, format!("Location must be at most {LOCATION_MAX} characters."));
  }
  if draft.notes.trim().chars().count() > NOTES_MAX {
    errors.insert(EventField::Notes, format!("Notes must be at most {NOTES_MAX} characters."));
  }
  let mut body = CreateEventRequest::new(draft.title.clone());
  body.all_day = Some(draft.all_day);
  body.location = Some(Some(draft.location.clone()));
  body.notes = Some(Some(draft.notes.clone()));
  if draft.all_day {
    match (parse_date(&draft.start_date), parse_date(&draft.end_date)) {
      (None, _) => {
        errors.insert(EventField::Start, "Enter a start date.".to_owned());
      }
      (Some(_), None) => {
        errors.insert(EventField::End, "Enter a date as YYYY-MM-DD.".to_owned());
      }
      (Some(start), Some(last)) if last < start => {
        errors.insert(EventField::End, "End date must be on or after the start date.".to_owned());
      }
      (Some(start), Some(last)) => {
        body.start_date = Some(Some(start));
        body.end_date = Some(last.succ_opt());
      }
    }
  } else {
    let start = instant(&draft.start_date, &draft.start_time, draft.start_occurrence, zone);
    let end = instant(&draft.end_date, &draft.end_time, draft.end_occurrence, zone);
    if let Err((message, occurrence)) = start {
      errors.insert(
        if occurrence {
          EventField::StartOccurrence
        } else {
          EventField::Start
        },
        message.to_owned(),
      );
    }
    if let Err((message, occurrence)) = end {
      errors.insert(
        if occurrence { EventField::EndOccurrence } else { EventField::End },
        message.to_owned(),
      );
    }
    if let (Ok(start), Ok(end)) = (start, end) {
      if end <= start {
        errors.insert(EventField::End, "End must be after the start.".to_owned());
      }
      body.start = Some(Some(start));
      body.end = Some(Some(end));
      body.time_zone = Some(Some(zone.name().to_owned()));
    }
  }
  if errors.is_empty() { Ok(EventBody(body)) } else { Err(errors) }
}

impl EventBody {
  /// The update request: the same fields plus the version the form loaded.
  #[must_use]
  pub fn update(self, version: calendar_client::generated::UpdateEventRequestVersion) -> UpdateEventRequest {
    let b = self.0;
    let mut update = UpdateEventRequest::new(b.title, version);
    update.all_day = b.all_day;
    update.start = b.start;
    update.end = b.end;
    update.time_zone = b.time_zone;
    update.start_date = b.start_date;
    update.end_date = b.end_date;
    update.location = b.location;
    update.notes = b.notes;
    update
  }
}

/// The form for a stored event, its times in the user's zone (the web app's `fromEvent`): an all-day event shows its
/// first and last days at 09:00 and 10:00; a repeated local time keeps the stored instant's occurrence.
#[must_use]
pub fn event_draft(event: &EventResponse, zone: Tz) -> EventDraft {
  let nine = NaiveTime::from_hms_opt(9, 0, 0).expect("09:00");
  let ten = NaiveTime::from_hms_opt(10, 0, 0).expect("10:00");
  let mut draft = EventDraft {
    title: event.title.clone(),
    all_day: event.all_day,
    start_date: String::new(),
    start_time: time_text(nine),
    start_occurrence: None,
    end_date: String::new(),
    end_time: time_text(ten),
    end_occurrence: None,
    location: event.location.clone().flatten().unwrap_or_default(),
    notes: event.notes.clone().flatten().unwrap_or_default(),
  };
  if event.all_day {
    if let Some(start) = event.start_date.flatten() {
      draft.start_date = start.to_string();
    }
    if let Some(end) = event.end_date.flatten().and_then(|d| d.pred_opt()) {
      draft.end_date = end.to_string();
    }
  } else {
    let occurrence = |at: DateTime<Utc>| -> (String, String, Occurrence) {
      let local = at.with_timezone(&zone).naive_local();
      let which = match resolve(local, zone) {
        Local::Twice(earlier, _) => Some(u8::from(at != earlier)),
        _ => None,
      };
      (local.date().to_string(), time_text(local.time()), which)
    };
    if let Some(start) = event.start.flatten() {
      (draft.start_date, draft.start_time, draft.start_occurrence) = occurrence(start);
    }
    if let Some(end) = event.end.flatten() {
      (draft.end_date, draft.end_time, draft.end_occurrence) = occurrence(end);
    }
  }
  draft
}

/// A 400's field errors on the event form (the web app's `eventFieldErrors`): `errors` keys lower-cased, `startDate`
/// and `endDate` onto Start and End, the rest onto the form; else `detail`, `title`, or the fallback.
#[must_use]
pub fn event_server_errors(body: &str) -> BTreeMap<EventField, String> {
  server_errors(
    body,
    "Couldn\u{2019}t save the event. Try again.",
    |key| match key {
      "title" => Some(EventField::Title),
      "start" | "startdate" => Some(EventField::Start),
      "end" | "enddate" => Some(EventField::End),
      "location" => Some(EventField::Location),
      "notes" => Some(EventField::Notes),
      _ => None,
    },
    EventField::Form,
  )
}

fn server_errors<F: Ord + Copy>(body: &str, fallback: &str, field: impl Fn(&str) -> Option<F>, form: F) -> BTreeMap<F, String> {
  let mut out = BTreeMap::new();
  let problem: Option<serde_json::Value> = serde_json::from_str(body).ok();
  if let Some(errors) = problem
    .as_ref()
    .and_then(|p| p.get("errors"))
    .and_then(serde_json::Value::as_object)
  {
    for (key, messages) in errors {
      let Some(message) = messages.as_array().and_then(|m| m.iter().find_map(serde_json::Value::as_str)) else {
        continue;
      };
      out
        .entry(field(&key.to_lowercase()).unwrap_or(form))
        .or_insert_with(|| message.to_owned());
    }
  }
  if out.is_empty() {
    let text = problem
      .as_ref()
      .and_then(|p| {
        ["detail", "title"]
          .into_iter()
          .find_map(|k| p.get(k)?.as_str().filter(|s| !s.is_empty()))
      })
      .unwrap_or(fallback);
    out.insert(form, text.to_owned());
  }
  out
}

// ---------------------------------------------------------------------------------------------------------------
// Tasks

/// The task form's fields, in focus order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum TaskField {
  Title,
  Date,
  Time,
  Occurrence,
  Notes,
  Form,
}

/// "No deadline", "Date only" or "Exact date and time".
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Deadline {
  #[default]
  None,
  Date,
  Time,
}

impl Deadline {
  pub const ALL: [Deadline; 3] = [Deadline::None, Deadline::Date, Deadline::Time];

  #[must_use]
  pub fn label(self) -> &'static str {
    match self {
      Deadline::None => "No deadline",
      Deadline::Date => "Date only",
      Deadline::Time => "Exact date and time",
    }
  }
}

pub const PRIORITIES: [(&str, &str); 3] = [("low", "Low"), ("medium", "Medium"), ("high", "High")];

/// The task form as typed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskDraft {
  pub title: String,
  pub deadline: Deadline,
  pub due_date: String,
  pub due_time: String,
  pub occurrence: Occurrence,
  pub priority: String,
  pub notes: String,
}

/// A new task: due on `date` when the page has one (Day), else no deadline (My tasks); medium priority.
#[must_use]
pub fn new_task(date: Option<NaiveDate>) -> TaskDraft {
  TaskDraft {
    title: String::new(),
    deadline: if date.is_some() { Deadline::Date } else { Deadline::None },
    due_date: date.map(|d| d.to_string()).unwrap_or_default(),
    due_time: String::new(),
    occurrence: None,
    priority: "medium".to_owned(),
    notes: String::new(),
  }
}

/// The form for a stored task (the web app's `fromTask`): no priority reads as medium; `dueAt` in the user's zone.
#[must_use]
pub fn task_draft(task: &TaskResponse, zone: Tz) -> TaskDraft {
  let mut draft = new_task(None);
  draft.title.clone_from(&task.title);
  draft.priority = task.priority.clone().unwrap_or_else(|| "medium".to_owned());
  draft.notes = task.notes.clone().flatten().unwrap_or_default();
  if let Some(date) = task.due_date.flatten() {
    draft.deadline = Deadline::Date;
    draft.due_date = date.to_string();
  } else if let Some(at) = task.due_at.flatten() {
    let local = at.with_timezone(&zone).naive_local();
    draft.deadline = Deadline::Time;
    draft.due_date = local.date().to_string();
    draft.due_time = time_text(local.time());
    if let Local::Twice(earlier, _) = resolve(local, zone) {
      draft.occurrence = Some(u8::from(at != earlier));
    }
  }
  draft
}

/// Checks the form as the web app's `validateTask` does.
pub fn validate_task(draft: &TaskDraft, zone: Tz) -> Result<CreateTaskRequest, BTreeMap<TaskField, String>> {
  let mut errors = BTreeMap::new();
  let title = draft.title.trim();
  if title.is_empty() {
    errors.insert(TaskField::Title, "Enter a title.".to_owned());
  } else if title.chars().count() > TITLE_MAX {
    errors.insert(TaskField::Title, format!("Title must be at most {TITLE_MAX} characters."));
  }
  if draft.notes.chars().count() > NOTES_MAX {
    errors.insert(TaskField::Notes, format!("Notes must be at most {NOTES_MAX} characters."));
  }
  let mut body = CreateTaskRequest::new(draft.title.clone());
  body.priority = Some(draft.priority.clone());
  body.notes = Some(Some(draft.notes.clone()));
  match draft.deadline {
    Deadline::None => {}
    Deadline::Date => match parse_date(&draft.due_date) {
      Some(date) => body.due_date = Some(Some(date)),
      None if draft.due_date.trim().is_empty() => {
        errors.insert(TaskField::Date, "Enter a due date.".to_owned());
      }
      None => {
        errors.insert(TaskField::Date, "Enter a date as YYYY-MM-DD.".to_owned());
      }
    },
    Deadline::Time => {
      if draft.due_date.trim().is_empty() {
        errors.insert(TaskField::Date, "Enter a due date.".to_owned());
      } else if draft.due_time.trim().is_empty() {
        errors.insert(TaskField::Time, "Enter a due time.".to_owned());
      } else {
        match instant(&draft.due_date, &draft.due_time, draft.occurrence, zone) {
          Ok(at) => body.due_at = Some(Some(at)),
          Err((message, true)) => {
            errors.insert(TaskField::Occurrence, message.to_owned());
          }
          Err((message, false)) => {
            let field = if message.contains("date") {
              TaskField::Date
            } else {
              TaskField::Time
            };
            errors.insert(field, message.to_owned());
          }
        }
      }
    }
  }
  if errors.is_empty() { Ok(body) } else { Err(errors) }
}

/// The update request: the same fields plus the version the form loaded.
#[must_use]
pub fn task_update(body: CreateTaskRequest, version: calendar_client::generated::UpdateTaskRequestVersion) -> UpdateTaskRequest {
  let mut update = UpdateTaskRequest::new(body.title, version);
  update.priority = body.priority;
  update.notes = body.notes;
  update.due_date = body.due_date;
  update.due_at = body.due_at;
  update
}

/// A 400's field errors on the task form (`dueDate` onto Date, `dueAt` onto Time).
#[must_use]
pub fn task_server_errors(body: &str) -> BTreeMap<TaskField, String> {
  server_errors(
    body,
    "Couldn\u{2019}t save the task. Try again.",
    |key| match key {
      "title" => Some(TaskField::Title),
      "duedate" => Some(TaskField::Date),
      "dueat" => Some(TaskField::Time),
      "notes" => Some(TaskField::Notes),
      _ => None,
    },
    TaskField::Form,
  )
}

#[cfg(test)]
mod tests {
  use super::*;
  use chrono_tz::Europe::Madrid;

  fn d(s: &str) -> NaiveDate {
    s.parse().unwrap()
  }
  fn t(s: &str) -> DateTime<Utc> {
    s.parse().unwrap()
  }

  #[test]
  fn a_new_event_starts_at_the_next_half_hour_today_and_at_nine_otherwise() {
    let today = d("2026-11-20");
    let draft = new_event(today, today, t("2026-11-20T09:07:31Z"), Madrid);
    assert_eq!(
      (draft.start_date.as_str(), draft.start_time.as_str(), draft.end_time.as_str()),
      ("2026-11-20", "10:30", "11:30")
    );
    let on_the_hour = new_event(today, today, t("2026-11-20T09:00:00Z"), Madrid);
    assert_eq!(on_the_hour.start_time, "10:00");
    let late = new_event(today, today, t("2026-11-20T22:45:00Z"), Madrid);
    assert_eq!(
      (late.start_date.as_str(), late.start_time.as_str(), late.end_date.as_str()),
      ("2026-11-21", "00:00", "2026-11-21")
    );
    let other = new_event(d("2026-11-23"), today, t("2026-11-20T09:07:00Z"), Madrid);
    assert_eq!((other.start_time.as_str(), other.end_time.as_str()), ("09:00", "10:00"));
  }

  #[test]
  fn moving_the_start_keeps_the_duration() {
    let mut draft = new_event(d("2026-11-23"), d("2026-11-20"), t("2026-11-20T09:00:00Z"), Madrid);
    draft.end_time = "11:30".into();
    draft.move_start("2026-11-24".into(), "14:00".into());
    assert_eq!((draft.end_date.as_str(), draft.end_time.as_str()), ("2026-11-24", "16:30"));
  }

  #[test]
  fn daylight_saving_gaps_and_repeats_are_caught() {
    // Madrid: clocks go forward 2026-03-29 02:00 → 03:00, back 2026-10-25 03:00 → 02:00.
    assert_eq!(resolve(d("2026-03-29").and_hms_opt(2, 30, 0).unwrap(), Madrid), Local::Gap);
    assert!(matches!(resolve(d("2026-10-25").and_hms_opt(2, 30, 0).unwrap(), Madrid), Local::Twice(a, b) if b - a == Duration::hours(1)));
    let mut draft = new_event(d("2026-03-29"), d("2026-03-01"), t("2026-03-01T09:00:00Z"), Madrid);
    draft.title = "Run".into();
    draft.start_time = "02:30".into();
    let errors = validate_event(&draft, Madrid).unwrap_err();
    assert_eq!(errors[&EventField::Start], "This local time does not exist. Choose another time.");
    draft.start_date = "2026-10-25".into();
    draft.end_date = "2026-10-25".into();
    draft.end_time = "04:00".into();
    let errors = validate_event(&draft, Madrid).unwrap_err();
    assert_eq!(
      errors[&EventField::StartOccurrence],
      "Choose which occurrence of this time you mean."
    );
    draft.start_occurrence = Some(1);
    let body = validate_event(&draft, Madrid).unwrap().0;
    assert_eq!(body.start, Some(Some(t("2026-10-25T01:30:00Z"))), "the later 02:30 is CET, UTC+1");
  }

  #[test]
  fn event_rules_and_messages_are_the_web_apps() {
    let mut draft = new_event(d("2026-11-23"), d("2026-11-20"), t("2026-11-20T09:00:00Z"), Madrid);
    let errors = validate_event(&draft, Madrid).unwrap_err();
    assert_eq!(
      errors.keys().next(),
      Some(&EventField::Title),
      "focus goes to the first invalid field"
    );
    assert_eq!(errors[&EventField::Title], "Enter a title.");
    draft.title = "x".repeat(201);
    draft.end_time = "08:00".into();
    let errors = validate_event(&draft, Madrid).unwrap_err();
    assert_eq!(errors[&EventField::Title], "Title must be at most 200 characters.");
    assert_eq!(errors[&EventField::End], "End must be after the start.");
    draft.title = "Planning".into();
    draft.end_time = "8:00".into();
    assert_eq!(
      validate_event(&draft, Madrid).unwrap_err()[&EventField::End],
      "Enter a time as HH:MM."
    );
  }

  #[test]
  fn a_timed_event_sends_utc_instants_and_the_zone() {
    let mut draft = new_event(d("2026-11-23"), d("2026-11-20"), t("2026-11-20T09:00:00Z"), Madrid);
    draft.title = "Planning".into();
    let body = validate_event(&draft, Madrid).unwrap().0;
    assert_eq!(
      (body.start, body.end),
      (Some(Some(t("2026-11-23T08:00:00Z"))), Some(Some(t("2026-11-23T09:00:00Z"))))
    );
    assert_eq!(body.time_zone, Some(Some("Europe/Madrid".to_owned())));
    assert_eq!((body.start_date, body.all_day), (None, Some(false)));
  }

  #[test]
  fn an_all_day_event_sends_an_exclusive_end_date() {
    let mut draft = new_event(d("2026-11-23"), d("2026-11-20"), t("2026-11-20T09:00:00Z"), Madrid);
    draft.title = "Conference".into();
    draft.all_day = true;
    draft.end_date = "2026-11-25".into();
    let body = validate_event(&draft, Madrid).unwrap().0;
    assert_eq!(
      (body.start_date, body.end_date),
      (Some(Some(d("2026-11-23"))), Some(Some(d("2026-11-26"))))
    );
    assert_eq!((body.start, body.time_zone), (None, None));
    draft.end_date = "2026-11-22".into();
    assert_eq!(
      validate_event(&draft, Madrid).unwrap_err()[&EventField::End],
      "End date must be on or after the start date."
    );
  }

  #[test]
  fn a_stored_event_reads_back_into_the_form() {
    let event: EventResponse = serde_json::from_value(serde_json::json!({
      "id": "20000000-0000-4000-8000-000000000002", "title": "Design review", "allDay": false,
      "start": "2026-10-25T01:30:00Z", "end": "2026-10-25T03:00:00Z", "timeZone": "Europe/Madrid",
      "startDate": null, "endDate": null, "location": "Room 2", "notes": null, "version": 4 }))
    .unwrap();
    let draft = event_draft(&event, Madrid);
    assert_eq!(
      (draft.start_date.as_str(), draft.start_time.as_str(), draft.start_occurrence),
      ("2026-10-25", "02:30", Some(1))
    );
    assert_eq!((draft.end_time.as_str(), draft.location.as_str()), ("04:00", "Room 2"));
    let all_day: EventResponse = serde_json::from_value(serde_json::json!({
      "id": "10000000-0000-4000-8000-000000000001", "title": "Conference", "allDay": true, "start": null,
      "end": null, "timeZone": null, "startDate": "2026-11-19", "endDate": "2026-11-22", "location": null,
      "notes": null, "version": "7" }))
    .unwrap();
    let draft = event_draft(&all_day, Madrid);
    assert_eq!((draft.start_date.as_str(), draft.end_date.as_str()), ("2026-11-19", "2026-11-21"));
    let update = validate_event(&draft, Madrid).unwrap().update(all_day.version.into());
    assert_eq!(
      serde_json::to_value(&update).unwrap()["version"],
      "7",
      "the version goes back as it came"
    );
  }

  #[test]
  fn server_errors_land_on_their_fields() {
    let body = r#"{"title":"One or more validation errors occurred.","errors":{"StartDate":["Start is required."],"Title":["Too long."],"Other":["Odd."]}}"#;
    let errors = event_server_errors(body);
    assert_eq!(errors[&EventField::Start], "Start is required.");
    assert_eq!(errors[&EventField::Title], "Too long.");
    assert_eq!(errors[&EventField::Form], "Odd.");
    assert_eq!(
      event_server_errors(r#"{"title":"Bad","detail":"Nope."}"#)[&EventField::Form],
      "Nope."
    );
    assert_eq!(
      event_server_errors("<html>")[&EventField::Form],
      "Couldn\u{2019}t save the event. Try again."
    );
    assert_eq!(
      task_server_errors(r#"{"errors":{"dueAt":["Must have an offset."]}}"#)[&TaskField::Time],
      "Must have an offset."
    );
  }

  #[test]
  fn task_forms_follow_the_web_app() {
    let draft = new_task(Some(d("2026-11-20")));
    assert_eq!(
      (draft.deadline, draft.due_date.as_str(), draft.priority.as_str()),
      (Deadline::Date, "2026-11-20", "medium")
    );
    assert_eq!(new_task(None).deadline, Deadline::None);
    let mut draft = new_task(None);
    assert_eq!(validate_task(&draft, Madrid).unwrap_err()[&TaskField::Title], "Enter a title.");
    draft.title = "Call".into();
    let body = validate_task(&draft, Madrid).unwrap();
    assert_eq!((body.due_date, body.due_at), (None, None), "no deadline sends neither field");
    draft.deadline = Deadline::Time;
    assert_eq!(validate_task(&draft, Madrid).unwrap_err()[&TaskField::Date], "Enter a due date.");
    draft.due_date = "2026-11-20".into();
    assert_eq!(validate_task(&draft, Madrid).unwrap_err()[&TaskField::Time], "Enter a due time.");
    draft.due_time = "09:30".into();
    assert_eq!(validate_task(&draft, Madrid).unwrap().due_at, Some(Some(t("2026-11-20T08:30:00Z"))));
    draft.due_date = "2026-10-25".into();
    draft.due_time = "02:30".into();
    assert_eq!(
      validate_task(&draft, Madrid).unwrap_err()[&TaskField::Occurrence],
      "Choose which occurrence of this time you mean."
    );
  }
}
