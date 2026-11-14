//! The agenda read against a real database: what it selects and projects, the overdue list, and that all of
//! it comes from one read-only snapshot (ADR-0020).

use calendar_domain::events::CalendarEvent;
use calendar_domain::tasks::{Priority, TodoTask};
use calendar_domain::time::{DateRangeWindow, DayWindow, IanaZone, time_zones};
use calendar_infrastructure::agenda::{self, AgendaTaskRow, AllDayEventRow, TimedEventRow};
use chrono::NaiveDate;
use uuid::Uuid;

use crate::repositories::{OWNER, SqlLog, USER_B, all_day_event, date, fixture, seed, sorted, task, task_of, timed_event, utc};

fn day(date: NaiveDate) -> DateRangeWindow {
  DateRangeWindow::single_day(date, IanaZone::UTC)
}

fn task_titles(rows: &[AgendaTaskRow]) -> Vec<&str> {
  rows.iter().map(|row| row.title.as_str()).collect()
}

#[tokio::test]
async fn a_day_is_read_with_the_columns_the_agenda_shows() {
  let mut f = fixture().await;
  let all_day = CalendarEvent::create_all_day(OWNER.0, "Holiday", date(2026, 10, 25), date(2026, 10, 28), Some("Home"), None).unwrap();
  let timed = CalendarEvent::create(
    OWNER.0,
    "Standup",
    utc(2026, 10, 26, 9, 0),
    utc(2026, 10, 26, 9, 30),
    "Europe/Berlin",
    None,
    Some("Bring notes"),
  )
  .unwrap();
  let due = TodoTask::create(OWNER.0, "Buy milk", Some(date(2026, 10, 26)), None, "high", Some("Two litres")).unwrap();
  let mut done = TodoTask::create(OWNER.0, "Call", None, Some(utc(2026, 10, 26, 14, 30)), "low", None).unwrap();
  done.complete(utc(2026, 10, 26, 15, 0));
  seed(&mut f.conn, &[all_day.clone(), timed.clone()], &[due.clone(), done.clone()]).await;
  // Rows the day must not show: other days, and another user's.
  seed(
    &mut f.conn,
    &[
      all_day_event(OWNER, "Next week", date(2026, 11, 2), date(2026, 11, 3)),
      timed_event(OWNER, "Tomorrow", utc(2026, 10, 27, 9, 0), utc(2026, 10, 27, 10, 0), "UTC"),
      all_day_event(USER_B, "Theirs", date(2026, 10, 26), date(2026, 10, 27)),
      timed_event(USER_B, "Theirs", utc(2026, 10, 26, 9, 0), utc(2026, 10, 26, 10, 0), "UTC"),
    ],
    &[
      task("Tomorrow", Some(date(2026, 10, 27)), None, None),
      task("Undated", None, None, None),
      task_of(USER_B, "Theirs", Some(date(2026, 10, 26)), None, None),
    ],
  )
  .await;

  let rows = agenda::read(&mut f.conn, OWNER, &day(date(2026, 10, 26)), None, 20).await.unwrap();

  assert_eq!(
    rows.all_day_events,
    [AllDayEventRow {
      id: all_day.id(),
      title: "Holiday".to_owned(),
      location: Some("Home".to_owned()),
      has_notes: false,
      start_date: date(2026, 10, 25),
      end_date: date(2026, 10, 28),
    }]
  );
  assert_eq!(
    rows.timed_events,
    [TimedEventRow {
      id: timed.id(),
      title: "Standup".to_owned(),
      location: None,
      has_notes: true,
      start: utc(2026, 10, 26, 9, 0),
      end: utc(2026, 10, 26, 9, 30),
      time_zone_id: "Europe/Berlin".to_owned(),
    }]
  );
  let mut due_tasks = rows.due_tasks;
  due_tasks.sort_by(|a, b| a.title.cmp(&b.title));
  assert_eq!(
    due_tasks,
    [
      AgendaTaskRow {
        id: due.id(),
        title: "Buy milk".to_owned(),
        priority: Priority::High,
        has_notes: true,
        due_date: Some(date(2026, 10, 26)),
        due_at: None,
        completed_at: None,
      },
      AgendaTaskRow {
        id: done.id(),
        title: "Call".to_owned(),
        priority: Priority::Low,
        has_notes: false,
        due_date: None,
        due_at: Some(utc(2026, 10, 26, 14, 30)),
        completed_at: Some(utc(2026, 10, 26, 15, 0)),
      },
    ]
  );
  assert_eq!(rows.overdue, None);

  // Ports the data half of `OwnershipTests.DayAndWeekAgendas_ShowOnlyTheCallersRows`.
  let theirs = agenda::read(&mut f.conn, USER_B, &day(date(2026, 10, 26)), None, 20).await.unwrap();
  assert_eq!(theirs.all_day_events.len(), 1);
  assert_eq!(theirs.timed_events.len(), 1);
  assert_eq!(task_titles(&theirs.due_tasks), ["Theirs"]);
}

/// ADR-0020 D1: one `REPEATABLE READ, READ ONLY` transaction around a fixed number of reads.
#[tokio::test]
async fn the_agenda_is_read_in_one_read_only_snapshot_with_a_fixed_number_of_queries() {
  let mut f = fixture().await;
  let week = DateRangeWindow::iso_week(date(2026, 10, 28), IanaZone::UTC);
  let today = DayWindow::create(date(2026, 10, 28), IanaZone::UTC);
  let log = SqlLog::record(&mut f.conn);

  agenda::read(&mut f.conn, OWNER, &week, None, 20).await.unwrap();
  let without_overdue = log.statements();
  agenda::read(&mut f.conn, OWNER, &week, Some(&today), 20).await.unwrap();
  let with_overdue = log.statements().split_off(without_overdue.len());

  for statements in [&without_overdue, &with_overdue] {
    let begin = statements.iter().position(|sql| sql == "<begin>").expect("a transaction");
    let commit = statements.iter().position(|sql| sql == "<commit>").expect("a commit");
    assert!(
      statements[..=begin + 1]
        .iter()
        .any(|sql| sql.contains("ISOLATION LEVEL REPEATABLE READ") && sql.contains("READ ONLY")),
      "{statements:?}"
    );
    let selects: Vec<usize> = (0..statements.len()).filter(|i| statements[*i].contains("SELECT")).collect();
    assert!(selects.iter().all(|i| *i > begin && *i < commit), "{statements:?}");
    assert_eq!(statements.last().map(String::as_str), Some("COMMIT"), "{statements:?}");
  }
  let count = |statements: &[String]| statements.iter().filter(|sql| sql.contains("SELECT")).count();
  assert_eq!(count(&without_overdue), 3, "{without_overdue:?}");
  assert_eq!(count(&with_overdue), 6, "{with_overdue:?}");

  // The overdue list is two branches, each selective on its own partial index, combined and then ordered.
  let overdue = with_overdue.iter().find(|sql| sql.contains("UNION ALL")).expect("the overdue list");
  let (open, completed) = overdue.split_once("UNION ALL").unwrap();
  assert!(
    open.contains("\"completed_at\" IS NULL") && !open.contains("\"completed_at\" >="),
    "{overdue}"
  );
  assert!(
    completed.contains("\"completed_at\" >=") && completed.contains("\"completed_at\" <"),
    "{overdue}"
  );
  assert!(
    completed.contains("ORDER BY 8, 9, 10, 6, 1") && completed.contains("LIMIT"),
    "{overdue}"
  );
  assert!(overdue.contains("AT TIME ZONE"), "{overdue}");

  // The snapshot really is read-only: a write inside it would have failed, and the connection is usable after.
  seed(&mut f.conn, &[], &[task("after", None, None, None)]).await;
}

/// Ports the data half of the overdue assertions in `AgendaEndpointsTests` and `WeekAgendaEndpointsTests`: open
/// tasks and tasks completed on the as-of day, due before the range, open ones first, in the dated order.
#[tokio::test]
async fn the_overdue_list_is_ordered_limited_and_counted() {
  let mut f = fixture().await;
  let zone = time_zones::find_iana("America/New_York").unwrap();
  let week = DateRangeWindow::iso_week(date(2026, 10, 28), zone); // Monday 2026-10-26
  let today = DayWindow::create(date(2026, 10, 28), zone);
  let listed = vec![
    task("open date 20", Some(date(2026, 10, 20)), None, None),
    // 03:00Z on the 21st is 23:00 on the 20th in New York: the same local date, and timed goes first.
    task("open at 20 late", None, Some(utc(2026, 10, 21, 3, 0)), None),
    task("open at 20 early", None, Some(utc(2026, 10, 20, 13, 0)), None),
    task("open date 25", Some(date(2026, 10, 25)), None, None),
    task("open date 01", Some(date(2026, 10, 1)), None, None),
    // Completed today: still listed, after every open task.
    task("done today date 02", Some(date(2026, 10, 2)), None, Some(utc(2026, 10, 28, 15, 0))),
    task("done today at 01", None, Some(utc(2026, 10, 1, 12, 0)), Some(today.start())),
  ];
  let unlisted = vec![
    // Overdue as of Wednesday but due within the week: shown on its day, not in the list.
    task("due monday", Some(date(2026, 10, 26)), None, None),
    task("due monday at", None, Some(week.start()), None),
    // Completed before today or after it: not overdue as of today.
    task("done yesterday", Some(date(2026, 10, 2)), None, Some(utc(2026, 10, 27, 15, 0))),
    task("done tomorrow", Some(date(2026, 10, 2)), None, Some(today.end())),
    task("upcoming", Some(date(2026, 11, 20)), None, None),
    task("undated", None, None, None),
    task_of(USER_B, "theirs", Some(date(2026, 10, 2)), None, None),
  ];
  seed(&mut f.conn, &[], &listed).await;
  seed(&mut f.conn, &[], &unlisted).await;

  let overdue = agenda::read(&mut f.conn, OWNER, &week, Some(&today), 20)
    .await
    .unwrap()
    .overdue
    .unwrap();

  assert_eq!(
    task_titles(&overdue.tasks),
    [
      "open date 01",
      "open at 20 early",
      "open at 20 late",
      "open date 20",
      "open date 25",
      "done today at 01",
      "done today date 02",
    ]
  );
  assert_eq!((overdue.total, overdue.open_total), (7, 5));

  // The limit cuts the list, never the totals.
  let limited = agenda::read(&mut f.conn, OWNER, &week, Some(&today), 3)
    .await
    .unwrap()
    .overdue
    .unwrap();
  assert_eq!(task_titles(&limited.tasks), ["open date 01", "open at 20 early", "open at 20 late"]);
  assert_eq!((limited.total, limited.open_total), (7, 5));

  // Ties are broken by id.
  let twins: Vec<TodoTask> = (0..4).map(|_| task("twin", Some(date(2026, 9, 1)), None, None)).collect();
  seed(&mut f.conn, &[], &twins).await;
  let first: Vec<Uuid> = agenda::read(&mut f.conn, OWNER, &week, Some(&today), 4)
    .await
    .unwrap()
    .overdue
    .unwrap()
    .tasks
    .iter()
    .map(|row| row.id)
    .collect();
  assert_eq!(first, sorted(twins.iter().map(TodoTask::id).collect()));
}

/// A range made only of a date a clock change skipped has no length: no timed event overlaps it, and the
/// empty range is never sent to PostgreSQL as a range value.
#[tokio::test]
async fn a_skipped_date_shows_no_timed_events() {
  let mut f = fixture().await;
  let apia = time_zones::find_iana("Pacific/Apia").unwrap();
  let skipped = DateRangeWindow::single_day(date(2011, 12, 30), apia);
  assert_eq!(skipped.start(), skipped.end());
  seed(
    &mut f.conn,
    &[
      timed_event(OWNER, "Across", utc(2011, 12, 29, 0, 0), utc(2012, 1, 2, 0, 0), "Pacific/Apia"),
      all_day_event(OWNER, "All day", date(2011, 12, 30), date(2011, 12, 31)),
    ],
    &[task("Due", Some(date(2011, 12, 30)), None, None)],
  )
  .await;

  let rows = agenda::read(&mut f.conn, OWNER, &skipped, Some(&skipped.days()[0]), 20)
    .await
    .unwrap();

  assert_eq!(rows.timed_events, []);
  assert_eq!(rows.all_day_events.len(), 1);
  assert_eq!(task_titles(&rows.due_tasks), ["Due"]);
}
