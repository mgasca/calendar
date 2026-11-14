//! Ports `Endpoints/WeekAgendaEndpointsTests.cs`: `GET /api/agenda/week`.

use crate::common::*;
use chrono::{Datelike, Days, Weekday};

// The week of Monday 2026-10-26 in New York ends with the fall-back day, Sunday 2026-11-01 (25 hours).
const MONDAY: &str = "2026-10-26";
const WEDNESDAY: &str = "2026-10-28";

fn titles_and_completion(tasks: &[AgendaTaskItem]) -> Vec<(&str, bool)> {
  tasks.iter().map(|task| (task.title.as_str(), task.is_completed)).collect()
}

// ---- request validation ----

#[tokio::test]
async fn get_week_agenda_invalid_input_returns_400_validation_problem() {
  let app = TestApp::start().await;
  let cases = [
    ("timeZone=UTC&today=2026-10-28", "date"),
    ("date=2026-10-28&today=2026-10-28", "timeZone"),
    ("date=2026-10-28&timeZone=UTC", "today"),
    ("date=2026-10-28&timeZone=&today=2026-10-28", "timeZone"),
    ("date=2026-10-28&timeZone=Nowhere/Land&today=2026-10-28", "timeZone"),
    ("date=2026-10-28&timeZone=Eastern%20Standard%20Time&today=2026-10-28", "timeZone"),
    ("date=1899-12-31&timeZone=UTC&today=2026-10-28", "date"),
    ("date=2201-01-01&timeZone=UTC&today=2026-10-28", "date"),
    ("date=2026-10-28&timeZone=UTC&today=1899-12-31", "today"),
    ("date=2026-10-28&timeZone=UTC&today=9999-12-31", "today"),
  ];

  for (query, field) in cases {
    let response = app.client().get(&format!("/api/agenda/week?{query}")).await;

    assert_eq!(response.status, StatusCode::BAD_REQUEST, "{query}");
    assert_eq!(response.media_type(), Some("application/problem+json"), "{query}");
    assert!(response.has_error(field), "{query}: {}", response.value());
  }
}

#[tokio::test]
async fn get_week_agenda_no_parameters_reports_every_missing_one() {
  let app = TestApp::start().await;

  let response = app.client().get("/api/agenda/week").await;

  assert_eq!(response.status, StatusCode::BAD_REQUEST);
  let body = response.value();
  assert_eq!(sorted_keys(&body["errors"]), sorted(vec!["date", "timeZone", "today"]));
}

#[tokio::test]
async fn get_week_agenda_unparsable_date_returns_400() {
  let app = TestApp::start().await;
  let cases = [
    "date=not-a-date&timeZone=UTC&today=2026-10-28",
    "date=2026-10-28&timeZone=UTC&today=2026-13-45",
  ];

  for query in cases {
    let response = app.client().get(&format!("/api/agenda/week?{query}")).await;

    assert_eq!(response.status, StatusCode::BAD_REQUEST, "{query}");
    assert_eq!(response.media_type(), Some("application/problem+json"), "{query}");
  }
}

#[tokio::test]
async fn get_week_agenda_at_the_supported_date_limits_works() {
  let app = TestApp::start().await;

  for (date, week_start) in [("1900-01-01", "1900-01-01"), ("2200-12-31", "2200-12-29")] {
    let week = app.get_week_agenda(date, "Pacific/Kiritimati", date).await;
    assert_eq!(week.week_start, d(week_start), "{date}");
  }
}

// ---- shape ----

#[tokio::test]
async fn get_week_agenda_empty_returns_seven_days_from_monday_with_dst_correct_windows() {
  let app = TestApp::start().await;

  let week = app.get_week_agenda(WEDNESDAY, NEW_YORK, WEDNESDAY).await;

  assert_eq!(week.week_start, d(MONDAY));
  assert_eq!(week.time_zone, NEW_YORK);
  assert_eq!(week.window.start, utc(2026, 10, 26, 4, 0));
  assert_eq!(week.window.end, utc(2026, 11, 2, 5, 0));
  let dates: Vec<NaiveDate> = week.days.iter().map(|day| day.date).collect();
  let expected: Vec<NaiveDate> = (0..7).map(|i| d(MONDAY) + Days::new(i)).collect();
  assert_eq!(dates, expected);
  assert_eq!(week.days[0].date.weekday(), Weekday::Mon);
  assert_eq!(week.days[0].window.start, week.window.start);
  assert_eq!(week.days[6].window.end, week.window.end);
  assert_eq!(week.days[6].window.end - week.days[6].window.start, TimeDelta::hours(25));
  for i in 1..7 {
    assert_eq!(week.days[i].window.start, week.days[i - 1].window.end, "day {i}");
  }

  assert_eq!(week.all_day_events, Vec::new());
  assert!(week.days.iter().all(|day| day.events.is_empty() && day.tasks.is_empty()));
  assert_eq!(week.overdue, Some(Vec::new()));
}

#[tokio::test]
async fn get_week_agenda_uses_camel_case_property_names_and_always_writes_overdue() {
  let app = TestApp::start().await;
  app
    .seed(
      &[
        timed("E", utc(2026, 10, 27, 14, 0), utc(2026, 10, 27, 15, 0)),
        all_day("A", MONDAY, "2026-10-27"),
      ],
      &[on("T", WEDNESDAY)],
    )
    .await;

  let root = app
    .client()
    .get(&format!("/api/agenda/week?date={WEDNESDAY}&timeZone={NEW_YORK}&today={WEDNESDAY}"))
    .await
    .success()
    .value();
  let past_root = app
    .client()
    .get(&format!("/api/agenda/week?date=2026-10-19&timeZone={NEW_YORK}&today={WEDNESDAY}"))
    .await
    .success()
    .value();

  assert_eq!(
    sorted_keys(&root),
    sorted(vec![
      "weekStart",
      "timeZone",
      "window",
      "allDayEvents",
      "days",
      "overdue",
      "overdueTotal",
      "overdueOpenTotal"
    ])
  );
  assert_eq!(root["weekStart"], json!(MONDAY));
  assert_eq!(root["days"].as_array().expect("the days").len(), 7);
  assert_eq!(sorted_keys(&root["days"][0]), sorted(vec!["date", "window", "events", "tasks"]));
  assert!(
    root["days"][1]["events"][0]
      .as_object()
      .expect("an event")
      .contains_key("endsAfterDay")
  );
  assert_eq!(root["days"][2]["tasks"][0]["title"], json!("T"));
  assert_eq!(root["allDayEvents"][0]["startDate"], json!(MONDAY));
  let past = past_root.as_object().expect("a JSON object");
  assert!(past.contains_key("overdue"));
  assert!(past["overdue"].is_null());
}

#[tokio::test]
async fn get_week_agenda_any_date_of_the_week_snaps_to_its_monday() {
  let app = TestApp::start().await;
  let dates = [
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
  ];

  for date in dates {
    let week = app.get_week_agenda(date, NEW_YORK, WEDNESDAY).await;

    assert_eq!(week.week_start, d(MONDAY), "{date}");
    assert_eq!(week.days[0].date, d(MONDAY), "{date}");
  }
}

#[tokio::test]
async fn get_week_agenda_across_a_year_boundary_starts_in_december() {
  let app = TestApp::start().await;

  let week = app.get_week_agenda("2026-01-01", "UTC", "2026-01-01").await;

  assert_eq!(week.week_start, d("2025-12-29"));
  assert_eq!(week.days.last().expect("a last day").date, d("2026-01-04"));
}

#[tokio::test]
async fn get_week_agenda_echoes_the_canonical_zone_id() {
  let app = TestApp::start().await;

  assert_eq!(app.get_week_agenda(WEDNESDAY, "US/Eastern", WEDNESDAY).await.time_zone, NEW_YORK);
}

// ---- events ----

#[tokio::test]
async fn events_are_placed_on_each_day_they_touch_with_day_relative_flags_and_ordered_by_start_then_title() {
  let app = TestApp::start().await;
  app
    .seed(
      &[
        timed("overnight Tue-Wed", utc(2026, 10, 28, 2, 0), utc(2026, 10, 28, 10, 0)), // 22:00 Tue - 06:00 Wed
        timed("beta", utc(2026, 10, 28, 15, 0), utc(2026, 10, 28, 16, 0)),
        timed("Alpha", utc(2026, 10, 28, 15, 0), utc(2026, 10, 28, 15, 30)),
        timed("from last week", utc(2026, 10, 25, 12, 0), utc(2026, 10, 26, 12, 0)),
        timed("into next week", utc(2026, 11, 2, 4, 0), utc(2026, 11, 2, 6, 0)), // 23:00 EST Sun
        timed("next week", utc(2026, 11, 2, 5, 0), utc(2026, 11, 2, 6, 0)),
        timed("last week", utc(2026, 10, 25, 12, 0), utc(2026, 10, 26, 4, 0)),
      ],
      &[],
    )
    .await;

  let week = app.get_week_agenda(WEDNESDAY, NEW_YORK, WEDNESDAY).await;

  assert_eq!(week.days[0].events.len(), 1);
  let monday = &week.days[0].events[0];
  assert_eq!(monday.title, "from last week");
  assert!(monday.starts_before_day);
  assert!(!monday.ends_after_day);

  assert_eq!(week.days[1].events.len(), 1);
  let tuesday = &week.days[1].events[0];
  assert_eq!(tuesday.title, "overnight Tue-Wed");
  assert_eq!((tuesday.starts_before_day, tuesday.ends_after_day), (false, true));

  assert_eq!(titles(&week.days[2].events), ["overnight Tue-Wed", "Alpha", "beta"]);
  assert_eq!(
    (week.days[2].events[0].starts_before_day, week.days[2].events[0].ends_after_day),
    (true, false)
  );
  assert!(
    week.days[2].events[1..]
      .iter()
      .all(|event| !event.starts_before_day && !event.ends_after_day)
  );

  assert_eq!(week.days[3].events, Vec::new());
  assert_eq!(titles(&week.days[6].events), ["into next week"]);
  assert!(
    !week
      .days
      .iter()
      .flat_map(|day| &day.events)
      .any(|event| event.title == "next week" || event.title == "last week")
  );
}

#[tokio::test]
async fn all_day_events_are_returned_once_per_week_ordered_by_start_date_then_title_then_id() {
  let app = TestApp::start().await;
  let twin_a = all_day("Twin", "2026-10-27", "2026-10-28");
  let twin_b = all_day("twin", "2026-10-27", "2026-10-28");
  app
    .seed(
      &[
        all_day("conference", "2026-10-27", "2026-10-30"),
        twin_a.clone(),
        twin_b.clone(),
        all_day("trip from last week", "2026-10-24", "2026-10-27"),
        all_day("into next week", "2026-11-01", "2026-11-04"),
        all_day("ended last week", "2026-10-20", MONDAY),
        all_day("next week", "2026-11-02", "2026-11-03"),
        timed("timed", utc(2026, 10, 27, 14, 0), utc(2026, 10, 27, 15, 0)),
      ],
      &[],
    )
    .await;

  let week = app.get_week_agenda(WEDNESDAY, NEW_YORK, WEDNESDAY).await;

  let mut twins = vec![twin_a.id(), twin_b.id()];
  twins.sort_unstable();
  assert_eq!(
    sorted(titles(&week.all_day_events)),
    sorted(vec!["trip from last week", "conference", "Twin", "twin", "into next week"])
  );
  assert_eq!(titles(&week.all_day_events[..2]), ["trip from last week", "conference"]);
  let twin_ids: Vec<Uuid> = week.all_day_events[2..4].iter().map(|event| event.id).collect();
  assert_eq!(twin_ids, twins);
  assert_eq!(week.all_day_events.last().expect("a last event").title, "into next week");
  assert_eq!(week.all_day_events[0].start_date, d("2026-10-24"));
  assert_eq!(titles(&week.days[1].events), ["timed"]);
}

// ---- tasks per day ----

#[tokio::test]
async fn tasks_are_listed_on_their_due_day_timed_first_by_instant_then_date_only_by_title_including_completed() {
  let app = TestApp::start().await;
  app
    .seed(
      &[],
      &[
        on("zeta", WEDNESDAY),
        at("late", utc(2026, 10, 28, 21, 0)),
        done("Alpha", WEDNESDAY, utc(2026, 10, 27, 9, 0)),
        at("early", utc(2026, 10, 28, 9, 0)),
        at("late Sunday EST", utc(2026, 11, 2, 4, 30)), // 23:30 Sunday after the fall back
        at("first instant", utc(2026, 10, 26, 4, 0)),
        on("next Monday", "2026-11-02"),
        task("undated", None, None),
      ],
    )
    .await;

  let week = app.get_week_agenda(WEDNESDAY, NEW_YORK, WEDNESDAY).await;

  assert_eq!(titles(&week.days[0].tasks), ["first instant"]);
  assert_eq!(titles(&week.days[2].tasks), ["early", "late", "Alpha", "zeta"]);
  let alphas: Vec<&AgendaTaskItem> = week.days[2].tasks.iter().filter(|task| task.title == "Alpha").collect();
  assert_eq!(alphas.len(), 1);
  assert!(alphas[0].is_completed);
  assert_eq!(titles(&week.days[6].tasks), ["late Sunday EST"]);
  assert_eq!(week.days.iter().map(|day| day.tasks.len()).sum::<usize>(), 6);
}

#[tokio::test]
async fn tasks_in_a_past_week_show_open_and_completed_and_there_is_no_overdue_list() {
  let app = TestApp::start().await;
  app
    .seed(
      &[],
      &[
        done("done on time", "2026-10-14", utc(2026, 10, 14, 15, 0)),
        on("never done", "2026-10-14"),
        done("done late", "2026-10-12", utc(2026, 10, 28, 15, 0)),
        on("older", "2026-10-01"),
      ],
    )
    .await;

  let week = app.get_week_agenda("2026-10-14", NEW_YORK, WEDNESDAY).await;

  assert_eq!(week.week_start, d("2026-10-12"));
  assert_eq!(
    titles_and_completion(&week.days[2].tasks),
    [("done on time", true), ("never done", false)]
  );
  assert_eq!(titles_and_completion(&week.days[0].tasks), [("done late", true)]);
  assert_eq!(week.overdue, None);
}

// ---- overdue ----

#[tokio::test]
async fn overdue_is_null_only_when_the_whole_week_is_before_today() {
  let app = TestApp::start().await;
  let cases = [
    ("2026-10-19", "2026-10-26", true),  // the week ended yesterday
    ("2026-10-19", "2026-10-25", false), // today is its Sunday
    ("2026-10-19", "2026-10-19", false), // today is its Monday
    ("2026-10-26", "2026-10-19", false), // a future week
  ];

  for (date, today, is_null) in cases {
    let week = app.get_week_agenda(date, NEW_YORK, today).await;

    assert_eq!(week.overdue.is_none(), is_null, "{date} as of {today}");
  }
}

#[tokio::test]
async fn overdue_in_the_current_week_has_only_tasks_due_before_monday_and_never_repeats_a_day_task() {
  let app = TestApp::start().await;
  app
    .seed(
      &[],
      &[
        on("last week, open", "2026-10-20"),
        at("timed Sunday night, open", utc(2026, 10, 26, 3, 59)),
        done("last week, done today", "2026-10-19", utc(2026, 10, 28, 15, 0)),
        done("last week, done yesterday", "2026-10-19", utc(2026, 10, 27, 15, 0)),
        on("Monday, open", MONDAY),
        at("Monday first instant, open", utc(2026, 10, 26, 4, 0)),
        on("Tuesday, open", "2026-10-27"),
        on("today, open", WEDNESDAY),
      ],
    )
    .await;

  let week = app.get_week_agenda(WEDNESDAY, NEW_YORK, WEDNESDAY).await;

  let overdue = week.overdue.as_ref().expect("an overdue list");
  assert_eq!(
    titles(overdue),
    ["last week, open", "timed Sunday night, open", "last week, done today"]
  );
  let done_today: Vec<&AgendaTaskItem> = overdue.iter().filter(|task| task.title == "last week, done today").collect();
  assert_eq!(done_today.len(), 1);
  assert!(done_today[0].is_completed);
  let in_days: Vec<Uuid> = week.days.iter().flat_map(|day| &day.tasks).map(|task| task.id).collect();
  assert!(!overdue.iter().any(|task| in_days.contains(&task.id)));
  assert_eq!(titles(&week.days[0].tasks), ["Monday first instant, open", "Monday, open"]);
  assert_eq!(titles(&week.days[1].tasks), ["Tuesday, open"]);
}

#[tokio::test]
async fn tasks_in_week_days_and_overdue_use_priority_after_deadline() {
  let app = TestApp::start().await;
  app
    .seed(
      &[],
      &[
        with_priority("old high", Some("2026-10-24"), None, "high"),
        with_priority("older low", Some("2026-10-23"), None, "low"),
        with_priority("due date low", Some(MONDAY), None, "low"),
        with_priority("due date high", Some(MONDAY), None, "high"),
        with_priority("same instant medium", None, Some(utc(2026, 10, 26, 12, 0)), "medium"),
        with_priority("same instant high z", None, Some(utc(2026, 10, 26, 12, 0)), "high"),
        with_priority("same instant high a", None, Some(utc(2026, 10, 26, 12, 0)), "high"),
      ],
    )
    .await;

  let week = app.get_week_agenda(WEDNESDAY, NEW_YORK, WEDNESDAY).await;

  assert_eq!(titles(week.overdue.as_ref().expect("an overdue list")), ["older low", "old high"]);
  assert_eq!(
    titles(&week.days[0].tasks),
    [
      "same instant high a",
      "same instant high z",
      "same instant medium",
      "due date high",
      "due date low"
    ]
  );
}

#[tokio::test]
async fn overdue_in_a_future_week_is_the_full_overdue_list_as_of_today() {
  let app = TestApp::start().await;
  app
    .seed(
      &[],
      &[
        on("last week, open", "2026-10-20"),
        on("this Monday, open", MONDAY),
        at("timed yesterday, open", utc(2026, 10, 27, 20, 0)),
        done("this Monday, done today", MONDAY, utc(2026, 10, 28, 15, 0)),
        done("this Monday, done yesterday", MONDAY, utc(2026, 10, 27, 15, 0)),
        on("today, open", WEDNESDAY),
        at("timed later today, open", utc(2026, 10, 28, 20, 0)),
        on("Friday, not yet due", "2026-10-30"),
        on("in the week", "2026-11-03"),
      ],
    )
    .await;

  let week = app.get_week_agenda("2026-11-04", NEW_YORK, WEDNESDAY).await;

  assert_eq!(week.week_start, d("2026-11-02"));
  assert_eq!(
    titles(week.overdue.as_ref().expect("an overdue list")),
    [
      "last week, open",
      "this Monday, open",
      "timed yesterday, open",
      "this Monday, done today",
    ]
  );
  assert_eq!(titles(&week.days[1].tasks), ["in the week"]);
}

#[tokio::test]
async fn overdue_in_the_current_week_when_today_is_monday_matches_the_day_agenda() {
  let app = TestApp::start().await;
  app
    .seed(
      &[],
      &[
        on("b", "2026-10-20"),
        at("a", utc(2026, 10, 22, 22, 0)),
        done("done today", "2026-10-21", utc(2026, 10, 26, 15, 0)),
        done("done before", "2026-10-21", utc(2026, 10, 25, 15, 0)),
      ],
    )
    .await;

  let week = app.get_week_agenda(WEDNESDAY, NEW_YORK, MONDAY).await;
  let day = app.get_agenda(MONDAY, NEW_YORK).await;

  let overdue = week.overdue.expect("an overdue list");
  assert_eq!(overdue, day.tasks.overdue);
  assert_eq!(overdue.len(), 3);
}
