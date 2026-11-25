//! Where timed events sit in a Week column (#1034), ported from the web app's `features/week/gridLayout.ts`:
//! overlapping events share the column side by side, up to [`MAX_COLUMNS`], and the rest collapse into a
//! "+N more" chip. Also where the grid opens: 07:00, or an hour before now in the current week.

use chrono::{DateTime, Timelike, Utc};
use chrono_tz::Tz;

/// Minutes in a day: the grid's height in minutes.
pub const MINUTES_PER_DAY: i32 = 24 * 60;

/// Very short events are drawn at least this tall, so their title fits.
pub const MIN_EVENT_MINUTES: i32 = 20;

/// At most this many events sit side by side; more collapse into a "+N more" chip.
pub const MAX_COLUMNS: usize = 4;

/// Where the grid opens outside the current week: 07:00.
pub const DEFAULT_SCROLL_MINUTE: i32 = 7 * 60;

/// Minutes since local midnight, `[start, end)`, 0 to 1440.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
  pub start: i32,
  pub end: i32,
}

/// The wall-clock time of `instant` in `zone`, as minutes since local midnight (0 to 1439).
#[must_use]
pub fn wall_clock_minutes(instant: DateTime<Utc>, zone: Tz) -> i32 {
  let local = instant.with_timezone(&zone);
  i32::try_from(local.hour() * 60 + local.minute()).unwrap_or(0)
}

/// The part of an event drawn in its day, as `eventSpan` draws it: clipped to the day where it starts before or
/// ends after it, kept going when the wall clock goes back inside it (the repeated hour), and at least
/// [`MIN_EVENT_MINUTES`] tall.
#[must_use]
pub fn event_span(start: DateTime<Utc>, end: DateTime<Utc>, starts_before_day: bool, ends_after_day: bool, zone: Tz) -> Span {
  let mut from = if starts_before_day { 0 } else { wall_clock_minutes(start, zone) };
  let mut to = if ends_after_day {
    MINUTES_PER_DAY
  } else {
    wall_clock_minutes(end, zone)
  };
  if to <= from {
    let length = i32::try_from((end - start).num_minutes().max(0)).unwrap_or(MINUTES_PER_DAY);
    to = MINUTES_PER_DAY.min(from.saturating_add(length));
  }
  if to - from < MIN_EVENT_MINUTES {
    from = from.min(MINUTES_PER_DAY - MIN_EVENT_MINUTES);
    to = from + MIN_EVENT_MINUTES;
  }
  Span { start: from, end: to }
}

/// One event's place: its column in its overlap cluster, the cluster's columns, and whether it is counted in a
/// chip instead of drawn.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Placed {
  pub span: Span,
  pub column: usize,
  pub columns: usize,
  pub hidden: bool,
}

/// A "+N more" chip: the hidden events' extent, their count, and its place (the last column).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Chip {
  pub span: Span,
  pub count: usize,
  pub column: usize,
  pub columns: usize,
}

/// Lays out a day's events (their spans, in the order given), as `layoutDay` does: sorted by start, longest first
/// on ties; transitively overlapping events form a cluster; each takes the first free column; every event in a
/// cluster gets its width. A cluster that needs more than [`MAX_COLUMNS`] keeps `MAX_COLUMNS - 1` columns and
/// shows the rest as one chip in the last. Returns the events in the order given, and the chips.
#[must_use]
pub fn layout_day(spans: &[Span]) -> (Vec<Placed>, Vec<Chip>) {
  let mut order: Vec<usize> = (0..spans.len()).collect();
  order.sort_by(|&a, &b| spans[a].start.cmp(&spans[b].start).then(spans[b].end.cmp(&spans[a].end)));
  let mut placed: Vec<Option<Placed>> = vec![None; spans.len()];
  let mut chips = Vec::new();
  let mut cluster: Vec<(usize, usize)> = Vec::new();
  let mut column_ends: Vec<i32> = Vec::new();
  let mut cluster_end = -1;
  let mut close = |cluster: &mut Vec<(usize, usize)>, column_ends: &mut Vec<i32>, placed: &mut Vec<Option<Placed>>| {
    let overflow = column_ends.len() > MAX_COLUMNS;
    let columns = column_ends.len().min(MAX_COLUMNS);
    let hidden: Vec<usize> = cluster
      .iter()
      .filter(|(_, column)| overflow && *column >= MAX_COLUMNS - 1)
      .map(|(i, _)| *i)
      .collect();
    for &(i, column) in cluster.iter() {
      placed[i] = Some(Placed {
        span: spans[i],
        column,
        columns,
        hidden: overflow && column >= MAX_COLUMNS - 1,
      });
    }
    if !hidden.is_empty() {
      chips.push(Chip {
        span: Span {
          start: hidden.iter().map(|&i| spans[i].start).min().unwrap_or(0),
          end: hidden.iter().map(|&i| spans[i].end).max().unwrap_or(0),
        },
        count: hidden.len(),
        column: MAX_COLUMNS - 1,
        columns: MAX_COLUMNS,
      });
    }
    cluster.clear();
    column_ends.clear();
  };
  for i in order {
    let span = spans[i];
    if !cluster.is_empty() && span.start >= cluster_end {
      close(&mut cluster, &mut column_ends, &mut placed);
      cluster_end = -1;
    }
    let column = if let Some(free) = column_ends.iter().position(|&end| end <= span.start) {
      column_ends[free] = span.end;
      free
    } else {
      column_ends.push(span.end);
      column_ends.len() - 1
    };
    cluster.push((i, column));
    cluster_end = cluster_end.max(span.end);
  }
  if !cluster.is_empty() {
    close(&mut cluster, &mut column_ends, &mut placed);
  }
  (placed.into_iter().flatten().collect(), chips)
}

/// Where the grid opens (`initialScrollMinute`): an hour before now in the current week, otherwise 07:00.
#[must_use]
pub fn initial_scroll_minute(now_minute: Option<i32>) -> i32 {
  now_minute.map_or(DEFAULT_SCROLL_MINUTE, |now| (now - 60).max(0))
}

#[cfg(test)]
mod tests {
  use super::*;

  const MADRID: Tz = chrono_tz::Europe::Madrid;

  fn t(s: &str) -> DateTime<Utc> {
    s.parse().unwrap()
  }
  fn at(from: &str, to: &str) -> Span {
    let minutes = |hm: &str| {
      let (h, m) = hm.split_once(':').unwrap();
      h.parse::<i32>().unwrap() * 60 + m.parse::<i32>().unwrap()
    };
    Span {
      start: minutes(from),
      end: minutes(to),
    }
  }

  #[test]
  fn overlaps_events_by_their_minimum_height() {
    let span = event_span(t("2026-10-26T08:00:00Z"), t("2026-10-26T08:05:00Z"), false, false, MADRID);
    assert_eq!(span, at("09:00", "09:20"));
    let (placed, _) = layout_day(&[span, at("09:10", "09:40")]);
    assert_eq!(placed.iter().map(|p| p.columns).collect::<Vec<_>>(), [2, 2]);
  }

  #[test]
  fn shows_up_to_four_events_side_by_side() {
    let (placed, chips) = layout_day(&[at("09:00", "10:00"); 4]);
    let got: Vec<_> = placed.iter().map(|p| (p.column, p.columns, p.hidden)).collect();
    assert_eq!(got, [(0, 4, false), (1, 4, false), (2, 4, false), (3, 4, false)]);
    assert_eq!(chips, []);
  }

  #[test]
  fn collapses_more_than_four_concurrent_events_into_a_chip() {
    let spans: Vec<Span> = (0..6).map(|i| at(&format!("09:{:02}", i * 5), "10:00")).collect();
    let (placed, chips) = layout_day(&spans);
    let shown: Vec<usize> = (0..6).filter(|&i| !placed[i].hidden).collect();
    assert_eq!(shown, [0, 1, 2]);
    assert!(placed.iter().all(|p| p.columns == 4));
    assert_eq!(
      chips,
      [Chip {
        span: at("09:15", "10:00"),
        count: 3,
        column: 3,
        columns: 4
      }]
    );
  }

  #[test]
  fn separate_clusters_keep_their_own_width() {
    let (placed, _) = layout_day(&[at("09:00", "10:00"), at("09:30", "10:30"), at("11:00", "12:00")]);
    assert_eq!(
      placed.iter().map(|p| (p.column, p.columns)).collect::<Vec<_>>(),
      [(0, 2), (1, 2), (0, 1)]
    );
  }

  #[test]
  fn lays_out_the_repeated_hour_of_a_25_hour_day_by_wall_clock() {
    // 02:15–02:45 twice on 25 October 2026 in Madrid: CEST, then CET.
    let first = event_span(t("2026-10-25T00:15:00Z"), t("2026-10-25T00:45:00Z"), false, false, MADRID);
    let second = event_span(t("2026-10-25T01:15:00Z"), t("2026-10-25T01:45:00Z"), false, false, MADRID);
    let (placed, _) = layout_day(&[first, second]);
    assert_eq!(
      placed.iter().map(|p| (p.span.start, p.column, p.columns)).collect::<Vec<_>>(),
      [(135, 0, 2), (135, 1, 2)]
    );
  }

  #[test]
  fn opens_at_seven_or_an_hour_before_now() {
    assert_eq!(initial_scroll_minute(None), 420);
    assert_eq!(initial_scroll_minute(Some(10 * 60 + 30)), 9 * 60 + 30);
    assert_eq!(initial_scroll_minute(Some(20)), 0);
  }
}
