//! Dates and times in the user's locale, as the web app's `Intl.DateTimeFormat(undefined, …)` calls show them
//! (#1032): the OS's preferred language on the desktop and the browser's on the web, with CLDR data from ICU4X.
//!
//! Each method names the web call it matches and keeps its options. The phrases around them ("Today",
//! "Overdue by 3 days") stay English, as in the web app, and weeks always start on Monday (`weekDates.ts`).

use std::sync::OnceLock;

use chrono::{DateTime, Datelike, NaiveDate, NaiveDateTime, Timelike, Utc};
use chrono_tz::Tz;
use icu_datetime::fieldsets::{self, zone::LocalizedOffsetShort};
use icu_datetime::input::{Date, Time, UtcOffset};
use icu_datetime::options::{Alignment, TimePrecision, YearStyle};
use icu_datetime::range::DateRangeFormatter;
use icu_datetime::{DateTimeFormatter, DateTimeFormatterPreferences, NoCalendarFormatter};

/// The locale an OS or browser that names no usable language gets: what a browser's `Intl` falls back to.
pub const FALLBACK: &str = "en-US";

/// A locale and its formatters, each built on first use (the web app's `dateTimeFormat` cache).
pub struct Locale {
  tag: String,
  prefs: DateTimeFormatterPreferences,
  cache: Cache,
}

#[derive(Default)]
struct Cache {
  date: OnceLock<DateTimeFormatter<fieldsets::MDE>>,
  date_year: OnceLock<DateTimeFormatter<fieldsets::YMDE>>,
  day_month: OnceLock<DateTimeFormatter<fieldsets::MD>>,
  short_day: OnceLock<DateTimeFormatter<fieldsets::MDE>>,
  weekday: OnceLock<DateTimeFormatter<fieldsets::E>>,
  day: OnceLock<DateTimeFormatter<fieldsets::D>>,
  time: OnceLock<NoCalendarFormatter<fieldsets::T>>,
  numeric: OnceLock<DateTimeFormatter<fieldsets::YMDT>>,
  medium: OnceLock<DateTimeFormatter<fieldsets::YMDT>>,
  offset: OnceLock<NoCalendarFormatter<LocalizedOffsetShort>>,
  week: OnceLock<DateRangeFormatter<fieldsets::YMD>>,
  band: OnceLock<DateRangeFormatter<fieldsets::MD>>,
}

impl std::fmt::Debug for Locale {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_tuple("Locale").field(&self.tag).finish()
  }
}

impl Locale {
  /// The locale `tag` names (BCP 47), or `None` when it doesn't parse.
  #[must_use]
  pub fn parse(tag: &str) -> Option<Self> {
    let locale: icu_locale_core::Locale = tag.parse().ok()?;
    Some(Locale {
      tag: locale.to_string(),
      prefs: (&locale).into(),
      cache: Cache::default(),
    })
  }

  /// The first of `languages` (most wanted first) that parses, else [`FALLBACK`].
  #[must_use]
  pub fn first_of<S: AsRef<str>>(languages: impl IntoIterator<Item = S>) -> Self {
    languages
      .into_iter()
      .find_map(|tag| Locale::parse(tag.as_ref()))
      .unwrap_or_else(|| Locale::parse(FALLBACK).expect("the fallback parses"))
  }

  /// The user's locale: the OS's preferred languages (POSIX locale variables on Linux), the browser's on the web.
  #[must_use]
  pub fn system() -> Self {
    Locale::first_of(rune_i18n::system_languages())
  }

  /// The locale's BCP 47 tag, as ICU4X normalises it.
  #[must_use]
  pub fn tag(&self) -> &str {
    &self.tag
  }

  fn load<'a, F>(&self, cell: &'a OnceLock<F>, make: impl Fn(DateTimeFormatterPreferences) -> Option<F>) -> &'a F {
    // Compiled data covers every locale (with fallback to its parent and to root), so building never fails for
    // these field sets; the fallback locale is the last resort.
    cell.get_or_init(|| {
      make(self.prefs)
        .or_else(|| make(Locale::parse(FALLBACK).expect("the fallback parses").prefs))
        .expect("ICU4X compiled data has the fallback locale")
    })
  }

  /// `formatDate`: weekday, day and month, long ("Monday 26 October"), with the year when `with_year`.
  #[must_use]
  pub fn date(&self, date: NaiveDate, with_year: bool) -> String {
    let Some(d) = iso(date) else { return date.to_string() };
    if with_year {
      let f = self.load(&self.cache.date_year, |p| {
        DateTimeFormatter::try_new(p, fieldsets::YMDE::long().with_year_style(YearStyle::Full)).ok()
      });
      f.format(&d).to_string()
    } else {
      let f = self.load(&self.cache.date, |p| DateTimeFormatter::try_new(p, fieldsets::MDE::long()).ok());
      f.format(&d).to_string()
    }
  }

  /// `formatDayMonth`: day and short month ("26 Oct").
  #[must_use]
  pub fn day_month(&self, date: NaiveDate) -> String {
    let f = self.load(&self.cache.day_month, |p| {
      DateTimeFormatter::try_new(p, fieldsets::MD::medium()).ok()
    });
    iso(date).map_or_else(|| date.to_string(), |d| f.format(&d).to_string())
  }

  /// `shortDay`: short weekday, day and short month ("Thu 29 Oct").
  #[must_use]
  pub fn short_day(&self, date: NaiveDate) -> String {
    let f = self.load(&self.cache.short_day, |p| {
      DateTimeFormatter::try_new(p, fieldsets::MDE::medium()).ok()
    });
    iso(date).map_or_else(|| date.to_string(), |d| f.format(&d).to_string())
  }

  /// `dayHeadingParts`: the short weekday and the day of the month, ("Mon", "26").
  #[must_use]
  pub fn day_heading(&self, date: NaiveDate) -> (String, String) {
    let weekday = self.load(&self.cache.weekday, |p| DateTimeFormatter::try_new(p, fieldsets::E::short()).ok());
    let day = self.load(&self.cache.day, |p| DateTimeFormatter::try_new(p, fieldsets::D::short()).ok());
    let Some(d) = iso(date) else {
      return (String::new(), date.day().to_string());
    };
    (weekday.format(&d).to_string(), day.format(&d).to_string())
  }

  fn time_formatter(&self) -> &NoCalendarFormatter<fieldsets::T> {
    // `hour: '2-digit'`: a padded hour in either clock ("09:30", "09:30 AM").
    self.load(&self.cache.time, |p| {
      NoCalendarFormatter::try_new(p, fieldsets::T::hm().with_alignment(Alignment::Column)).ok()
    })
  }

  /// `formatTime`: the wall-clock time of `instant` in `zone`, hour and minute, 2-digit ("09:30").
  #[must_use]
  pub fn time(&self, instant: DateTime<Utc>, zone: Tz) -> String {
    self
      .time_formatter()
      .format(&time(instant.with_timezone(&zone).naive_local()))
      .to_string()
  }

  /// `hourLabel`: an hour of the Week grid's axis ("07:00").
  #[must_use]
  pub fn hour_label(&self, hour: u8) -> String {
    let at = Time::try_new(hour.min(23), 0, 0, 0).expect("an hour of the day");
    self.time_formatter().format(&at).to_string()
  }

  fn numeric_formatter(&self) -> &DateTimeFormatter<fieldsets::YMDT> {
    // `toLocaleString`'s fields: numeric year, month and day, and the time to the second.
    self.load(&self.cache.numeric, |p| {
      DateTimeFormatter::try_new(
        p,
        fieldsets::YMDT::short()
          .with_year_style(YearStyle::Full)
          .with_time_precision(TimePrecision::Second),
      )
      .ok()
    })
  }

  /// `formatDateTime`: `instant` in `zone` as `toLocaleString` shows it ("26/10/2026, 09:30:00").
  #[must_use]
  pub fn date_time(&self, instant: DateTime<Utc>, zone: Tz) -> String {
    let local = instant.with_timezone(&zone).naive_local();
    date_time(local).map_or_else(|| iso_text(local), |at| self.numeric_formatter().format(&at).to_string())
  }

  /// `formatDateTime(v, { timeZoneName: 'shortOffset' })`: as [`Locale::date_time`] with the UTC offset, for the
  /// occurrences of a repeated local time ("25/10/2026, 02:30:00 GMT+2").
  #[must_use]
  pub fn date_time_with_offset(&self, instant: DateTime<Utc>, zone: Tz) -> String {
    use chrono::Offset;
    let local = instant.with_timezone(&zone);
    let seconds = local.offset().fix().local_minus_utc();
    let offset = self.load(&self.cache.offset, |p| NoCalendarFormatter::try_new(p, LocalizedOffsetShort).ok());
    let utc = UtcOffset::try_from_seconds(seconds).unwrap_or_default();
    format!("{} {}", self.date_time(instant, zone), offset.format(&utc))
  }

  /// Triage's due instant: `dateStyle: 'medium', timeStyle: 'short'` ("26 Oct 2026, 09:30").
  #[must_use]
  pub fn medium_date_time(&self, instant: DateTime<Utc>, zone: Tz) -> String {
    let f = self.load(&self.cache.medium, |p| {
      DateTimeFormatter::try_new(
        p,
        fieldsets::YMDT::medium()
          .with_year_style(YearStyle::Full)
          .with_time_precision(TimePrecision::Minute),
      )
      .ok()
    });
    let local = instant.with_timezone(&zone).naive_local();
    date_time(local).map_or_else(|| iso_text(local), |at| f.format(&at).to_string())
  }

  /// `formatWeekRange`: Monday to Sunday as one range ("26 Oct – 1 Nov 2026").
  #[must_use]
  pub fn week_range(&self, week_start: NaiveDate) -> String {
    let end = week_start + chrono::Days::new(6);
    let f = self.load(&self.cache.week, |p| {
      DateRangeFormatter::try_new(p, fieldsets::YMD::medium().with_year_style(YearStyle::Full)).ok()
    });
    match (iso(week_start), iso(end)) {
      (Some(a), Some(b)) => f.format(&a, &b).to_string(),
      _ => format!("{week_start} – {end}"),
    }
  }

  /// The all-day band's dates (`AllDayBand.tsx`): one day ("19 Nov") or a range of them ("19 – 22 Nov").
  #[must_use]
  pub fn day_range(&self, first: NaiveDate, last: NaiveDate) -> String {
    if first == last {
      return self.day_month(first);
    }
    let f = self.load(&self.cache.band, |p| DateRangeFormatter::try_new(p, fieldsets::MD::medium()).ok());
    match (iso(first), iso(last)) {
      (Some(a), Some(b)) => f.format(&a, &b).to_string(),
      _ => format!("{first} – {last}"),
    }
  }
}

/// `date` for ICU4X, or `None` outside its years (-9999..=9999). The API accepts a task's `dueAt` up to year 9999 in
/// UTC, so its local date can be in year 10000 east of UTC (pre-merge review of #1047): the callers then show the ISO
/// text rather than panic.
fn iso(date: NaiveDate) -> Option<Date<icu_calendar::Iso>> {
  Date::try_new_iso(date.year(), u8::try_from(date.month()).ok()?, u8::try_from(date.day()).ok()?).ok()
}

/// The ISO text of a local date and time that ICU4X can't hold.
fn iso_text(local: NaiveDateTime) -> String {
  local.format("%Y-%m-%d %H:%M:%S").to_string()
}

fn time(local: NaiveDateTime) -> Time {
  let (h, m, s) = (local.hour(), local.minute(), local.second());
  Time::try_new(
    u8::try_from(h).unwrap_or(0),
    u8::try_from(m).unwrap_or(0),
    u8::try_from(s.min(59)).unwrap_or(0),
    0,
  )
  .expect("a valid time of day")
}

fn date_time(local: NaiveDateTime) -> Option<icu_datetime::input::DateTime<icu_calendar::Iso>> {
  Some(icu_datetime::input::DateTime {
    date: iso(local.date())?,
    time: time(local),
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn d(s: &str) -> NaiveDate {
    s.parse().unwrap()
  }
  fn t(s: &str) -> DateTime<Utc> {
    s.parse().unwrap()
  }
  fn locale(tag: &str) -> Locale {
    Locale::parse(tag).unwrap()
  }
  /// The text with CLDR's narrow and thin spaces as plain ones, as the web tests' `plain` reads it.
  fn plain(text: &str) -> String {
    text.replace(['\u{2009}', '\u{202f}', '\u{a0}'], " ")
  }

  const MADRID: Tz = chrono_tz::Europe::Madrid;

  #[test]
  fn en_gb_reads_as_the_web_tests_pin_it() {
    let gb = locale("en-GB");
    assert_eq!(gb.date(d("2026-10-26"), false), "Monday 26 October");
    assert_eq!(gb.day_month(d("2026-10-26")), "26 Oct");
    assert_eq!(gb.short_day(d("2026-10-29")), "Thu 29 Oct");
    assert_eq!(gb.day_heading(d("2026-10-26")), ("Mon".to_owned(), "26".to_owned()));
    assert_eq!(gb.time(t("2026-10-26T08:30:00Z"), MADRID), "09:30");
    assert_eq!(gb.time(t("2026-10-26T08:00:00Z"), chrono_tz::Asia::Kolkata), "13:30");
    assert_eq!(gb.hour_label(7), "07:00");
    assert_eq!(gb.date_time(t("2026-10-26T08:30:00Z"), MADRID), "26/10/2026, 09:30:00");
    assert_eq!(plain(&gb.week_range(d("2026-10-26"))), "26 Oct – 1 Nov 2026");
    assert_eq!(plain(&gb.week_range(d("2026-11-02"))), "2 – 8 Nov 2026");
    assert_eq!(plain(&gb.week_range(d("2026-12-28"))), "28 Dec 2026 – 3 Jan 2027");
    assert_eq!(plain(&gb.day_range(d("2026-11-19"), d("2026-11-21"))), "19 – 21 Nov");
    assert_eq!(gb.day_range(d("2026-11-19"), d("2026-11-19")), "19 Nov");
  }

  #[test]
  fn en_us_uses_its_own_order_and_a_12_hour_clock() {
    let us = locale("en-US");
    assert_eq!(us.date(d("2026-10-26"), false), "Monday, October 26");
    assert_eq!(plain(&us.time(t("2026-10-26T08:30:00Z"), MADRID)), "09:30 AM");
    assert_eq!(plain(&us.hour_label(7)), "07:00 AM");
    assert_eq!(plain(&us.date_time(t("2026-10-26T08:30:00Z"), MADRID)), "10/26/2026, 9:30:00 AM");
    assert_eq!(plain(&us.week_range(d("2026-10-26"))), "Oct 26 – Nov 1, 2026");
  }

  #[test]
  fn other_locales_use_their_own_names_and_clock() {
    let de = locale("de-DE");
    assert_eq!(de.date(d("2026-10-26"), false), "Montag, 26. Oktober");
    assert_eq!(de.time(t("2026-10-26T15:30:00Z"), MADRID), "16:30");
    let fr = locale("fr-FR");
    assert_eq!(fr.date(d("2026-10-26"), false), "lundi 26 octobre");
    // A `-u-hc-` keyword picks the clock, as it does for `Intl`.
    assert_eq!(
      locale("en-GB-u-hc-h12")
        .time(t("2026-10-26T15:30:00Z"), MADRID)
        .to_lowercase()
        .replace('\u{202f}', " "),
      "04:30 pm"
    );
  }

  #[test]
  fn a_repeated_local_time_shows_its_offset() {
    // 02:30 happens twice in Madrid on 25 October 2026: first at UTC+2, then at UTC+1.
    let gb = locale("en-GB");
    assert_eq!(
      gb.date_time_with_offset(t("2026-10-25T00:30:00Z"), MADRID),
      "25/10/2026, 02:30:00 GMT+2"
    );
    assert_eq!(
      gb.date_time_with_offset(t("2026-10-25T01:30:00Z"), MADRID),
      "25/10/2026, 02:30:00 GMT+1"
    );
    assert_eq!(gb.medium_date_time(t("2026-10-26T08:30:00Z"), MADRID), "26 Oct 2026, 09:30");
  }

  #[test]
  fn an_instant_past_icus_years_shows_as_iso_text() {
    // The API takes a `dueAt` up to 9999-12-31 in UTC: in Madrid that is already year 10000.
    let gb = locale("en-GB");
    assert_eq!(gb.date_time(t("9999-12-31T23:30:00Z"), MADRID), "+10000-01-01 00:30:00");
    assert_eq!(gb.medium_date_time(t("9999-12-31T23:30:00Z"), MADRID), "+10000-01-01 00:30:00");
    assert!(gb.date_time_with_offset(t("9999-12-31T23:30:00Z"), MADRID).ends_with("GMT+1"));
    assert_eq!(gb.date(d("2026-10-26"), true), "Monday, 26 October 2026");
  }

  #[test]
  fn the_first_usable_language_wins_and_none_falls_back_to_en_us() {
    assert_eq!(Locale::first_of(["fr-CA", "en-GB"]).tag(), "fr-CA");
    assert_eq!(Locale::first_of(["not a tag", "de-AT"]).tag(), "de-AT");
    assert_eq!(Locale::first_of(Vec::<String>::new()).tag(), FALLBACK);
    assert_eq!(FALLBACK, "en-US");
    // What the desktop reads on Linux: POSIX locale variables, `C` and `POSIX` skipped.
    let posix = |vars: &'static [(&'static str, &'static str)]| {
      rune_i18n::posix_languages(move |name| vars.iter().find(|(n, _)| *n == name).map(|(_, v)| (*v).to_owned()))
    };
    assert_eq!(Locale::first_of(posix(&[("LANG", "fr_FR.UTF-8")])).tag(), "fr-FR");
    assert_eq!(Locale::first_of(posix(&[("LANG", "C.UTF-8")])).tag(), "en-US");
    assert_eq!(
      Locale::first_of(posix(&[("LC_ALL", "de_DE@euro"), ("LANG", "en_GB")])).tag(),
      "de-DE"
    );
  }
}
