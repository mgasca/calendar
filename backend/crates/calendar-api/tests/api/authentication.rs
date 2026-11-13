//! Ports `Endpoints/AuthenticationTests`: every route needs a signed-in user except health, the contract and
//! the sign-in routes (ADR-0027), and the pure allow-list and return-URL rules.

use crate::common::*;
use calendar_api::auth::google::local_return_url;
use calendar_api::config::is_allowed;

/// The application as production builds it (only a session cookie signs a request in), in Development and
/// without a database, like the bare `WebApplicationFactory<Program>` of the .NET tests.
async fn host() -> TestApp {
  TestApp::builder().without_database().real_authentication().start().await
}

#[tokio::test]
async fn anonymous_routes_return_unauthorized() {
  let app = host().await;
  for path in [
    "/api/events/00000000-0000-0000-0000-000000000000",
    "/api/tasks",
    "/api/agenda/day",
    "/api/agenda/week",
    "/api/auth/me",
  ] {
    let response = app.client().get(path).await;
    assert_eq!(response.status, StatusCode::UNAUTHORIZED, "{path}");
  }
}

#[tokio::test]
async fn anonymous_bulk_and_delete_routes_return_unauthorized() {
  let app = host().await;
  let bulk = app
    .client()
    .post_json("/api/tasks/bulk", &json!({"action": "delete", "ids": [Uuid::new_v4()]}))
    .await;
  let delete = app.client().delete(&format!("/api/tasks/{}", Uuid::new_v4())).await;

  assert_eq!(bulk.status, StatusCode::UNAUTHORIZED);
  assert_eq!(delete.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn public_routes_are_accessible() {
  let app = host().await;
  for path in ["/api/health", "/openapi/v1.json"] {
    let response = app.client().get(path).await;
    assert_eq!(response.status, StatusCode::OK, "{path}");
  }
}

#[test]
fn only_verified_allowed_emails_pass() {
  let allowed = ["user@example.com".to_owned()];
  for (email, verified, expected) in [
    (Some("USER@example.com"), true, true),
    (Some("other@example.com"), true, false),
    (Some("user@example.com"), false, false),
    (None, true, false),
  ] {
    assert_eq!(is_allowed(email, verified, &allowed), expected, "{email:?} verified={verified}");
  }
}

#[test]
fn return_urls_are_local() {
  for (input, expected) in [
    (Some("/day/2026-10-29?x=1"), "/day/2026-10-29?x=1"),
    (Some("//evil.test"), "/"),
    (Some("/\\evil.test"), "/"),
    (Some("https://evil.test"), "/"),
    (None, "/"),
  ] {
    assert_eq!(local_return_url(input), expected, "{input:?}");
  }
}

#[tokio::test]
async fn logout_clears_cookie() {
  // Signed in through the test authenticator, as the .NET test was through its fake scheme.
  let app = TestApp::builder().without_database().start().await;

  let response = app.client().post("/api/auth/logout").await;

  assert_eq!(response.status, StatusCode::NO_CONTENT);
  let cookies = response.set_cookies();
  assert_eq!(cookies.len(), 1, "{cookies:?}");
  assert!(cookies[0].contains("expires="), "{cookies:?}");
}

#[tokio::test]
async fn login_explains_when_google_is_not_configured() {
  let app = TestApp::builder()
    .without_database()
    .real_authentication()
    .setting("Auth__Google__ClientId", "")
    .setting("Auth__Google__ClientSecret", "")
    .start()
    .await;

  let response = app.client().get("/api/auth/login").await;

  assert_eq!(response.status, StatusCode::SERVICE_UNAVAILABLE);
  let body = response.text();
  assert!(body.contains("Google sign-in is not configured."), "{body}");
  assert!(body.contains("Auth__Google__ClientId"), "{body}");
}

#[tokio::test]
async fn cross_origin_request_has_no_cors_headers() {
  let app = host().await;

  let response = app.client().header("Origin", "https://example.com").get("/api/health").await;

  assert!(!response.headers.contains_key("access-control-allow-origin"));
}
