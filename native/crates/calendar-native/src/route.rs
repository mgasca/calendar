//! The pages the shell shows, as the web app's routes: `/`, `/day/$date`, `/week/$weekStart` and `/tasks`.

use crate::format;
use chrono::NaiveDate;

/// A task list view, as the web app's "Task views" tabs.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TaskView {
  #[default]
  Upcoming,
  Overdue,
  Completed,
  NoDeadline,
}

impl TaskView {
  pub const ALL: [TaskView; 4] = [TaskView::Upcoming, TaskView::Overdue, TaskView::Completed, TaskView::NoDeadline];

  /// The API's `view` value.
  #[must_use]
  pub fn api(self) -> &'static str {
    match self {
      TaskView::Upcoming => "upcoming",
      TaskView::Overdue => "overdue",
      TaskView::Completed => "completed",
      TaskView::NoDeadline => "no-deadline",
    }
  }

  /// The tab label.
  #[must_use]
  pub fn label(self) -> &'static str {
    match self {
      TaskView::Upcoming => "Upcoming",
      TaskView::Overdue => "Overdue",
      TaskView::Completed => "Completed",
      TaskView::NoDeadline => "No deadline",
    }
  }
}

/// The page on screen.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Route {
  /// Today, following the clock across midnight (`/`).
  #[default]
  Today,
  /// A given day (`/day/$date`).
  Day(NaiveDate),
  /// The ISO week starting on this Monday (`/week/$weekStart`).
  Week(NaiveDate),
  /// My tasks (`/tasks`).
  Tasks(TaskView),
}

impl Route {
  /// The week of `date`, always starting on its Monday (the web app redirects `/week/X` there).
  #[must_use]
  pub fn week_of(date: NaiveDate) -> Route {
    Route::Week(format::iso_week_start(date))
  }

  /// The date a day page shows, given today's.
  #[must_use]
  pub fn day_date(self, today: NaiveDate) -> Option<NaiveDate> {
    match self {
      Route::Today => Some(today),
      Route::Day(date) => Some(date),
      _ => None,
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_week_route_starts_on_monday() {
    let sunday = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
    assert_eq!(Route::week_of(sunday), Route::Week(NaiveDate::from_ymd_opt(2026, 10, 26).unwrap()));
  }

  #[test]
  fn task_views_are_the_web_apps() {
    let pairs: Vec<_> = TaskView::ALL.iter().map(|v| (v.api(), v.label())).collect();
    assert_eq!(
      pairs,
      [
        ("upcoming", "Upcoming"),
        ("overdue", "Overdue"),
        ("completed", "Completed"),
        ("no-deadline", "No deadline")
      ]
    );
  }
}
