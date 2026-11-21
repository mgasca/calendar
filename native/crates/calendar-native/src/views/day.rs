//! Today and any other day (`/` and `/day/$date`), as the web app's `features/day/DayView.tsx`.

use super::{TaskRow, badge, button, heading, item, meta, remote_state, section, task_row};
use crate::format::{self, EventStatus};
use crate::route::Route;
use crate::theme::Tokens;
use crate::{App, load};
use calendar_client::as_count;
use calendar_client::generated::{AgendaTaskItem, DayAgendaResponse};
use chrono::NaiveDate;
use rune::{El, col, row, text};

/// The page for the day the route shows.
pub fn view(app: &App, t: &Tokens) -> El {
  let today = app.clock.today();
  let date = app.route.day_date(today).unwrap_or(today);
  let is_today = date == today;
  let mut page = col().key("day").gap(16.0).w_full();
  page = page.child(header(app, date, today, t));
  if let Some(state) = remote_state(
    &app.day,
    "day",
    if is_today {
      "Loading today\u{2019}s agenda…"
    } else {
      "Loading the agenda for this day…"
    },
    if is_today {
      "Couldn\u{2019}t load today\u{2019}s agenda."
    } else {
      "Couldn\u{2019}t load the agenda for this day."
    },
    "Couldn\u{2019}t refresh; showing the last loaded agenda.",
    load::reload,
    t,
  ) {
    page = page.child(state);
  }
  if let Some(agenda) = &app.day.data {
    page = page.child(agenda_body(app, agenda, date, is_today, today, t));
  }
  page
}

fn header(app: &App, date: NaiveDate, today: NaiveDate, t: &Tokens) -> El {
  let mut nav = row().key("day-nav").role("navigation").label("Day").gap(6.0);
  if let Some(previous) = format::add_days(date, -1) {
    nav = nav.child(button("day-previous", "‹ Previous day", t).on_press(move |app: &mut App| load::go(app, Route::Day(previous))));
  }
  if date != today {
    nav = nav.child(button("day-today", "Today", t).on_press(|app: &mut App| load::go(app, Route::Today)));
  }
  if let Some(next) = format::add_days(date, 1) {
    nav = nav.child(button("day-next", "Next day ›", t).on_press(move |app: &mut App| load::go(app, Route::Day(next))));
  }
  let monday = format::iso_week_start(date);
  nav = nav.child(
    button("day-week", &format!("Week of {}", format::format_day_month(monday)), t)
      .on_press(move |app: &mut App| load::go(app, Route::Week(monday))),
  );
  // The web app's Day page: Add task and Add event beside the date, and a field to go to a date.
  let adds = row()
    .key("day-adds")
    .gap(6.0)
    .items_center()
    .child(button("add-task", "Add task", t).on_press(move |app: &mut App| crate::dialogs::add_task(app, Some(date))))
    .child(button("add-event", "Add event", t).on_press(move |app: &mut App| crate::dialogs::add_event(app, date)))
    .child(
      rune::text_input(&app.go_to_date, rune::tok::type_::BODY)
        .key("go-to-date")
        .label("Go to date (YYYY-MM-DD)")
        .single_line()
        .placeholder("YYYY-MM-DD", t.text_muted)
        .w(140.0)
        .px(8.0)
        .py(5.0)
        .radius(6.0)
        .border(1.0, t.border_strong)
        .fill(t.surface_sunken)
        .color(t.text)
        .on_edit(|app: &mut App| &mut app.go_to_date)
        .on_submit(|app: &mut App, _tx: &mut rune::Tx| load::go_to_date(app)),
    );
  nav = nav.child(adds);
  let mut head = col()
    .key("day-header")
    .gap(6.0)
    .child(meta(format::relative_day(date, today), t).key("day-eyebrow"))
    .child(heading("day-title", format::format_date(date, date.year_ne(today)), 1, t))
    .child(nav);
  if let Some(agenda) = &app.day.data {
    head = head.child(meta(summary(agenda).join(" · "), t).key("day-summary"));
  }
  head
}

trait YearNe {
  fn year_ne(&self, other: NaiveDate) -> bool;
}
impl YearNe for NaiveDate {
  fn year_ne(&self, other: NaiveDate) -> bool {
    chrono::Datelike::year(self) != chrono::Datelike::year(&other)
  }
}

/// "1 all-day event · 4 events · 2 tasks to do · 2 overdue", as the web app's `summary`.
#[must_use]
pub fn summary(agenda: &DayAgendaResponse) -> Vec<String> {
  let all_day = format::len(agenda.all_day_events.len());
  let events = format::len(agenda.events.len());
  let open_overdue = as_count(&agenda.tasks.overdue_open_total);
  let open_tasks = open_overdue + format::len(agenda.tasks.due_today.iter().filter(|t| !t.is_completed).count());
  let mut parts = Vec::new();
  if all_day > 0 {
    parts.push(format::count(all_day, "all-day event", "all-day events"));
  }
  if events > 0 {
    parts.push(format::count(events, "event", "events"));
  }
  parts.push(if open_tasks > 0 {
    format!("{} to do", format::count(open_tasks, "task", "tasks"))
  } else {
    "no tasks to do".to_owned()
  });
  if open_overdue > 0 {
    parts.push(format!("{open_overdue} overdue"));
  }
  parts
}

fn agenda_body(app: &App, agenda: &DayAgendaResponse, date: NaiveDate, is_today: bool, today: NaiveDate, t: &Tokens) -> El {
  let zone = app.clock.zone;
  let empty =
    agenda.all_day_events.is_empty() && agenda.events.is_empty() && agenda.tasks.due_today.is_empty() && agenda.tasks.overdue.is_empty();
  if empty {
    let message = if is_today {
      "Nothing scheduled today. Enjoy the free day!"
    } else {
      "Nothing scheduled."
    };
    return text(message).key("day-empty").color(t.empty_text);
  }
  let mut body = col().key("day-sections").gap(20.0).w_full();
  if !agenda.all_day_events.is_empty() {
    let items = agenda
      .all_day_events
      .iter()
      .map(|event| {
        let id = event.id;
        let open = super::title_button(format!("all-day-{id}-title"), &event.title, t.text, move |app: &mut App| {
          crate::dialogs::edit_event(app, id);
        });
        let mut details = col().gap(2.0).grow(1.0).child(open);
        let length = format::days_between(event.start_date, event.end_date);
        if length > 1 {
          details = details.child(meta(
            format!("Day {} of {length}", format::days_between(event.start_date, date) + 1),
            t,
          ));
        }
        if let Some(Some(location)) = &event.location {
          details = details.child(meta(location, t));
        }
        item(&format!("all-day-{}", event.id), t).child(details)
      })
      .collect();
    body = body.child(section("all-day", "All day", 2, items, t));
  }
  if !agenda.events.is_empty() {
    let spans: Vec<_> = agenda.events.iter().map(|e| (e.start, e.end)).collect();
    let statuses = format::event_statuses(&spans, app.clock.now());
    let items = agenda
      .events
      .iter()
      .zip(statuses)
      .map(|(event, status)| {
        let times = format::event_times(
          event.start,
          event.end,
          event.starts_before_day,
          event.ends_after_day,
          is_today,
          zone,
        );
        let mut details = col()
          .gap(2.0)
          .grow(1.0)
          .child({
            let id = event.id;
            super::title_button(format!("event-{id}-title"), &event.title, t.text, move |app: &mut App| {
              crate::dialogs::edit_event(app, id);
            })
          })
          .child(meta(times, t));
        if let Some(Some(location)) = &event.location {
          details = details.child(meta(location, t));
        }
        let mut r = item(&format!("event-{}", event.id), t).child(details);
        if is_today && let Some(label) = status.badge() {
          let (fill, color) = match status {
            EventStatus::Current => (t.current_bg, t.text),
            EventStatus::Next => (t.accent_soft, t.text),
            _ => (t.surface_sunken, t.text_muted),
          };
          r = r.child(badge(label, fill, color));
        }
        r
      })
      .collect();
    body = body.child(section("schedule", "Schedule", 2, items, t));
  }
  body.child(tasks_section(app, agenda, is_today, today, t))
}

fn agenda_task(task: &AgendaTaskItem, meta_text: Option<String>, overdue: bool) -> TaskRow<'_> {
  TaskRow {
    id: task.id,
    key: format!("task-{}", task.id),
    title: &task.title,
    done: task.is_completed,
    overdue: overdue && !task.is_completed,
    priority: task.priority.as_deref(),
    meta: meta_text,
    notes: None,
    named: true,
  }
}

fn tasks_section(app: &App, agenda: &DayAgendaResponse, is_today: bool, today: NaiveDate, t: &Tokens) -> El {
  let zone = app.clock.zone;
  let now = app.clock.now();
  let mut tasks = col()
    .key("tasks")
    .role("region")
    .label("Tasks")
    .gap(12.0)
    .w_full()
    .child(heading("tasks-heading", "Tasks", 2, t));
  if !agenda.tasks.overdue.is_empty() {
    let total = as_count(&agenda.tasks.overdue_total);
    let mut rows: Vec<El> = format::open_first(&agenda.tasks.overdue, |task| task.is_completed)
      .iter()
      .map(|task| {
        let described = if task.is_completed {
          "Was overdue".to_owned()
        } else {
          format::describe_overdue(task.due_date.flatten(), task.due_at.flatten(), today, zone)
        };
        task_row(agenda_task(task, Some(described), true), app, t)
      })
      .collect();
    if total > 20 {
      rows.push(button("overdue-all", &format!("View all {total} overdue"), t).on_press(crate::triage::open));
    }
    tasks = tasks.child(section("overdue", "Overdue", 3, rows, t));
  }
  if !agenda.tasks.due_today.is_empty() {
    let rows = format::open_first(&agenda.tasks.due_today, |task| task.is_completed)
      .iter()
      .map(|task| {
        let due = task.due_at.flatten().map(|at| {
          let mut s = format!("Due {}", format::format_time(at, zone));
          if is_today && format::is_past_due(task.is_completed, Some(at), now) {
            s.push_str(" · Past due");
          }
          s
        });
        task_row(agenda_task(task, due, false), app, t)
      })
      .collect();
    tasks = tasks.child(section("due", if is_today { "Due today" } else { "Due this day" }, 3, rows, t));
  }
  tasks
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_summary_counts_as_the_web_app_does() {
    assert_eq!(
      summary(&crate::fixtures::day()),
      ["1 all-day event", "4 events", "4 tasks to do", "2 overdue"]
    );
    assert_eq!(summary(&crate::fixtures::empty_day()), ["no tasks to do"]);
  }
}
