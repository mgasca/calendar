//! Proves the harness and the main paths end to end: a few task, event, agenda, session, seed and hosting
//! checks, and `DatabaseConnectivityTests`. The full port of the .NET endpoint tests lives in the files
//! beside this one.

mod common;

use common::*;
use diesel_async::RunQueryDsl;

const SEED_KEY: &str = "12345678901234567890123456789012";

/// Ports `DatabaseConnectivityTests.Api_ConnectsToRealPostgres_AsAppRole`.
#[tokio::test]
async fn the_api_connects_to_real_postgres_as_the_app_role() {
  let app = TestApp::start().await;
  let mut connection = app.state().db().await.expect("the API connects");

  let user: String = diesel::select(diesel::dsl::sql::<diesel::sql_types::Text>("current_user::text"))
    .get_result(&mut connection)
    .await
    .expect("the query runs");

  assert_eq!(user, "calendar_app");
}

#[tokio::test]
async fn a_task_is_created_read_listed_and_completed_at_the_clocks_time() {
  let app = TestApp::start().await;
  let client = app.client();

  let created = client
    .post_json("/api/tasks", &json!({"title": "  Write the harness  ", "priority": "high"}))
    .await;
  assert_eq!(created.status, StatusCode::CREATED);
  assert_eq!(created.media_type(), Some("application/json"));
  let task: TaskResponse = created.json();
  assert_eq!(task.title, "Write the harness");
  assert_eq!(task.priority, "high");
  assert!(!task.is_completed);
  assert_eq!(
    created.header("location"),
    Some(format!("http://{TEST_HOST}/api/tasks/{}", task.id).as_str())
  );

  let read: TaskResponse = client.get(&format!("/api/tasks/{}", task.id)).await.success().json();
  assert_eq!(read, task);

  let page: TaskPage = client.get("/api/tasks?view=no-deadline").await.success().json();
  assert_eq!(page.items, std::slice::from_ref(&task));
  assert_eq!(page.next_cursor, None);
  assert_eq!(page.total, None);

  app.clock.advance(TimeDelta::minutes(5));
  let completed: TaskResponse = client.post(&format!("/api/tasks/{}/complete", task.id)).await.success().json();
  assert_eq!(completed.completed_at, Some(utc(2026, 10, 26, 15, 5)));
  assert!(completed.is_completed);
  assert_ne!(completed.version, task.version);

  // The wire form of an instant is the .NET one.
  let raw = client.get(&format!("/api/tasks/{}", task.id)).await.value();
  assert_eq!(raw["completedAt"], "2026-10-26T15:05:00+00:00");
  assert_eq!(raw["dueDate"], Value::Null);
}

#[tokio::test]
async fn each_user_sees_only_their_own_rows() {
  let app = TestApp::start().await;
  let mine: TaskResponse = app
    .client()
    .post_json("/api/tasks", &json!({"title": "mine"}))
    .await
    .success()
    .json();

  let theirs = app.client_as(USER_B);
  assert_eq!(theirs.get(&format!("/api/tasks/{}", mine.id)).await.status, StatusCode::NOT_FOUND);
  let page: TaskPage = theirs.get("/api/tasks?view=no-deadline").await.success().json();
  assert_eq!(page.items, Vec::<TaskResponse>::new());

  let me: AuthUserResponse = theirs.get("/api/auth/me").await.success().json();
  assert_eq!((me.name.as_str(), me.email.as_str(), me.picture_url), ("Test", USER_B_EMAIL, None));
}

#[tokio::test]
async fn an_event_is_validated_created_and_shown_in_the_agenda() {
  let app = TestApp::start().await;
  let client = app.client();

  let invalid = client.post_json("/api/events", &json!({"title": "e"})).await;
  assert_eq!(invalid.status, StatusCode::BAD_REQUEST);
  assert_eq!(invalid.media_type(), Some("application/problem+json"));
  assert_eq!(invalid.problem_title(), "One or more validation errors occurred.");
  assert_eq!(invalid.errors("start"), ["start is required for a timed event."]);

  let unreadable = client
    .post_json("/api/events", &json!({"title": "e", "start": "2026-10-26T10:00:00"}))
    .await;
  assert_eq!(unreadable.status, StatusCode::BAD_REQUEST);
  assert_eq!(
    unreadable.errors("start"),
    ["Expected an instant with an explicit offset, e.g. 2026-10-26T14:00:00Z or 2026-10-26T10:00:00-04:00."]
  );

  let body =
    json!({"title": "Stand-up", "start": "2026-10-26T10:00:00-04:00", "end": "2026-10-26T14:30:00Z", "timeZone": "America/New_York"});
  let event: EventResponse = client.post_json("/api/events", &body).await.success().json();
  assert_eq!(event.start, Some(utc(2026, 10, 26, 14, 0)));
  assert_eq!(event.time_zone.as_deref(), Some("America/New_York"));

  app
    .seed(
      &[CalendarEvent::create_all_day(OWNER, "Conference", date(2026, 10, 26), date(2026, 10, 28), None, None).unwrap()],
      &[
        task("Due today", Some(date(2026, 10, 26)), None),
        completed_task("Done", Some(date(2026, 10, 20)), utc(2026, 10, 26, 13, 0), None),
      ],
    )
    .await;

  let agenda = app.get_agenda("2026-10-26", "America/New_York").await;
  assert_eq!(agenda.window.start, utc(2026, 10, 26, 4, 0));
  assert_eq!(
    agenda.events.iter().map(|event| event.title.as_str()).collect::<Vec<_>>(),
    ["Stand-up"]
  );
  assert_eq!(agenda.all_day_events.len(), 1);
  assert_eq!(agenda.tasks.due_today.len(), 1);
  assert_eq!((agenda.tasks.overdue_total, agenda.tasks.overdue_open_total), (1, 0));

  let week = app.get_week_agenda("2026-10-28", "America/New_York", "2026-10-26").await;
  assert_eq!(week.week_start, date(2026, 10, 26));
  assert_eq!(week.days.len(), 7);
  assert_eq!(week.days[0].events.len(), 1);
}

#[tokio::test]
async fn a_stale_version_is_a_conflict_and_an_unknown_route_a_problem() {
  let app = TestApp::start().await;
  let client = app.client();
  let task: TaskResponse = client.post_json("/api/tasks", &json!({"title": "a"})).await.success().json();

  let stale = client
    .put_json(
      &format!("/api/tasks/{}", task.id),
      &json!({"title": "b", "version": task.version.wrapping_add(1)}),
    )
    .await;
  assert_eq!(stale.status, StatusCode::CONFLICT);
  assert_eq!(stale.problem_title(), "The task was changed elsewhere. Load it again and retry.");

  let unknown = client.get("/api/unknown").await;
  assert_eq!(unknown.status, StatusCode::NOT_FOUND);
  assert_eq!(unknown.media_type(), Some("application/problem+json"));
  assert_eq!(unknown.value()["status"], 404);

  // Routes ignore case and a trailing slash, and a wrong method is an unknown route.
  assert_eq!(client.get("/API/Health/").await.status, StatusCode::OK);
  let wrong_method = client.post("/api/health").await;
  assert_eq!(wrong_method.status, StatusCode::NOT_FOUND);
  assert_eq!(wrong_method.header("allow"), None);
  assert_eq!(client.send(Method::HEAD, "/api/health", None).await.status, StatusCode::NOT_FOUND);

  // A body that is not JSON by its content type matches no route; one that cannot be read is a 400.
  let text = client.send(Method::POST, "/api/tasks", Some(("text/plain", b"{}".to_vec()))).await;
  assert_eq!(text.status, StatusCode::NOT_FOUND);
  let empty = client
    .send(Method::POST, "/api/tasks", Some(("application/json", Vec::new())))
    .await;
  assert_eq!(
    (empty.status, empty.problem_title().as_str()),
    (StatusCode::BAD_REQUEST, "Bad request.")
  );
  assert_eq!(empty.header("cache-control"), Some("no-cache,no-store"));
  let missing = client.post_json("/api/tasks", &json!({})).await;
  assert_eq!(
    missing.errors("$"),
    ["JSON deserialization for type 'Calendar.Api.Contracts.CreateTaskRequest' was missing required properties including: 'title'."]
  );
  let unbound = client.get("/api/tasks?view=completed&limit=abc").await;
  assert_eq!(
    (unbound.status, unbound.problem_title().as_str()),
    (StatusCode::BAD_REQUEST, "Bad request.")
  );
}

#[tokio::test]
async fn outside_development_https_gets_hsts_and_plain_http_is_redirected_when_the_port_is_known() {
  let production = TestApp::builder()
    .without_database()
    .real_authentication()
    .environment("Production")
    .start()
    .await;
  let https = production
    .client()
    .header("host", "calendar.example")
    .header("x-forwarded-proto", "https");
  assert_eq!(
    https.get("/api/health").await.header("strict-transport-security"),
    Some("max-age=2592000")
  );
  let http = production.client().header("host", "calendar.example");
  let plain = http.get("/api/health").await;
  assert_eq!((plain.status, plain.header("strict-transport-security")), (StatusCode::OK, None));
  assert_eq!(production.client().get("/openapi/v1.json").await.status, StatusCode::NOT_FOUND);
  // HSTS is never sent to a loopback host.
  let local = production.client().header("x-forwarded-proto", "https").get("/api/health").await;
  assert_eq!(local.header("strict-transport-security"), None);

  let redirecting = production.reconfigure().setting("ASPNETCORE_HTTPS_PORT", "443").start().await;
  let redirected = redirecting.client().header("host", "calendar.example").get("/api/health?x=1").await;
  assert_eq!(redirected.status, StatusCode::TEMPORARY_REDIRECT);
  assert_eq!(redirected.header("location"), Some("https://calendar.example/api/health?x=1"));

  let development = TestApp::builder().without_database().real_authentication().start().await;
  let dev_https = development
    .client()
    .header("host", "calendar.example")
    .header("x-forwarded-proto", "https");
  assert_eq!(dev_https.get("/api/health").await.header("strict-transport-security"), None);
}

#[tokio::test]
async fn without_the_test_authenticator_only_a_session_with_a_user_id_signs_in() {
  let app = TestApp::builder().real_authentication().start().await;
  let anonymous = app.client().get("/api/tasks?view=completed").await;
  assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
  assert_eq!(anonymous.media_type(), Some("application/problem+json"));
  assert_eq!(app.client().get("/api/health").await.status, StatusCode::OK);
  assert_eq!(app.client().get("/openapi/v1.json").await.status, StatusCode::OK);

  let ticket = SessionTicket {
    user_id: Some(USER_A),
    name: Some("Someone".to_owned()),
    email: Some("someone@example.com".to_owned()),
    picture: None,
    expires_at: app.clock.now() + TimeDelta::hours(8),
  };
  let signed_in = app.client().cookie(&app.session_cookie(&ticket).await);
  let me: AuthUserResponse = signed_in.get("/api/auth/me").await.success().json();
  assert_eq!((me.name.as_str(), me.email.as_str()), ("Someone", "someone@example.com"));

  // The session ends eight hours after it was issued, however much it was used.
  app.clock.advance(TimeDelta::hours(8));
  assert_eq!(signed_in.get("/api/auth/me").await.status, StatusCode::UNAUTHORIZED);
  app.clock.set(start_time());

  let without_user = SessionTicket { user_id: None, ..ticket };
  let rejected = app
    .client()
    .cookie(&app.session_cookie(&without_user).await)
    .get("/api/auth/me")
    .await;
  assert_eq!(rejected.status, StatusCode::UNAUTHORIZED);
  let cleared = rejected.set_cookies();
  assert_eq!(cleared.len(), 1);
  assert!(
    cleared[0].starts_with(&format!("{SESSION_COOKIE}=;")) && cleared[0].contains("expires="),
    "{cleared:?}"
  );

  let logout = signed_in.post("/api/auth/logout").await;
  assert_eq!(logout.status, StatusCode::NO_CONTENT);
  let cookie = logout.set_cookies().join("").to_lowercase();
  assert!(
    cookie.contains("expires=") && cookie.contains("httponly") && cookie.contains("samesite=lax"),
    "{cookie}"
  );
}

#[tokio::test]
async fn the_seed_key_signs_in_as_the_first_allow_listed_email_in_development_only() {
  let app = TestApp::start().await;
  let seeded = |environment: &str| {
    app
      .reconfigure()
      .real_authentication()
      .environment(environment)
      .setting("Auth__DevSeedKey", SEED_KEY)
      .setting("Auth__AllowedEmails__0", "Owner@Example.com")
  };

  let development = seeded("Development").start().await;
  let with_key = development.client().header("X-Dev-Seed-Key", SEED_KEY);
  let me: AuthUserResponse = with_key.get("/api/auth/me").await.success().json();
  assert_eq!((me.name.as_str(), me.email.as_str()), ("dev-seed", "owner@example.com"));
  assert_eq!(
    with_key.post_json("/api/tasks", &json!({"title": "seeded"})).await.status,
    StatusCode::CREATED
  );
  assert_eq!(
    development
      .client()
      .header("X-Dev-Seed-Key", "wrong")
      .get("/api/auth/me")
      .await
      .status,
    StatusCode::UNAUTHORIZED
  );
  assert_eq!(development.client().get("/api/auth/me").await.status, StatusCode::UNAUTHORIZED);

  let production = seeded("Production").start().await;
  assert_eq!(
    production
      .client()
      .header("X-Dev-Seed-Key", SEED_KEY)
      .get("/api/auth/me")
      .await
      .status,
    StatusCode::UNAUTHORIZED
  );

  let short = app.reconfigure().setting("Auth__DevSeedKey", "too-short").start_error();
  assert_eq!(short, "Auth:DevSeedKey must be at least 32 characters.");
}

#[tokio::test]
async fn static_files_the_web_app_fallback_and_the_login_explanation() {
  let root = tempfile::tempdir().unwrap();
  std::fs::create_dir(root.path().join("assets")).unwrap();
  std::fs::write(root.path().join("index.html"), "SPA").unwrap();
  std::fs::write(root.path().join("assets").join("app-Abc123_X.js"), "asset").unwrap();
  let app = TestApp::builder()
    .without_database()
    .real_authentication()
    .web_root(root.path())
    .start()
    .await;
  let client = app.client();

  for path in ["/", "/day/2026-10-29", "/index.html"] {
    let response = client.get(path).await;
    assert_eq!((response.status, response.text().as_str()), (StatusCode::OK, "SPA"), "{path}");
    assert_eq!(response.header("cache-control"), Some("no-cache"), "{path}");
  }
  let asset = client.get("/assets/app-Abc123_X.js").await;
  assert_eq!((asset.status, asset.text().as_str()), (StatusCode::OK, "asset"));
  assert_eq!(asset.header("cache-control"), Some("public, max-age=31536000, immutable"));
  assert_eq!(client.get("/assets/missing.js").await.status, StatusCode::NOT_FOUND);

  let login = client.get("/api/auth/login").await;
  assert_eq!(login.status, StatusCode::SERVICE_UNAVAILABLE);
  assert_eq!(login.problem_title(), "Google sign-in is not configured.");
  assert!(login.text().contains("Auth__Google__ClientId"));
}
