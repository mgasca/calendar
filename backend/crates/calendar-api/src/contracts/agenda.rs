use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{AgendaTaskItem, AllDayEventItem, TimedEventItem};
use crate::wire;

/// The day as UTC instants, `[start, end)`; may be shorter or longer than 24 hours across DST changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AgendaWindow {
  /// Inclusive start of the day, as a UTC instant.
  #[serde(serialize_with = "wire::instant")]
  pub start: DateTime<Utc>,

  /// Exclusive end of the day, as a UTC instant.
  #[serde(serialize_with = "wire::instant")]
  pub end: DateTime<Utc>,
}

/// Tasks relevant to the day, split into overdue and due-today groups.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgendaTasks {
  /// Up to 20 overdue tasks, open first then completed within the day; each group is ordered by local due date, instant and id.
  pub overdue: Vec<AgendaTaskItem>,

  /// Number of overdue tasks, including those completed today.
  pub overdue_total: i32,

  /// Number of open overdue tasks.
  pub overdue_open_total: i32,

  /// Tasks due on the day (open or completed): timed ones by due instant, then date-only ones by title.
  pub due_today: Vec<AgendaTaskItem>,
}

/// Everything for one local day, from a single snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DayAgendaResponse {
  /// The local calendar date (YYYY-MM-DD) in `timeZone`.
  pub date: NaiveDate,

  /// Canonical IANA time zone id the day was resolved in.
  pub time_zone: String,

  /// The UTC instants spanned by the local day.
  pub window: AgendaWindow,

  /// All-day events covering the date, by start date then title.
  pub all_day_events: Vec<AllDayEventItem>,

  /// Timed events overlapping the window, by start then title.
  pub events: Vec<TimedEventItem>,

  /// Overdue and due-today tasks.
  pub tasks: AgendaTasks,
}

/// One local day of a multi-day agenda: its timed events and the tasks due on it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AgendaDay {
  /// The local calendar date (YYYY-MM-DD).
  pub date: NaiveDate,

  /// The UTC instants spanned by the local day; empty for a date the zone skipped.
  pub window: AgendaWindow,

  /// Timed events overlapping the day, by start then title, with flags relative to this day. An event that
  /// crosses midnight appears on every day it touches.
  pub events: Vec<TimedEventItem>,

  /// Tasks due on the day (open or completed): timed ones by due instant, then date-only ones by title.
  pub tasks: Vec<AgendaTaskItem>,
}

/// The ISO week (Monday to Sunday) containing the requested date, from a single snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WeekAgendaResponse {
  /// The Monday the week starts on (YYYY-MM-DD).
  pub week_start: NaiveDate,

  /// Canonical IANA time zone id the week was resolved in.
  pub time_zone: String,

  /// The UTC instants from local midnight on Monday to local midnight on the next Monday.
  pub window: AgendaWindow,

  /// All-day events covering any date of the week, once each, by start date then title.
  pub all_day_events: Vec<AllDayEventItem>,

  /// The seven days, Monday first.
  pub days: Vec<AgendaDay>,

  /// Tasks overdue as of `today` (still open, or completed within today) that were due before the week's
  /// Monday, capped at 20 and ordered open first, then completed today, by local due date, instant and id within
  /// each group. Tasks due within the week are in their day instead. `null` when the whole
  /// week is before `today`.
  #[schema(required = true)]
  pub overdue: Option<Vec<AgendaTaskItem>>,

  /// Number of overdue tasks, including those completed today.
  pub overdue_total: i32,

  /// Number of open overdue tasks.
  pub overdue_open_total: i32,
}
