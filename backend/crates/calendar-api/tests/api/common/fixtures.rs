//! Builders, projections and generators that more than one test module uses, re-exported by `common` so
//! `use crate::common::*;` brings them in. Add a helper here rather than copying it into a second module.

use super::{OWNER, completed_task, task};
use calendar_api::contracts::{AgendaTaskItem, AllDayEventItem, TimedEventItem};
use calendar_domain::events::CalendarEvent;
use calendar_domain::tasks::TodoTask;
use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use uuid::Uuid;

/// The zone of the agenda endpoint tests' events.
pub const NEW_YORK: &str = "America/New_York";

/// The development seed key the seed tests configure (32 characters, the minimum).
pub const SEED_KEY: &str = "12345678901234567890123456789012";

/// A date from its ISO text.
pub fn d(text: &str) -> NaiveDate {
  text.parse().expect("a valid date")
}

/// A timed event of [`OWNER`] in [`NEW_YORK`].
pub fn timed(title: &str, start: DateTime<Utc>, end: DateTime<Utc>) -> CalendarEvent {
  timed_in(title, start, end, NEW_YORK)
}

/// A timed event of [`OWNER`] in `zone`.
pub fn timed_in(title: &str, start: DateTime<Utc>, end: DateTime<Utc>, zone: &str) -> CalendarEvent {
  CalendarEvent::create(OWNER, title, start, end, zone, None, None).expect("a valid event")
}

/// An all-day event of [`OWNER`] from `start` to the exclusive `end` (ISO dates).
pub fn all_day(title: &str, start: &str, end: &str) -> CalendarEvent {
  CalendarEvent::create_all_day(OWNER, title, d(start), d(end), None, None).expect("a valid event")
}

/// An open task of [`OWNER`] due on `due_date` (ISO).
pub fn on(title: &str, due_date: &str) -> TodoTask {
  task(title, Some(d(due_date)), None)
}

/// An open task of [`OWNER`] due at `due_at`.
pub fn at(title: &str, due_at: DateTime<Utc>) -> TodoTask {
  task(title, None, Some(due_at))
}

/// An open task of [`OWNER`] with `priority`.
pub fn with_priority(title: &str, due_date: Option<&str>, due_at: Option<DateTime<Utc>>, priority: &str) -> TodoTask {
  TodoTask::create(OWNER, title, due_date.map(d), due_at, priority, None).expect("a valid task")
}

/// A task of [`OWNER`] due on `due_date` (ISO) and completed at `completed_at`.
pub fn done(title: &str, due_date: &str, completed_at: DateTime<Utc>) -> TodoTask {
  completed_task(title, Some(d(due_date)), completed_at, None)
}

/// An item with a title, for [`titles`].
pub trait Titled {
  /// The item's title.
  fn title(&self) -> &str;
}

impl Titled for TimedEventItem {
  fn title(&self) -> &str {
    &self.title
  }
}

impl Titled for AllDayEventItem {
  fn title(&self) -> &str {
    &self.title
  }
}

impl Titled for AgendaTaskItem {
  fn title(&self) -> &str {
    &self.title
  }
}

/// The titles of `items`, in order.
pub fn titles<T: Titled>(items: &[T]) -> Vec<&str> {
  items.iter().map(Titled::title).collect()
}

/// The keys of a JSON object, sorted.
pub fn sorted_keys(value: &Value) -> Vec<&str> {
  let mut keys: Vec<&str> = value.as_object().expect("a JSON object").keys().map(String::as_str).collect();
  keys.sort_unstable();
  keys
}

/// `items`, sorted.
pub fn sorted<T: Ord>(mut items: Vec<T>) -> Vec<T> {
  items.sort_unstable();
  items
}

/// A web root for the static-file tests: `index.html` ("SPA") and one fingerprinted asset,
/// `assets/app-Abc123_X.js` ("asset"). Removed when dropped.
pub fn spa_root() -> tempfile::TempDir {
  let root = tempfile::tempdir().expect("a temporary directory");
  std::fs::create_dir(root.path().join("assets")).expect("the assets directory");
  std::fs::write(root.path().join("index.html"), "SPA").expect("index.html");
  std::fs::write(root.path().join("assets").join("app-Abc123_X.js"), "asset").expect("the asset");
  root
}

/// `SplitMix64`: a small deterministic generator, seeded like `new Random(seed)`, shared by the randomized
/// tests so they draw from one generator.
pub struct SeededRandom(pub u64);

impl SeededRandom {
  /// The next 64 random bits.
  pub fn next_u64(&mut self) -> u64 {
    self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = self.0;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
  }

  /// A value in `0..bound` (`Random.Next(bound)`).
  pub fn below(&mut self, bound: u64) -> u64 {
    self.next_u64() % bound
  }

  /// A value in `min..max` (`Random.Next(min, max)`).
  pub fn between(&mut self, min: i64, max: i64) -> i64 {
    let span = u64::try_from(max - min).expect("an ascending range");
    min + i64::try_from(self.below(span)).expect("a small offset")
  }

  /// One of `items`.
  pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
    let index = usize::try_from(self.below(u64::try_from(items.len()).expect("a small slice"))).expect("an index");
    &items[index]
  }

  /// A random id.
  pub fn id(&mut self) -> Uuid {
    Uuid::from_u128((u128::from(self.next_u64()) << 64) | u128::from(self.next_u64()))
  }
}

/// Declares one `#[tokio::test]` per scenario, each awaiting `$test(date, zone)`:
///
/// ```ignore
/// scenarios! {
///   each_day_of_the_week_equals_the_day_agenda;
///   each_day_of_the_week_equals_the_day_agenda_utc: "2026-10-28", "UTC";
/// }
/// ```
macro_rules! scenarios {
  ($test:ident; $($name:ident: $date:literal, $zone:literal;)*) => {
    $(
      #[tokio::test]
      async fn $name() {
        $test($date, $zone).await;
      }
    )*
  };
}
pub(crate) use scenarios;
