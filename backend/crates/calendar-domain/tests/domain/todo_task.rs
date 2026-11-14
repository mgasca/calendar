//! Port of `Calendar.Domain.Tests/Tasks/TodoTaskTests.cs`.
//!
//! Instants are `DateTime<Utc>` in the domain, so the C# "offset is zero" assertions hold by type; inputs the C#
//! suite gives with another offset are converted the way a caller would.

use calendar_domain::error::{ArgumentError, InvalidOperationError};
use calendar_domain::tasks::{Priority, TodoTask, TodoTaskRecord};
use chrono::{DateTime, FixedOffset, NaiveDate, TimeDelta, TimeZone, Utc};
use uuid::Uuid;

fn owner() -> Uuid {
  Uuid::from_u128(0x0a0b_0c0d_0e0f_4a1b_8c2d_3e4f_5a6b_7c8d)
}

fn now() -> DateTime<Utc> {
  Utc.with_ymd_and_hms(2026, 10, 26, 12, 0, 0).unwrap()
}

fn date(year: i32, month: u32, day: u32) -> NaiveDate {
  NaiveDate::from_ymd_opt(year, month, day).unwrap()
}

fn with_offset(hours: i32, year: i32, month: u32, day: u32, hour: u32) -> DateTime<FixedOffset> {
  FixedOffset::east_opt(hours * 3600)
    .unwrap()
    .with_ymd_and_hms(year, month, day, hour, 0, 0)
    .unwrap()
}

fn create(title: &str) -> Result<TodoTask, ArgumentError> {
  TodoTask::create(owner(), title, None, None, "medium", None)
}

fn closed_message() -> InvalidOperationError {
  InvalidOperationError::new("A completed task's deadline cannot be changed.")
}

#[test]
fn create_undated_has_no_due_value() {
  let task = create("  Buy milk ").unwrap();

  assert_eq!(task.title(), "Buy milk");
  assert_eq!(task.priority().as_str(), "medium");
  assert_eq!(task.notes(), None);
  assert!(!task.id().is_nil());
  assert_eq!(task.due_date(), None);
  assert_eq!(task.due_at(), None);
  assert!(!task.is_completed());
}

#[test]
fn create_sets_the_owner_and_rejects_an_empty_one() {
  assert_eq!(create("A").unwrap().owner_id(), owner());

  let error = TodoTask::create(Uuid::nil(), "A", None, None, "medium", None).unwrap_err();
  assert_eq!(error, ArgumentError::new("ownerId", "A task needs an owner."));
}

#[test]
fn create_with_due_date_sets_due_date() {
  let task = TodoTask::create(owner(), "A", Some(date(2026, 10, 26)), None, "medium", None).unwrap();

  assert_eq!(task.due_date(), Some(date(2026, 10, 26)));
  assert_eq!(task.due_at(), None);
}

#[test]
fn create_with_due_at_normalizes_to_utc() {
  let due_at = with_offset(-4, 2026, 10, 26, 9).with_timezone(&Utc);
  let task = TodoTask::create(owner(), "A", None, Some(due_at), "medium", None).unwrap();

  assert_eq!(task.due_at(), Some(Utc.with_ymd_and_hms(2026, 10, 26, 13, 0, 0).unwrap()));
  assert_eq!(task.due_date(), None);
}

#[test]
fn create_with_both_due_values_fails() {
  let error = TodoTask::create(owner(), "A", Some(date(2026, 10, 26)), Some(now()), "medium", None).unwrap_err();

  assert_eq!(
    error,
    ArgumentError::new("dueAt", "A task can have a due date or a due instant, not both.")
  );
}

#[test]
fn create_with_blank_title_fails() {
  for title in ["", "  "] {
    assert_eq!(create(title).unwrap_err(), ArgumentError::new("title", "Title is required."));
  }
}

#[test]
fn create_title_length_is_capped_at_two_hundred_after_trim() {
  assert_eq!(create(&format!(" {}", "a".repeat(200))).unwrap().title().len(), 200);
  assert_eq!(
    create(&"a".repeat(201)).unwrap_err(),
    ArgumentError::new("title", "Title must be at most 200 characters.")
  );
}

#[test]
fn create_with_notes_normalizes_and_limits_length() {
  let notes = |priority: &str, notes: &str| TodoTask::create(owner(), "T", None, None, priority, Some(notes));

  assert_eq!(notes("high", "  Details  ").unwrap().notes(), Some("Details"));
  assert_eq!(notes("medium", "  ").unwrap().notes(), None);
  assert_eq!(notes("medium", &"a".repeat(4000)).unwrap().notes().unwrap().len(), 4000);
  assert_eq!(
    notes("medium", &"a".repeat(4001)).unwrap_err(),
    ArgumentError::new("notes", "Value must be at most 4000 characters.")
  );
}

#[test]
fn create_with_invalid_priority_fails() {
  for priority in ["urgent", ""] {
    let error = TodoTask::create(owner(), "T", None, None, priority, None).unwrap_err();
    assert_eq!(error, ArgumentError::new("priority", "Priority must be low, medium or high."));
  }
}

#[test]
fn complete_sets_completed_at_in_utc() {
  let mut task = create("A").unwrap();

  task.complete(with_offset(-4, 2026, 10, 26, 8).with_timezone(&Utc));

  assert!(task.is_completed());
  assert_eq!(task.completed_at(), Some(now()));
}

#[test]
fn complete_when_already_completed_keeps_first_completion_time() {
  let mut task = create("A").unwrap();
  task.complete(now());

  task.complete(now() + TimeDelta::hours(5));

  assert_eq!(task.completed_at(), Some(now()));
}

#[test]
fn reopen_clears_completion_and_is_idempotent() {
  let mut task = create("A").unwrap();
  task.complete(now());

  task.reopen();
  task.reopen();

  assert!(!task.is_completed());
  assert_eq!(task.completed_at(), None);
}

#[test]
fn complete_after_reopen_records_new_time() {
  let mut task = create("A").unwrap();
  task.complete(now());
  task.reopen();

  task.complete(now() + TimeDelta::hours(1));

  assert_eq!(task.completed_at(), Some(now() + TimeDelta::hours(1)));
}

#[test]
fn deadline_changes_replace_or_clear_open_task_deadline() {
  let mut task = TodoTask::create(owner(), "A", Some(date(2026, 10, 25)), None, "medium", None).unwrap();
  let due_at = with_offset(-4, 2026, 10, 26, 9);

  task.set_due_at(due_at.with_timezone(&Utc)).unwrap();
  assert_eq!(task.due_date(), None);
  assert_eq!(task.due_at(), Some(now() + TimeDelta::hours(1)));
  task.set_due_date(date(2026, 10, 27)).unwrap();
  assert_eq!(task.due_date(), Some(date(2026, 10, 27)));
  assert_eq!(task.due_at(), None);
  task.clear_deadline().unwrap();
  assert_eq!(task.due_date(), None);
  assert_eq!(task.due_at(), None);
}

#[test]
fn deadline_changes_on_completed_task_fail() {
  let mut task = create("A").unwrap();
  task.complete(now());

  assert_eq!(task.set_due_date(date(2026, 10, 27)), Err(closed_message()));
  assert_eq!(task.set_due_at(now()), Err(closed_message()));
  assert_eq!(task.clear_deadline(), Err(closed_message()));
  assert_eq!(task.due_date(), None);
  assert_eq!(task.due_at(), None);
}

#[test]
fn update_replaces_the_editable_fields_and_keeps_id_owner_and_completion() {
  let mut task = TodoTask::create(owner(), "Buy milk", Some(date(2026, 10, 26)), None, "low", Some("Two litres")).unwrap();
  let id = task.id();
  task.complete(now());

  let due_at = now().with_timezone(&FixedOffset::east_opt(2 * 3600).unwrap());
  task
    .update(" Buy oat milk ", None, Some(due_at.with_timezone(&Utc)), "high", None)
    .unwrap();

  assert_eq!(task.id(), id);
  assert_eq!(task.owner_id(), owner());
  assert_eq!(task.title(), "Buy oat milk");
  assert_eq!(task.priority().as_str(), "high");
  assert_eq!(task.notes(), None);
  assert_eq!(task.due_date(), None);
  assert_eq!(task.due_at(), Some(now()));
  assert_eq!(task.completed_at(), Some(now()));
}

#[test]
fn update_can_clear_the_deadline_and_keeps_an_open_task_open() {
  let mut task = TodoTask::create(owner(), "Buy milk", Some(date(2026, 10, 26)), None, "medium", None).unwrap();

  task.update("Buy milk", None, None, "medium", None).unwrap();

  assert_eq!(task.due_date(), None);
  assert_eq!(task.due_at(), None);
  assert!(!task.is_completed());
}

#[test]
fn update_with_invalid_values_fails_and_changes_nothing() {
  let mut task = TodoTask::create(owner(), "Buy milk", Some(date(2026, 10, 26)), None, "low", None).unwrap();

  assert_eq!(task.update("  ", None, None, "medium", None).unwrap_err().param, "title");
  assert_eq!(task.update("A", None, None, "urgent", None).unwrap_err().param, "priority");
  assert_eq!(
    task
      .update("A", Some(date(2026, 10, 27)), Some(now()), "medium", None)
      .unwrap_err()
      .param,
    "dueAt"
  );

  assert_eq!(task.title(), "Buy milk");
  assert_eq!(task.priority().as_str(), "low");
  assert_eq!(task.due_date(), Some(date(2026, 10, 26)));
}

// ---- beyond the C# suite ----

#[test]
fn create_reports_the_first_broken_rule_in_a_fixed_order() {
  let long_notes = "n".repeat(4001);
  let both = (Some(date(2026, 10, 26)), Some(now()));

  let error = |owner_id, title| {
    TodoTask::create(owner_id, title, both.0, both.1, "urgent", Some(&long_notes))
      .unwrap_err()
      .param
  };
  assert_eq!(error(Uuid::nil(), " "), "ownerId");
  assert_eq!(error(owner(), " "), "title");
  assert_eq!(error(owner(), "A"), "dueAt");
  assert_eq!(
    TodoTask::create(owner(), "A", None, None, "urgent", Some(&long_notes))
      .unwrap_err()
      .param,
    "priority"
  );
  assert_eq!(
    TodoTask::create(owner(), "A", None, None, "high", Some(&long_notes))
      .unwrap_err()
      .param,
    "notes"
  );
}

#[test]
fn priority_round_trips_its_wire_form_and_is_case_sensitive() {
  for priority in [Priority::Low, Priority::Medium, Priority::High] {
    assert_eq!(Priority::parse(priority.as_str()), Some(priority));
  }

  assert_eq!(Priority::default(), Priority::Medium);
  assert_eq!(Priority::parse("High"), None);
  assert_eq!(Priority::parse(" low"), None);
}

#[test]
fn deadline_column_helpers_are_mutually_exclusive() {
  assert_eq!(TodoTask::for_due_date(date(2026, 10, 27)), (Some(date(2026, 10, 27)), None));
  assert_eq!(TodoTask::for_due_instant(now()), (None, Some(now())));
  assert_eq!(TodoTask::without_deadline(), (None, None));
}

#[test]
fn restore_and_into_record_round_trip_without_validation() {
  let record = TodoTaskRecord {
    id: Uuid::from_u128(7),
    owner_id: owner(),
    title: "Stored".to_owned(),
    priority: Priority::High,
    notes: Some("n".to_owned()),
    due_date: None,
    due_at: Some(now()),
    completed_at: Some(now() + TimeDelta::hours(1)),
  };

  let task = TodoTask::restore(record.clone());

  assert_eq!(task.id(), Uuid::from_u128(7));
  assert!(task.is_completed());
  assert_eq!(task.into_record(), record);
}
