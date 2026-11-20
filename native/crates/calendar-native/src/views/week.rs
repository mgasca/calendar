//! The week (`/week/$weekStart`), as the web app's `features/week/WeekView.tsx`: a Monday-first time grid with
//! an all-day band, each day's tasks, and the overdue panel.

use super::{TaskRow, button, heading, meta, remote_state, section, task_row};
use crate::format;
use crate::route::Route;
use crate::theme::Tokens;
use crate::{App, load};
use calendar_client::as_count;
use calendar_client::generated::WeekAgendaResponse;
use chrono::{NaiveDate, Timelike};
use rune::tok::type_;
use rune::{El, ScrollSpec, col, el, row, text};

/// Points per hour in the time grid.
pub const HOUR: f32 = 40.0;
const GUTTER: f32 = 48.0;

pub fn view(app: &App, week_start: NaiveDate, t: &Tokens) -> El {
  let today = app.clock.today();
  let this_week = format::iso_week_start(today);
  let mut nav = row().key("week-nav").role("navigation").label("Weeks").gap(6.0);
  if let Some(previous) = format::add_days(week_start, -7) {
    nav = nav.child(button("week-previous", "Previous", t).on_press(move |app: &mut App| load::go(app, Route::Week(previous))));
  }
  nav = nav.child(
    button("week-this", "This week", t)
      .checked(week_start == this_week)
      .on_press(move |app: &mut App| load::go(app, Route::Week(this_week))),
  );
  if let Some(next) = format::add_days(week_start, 7) {
    nav = nav.child(button("week-next", "Next", t).on_press(move |app: &mut App| load::go(app, Route::Week(next))));
  }
  let mut header = col()
    .key("week-header")
    .gap(6.0)
    .child(meta(format::relative_week(week_start, this_week), t).key("week-eyebrow"))
    .child(heading("week-title", format::format_week_range(week_start), 1, t))
    .child(nav);
  if let Some(week) = app
    .week
    .data
    .as_ref()
    .filter(|w| !w.all_day_events.is_empty() || w.days.iter().any(|d| !d.events.is_empty() || !d.tasks.is_empty()))
  {
    header = header.child(meta(summary(week), t).key("week-summary"));
  }
  let mut page = col().key("week").gap(14.0).w_full().child(header);
  if let Some(state) = remote_state(
    &app.week,
    "week",
    "Loading the week…",
    "Couldn\u{2019}t load this week.",
    "Couldn\u{2019}t refresh; showing the last loaded week.",
    load::reload,
    t,
  ) {
    page = page.child(state);
  }
  let Some(week) = &app.week.data else { return page };
  let empty = week.all_day_events.is_empty() && week.days.iter().all(|d| d.events.is_empty() && d.tasks.is_empty());
  if empty {
    page = page.child(text("Nothing planned this week.").key("week-empty").color(t.empty_text));
  } else {
    page = page.child(grid(app, week, today, t));
  }
  if let Some(overdue) = week.overdue.as_ref().filter(|o| !o.is_empty()) {
    let total = as_count(&week.overdue_total);
    let mut rows: Vec<El> = overdue
      .iter()
      .map(|task| {
        let described = format::describe_overdue(task.due_date.flatten(), task.due_at.flatten(), today, app.clock.zone);
        task_row(
          TaskRow {
            id: task.id,
            key: format!("overdue-{}", task.id),
            title: &task.title,
            done: task.is_completed,
            overdue: true,
            priority: task.priority.as_deref(),
            meta: Some(described),
            notes: None,
            named: true,
          },
          app,
          t,
        )
      })
      .collect();
    if total > 20 {
      rows.push(
        button("week-overdue-all", &format!("View all {total} overdue"), t)
          .focusable(false)
          .disabled(true),
      );
    }
    page = page.child(section("week-overdue", &format!("Overdue ({total})"), 2, rows, t));
  }
  page
}

/// "5 events · 2 tasks (1 open)": a timed event that crosses midnight counts once.
#[must_use]
pub fn summary(week: &WeekAgendaResponse) -> String {
  let mut ids: Vec<_> = week.days.iter().flat_map(|d| d.events.iter().map(|e| e.id)).collect();
  ids.sort_unstable();
  ids.dedup();
  let events = format::len(ids.len() + week.all_day_events.len());
  let tasks: Vec<_> = week.days.iter().flat_map(|d| d.tasks.iter()).collect();
  let open = tasks.iter().filter(|t| !t.is_completed).count();
  format!(
    "{} · {} ({open} open)",
    format::count(events, "event", "events"),
    format::count(format::len(tasks.len()), "task", "tasks")
  )
}

// One layout: the band, headings, task strips and hour grid share their seven columns.
#[allow(clippy::too_many_lines, clippy::cast_precision_loss)]
fn grid(app: &App, week: &WeekAgendaResponse, today: NaiveDate, t: &Tokens) -> El {
  let zone = app.clock.zone;
  let this_week = format::iso_week_start(today) == week.week_start;
  // The all-day band: one bar per event, clipped to the week, with ◀ ▶ when it continues.
  let week_end = format::week_dates(week.week_start)[6];
  let band = week.all_day_events.iter().fold(
    col().key("all-day-band").role("list").label("All day").gap(4.0).w_full(),
    |band, event| {
      let last = event.end_date.pred_opt().unwrap_or(event.end_date);
      let before = event.start_date < week.week_start;
      let after = last > week_end;
      let label = format!("{}{}{}", if before { "◀ " } else { "" }, event.title, if after { " ▶" } else { "" });
      // The bar spans its days in the week's seven columns, after the hour gutter.
      let first = format::days_between(week.week_start, event.start_date.max(week.week_start));
      let days = format::days_between(week.week_start, last.min(week_end)) - first + 1;
      #[allow(clippy::cast_precision_loss)]
      let cells = |n: i64| el().w(0.0).grow(n as f32);
      band.child(
        row()
          .w_full()
          .gap(4.0)
          .child(el().w(GUTTER))
          .child(cells(first))
          .child(
            text(label)
              .key(format!("band-{}", event.id))
              .role("listitem")
              .label(format!("{}, {}", event.title, band_dates(event.start_date, last)))
              .w(0.0)
              .grow(days as f32)
              .fill(t.accent_soft)
              .color(t.text)
              .px(8.0)
              .py(3.0)
              .radius(4.0)
              .truncate(),
          )
          .child(cells(7 - first - days)),
      )
    },
  );
  // Three aligned rows over the same seven equal columns: headings, each day's tasks, then the hour grid.
  let column = || el().w(0.0).grow(1.0);
  let mut headings = row().key("day-headings").w_full().gap(4.0).child(el().w(GUTTER));
  let mut strips = row().key("day-tasks").w_full().gap(4.0).child(el().w(GUTTER));
  let gutter = (0..24).fold(col().key("hours").w(GUTTER), |g, hour| {
    g.child(
      el()
        .h(HOUR)
        .child(text(format!("{hour:02}:00")).font(type_::LABEL).color(t.text_muted)),
    )
  });
  let mut hours_row = row().key("days").w_full().gap(4.0).child(gutter);
  for day in &week.days {
    let is_today = day.date == today;
    let (weekday, number) = format::day_heading(day.date);
    let date = day.date;
    headings = headings.child(
      column().child(
        button(&format!("day-{date}"), &format!("{weekday} {number}"), t)
          .label(format::format_date(date, false))
          .checked(is_today)
          .fill(if is_today { t.current_bg } else { t.surface_raised })
          .on_press(move |app: &mut App| load::go(app, Route::Day(date))),
      ),
    );
    let strip = format::open_first(&day.tasks, |task| task.is_completed).iter().fold(
      col()
        .key(format!("tasks-{date}"))
        .role("list")
        .label(format!("Tasks, {}", format::format_date(date, false)))
        .gap(4.0),
      |list, task| {
        let overdue = this_week && day.date < today && !task.is_completed;
        let mut item = row()
          .key(format!("week-task-{date}-{}", task.id))
          .role("listitem")
          .gap(6.0)
          .items_center()
          .px(6.0)
          .py(4.0)
          .radius(4.0)
          .fill(if overdue { t.overdue_bg } else { t.surface })
          .child(
            super::checkbox(
              &format!("week-check-{date}-{}", task.id),
              task.id,
              &task.title,
              task.is_completed,
              app,
            )
            .size(12.0, 12.0)
            .radius(3.0)
            .border(1.5, t.border_strong),
          )
          .child(
            text(&task.title)
              .font(type_::LABEL)
              .color(if task.is_completed { t.completed_text } else { t.text })
              .truncate(),
          );
        if overdue {
          item = item.child(text("Overdue").font(type_::LABEL).color(t.overdue_text));
        }
        list.child(item)
      },
    );
    strips = strips.child(column().child(strip));
    let mut hours = column()
      .key(format!("grid-{date}"))
      .h(24.0 * HOUR)
      .fill(if is_today { t.current_bg } else { t.surface });
    for event in &day.events {
      let start = if event.starts_before_day { 0.0 } else { minutes(event.start, zone) };
      let end = if event.ends_after_day {
        24.0 * 60.0
      } else {
        minutes(event.end, zone).max(start + 15.0)
      };
      let times = format::event_times(event.start, event.end, event.starts_before_day, event.ends_after_day, false, zone);
      hours = hours.child(
        col()
          .key(format!("week-event-{date}-{}", event.id))
          .role("listitem")
          .label(format!("{}, {times}", event.title))
          .absolute(2.0, start / 60.0 * HOUR)
          .w_full()
          .h((end - start) / 60.0 * HOUR - 2.0)
          .px(4.0)
          .py(2.0)
          .radius(4.0)
          .fill(t.accent_soft)
          .child(text(&event.title).font(type_::LABEL).color(t.text).truncate())
          .child(text(times).font(type_::LABEL).color(t.text_muted).truncate()),
      );
    }
    if is_today {
      hours = hours.child(
        el()
          .key("now-line")
          .absolute(0.0, minutes(app.clock.now(), zone) / 60.0 * HOUR)
          .w_full()
          .h(2.0)
          .fill(t.now_line),
      );
    }
    hours_row = hours_row.child(hours);
  }
  col()
    .key("week-grid")
    .gap(8.0)
    .w_full()
    .child(band)
    .child(headings)
    .child(strips)
    .child(
      col()
        .key("week-hours")
        .w_full()
        .h(560.0)
        .scroll(ScrollSpec { stick_bottom: false })
        .child(hours_row),
    )
}

// Minutes in a day (at most 1,439) are exact in an f32.
#[allow(clippy::cast_precision_loss)]
fn minutes(instant: chrono::DateTime<chrono::Utc>, zone: chrono_tz::Tz) -> f32 {
  let local = instant.with_timezone(&zone);
  (local.hour() * 60 + local.minute()) as f32
}

/// An all-day event's dates as the web app's band says them: "19 Nov" or "19–22 Nov" (`AllDayBand.tsx`).
fn band_dates(first: NaiveDate, last: NaiveDate) -> String {
  use chrono::Datelike;
  if first == last {
    format::format_day_month(first)
  } else if first.month() == last.month() && first.year() == last.year() {
    format!("{}–{}", first.format("%-d"), format::format_day_month(last))
  } else {
    format!("{} – {}", format::format_day_month(first), format::format_day_month(last))
  }
}

#[cfg(test)]
mod tests {
  #[test]
  fn the_summary_counts_events_and_open_tasks() {
    assert_eq!(super::summary(&crate::fixtures::week()), "4 events · 2 tasks (2 open)");
  }
}
