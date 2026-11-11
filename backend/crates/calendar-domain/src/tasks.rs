//! To-do tasks.

use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;

use crate::error::{ArgumentError, InvalidOperationError};
use crate::validation::{self, MAX_NOTES_LENGTH};

/// The mutually exclusive deadline columns of a task: `(due_date, due_at)`, at most one of them set.
pub type Deadline = (Option<NaiveDate>, Option<DateTime<Utc>>);

/// Priority level of a task.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Priority {
  /// `low`
  Low,
  /// `medium`, the default.
  #[default]
  Medium,
  /// `high`
  High,
}

impl Priority {
  /// Parses the stored and wire form: exactly `low`, `medium` or `high` (case-sensitive).
  pub fn parse(value: &str) -> Option<Self> {
    match value {
      "low" => Some(Self::Low),
      "medium" => Some(Self::Medium),
      "high" => Some(Self::High),
      _ => None,
    }
  }

  /// The stored and wire form: `low`, `medium` or `high`.
  pub fn as_str(self) -> &'static str {
    match self {
      Self::Low => "low",
      Self::Medium => "medium",
      Self::High => "high",
    }
  }
}

/// The stored fields of a [`TodoTask`], for persistence to read and rebuild one without validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoTaskRecord {
  /// Unique id.
  pub id: Uuid,
  /// Owning user.
  pub owner_id: Uuid,
  /// Normalized, non-empty title.
  pub title: String,
  /// Priority level.
  pub priority: Priority,
  /// Optional notes.
  pub notes: Option<String>,
  /// Floating due date; mutually exclusive with `due_at`.
  pub due_date: Option<NaiveDate>,
  /// Due instant; mutually exclusive with `due_date`.
  pub due_at: Option<DateTime<Utc>>,
  /// When the task was completed; `None` while open.
  pub completed_at: Option<DateTime<Utc>>,
}

/// A to-do item with an optional due value: a floating due date (date only) **or** a due instant, never both.
/// Tasks with neither are undated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoTask {
  id: Uuid,
  owner_id: Uuid,
  title: String,
  priority: Priority,
  notes: Option<String>,
  due_date: Option<NaiveDate>,
  due_at: Option<DateTime<Utc>>,
  completed_at: Option<DateTime<Utc>>,
}

impl TodoTask {
  /// Creates an open task owned by `owner_id`, with a new random id and an optional due date or due instant, but
  /// not both. `priority` is the wire form (`low`, `medium`, `high`); pass `medium` when the caller gave none.
  ///
  /// Errors, in this order, by parameter name: `ownerId` (nil), `title` (blank or too long), `dueAt` (both due
  /// values given), `priority`, `notes` (too long).
  pub fn create(
    owner_id: Uuid,
    title: &str,
    due_date: Option<NaiveDate>,
    due_at: Option<DateTime<Utc>>,
    priority: &str,
    notes: Option<&str>,
  ) -> Result<Self, ArgumentError> {
    if owner_id.is_nil() {
      return Err(ArgumentError::new("ownerId", "A task needs an owner."));
    }

    let title = validation::normalize_title(title, "title")?;
    if due_date.is_some() && due_at.is_some() {
      return Err(ArgumentError::new(
        "dueAt",
        "A task can have a due date or a due instant, not both.",
      ));
    }

    let Some(priority) = Priority::parse(priority) else {
      return Err(ArgumentError::new("priority", "Priority must be low, medium or high."));
    };

    let notes = validation::normalize_optional(notes, MAX_NOTES_LENGTH, "notes")?;

    Ok(Self {
      id: Uuid::new_v4(),
      owner_id,
      title,
      priority,
      notes,
      due_date,
      due_at,
      completed_at: None,
    })
  }

  /// Rebuilds a stored task without validation.
  pub fn restore(record: TodoTaskRecord) -> Self {
    let TodoTaskRecord {
      id,
      owner_id,
      title,
      priority,
      notes,
      due_date,
      due_at,
      completed_at,
    } = record;
    Self {
      id,
      owner_id,
      title,
      priority,
      notes,
      due_date,
      due_at,
      completed_at,
    }
  }

  /// The stored fields, for persistence.
  pub fn into_record(self) -> TodoTaskRecord {
    TodoTaskRecord {
      id: self.id,
      owner_id: self.owner_id,
      title: self.title,
      priority: self.priority,
      notes: self.notes,
      due_date: self.due_date,
      due_at: self.due_at,
      completed_at: self.completed_at,
    }
  }

  /// Unique id, generated on creation.
  pub fn id(&self) -> Uuid {
    self.id
  }

  /// The user who owns the task (ADR-0041); only they can ever read or change it.
  pub fn owner_id(&self) -> Uuid {
    self.owner_id
  }

  /// Normalized, non-empty title.
  pub fn title(&self) -> &str {
    &self.title
  }

  /// Priority level.
  pub fn priority(&self) -> Priority {
    self.priority
  }

  /// Optional task notes.
  pub fn notes(&self) -> Option<&str> {
    self.notes.as_deref()
  }

  /// Floating due date (no zone); mutually exclusive with [`due_at`](Self::due_at).
  pub fn due_date(&self) -> Option<NaiveDate> {
    self.due_date
  }

  /// Due instant; mutually exclusive with [`due_date`](Self::due_date).
  pub fn due_at(&self) -> Option<DateTime<Utc>> {
    self.due_at
  }

  /// When the task was first completed; `None` while open.
  pub fn completed_at(&self) -> Option<DateTime<Utc>> {
    self.completed_at
  }

  /// True once the task has been completed.
  pub fn is_completed(&self) -> bool {
    self.completed_at.is_some()
  }

  /// Replaces the title, deadline, priority and notes by the rules of [`create`](Self::create); completion is
  /// left as it is, so an open task stays open and a completed one stays completed. Nothing changes when a value
  /// is invalid.
  pub fn update(
    &mut self,
    title: &str,
    due_date: Option<NaiveDate>,
    due_at: Option<DateTime<Utc>>,
    priority: &str,
    notes: Option<&str>,
  ) -> Result<(), ArgumentError> {
    let validated = Self::create(self.owner_id, title, due_date, due_at, priority, notes)?;
    self.title = validated.title;
    self.priority = validated.priority;
    self.notes = validated.notes;
    self.due_date = validated.due_date;
    self.due_at = validated.due_at;
    Ok(())
  }

  /// Marks the task complete. Idempotent: an already completed task keeps its first completion time.
  pub fn complete(&mut self, now: DateTime<Utc>) {
    self.completed_at.get_or_insert(now);
  }

  /// Normalizes completion timestamps the same way for entity and set-based updates (to UTC).
  pub fn normalize_completion_time<Tz: chrono::TimeZone>(completed_at: &DateTime<Tz>) -> DateTime<Utc> {
    completed_at.with_timezone(&Utc)
  }

  /// Marks the task open again. Idempotent.
  pub fn reopen(&mut self) {
    self.completed_at = None;
  }

  /// Replaces the deadline of an open task with a floating date.
  pub fn set_due_date(&mut self, due_date: NaiveDate) -> Result<(), InvalidOperationError> {
    self.require_open()?;
    (self.due_date, self.due_at) = Self::for_due_date(due_date);
    Ok(())
  }

  /// Replaces the deadline of an open task with an instant.
  pub fn set_due_at(&mut self, due_at: DateTime<Utc>) -> Result<(), InvalidOperationError> {
    self.require_open()?;
    (self.due_date, self.due_at) = Self::for_due_instant(due_at);
    Ok(())
  }

  /// Normalizes deadline instants the same way for entity and set-based updates (to UTC).
  pub fn normalize_due_at<Tz: chrono::TimeZone>(due_at: &DateTime<Tz>) -> DateTime<Utc> {
    due_at.with_timezone(&Utc)
  }

  /// Returns the mutually exclusive deadline columns for a floating date.
  pub fn for_due_date(due_date: NaiveDate) -> Deadline {
    (Some(due_date), None)
  }

  /// Returns the mutually exclusive deadline columns for an instant.
  pub fn for_due_instant(due_at: DateTime<Utc>) -> Deadline {
    (None, Some(due_at))
  }

  /// Clears the deadline of an open task.
  pub fn clear_deadline(&mut self) -> Result<(), InvalidOperationError> {
    self.require_open()?;
    (self.due_date, self.due_at) = Self::without_deadline();
    Ok(())
  }

  /// Returns empty values for both mutually exclusive deadline columns.
  pub fn without_deadline() -> Deadline {
    (None, None)
  }

  fn require_open(&self) -> Result<(), InvalidOperationError> {
    if self.is_completed() {
      Err(InvalidOperationError::new("A completed task's deadline cannot be changed."))
    } else {
      Ok(())
    }
  }
}
