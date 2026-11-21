//! The date and time pickers the forms use (#1033), standing in for the browser's `type="date"` and `type="time"`
//! controls: a month grid beside a date field, and hour and minute spin buttons for a time.
//!
//! Both write the same `YYYY-MM-DD` and `HH:MM` text the forms already validate (`forms.rs`), so typing a date and
//! choosing it give the same request. The keys follow the browsers' controls and the ARIA date-picker pattern.

use crate::App;
use crate::format;
use chrono::{Datelike, Days, Months, NaiveDate, NaiveTime, Timelike};
use rune::{Key, KeyEvent, TextEdit, Tx};

/// A text field a picker writes to: its key and where its text lives.
#[derive(Clone, Copy)]
pub struct Field {
  pub key: &'static str,
  pub edit: fn(&mut App) -> &mut TextEdit,
  /// The field's text for drawing, `None` once its form has closed.
  pub edit_text: fn(&App) -> Option<&str>,
  /// What a chosen date does next, after it is written: Day's "Go to date" goes there, as the web app's date input
  /// does on a change.
  pub then: Option<fn(&mut App)>,
}

impl std::fmt::Debug for Field {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_tuple("Field").field(&self.key).finish()
  }
}

/// The month grid open under a date field, with the day that has focus.
#[derive(Clone, Copy, Debug)]
pub struct Calendar {
  pub field: Field,
  pub focus: NaiveDate,
}

impl Calendar {
  /// The first of the month shown.
  #[must_use]
  pub fn month(&self) -> NaiveDate {
    self.focus.with_day(1).unwrap_or(self.focus)
  }
}

/// The key of the button that opens a field's grid.
#[must_use]
pub fn button_key(field: &str) -> String {
  format!("{field}-choose")
}

/// The key of a day in a field's grid.
#[must_use]
pub fn day_key(field: &str, date: NaiveDate) -> String {
  format!("{field}-day-{date}")
}

/// The 42 days a month's grid shows: six weeks from the Monday on or before the 1st (weeks start on Monday, as in
/// the rest of the app).
#[must_use]
pub fn grid_dates(month: NaiveDate) -> [NaiveDate; 42] {
  let start = format::iso_week_start(month.with_day(1).unwrap_or(month));
  std::array::from_fn(|i| start + Days::new(i as u64))
}

/// Forgets an open grid and half-typed digits. Every form and the reschedule panel call it as they open and close,
/// so neither outlives its form: all event forms share their keys (pre-merge review of #1048).
pub fn reset(app: &mut App) {
  app.calendar = None;
  app.spin_typed = None;
}

/// Opens `field`'s grid on its date (today when it has none) and focuses that day.
pub fn open(app: &mut App, field: Field, tx: &mut Tx) {
  let typed = format::parse_iso_date((field.edit)(app).text.trim());
  let focus = typed.unwrap_or_else(|| app.clock.today());
  app.calendar = Some(Calendar { field, focus });
  tx.focus(day_key(field.key, focus), true);
}

/// Closes the grid and gives focus back to its button.
pub fn close(app: &mut App, tx: &mut Tx) {
  if let Some(calendar) = app.calendar.take() {
    tx.focus(button_key(calendar.field.key), true);
  }
}

/// Writes `date` into the field and closes the grid.
pub fn choose(app: &mut App, date: NaiveDate, tx: &mut Tx) {
  let Some(calendar) = app.calendar else { return };
  (calendar.field.edit)(app).replace_text(date.to_string());
  close(app, tx);
  if let Some(then) = calendar.field.then {
    then(app);
  }
}

/// Moves focus to `date`, within the supported years.
fn move_to(app: &mut App, date: Option<NaiveDate>, tx: &mut Tx) {
  let Some(calendar) = &mut app.calendar else { return };
  if let Some(date) = date.filter(|d| format::in_range(*d)) {
    calendar.focus = date;
    tx.focus(day_key(calendar.field.key, date), true);
  }
}

/// Shows the month before (`-1`) or after (`1`), keeping the day of the month where it can.
pub fn shift_month(app: &mut App, months: i32, tx: &mut Tx) {
  let Some(calendar) = app.calendar else { return };
  let target = if months < 0 {
    calendar.focus.checked_sub_months(Months::new(months.unsigned_abs()))
  } else {
    calendar.focus.checked_add_months(Months::new(months.unsigned_abs()))
  };
  move_to(app, target, tx);
}

/// The grid's keys: arrows move a day or a week, Page Up and Down a month, Home and End to the week's ends, Return
/// or Space choose, Escape closes. Keys with a modifier are left alone.
pub fn grid_key(app: &mut App, ev: &KeyEvent, tx: &mut Tx) -> bool {
  let Some(calendar) = app.calendar else { return false };
  let m = ev.mods;
  if m.cmd || m.ctrl || m.alt || m.logo || m.shift {
    return false;
  }
  let focus = calendar.focus;
  let days = |n: i64| format::add_days(focus, n);
  match &ev.key {
    Key::Left => move_to(app, days(-1), tx),
    Key::Right => move_to(app, days(1), tx),
    Key::Up => move_to(app, days(-7), tx),
    Key::Down => move_to(app, days(7), tx),
    Key::Home => move_to(app, Some(format::iso_week_start(focus)), tx),
    Key::End => move_to(app, days(6 - i64::from(focus.weekday().num_days_from_monday())), tx),
    Key::PageUp => shift_month(app, -1, tx),
    Key::PageDown => shift_month(app, 1, tx),
    Key::Enter => choose(app, focus, tx),
    Key::Text(s) if s == " " => choose(app, focus, tx),
    Key::Escape => close(app, tx),
    _ => return false,
  }
  true
}

/// A part of a time the spin buttons edit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Part {
  Hour,
  Minute,
  /// AM or PM, in a 12-hour locale.
  Period,
}

/// The time a field holds, `None` while it is empty or not `HH:MM`.
#[must_use]
pub fn parse_time(text: &str) -> Option<NaiveTime> {
  let text = text.trim();
  (text.len() == 5).then(|| NaiveTime::parse_from_str(text, "%H:%M").ok()).flatten()
}

fn hm(hour: u32, minute: u32) -> String {
  format!("{hour:02}:{minute:02}")
}

/// `text` with one part stepped by `delta`, wrapping as the browser's spin buttons do: the hour and minute each wrap
/// on their own, and in a 12-hour clock the hour stays in its half of the day. An empty field starts at 00:00.
#[must_use]
pub fn step(text: &str, part: Part, delta: i32, twelve_hour: bool) -> String {
  let time = parse_time(text).unwrap_or(NaiveTime::MIN);
  let (h, m) = (i32::try_from(time.hour()).unwrap_or(0), i32::try_from(time.minute()).unwrap_or(0));
  let (h, m) = match part {
    Part::Hour if twelve_hour => ((h % 12 + delta).rem_euclid(12) + h / 12 * 12, m),
    Part::Hour => ((h + delta).rem_euclid(24), m),
    Part::Minute => (h, (m + delta).rem_euclid(60)),
    Part::Period => ((h + 12) % 24, m),
  };
  hm(h.unsigned_abs(), m.unsigned_abs())
}

/// `text` after a digit typed into one part, with what has been typed so far into it (`typed`). Returns the new text
/// and whether the part is complete (two digits, or one that no second digit could follow), when focus moves on.
#[must_use]
pub fn type_digit(text: &str, part: Part, typed: &str, digit: u32, twelve_hour: bool) -> (String, bool) {
  let time = parse_time(text).unwrap_or(NaiveTime::MIN);
  let (h, m) = (time.hour(), time.minute());
  let value = typed.parse::<u32>().unwrap_or(0) * 10 + digit;
  match part {
    Part::Hour if twelve_hour => {
      let hour12 = if value == 0 || value > 12 { digit.max(1) } else { value };
      let complete = !typed.is_empty() || digit > 1;
      (hm(hour12 % 12 + h / 12 * 12, m), complete)
    }
    Part::Hour => {
      let hour = if value > 23 { digit } else { value };
      (hm(hour, m), !typed.is_empty() || digit > 2)
    }
    Part::Minute => {
      let minute = if value > 59 { digit } else { value };
      (hm(h, minute), !typed.is_empty() || digit > 5)
    }
    Part::Period => (text.to_owned(), true),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn d(s: &str) -> NaiveDate {
    s.parse().unwrap()
  }

  #[test]
  fn a_month_shows_six_weeks_from_a_monday() {
    let days = grid_dates(d("2026-11-15"));
    assert_eq!(days[0], d("2026-10-26"));
    assert_eq!(days[6], d("2026-11-01"));
    assert_eq!(days[41], d("2026-12-06"));
  }

  #[test]
  fn spin_buttons_wrap_each_part() {
    assert_eq!(step("23:59", Part::Hour, 1, false), "00:59");
    assert_eq!(step("23:59", Part::Minute, 1, false), "23:00");
    assert_eq!(step("09:30", Part::Minute, -10, false), "09:20");
    assert_eq!(step("", Part::Hour, 1, false), "01:00");
    assert_eq!(step("", Part::Hour, -1, false), "23:00");
    // A 12-hour clock keeps the hour in its half of the day; the period swaps halves.
    assert_eq!(step("11:15", Part::Hour, 1, true), "00:15");
    assert_eq!(step("23:15", Part::Hour, 1, true), "12:15");
    assert_eq!(step("09:15", Part::Period, 1, true), "21:15");
  }

  #[test]
  fn typed_digits_fill_a_part_and_say_when_it_is_done() {
    assert_eq!(type_digit("09:30", Part::Hour, "", 1, false), ("01:30".to_owned(), false));
    assert_eq!(type_digit("01:30", Part::Hour, "1", 4, false), ("14:30".to_owned(), true));
    assert_eq!(type_digit("09:30", Part::Hour, "", 7, false), ("07:30".to_owned(), true));
    assert_eq!(type_digit("09:30", Part::Minute, "", 4, false), ("09:04".to_owned(), false));
    assert_eq!(type_digit("09:04", Part::Minute, "4", 5, false), ("09:45".to_owned(), true));
    assert_eq!(type_digit("09:30", Part::Minute, "", 9, false), ("09:09".to_owned(), true));
    // 12-hour: "1" may become 10 to 12; "3" can't, so it's done; the half of the day stays.
    assert_eq!(type_digit("21:00", Part::Hour, "", 3, true), ("15:00".to_owned(), true));
    assert_eq!(type_digit("21:00", Part::Hour, "1", 2, true), ("12:00".to_owned(), true));
    assert_eq!(type_digit("09:00", Part::Hour, "1", 2, true), ("00:00".to_owned(), true));
  }
}
