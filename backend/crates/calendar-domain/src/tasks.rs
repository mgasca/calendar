//! To-do tasks.

use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;

use crate::error::{ArgumentError, InvalidOperationError};
use crate::validation::{self, MAX_NOTES_LENGTH};

/// The deadline of a task: none, a floating due date (date only) or a due instant, never both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Deadline {
  /// No deadline: the task is undated.
  #[default]
  None,
  /// Due on a floating date, the same in every zone.
  On(NaiveDate),
  /// Due at an instant.
  At(DateTime<Utc>),
}

impl Deadline {
  /// The deadline of a due date and a due instant given separately, as a request or a row holds them.
  ///
  /// Errors with `dueAt` when both are given.
  pub fn from_parts(due_date: Option<NaiveDate>, due_at: Option<DateTime<Utc>>) -> Result<Self, ArgumentError> {
    match (due_date, due_at) {
      (None, None) => Ok(Self::None),
      (Some(date), None) => Ok(Self::On(date)),
      (None, Some(at)) => Ok(Self::At(at)),
      (Some(_), Some(_)) => Err(ArgumentError::new(
        "dueAt",
        "A task can have a due date or a due instant, not both.",
      )),
    }
  }

  /// The floating due date, when the deadline is one.
  pub fn due_date(self) -> Option<NaiveDate> {
    match self {
      Self::On(date) => Some(date),
      Self::None | Self::At(_) => None,
    }
  }

  /// The due instant, when the deadline is one.
  pub fn due_at(self) -> Option<DateTime<Utc>> {
    match self {
      Self::At(at) => Some(at),
      Self::None | Self::On(_) => None,
    }
  }
}

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
  /// The deadline, if any.
  pub deadline: Deadline,
  /// When the task was completed; `None` while open.
  pub completed_at: Option<DateTime<Utc>>,
}

/// A to-do item with an optional [`Deadline`]: a floating due date (date only) **or** a due instant, never
/// both. Tasks with neither are undated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoTask {
  id: Uuid,
  owner_id: Uuid,
  title: String,
  priority: Priority,
  notes: Option<String>,
  deadline: Deadline,
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
    let deadline = Deadline::from_parts(due_date, due_at)?;

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
      deadline,
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
      deadline,
      completed_at,
    } = record;
    Self {
      id,
      owner_id,
      title,
      priority,
      notes,
      deadline,
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
      deadline: self.deadline,
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

  /// The deadline, if any.
  pub fn deadline(&self) -> Deadline {
    self.deadline
  }

  /// Floating due date (no zone); mutually exclusive with [`due_at`](Self::due_at).
  pub fn due_date(&self) -> Option<NaiveDate> {
    self.deadline.due_date()
  }

  /// Due instant; mutually exclusive with [`due_date`](Self::due_date).
  pub fn due_at(&self) -> Option<DateTime<Utc>> {
    self.deadline.due_at()
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
    self.deadline = validated.deadline;
    Ok(())
  }

  /// Marks the task complete. Idempotent: an already completed task keeps its first completion time.
  pub fn complete(&mut self, now: DateTime<Utc>) {
    self.completed_at.get_or_insert(now);
  }

  /// Marks the task open again. Idempotent.
  pub fn reopen(&mut self) {
    self.completed_at = None;
  }

  /// Replaces the deadline of an open task with a floating date.
  pub fn set_due_date(&mut self, due_date: NaiveDate) -> Result<(), InvalidOperationError> {
    self.require_open()?;
    self.deadline = Deadline::On(due_date);
    Ok(())
  }

  /// Replaces the deadline of an open task with an instant.
  pub fn set_due_at(&mut self, due_at: DateTime<Utc>) -> Result<(), InvalidOperationError> {
    self.require_open()?;
    self.deadline = Deadline::At(due_at);
    Ok(())
  }

  /// Clears the deadline of an open task.
  pub fn clear_deadline(&mut self) -> Result<(), InvalidOperationError> {
    self.require_open()?;
    self.deadline = Deadline::None;
    Ok(())
  }

  fn require_open(&self) -> Result<(), InvalidOperationError> {
    if self.is_completed() {
      Err(InvalidOperationError::new("A completed task's deadline cannot be changed."))
    } else {
      Ok(())
    }
  }
}
