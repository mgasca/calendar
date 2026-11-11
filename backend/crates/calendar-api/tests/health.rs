//! Ports `HealthEndpointsTests`.

mod common;

use common::*;

#[tokio::test]
async fn get_health_returns_ok() {
  // Health needs neither a database nor a signed-in user.
  let app = TestApp::builder().without_database().real_authentication().start().await;

  let response = app.client().get("/api/health").await;

  assert_eq!(response.status, StatusCode::OK);
  let body: HealthResponse = response.json();
  assert_eq!(body.status, "ok");
}
