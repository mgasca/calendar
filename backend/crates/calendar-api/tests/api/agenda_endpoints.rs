//! Ports `Endpoints/AgendaEndpointsTests.cs`: `GET /api/agenda/day`.

use crate::common::*;

fn task_ids(tasks: &[AgendaTaskItem]) -> Vec<Uuid> {
  tasks.iter().map(|task| task.id).collect()
}

// ---- request validation ----

#[tokio::test]
async fn get_day_agenda_invalid_input_returns_400_validation_problem() {
  let app = TestApp::start().await;
  let cases = [
    ("", "date"),
    ("timeZone=America/New_York", "date"),
    ("date=2026-10-26", "timeZone"),
    ("date=2026-10-26&timeZone=", "timeZone"),
    ("date=2026-10-26&timeZone=Nowhere/Land", "timeZone"),
    ("date=2026-10-26&timeZone=America", "timeZone"),
    ("date=2026-10-26&timeZone=Eastern%20Standard%20Time", "timeZone"),
    ("date=2026-10-26&timeZone=America//New_York", "timeZone"),
    ("date=0001-01-01&timeZone=UTC", "date"),
    ("date=1899-12-31&timeZone=UTC", "date"),
    ("date=2201-01-01&timeZone=UTC", "date"),
    ("date=9999-12-31&timeZone=Pacific/Kiritimati", "date"),
  ];

  for (query, field) in cases {
    let response = app.client().get(&format!("/api/agenda/day?{query}")).await;

    assert_eq!(response.status, StatusCode::BAD_REQUEST, "{query}");
    assert_eq!(response.media_type(), Some("application/problem+json"), "{query}");
    assert!(response.has_error(field), "{query}: {}", response.value());
  }
}

#[tokio::test]
async fn get_day_agenda_unparsable_date_returns_400() {
  let app = TestApp::start().await;

  for query in ["date=not-a-date&timeZone=UTC", "date=2026-13-45&timeZone=UTC"] {
    let response = app.client().get(&format!("/api/agenda/day?{query}")).await;

    assert_eq!(response.status, StatusCode::BAD_REQUEST, "{query}");
    assert_eq!(response.media_type(), Some("application/problem+json"), "{query}");
  }
}

#[tokio::test]
async fn get_day_agenda_at_the_supported_date_limits_works() {
  let app = TestApp::start().await;

  for date in ["1900-01-01", "2200-12-31"] {
    let agenda = app.get_agenda(date, "Pacific/Kiritimati").await;
    assert_eq!(agenda.date, d(date));
  }
}

#[tokio::test]
async fn get_day_agenda_accepts_legacy_aliases_and_etc_zones_echoing_the_canonical_id() {
  let app = TestApp::start().await;
  let cases = [
    ("Asia/Calcutta", "Asia/Kolkata"),
    ("US/Eastern", "America/New_York"),
    ("Etc/GMT%2B5", "Etc/GMT+5"),
  ];

  for (requested, canonical) in cases {
    let agenda: DayAgendaResponse = app
      .client()
      .get(&format!("/api/agenda/day?date=2026-10-26&timeZone={requested}"))
      .await
      .success()
      .json();

    assert_eq!(agenda.time_zone, canonical, "{requested}");
  }
}

// ---- shape ----

#[tokio::test]
async fn get_day_agenda_empty_returns_window_and_empty_lists() {
  let app = TestApp::start().await;

  let agenda = app.get_agenda("2026-10-26", NEW_YORK).await;

  assert_eq!(agenda.date, date(2026, 10, 26));
  assert_eq!(agenda.time_zone, NEW_YORK);
  assert_eq!(agenda.window.start, utc(2026, 10, 26, 4, 0));
  assert_eq!(agenda.window.end, utc(2026, 10, 27, 4, 0));
  assert_eq!(agenda.all_day_events, Vec::new());
  assert_eq!(agenda.events, Vec::new());
  assert_eq!(agenda.tasks.overdue, Vec::new());
  assert_eq!(agenda.tasks.due_today, Vec::new());
}

#[tokio::test]
async fn get_day_agenda_uses_camel_case_property_names() {
  let app = TestApp::start().await;
  app
    .seed(
      &[
        timed("E", utc(2026, 10, 26, 14, 0), utc(2026, 10, 26, 15, 0)),
        all_day("A", "2026-10-26", "2026-10-27"),
      ],
      &[on("T", "2026-10-26")],
    )
    .await;

  let root = app
    .client()
    .get("/api/agenda/day?date=2026-10-26&timeZone=America/New_York")
    .await
    .success()
    .value();

  assert_eq!(
    sorted_keys(&root),
    sorted(vec!["date", "timeZone", "window", "allDayEvents", "events", "tasks"])
  );
  assert_eq!(root["date"], json!("2026-10-26"));
  assert!(root["events"][0].as_object().expect("an event").contains_key("startsBeforeDay"));
  assert_eq!(root["allDayEvents"][0]["startDate"], json!("2026-10-26"));
  assert_eq!(
    sorted_keys(&root["tasks"]),
    sorted(vec!["overdue", "overdueTotal", "overdueOpenTotal", "dueToday"])
  );
}

#[tokio::test]
async fn get_day_agenda_echoes_the_canonical_zone_id() {
  let app = TestApp::start().await;

  assert_eq!(app.get_agenda("2026-10-26", "utc").await.time_zone, "UTC");
}

// ---- timed events ----

#[tokio::test]
async fn events_overnight_span_appears_on_both_days_with_continuation_flags() {
  let app = TestApp::start().await;
  // 23:00 on the 25th to 06:00 on the 26th, New York (EDT, -4).
  app
    .seed(&[timed("Night shift", utc(2026, 10, 26, 3, 0), utc(2026, 10, 26, 10, 0))], &[])
    .await;

  let before = app.get_agenda("2026-10-25", NEW_YORK).await;
  let today = app.get_agenda("2026-10-26", NEW_YORK).await;
  let after = app.get_agenda("2026-10-27", NEW_YORK).await;

  assert_eq!(before.events.len(), 1);
  let first = &before.events[0];
  assert!(!first.starts_before_day);
  assert!(first.ends_after_day);

  assert_eq!(today.events.len(), 1);
  let second = &today.events[0];
  assert!(second.starts_before_day);
  assert!(!second.ends_after_day);
  assert_eq!(second.start, utc(2026, 10, 26, 3, 0));
  assert_eq!(second.end, utc(2026, 10, 26, 10, 0));
  assert_eq!(second.time_zone, NEW_YORK);

  assert_eq!(after.events, Vec::new());
}

#[tokio::test]
async fn events_spanning_the_whole_day_has_both_flags() {
  let app = TestApp::start().await;
  app
    .seed(&[timed("Conference", utc(2026, 10, 24, 12, 0), utc(2026, 10, 29, 12, 0))], &[])
    .await;

  let agenda = app.get_agenda("2026-10-26", NEW_YORK).await;

  assert_eq!(agenda.events.len(), 1);
  assert!(agenda.events[0].starts_before_day);
  assert!(agenda.events[0].ends_after_day);
}

#[tokio::test]
async fn events_touching_the_window_edges_are_excluded() {
  let app = TestApp::start().await;
  // New York 2026-10-26 is [04:00Z, 2026-10-27T04:00Z).
  app
    .seed(
      &[
        timed("ends at window start", utc(2026, 10, 26, 3, 0), utc(2026, 10, 26, 4, 0)),
        timed("starts at window end", utc(2026, 10, 27, 4, 0), utc(2026, 10, 27, 5, 0)),
        timed(
          "ends a second into the day",
          utc(2026, 10, 26, 3, 0),
          utc(2026, 10, 26, 4, 0) + TimeDelta::seconds(1),
        ),
        timed(
          "starts a second before the end",
          utc(2026, 10, 27, 4, 0) - TimeDelta::seconds(1),
          utc(2026, 10, 27, 5, 0),
        ),
      ],
      &[],
    )
    .await;

  let agenda = app.get_agenda("2026-10-26", NEW_YORK).await;

  assert_eq!(
    titles(&agenda.events),
    ["ends a second into the day", "starts a second before the end"]
  );
}

#[tokio::test]
async fn events_on_dst_fall_back_day_use_the_twenty_five_hour_window() {
  let app = TestApp::start().await;
  // New York 2026-11-01: [04:00Z, 2026-11-02T05:00Z), 25 hours.
  app
    .seed(
      &[
        timed("late on the 31st", utc(2026, 11, 1, 3, 30), utc(2026, 11, 1, 3, 59)),
        timed("first minute", utc(2026, 11, 1, 4, 0), utc(2026, 11, 1, 4, 1)),
        timed("23:30 EST on the 1st", utc(2026, 11, 2, 4, 30), utc(2026, 11, 2, 4, 45)),
        timed("00:00 EST on the 2nd", utc(2026, 11, 2, 5, 0), utc(2026, 11, 2, 6, 0)),
      ],
      &[],
    )
    .await;

  let nov1 = app.get_agenda("2026-11-01", NEW_YORK).await;

  assert_eq!(nov1.window.start, utc(2026, 11, 1, 4, 0));
  assert_eq!(nov1.window.end, utc(2026, 11, 2, 5, 0));
  assert_eq!(titles(&nov1.events), ["first minute", "23:30 EST on the 1st"]);
  assert_eq!(
    titles(&app.get_agenda("2026-11-02", NEW_YORK).await.events),
    ["00:00 EST on the 2nd"]
  );
  assert_eq!(titles(&app.get_agenda("2026-10-31", NEW_YORK).await.events), ["late on the 31st"]);
}

#[tokio::test]
async fn events_are_sorted_by_start_then_title() {
  let app = TestApp::start().await;
  app
    .seed(
      &[
        timed("beta", utc(2026, 10, 26, 15, 0), utc(2026, 10, 26, 16, 0)),
        timed("Zulu", utc(2026, 10, 26, 14, 0), utc(2026, 10, 26, 16, 0)),
        timed("alpha", utc(2026, 10, 26, 15, 0), utc(2026, 10, 26, 15, 30)),
        timed("early", utc(2026, 10, 26, 5, 0), utc(2026, 10, 26, 6, 0)),
      ],
      &[],
    )
    .await;

  let agenda = app.get_agenda("2026-10-26", NEW_YORK).await;

  assert_eq!(titles(&agenda.events), ["early", "Zulu", "alpha", "beta"]);
}

// ---- all-day events ----

#[tokio::test]
async fn all_day_events_multi_day_cover_start_through_the_day_before_the_exclusive_end() {
  let app = TestApp::start().await;
  app.seed(&[all_day("Trip", "2026-10-24", "2026-10-27")], &[]).await;

  assert_eq!(app.get_agenda("2026-10-23", NEW_YORK).await.all_day_events, Vec::new());
  assert_eq!(app.get_agenda("2026-10-24", NEW_YORK).await.all_day_events.len(), 1);
  assert_eq!(app.get_agenda("2026-10-25", NEW_YORK).await.all_day_events.len(), 1);
  assert_eq!(app.get_agenda("2026-10-26", NEW_YORK).await.all_day_events.len(), 1);
  assert_eq!(app.get_agenda("2026-10-27", NEW_YORK).await.all_day_events, Vec::new()); // end is exclusive
}

#[tokio::test]
async fn all_day_events_are_floating_the_same_date_in_every_zone() {
  let app = TestApp::start().await;
  app.seed(&[all_day("Holiday", "2026-10-26", "2026-10-27")], &[]).await;

  for zone in ["Pacific/Kiritimati", "UTC", "Pacific/Pago_Pago"] {
    let agenda = app.get_agenda("2026-10-26", zone).await;
    assert_eq!(agenda.all_day_events.len(), 1, "{zone}");
    let item = &agenda.all_day_events[0];
    assert_eq!(item.start_date, date(2026, 10, 26), "{zone}");
    assert_eq!(item.end_date, date(2026, 10, 27), "{zone}");
    assert_eq!(app.get_agenda("2026-10-27", zone).await.all_day_events, Vec::new(), "{zone}");
  }
}

#[tokio::test]
async fn all_day_events_are_sorted_by_start_date_then_title_and_not_mixed_with_timed_events() {
  let app = TestApp::start().await;
  app
    .seed(
      &[
        all_day("b", "2026-10-26", "2026-10-27"),
        all_day("a", "2026-10-26", "2026-10-28"),
        all_day("older", "2026-10-20", "2026-10-30"),
        timed("timed", utc(2026, 10, 26, 14, 0), utc(2026, 10, 26, 15, 0)),
      ],
      &[],
    )
    .await;

  let agenda = app.get_agenda("2026-10-26", NEW_YORK).await;

  assert_eq!(titles(&agenda.all_day_events), ["older", "a", "b"]);
  assert_eq!(titles(&agenda.events), ["timed"]);
}

// ---- tasks ----

#[tokio::test]
async fn tasks_due_today_includes_date_only_and_timed_in_window_but_not_undated_or_future() {
  let app = TestApp::start().await;
  app
    .seed(
      &[],
      &[
        on("date today", "2026-10-26"),
        at("timed today", utc(2026, 10, 26, 18, 0)),
        at("timed at window start", utc(2026, 10, 26, 4, 0)),
        at("timed at window end", utc(2026, 10, 27, 4, 0)),
        on("tomorrow", "2026-10-27"),
        task("undated", None, None),
      ],
    )
    .await;

  let agenda = app.get_agenda("2026-10-26", NEW_YORK).await;

  assert_eq!(
    titles(&agenda.tasks.due_today),
    ["timed at window start", "timed today", "date today"]
  );
  assert_eq!(agenda.tasks.overdue, Vec::new());
}

#[tokio::test]
async fn tasks_overdue_open_ones_and_ones_completed_today_are_shown_but_not_completed_earlier() {
  let app = TestApp::start().await;
  app
    .seed(
      &[],
      &[
        on("open, due last week", "2026-10-19"),
        at("open, timed yesterday", utc(2026, 10, 25, 20, 0)),
        done("done this morning", "2026-10-20", utc(2026, 10, 26, 12, 0)),
        done("done at window start", "2026-10-20", utc(2026, 10, 26, 4, 0)),
        done("done yesterday", "2026-10-20", utc(2026, 10, 26, 3, 59)),
        done("done at window end", "2026-10-20", utc(2026, 10, 27, 4, 0)),
        completed_task("timed, done today", None, utc(2026, 10, 26, 6, 0), Some(utc(2026, 10, 24, 15, 0))),
        at("timed just before window", utc(2026, 10, 26, 3, 59)),
      ],
    )
    .await;

  let overdue = app.get_agenda("2026-10-26", NEW_YORK).await.tasks.overdue;

  assert!(overdue.len() >= 3, "{overdue:?}");
  assert_eq!(
    titles(&overdue[..3]),
    ["open, due last week", "open, timed yesterday", "timed just before window"]
  );
  assert!(overdue[3..].iter().all(|task| task.is_completed));
  let completed: Vec<&str> = overdue
    .iter()
    .filter(|task| task.is_completed)
    .map(|task| task.title.as_str())
    .collect();
  assert_eq!(
    sorted(completed),
    sorted(vec!["done this morning", "done at window start", "timed, done today"])
  );
}

#[tokio::test]
async fn tasks_due_today_stay_visible_when_completed() {
  let app = TestApp::start().await;
  app
    .seed(
      &[],
      &[
        done("done earlier", "2026-10-26", utc(2026, 10, 24, 0, 0)),
        done("done today", "2026-10-26", utc(2026, 10, 26, 13, 0)),
        completed_task("done timed", None, utc(2026, 10, 26, 13, 0), Some(utc(2026, 10, 26, 14, 0))),
      ],
    )
    .await;

  let due_today = app.get_agenda("2026-10-26", NEW_YORK).await.tasks.due_today;

  assert_eq!(titles(&due_today), ["done timed", "done earlier", "done today"]);
  assert!(due_today.iter().all(|task| task.is_completed));
}

#[tokio::test]
async fn tasks_overdue_are_ordered_oldest_due_first_across_date_and_instant_dues() {
  let app = TestApp::start().await;
  // New York local dates: instants are converted to the viewer's zone before comparing with dates.
  app
    .seed(
      &[],
      &[
        on("c: date 10-24", "2026-10-24"),
        on("a: date 10-20", "2026-10-20"),
        on("b2: date 10-22", "2026-10-22"),
        at("b1: timed 10-22 18:00 local", utc(2026, 10, 22, 22, 0)),
        at("d: timed 10-23 23:30 local", utc(2026, 10, 24, 3, 30)),
        at("e: timed 10-25 00:30 local", utc(2026, 10, 25, 4, 30)),
      ],
    )
    .await;

  let overdue = app.get_agenda("2026-10-26", NEW_YORK).await.tasks.overdue;

  assert_eq!(
    titles(&overdue),
    [
      "a: date 10-20",
      "b1: timed 10-22 18:00 local",
      "b2: date 10-22",
      "d: timed 10-23 23:30 local",
      "c: date 10-24",
      "e: timed 10-25 00:30 local",
    ]
  );
}

#[tokio::test]
async fn tasks_overdue_orders_timed_before_date_only_on_the_same_day() {
  let app = TestApp::start().await;
  app
    .seed(
      &[],
      &[
        with_priority("zeta", Some("2026-10-20"), None, "low"),
        with_priority("later high", Some("2026-10-21"), None, "high"),
        with_priority("date medium", Some("2026-10-20"), None, "medium"),
        with_priority("date high", Some("2026-10-20"), None, "high"),
        with_priority("timed medium", None, Some(utc(2026, 10, 20, 12, 0)), "medium"),
        with_priority("timed low", None, Some(utc(2026, 10, 20, 12, 0)), "low"),
        with_priority("timed high", None, Some(utc(2026, 10, 20, 12, 0)), "high"),
      ],
    )
    .await;

  let overdue = app.get_agenda("2026-10-26", NEW_YORK).await.tasks.overdue;

  assert_eq!(overdue.len(), 7);
  assert!(overdue[..3].iter().all(|task| task.due_at.is_some()));
  assert!(overdue[3..6].iter().all(|task| task.due_date == Some(date(2026, 10, 20))));
  assert_eq!(overdue[6].title, "later high");
}

#[tokio::test]
async fn tasks_due_today_deadline_precedes_priority_and_priority_precedes_title() {
  let app = TestApp::start().await;
  app
    .seed(
      &[],
      &[
        with_priority("date zeta", Some("2026-10-26"), None, "low"),
        with_priority("date medium", Some("2026-10-26"), None, "medium"),
        with_priority("date high", Some("2026-10-26"), None, "high"),
        with_priority("late high", None, Some(utc(2026, 10, 26, 21, 0)), "high"),
        with_priority("early low", None, Some(utc(2026, 10, 26, 9, 0)), "low"),
        with_priority("early medium", None, Some(utc(2026, 10, 26, 9, 0)), "medium"),
        with_priority("early high z", None, Some(utc(2026, 10, 26, 9, 0)), "high"),
        with_priority("early high a", None, Some(utc(2026, 10, 26, 9, 0)), "high"),
      ],
    )
    .await;

  let due_today = app.get_agenda("2026-10-26", NEW_YORK).await.tasks.due_today;

  assert_eq!(
    titles(&due_today),
    [
      "early high a",
      "early high z",
      "early medium",
      "early low",
      "late high",
      "date high",
      "date medium",
      "date zeta"
    ]
  );
}

#[tokio::test]
async fn tasks_date_only_dues_are_floating_the_same_date_in_every_zone() {
  let app = TestApp::start().await;
  app.seed(&[], &[on("floating", "2026-10-26")]).await;

  for zone in ["Pacific/Kiritimati", "UTC", "Pacific/Pago_Pago"] {
    assert_eq!(app.get_agenda("2026-10-26", zone).await.tasks.due_today.len(), 1, "{zone}");
    assert_eq!(app.get_agenda("2026-10-27", zone).await.tasks.overdue.len(), 1, "{zone}");
  }
}

#[tokio::test]
async fn tasks_timed_due_shifts_day_with_the_viewers_zone() {
  let app = TestApp::start().await;
  // 02:00Z on the 27th is 22:00 on the 26th in New York but already the 27th in UTC.
  app.seed(&[], &[at("late night", utc(2026, 10, 27, 2, 0))]).await;

  assert_eq!(app.get_agenda("2026-10-26", NEW_YORK).await.tasks.due_today.len(), 1);
  assert_eq!(app.get_agenda("2026-10-26", "UTC").await.tasks.due_today, Vec::new());
  assert_eq!(app.get_agenda("2026-10-27", "UTC").await.tasks.due_today.len(), 1);
}

#[tokio::test]
async fn tasks_completing_an_overdue_task_through_the_api_keeps_it_visible_as_done() {
  let app = TestApp::start().await;
  // The flow the Today view relies on: tick an overdue task and it must not vanish.
  let late = on("late", "2026-10-20");
  app.seed(&[], std::slice::from_ref(&late)).await;
  app.clock.set(utc(2026, 10, 26, 15, 0));

  let _ = app.client().post(&format!("/api/tasks/{}/complete", late.id())).await.success();

  let overdue = app.get_agenda("2026-10-26", NEW_YORK).await.tasks.overdue;
  assert_eq!(overdue.len(), 1);
  assert!(overdue[0].is_completed);
  assert_eq!(app.get_agenda("2026-10-27", NEW_YORK).await.tasks.overdue, Vec::new());
}

#[tokio::test]
async fn overdue_is_capped_and_matches_task_list_order_in_day_and_week() {
  let app = TestApp::start().await;
  let mut tasks: Vec<TodoTask> = (0..25_u32)
    .map(|i| task(&format!("open {i}"), Some(date(2026, 10, 1 + i % 5)), None))
    .collect();
  tasks.push(done("done today", "2026-10-01", utc(2026, 10, 26, 12, 0)));
  app.seed(&[], &tasks).await;

  let day = app.get_agenda("2026-10-26", NEW_YORK).await;
  let week = app.get_week_agenda("2026-10-26", NEW_YORK, "2026-10-26").await;
  let page: TaskPage = app
    .client()
    .get("/api/tasks?view=overdue&today=2026-10-26&timeZone=America/New_York&limit=20")
    .await
    .success()
    .json();

  assert_eq!(day.tasks.overdue.len(), 20);
  assert_eq!(day.tasks.overdue_total, 26);
  assert_eq!(day.tasks.overdue_open_total, 25);
  let page_ids: Vec<Uuid> = page.items.iter().map(|task| task.id).collect();
  assert_eq!(task_ids(&day.tasks.overdue), page_ids);
  assert_eq!(task_ids(&week.overdue.expect("an overdue list")), task_ids(&day.tasks.overdue));
  assert_eq!(week.overdue_total, 26);
  assert_eq!(week.overdue_open_total, 25);
}

#[tokio::test]
async fn overdue_completed_today_follows_open_tasks_even_when_due_earlier() {
  let app = TestApp::start().await;
  app
    .seed(
      &[],
      &[on("open", "2026-10-20"), done("completed", "2026-10-01", utc(2026, 10, 26, 12, 0))],
    )
    .await;

  let day = app.get_agenda("2026-10-26", NEW_YORK).await;
  let week = app.get_week_agenda("2026-10-26", NEW_YORK, "2026-10-26").await;

  assert_eq!(titles(&day.tasks.overdue), ["open", "completed"]);
  assert_eq!(day.tasks.overdue_total, 2);
  assert_eq!(day.tasks.overdue_open_total, 1);
  assert_eq!(titles(&week.overdue.expect("an overdue list")), ["open", "completed"]);
}

#[tokio::test]
async fn agenda_reports_notes_without_including_their_text() {
  let app = TestApp::start().await;
  app
    .seed(
      &[
        CalendarEvent::create(
          OWNER,
          "timed",
          utc(2026, 10, 26, 14, 0),
          utc(2026, 10, 26, 15, 0),
          NEW_YORK,
          None,
          Some("secret event"),
        )
        .expect("a valid event"),
        all_day("all day", "2026-10-26", "2026-10-27"),
      ],
      &[
        TodoTask::create(OWNER, "with notes", Some(date(2026, 10, 26)), None, "medium", Some("secret task")).expect("a valid task"),
        on("without", "2026-10-26"),
      ],
    )
    .await;

  let day = app.get_agenda("2026-10-26", NEW_YORK).await;

  assert_eq!(day.events.len(), 1);
  assert!(day.events[0].has_notes);
  assert_eq!(day.all_day_events.len(), 1);
  assert!(!day.all_day_events[0].has_notes);
  let has_notes = |title: &str| -> bool {
    let matching: Vec<&AgendaTaskItem> = day.tasks.due_today.iter().filter(|task| task.title == title).collect();
    assert_eq!(matching.len(), 1, "{title}");
    matching[0].has_notes
  };
  assert!(has_notes("with notes"));
  assert!(!has_notes("without"));

  let json = app
    .client()
    .get("/api/agenda/day?date=2026-10-26&timeZone=America/New_York")
    .await
    .success()
    .text();
  assert!(!json.contains("\"notes\""), "{json}");
  assert!(!json.contains("secret"), "{json}");
  let week_json = app
    .client()
    .get("/api/agenda/week?date=2026-10-26&timeZone=America/New_York&today=2026-10-26")
    .await
    .success()
    .text();
  assert!(!week_json.contains("\"notes\""), "{week_json}");
  assert!(!week_json.contains("secret"), "{week_json}");
}

// ---- skipped / odd days ----

#[tokio::test]
async fn events_on_a_date_skipped_by_a_clock_change_are_never_shown() {
  let app = TestApp::start().await;
  // Pacific/Apia skipped 2011-12-30 entirely: the window is empty.
  app
    .seed(
      &[
        timed_in("spans the jump", utc(2011, 12, 29, 12, 0), utc(2011, 12, 31, 12, 0), "Pacific/Apia"),
        all_day("floating", "2011-12-30", "2011-12-31"),
      ],
      &[],
    )
    .await;

  let agenda = app.get_agenda("2011-12-30", "Pacific/Apia").await;

  assert_eq!(agenda.window.start, agenda.window.end);
  assert_eq!(agenda.events, Vec::new());
  assert_eq!(agenda.all_day_events.len(), 1);
  assert_eq!(app.get_agenda("2011-12-29", "Pacific/Apia").await.events.len(), 1);
  assert_eq!(app.get_agenda("2011-12-31", "Pacific/Apia").await.events.len(), 1);
}

#[tokio::test]
async fn window_on_a_gap_starting_at_midnight_starts_at_the_transition() {
  let app = TestApp::start().await;

  let agenda = app.get_agenda("2024-10-06", "America/Asuncion").await;

  assert_eq!(agenda.window.start, utc(2024, 10, 6, 4, 0));
}
