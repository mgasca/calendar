//! Ports `Endpoints/HostingTests`: static files and the web app's fallback, the forwarded scheme and host,
//! `403` for a denied API request, and the session cookie's attributes.

use crate::common::*;
use calendar_api::auth::google::SIGN_IN_COOKIE;

/// A signed-in user who is denied: no production route denies a signed-in user today.
struct DeniesEveryone;

impl Authenticator for DeniesEveryone {
  fn authenticate(&self, _headers: &HeaderMap) -> AuthOutcome {
    AuthOutcome::Forbidden
  }
}

#[tokio::test]
async fn spa_routing_and_cache_headers() {
  let root = spa_root();
  std::fs::write(root.path().join("assets").join("plain.js"), "plain").unwrap();
  let app = TestApp::builder()
    .without_database()
    .real_authentication()
    .web_root(root.path())
    .start()
    .await;
  let client = app.client();

  for path in ["/", "/day/2026-10-29", "/index.html"] {
    let response = client.get(path).await;
    assert_eq!(response.status, StatusCode::OK, "{path}");
    assert_eq!(response.text(), "SPA", "{path}");
    assert_eq!(response.header("cache-control"), Some("no-cache"), "{path}");
  }

  let asset = client.get("/assets/app-Abc123_X.js").await;
  assert_eq!(asset.status, StatusCode::OK);
  assert_eq!(asset.text(), "asset");
  assert_eq!(asset.header("cache-control"), Some("public, max-age=31536000, immutable"));

  let plain = client.get("/assets/plain.js").await;
  assert_eq!(plain.header("cache-control"), None);

  let missing = client.get("/assets/missing.js").await;
  assert_eq!(missing.status, StatusCode::NOT_FOUND);

  let unknown = client.get("/api/unknown").await;
  assert_eq!(unknown.status, StatusCode::NOT_FOUND);
  assert_eq!(unknown.media_type(), Some("application/problem+json"));
  assert_eq!(unknown.value()["status"], json!(404));

  let protected_route = client.get("/api/auth/me").await;
  assert_eq!(protected_route.status, StatusCode::UNAUTHORIZED);
}

/// The Rune UI's browser bundle at `/native/` on the same origin (ADR-0067, #1009): its own entry page as
/// the fallback, never the React app's, its files with their types and revalidated, and the React app and
/// the API unchanged beside it.
#[tokio::test]
async fn native_bundle_routing_and_cache_headers() {
  let root = spa_root();
  let native = root.path().join("native");
  std::fs::create_dir(&native).unwrap();
  std::fs::write(native.join("index.html"), "NATIVE").unwrap();
  std::fs::write(native.join("app.js"), "glue").unwrap();
  std::fs::write(native.join("app_bg.wasm"), b"\0asm\x01\0\0\0").unwrap();
  let app = TestApp::builder()
    .without_database()
    .real_authentication()
    .web_root(root.path())
    .start()
    .await;
  let client = app.client();

  for path in [
    "/native/",
    "/native/week",
    "/native/tasks/123",
    "/native/index.html",
    "/NATIVE/week",
  ] {
    let response = client.get(path).await;
    assert_eq!(response.status, StatusCode::OK, "{path}");
    assert_eq!(response.text(), "NATIVE", "{path}");
    assert_eq!(response.header("cache-control"), Some("no-cache"), "{path}");
  }

  let wasm = client.get("/native/app_bg.wasm").await;
  assert_eq!(wasm.status, StatusCode::OK);
  assert_eq!(wasm.media_type(), Some("application/wasm"));
  assert_eq!(wasm.header("cache-control"), Some("no-cache"));

  let glue = client.get("/native/app.js").await;
  assert_eq!(glue.status, StatusCode::OK);
  assert_eq!(glue.text(), "glue");
  assert_eq!(glue.media_type(), Some("text/javascript"));
  assert_eq!(glue.header("cache-control"), Some("no-cache"));

  for (path, location) in [("/native", "/native/"), ("/native?from=menu", "/native/?from=menu")] {
    let response = client.get(path).await;
    assert_eq!(response.status, StatusCode::MOVED_PERMANENTLY, "{path}");
    assert_eq!(response.header("location"), Some(location), "{path}");
  }

  let missing = client.get("/native/missing.js").await;
  assert_eq!(missing.status, StatusCode::NOT_FOUND);

  // The React app keeps its own routes and entry page, including a look-alike prefix.
  for path in ["/", "/week", "/nativeish"] {
    let response = client.get(path).await;
    assert_eq!(response.status, StatusCode::OK, "{path}");
    assert_eq!(response.text(), "SPA", "{path}");
  }
  assert_eq!(client.get("/api/auth/me").await.status, StatusCode::UNAUTHORIZED);
}

/// The bundle's large files go out gzip-encoded to a client that accepts it, from the `.gz` copies the image
/// writes beside them, with the original type and cache header; a client that does not gets the file itself
/// (#1044: the wasm is 13.6 MB, 4.2 MB gzipped).
#[tokio::test]
async fn native_bundle_files_are_served_precompressed() {
  let root = spa_root();
  let native = root.path().join("native");
  std::fs::create_dir(&native).unwrap();
  std::fs::write(native.join("index.html"), "NATIVE").unwrap();
  std::fs::write(native.join("app_bg.wasm"), b"\0asm\x01\0\0\0").unwrap();
  std::fs::write(native.join("app_bg.wasm.gz"), "GZIPPED").unwrap();
  let app = TestApp::builder()
    .without_database()
    .real_authentication()
    .web_root(root.path())
    .start()
    .await;

  let gzipped = app.client().header("accept-encoding", "gzip, br").get("/native/app_bg.wasm").await;
  assert_eq!(gzipped.status, StatusCode::OK);
  assert_eq!(gzipped.header("content-encoding"), Some("gzip"));
  assert_eq!(gzipped.media_type(), Some("application/wasm"));
  assert_eq!(gzipped.header("cache-control"), Some("no-cache"));
  assert_eq!(gzipped.body, b"GZIPPED");

  let plain = app.client().get("/native/app_bg.wasm").await;
  assert_eq!(plain.status, StatusCode::OK);
  assert_eq!(plain.header("content-encoding"), None);
  assert_eq!(plain.body, b"\0asm\x01\0\0\0");
}

/// Without a built bundle, `/native/` is a `404`, not the React app.
#[tokio::test]
async fn native_paths_without_a_bundle_are_not_found() {
  let root = spa_root();
  let app = TestApp::builder()
    .without_database()
    .real_authentication()
    .web_root(root.path())
    .start()
    .await;
  let response = app.client().get("/native/week").await;
  assert_eq!(response.status, StatusCode::NOT_FOUND);
  assert_ne!(response.text(), "SPA");
}

#[tokio::test]
async fn forwarded_https_sets_google_redirect_and_secure_cookie() {
  let app = TestApp::builder()
    .without_database()
    .environment("Development")
    .setting("Auth__Google__ClientId", "test-client")
    .setting("Auth__Google__ClientSecret", "test-secret")
    .start()
    .await;

  let login = app
    .client()
    .header("host", "internal")
    .header("x-forwarded-proto", "https")
    .header("x-forwarded-host", "calendar.example")
    .get("/api/auth/login")
    .await;
  assert_eq!(login.status, StatusCode::FOUND);
  let location = login.header("location").expect("the redirect has a location");
  assert!(
    location.contains("redirect_uri=https%3A%2F%2Fcalendar.example%2Fapi%2Fauth%2Fcallback%2Fgoogle"),
    "{location}"
  );
  let flow = login.set_cookie(SIGN_IN_COOKIE).expect("the sign-in cookie is set");
  assert!(flow.has("secure"), "{flow:?}");

  let logout = app.client().header("x-forwarded-proto", "https").post("/api/auth/logout").await;
  assert_eq!(logout.status, StatusCode::NO_CONTENT);
  let cleared = logout.set_cookie(SESSION_COOKIE).expect("the session cookie is cleared");
  assert!(cleared.has("secure"), "{cleared:?}");
}

#[tokio::test]
async fn denied_api_request_is_forbidden_not_redirected() {
  let app = TestApp::builder().without_database().authenticator(DeniesEveryone).start().await;

  let response = app.client().get("/api/tasks").await;

  assert_eq!(response.status, StatusCode::FORBIDDEN);
  assert_eq!(response.header("location"), None);
}

#[tokio::test]
async fn session_cookie_is_http_only_and_same_site_lax() {
  let app = TestApp::builder().without_database().start().await;

  let response = app.client().post("/api/auth/logout").await;

  let cookies = response.set_cookies();
  assert_eq!(cookies.len(), 1, "{cookies:?}");
  let cookie = response.set_cookie(SESSION_COOKIE).expect("the session cookie is set");
  assert!(cookie.has("httponly"), "{cookie:?}");
  assert!(cookie.has("samesite=lax"), "{cookie:?}");
}
