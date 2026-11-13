//! A run of consecutive local days.

use std::num::NonZeroUsize;

use chrono::{DateTime, Datelike, Days, NaiveDate, Utc};

use super::{DayWindow, IanaZone};

/// Consecutive local calendar days in a time zone, from [`start_date`](Self::start_date) up to (not including)
/// [`end_date`](Self::end_date), each as its [`DayWindow`]. The whole range is the half-open UTC interval
/// `[start, end)`.
///
/// The days tile without gaps or overlaps: each day's end is the next day's start. Days keep their [`DayWindow`]
/// behaviour, so a range can hold 23- and 25-hour days, and an empty day for a date the zone skipped entirely.
/// Nothing here assumes a range length: a week is the [`iso_week`](Self::iso_week) factory, and a month or any
/// other run of days is [`create`](Self::create).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DateRangeWindow {
  zone: IanaZone,
  days: Vec<DayWindow>,
}

impl DateRangeWindow {
  /// Days in an ISO week.
  pub const DAYS_IN_WEEK: NonZeroUsize = NonZeroUsize::new(7).unwrap();

  /// Builds the `day_count` consecutive days from `start_date` in `zone`. The count is never zero, so a range
  /// is never empty.
  ///
  /// # Panics
  ///
  /// When the range reaches the limits of the dates `chrono` can represent (see [`DayWindow::create`]).
  pub fn create(start_date: NaiveDate, day_count: NonZeroUsize, zone: IanaZone) -> Self {
    let days = start_date
      .iter_days()
      .take(day_count.get())
      .map(|date| DayWindow::create(date, zone))
      .collect::<Vec<_>>();
    assert!(days.len() == day_count.get(), "the range runs past the last supported date");
    Self { zone, days }
  }

  /// The one local day `date` in `zone`.
  ///
  /// # Panics
  ///
  /// When `date` is at the limits of the dates `chrono` can represent (see [`DayWindow::create`]).
  pub fn single_day(date: NaiveDate, zone: IanaZone) -> Self {
    Self::create(date, NonZeroUsize::MIN, zone)
  }

  /// The ISO week (Monday to Sunday) that contains `any_date`, in `zone`.
  pub fn iso_week(any_date: NaiveDate, zone: IanaZone) -> Self {
    Self::create(Self::iso_week_start(any_date), Self::DAYS_IN_WEEK, zone)
  }

  /// The Monday of the ISO week that contains `date`.
  pub fn iso_week_start(date: NaiveDate) -> NaiveDate {
    date - Days::new(u64::from(date.weekday().num_days_from_monday()))
  }

  /// The zone the local days are resolved in.
  pub fn zone(&self) -> IanaZone {
    self.zone
  }

  /// The days in date order; never empty.
  pub fn days(&self) -> &[DayWindow] {
    &self.days
  }

  /// The first local date in the range.
  pub fn start_date(&self) -> NaiveDate {
    self.first_day().date()
  }

  /// The exclusive end date: the day after the last date in the range.
  pub fn end_date(&self) -> NaiveDate {
    self.last_day().date() + Days::new(1)
  }

  /// Inclusive start of the first day.
  pub fn start(&self) -> DateTime<Utc> {
    self.first_day().start()
  }

  /// Exclusive end of the last day.
  pub fn end(&self) -> DateTime<Utc> {
    self.last_day().end()
  }

  fn first_day(&self) -> &DayWindow {
    self.days.first().expect("a range holds at least one day")
  }

  fn last_day(&self) -> &DayWindow {
    self.days.last().expect("a range holds at least one day")
  }
}
