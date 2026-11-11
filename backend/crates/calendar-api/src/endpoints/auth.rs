//! `GET /api/auth/me` and `POST /api/auth/logout`. Sign-in itself is in [`crate::auth::google`].

use axum::http::header::{CACHE_CONTROL, EXPIRES, PRAGMA, SET_COOKIE};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};

use super::request;
use crate::auth::CurrentUser;
use crate::auth::session::{self, SESSION_COOKIE};
use crate::contracts::AuthUserResponse;
use crate::error::ApiError;
use crate::hosting::RequestOrigin;
use crate::state::AppState;

// The signed-in person.
#[utoipa::path(
  get,
  path = "/api/auth/me",
  operation_id = "GetCurrentUser",
  tag = "Auth",
  responses((status = 200, description = "OK", body = AuthUserResponse))
)]
pub async fn me(CurrentUser(user): CurrentUser) -> Result<Response, ApiError> {
  request::ok(&AuthUserResponse {
    name: user.name.unwrap_or_default(),
    email: user.email.unwrap_or_default(),
    picture_url: user.picture,
  })
}

// Ends the session: the browser is told to drop the session cookie.
#[utoipa::path(
  post,
  path = "/api/auth/logout",
  operation_id = "Logout",
  tag = "Auth",
  responses((status = 204, description = "No Content"))
)]
pub async fn logout(_user: CurrentUser, axum::extract::State(state): axum::extract::State<AppState>, origin: RequestOrigin) -> Response {
  let mut response = StatusCode::NO_CONTENT.into_response();
  let headers = response.headers_mut();
  headers.insert(
    SET_COOKIE,
    session::clear_cookie(SESSION_COOKIE, origin.secure_cookies(state.settings())),
  );
  // As the ASP.NET cookie handler did on sign-out: the answer to a logout is never cached.
  headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache,no-store"));
  headers.insert(EXPIRES, HeaderValue::from_static("Thu, 01 Jan 1970 00:00:00 GMT"));
  headers.insert(PRAGMA, HeaderValue::from_static("no-cache"));
  response
}
