//! `GET /api/auth/me`, `POST /api/auth/logout` and `POST /api/auth/native/token`. Sign-in itself is in
//! [`crate::auth::google`], and the rest of the native sign-in in [`crate::auth::native`].

use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, EXPIRES, PRAGMA, SET_COOKIE};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use calendar_infrastructure::users;

use super::request;
use crate::auth::CurrentUser;
use crate::auth::native::Handover;
use crate::auth::session::{self, SESSION_COOKIE, SessionTicket};
use crate::contracts::{AuthUserResponse, NativeSessionRequest, ProblemDetails};
use crate::error::ApiError;
use crate::hosting::RequestOrigin;
use crate::json::{JsonBody, JsonContent};
use crate::problem::Problem;
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

// Ends a native sign-in: redeems the handover code the API sent to the desktop app's loopback redirect
// with the app's PKCE verifier, for the ordinary session cookie (`auth::native`). Unauthenticated, like the
// rest of sign-in.
#[utoipa::path(
  post,
  path = "/api/auth/native/token",
  operation_id = "RedeemNativeCode",
  tag = "Auth",
  request_body = NativeSessionRequest,
  responses(
    (status = 204, description = "No Content"),
    (status = 400, description = "Bad Request", body = ProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn native_token(
  _json: JsonContent,
  State(state): State<AppState>,
  origin: RequestOrigin,
  JsonBody(request): JsonBody<NativeSessionRequest>,
) -> Result<Response, ApiError> {
  let refused = || Problem::titled(StatusCode::BAD_REQUEST, "invalid_grant");
  let sealer = state.sealer().await?;
  let principal = match Handover::redeem(&sealer, &request.code, &request.code_verifier, &request.redirect_uri, state.now()) {
    Ok(principal) => principal,
    Err(reason) => {
      tracing::warn!(%reason, "native sign-in handover refused");
      return Err(refused().into());
    }
  };
  // The allow-list was applied at the callback; a user removed since is not signed in.
  let mut connection = state.db().await?;
  if users::find(&mut connection, principal.owner.0).await?.is_none() {
    tracing::warn!("native sign-in handover refused: the user no longer exists");
    return Err(refused().into());
  }

  let ticket = SessionTicket::issue(principal, state.now()).seal(&sealer);
  let mut response = StatusCode::NO_CONTENT.into_response();
  let headers = response.headers_mut();
  headers.insert(
    SET_COOKIE,
    session::set_cookie(SESSION_COOKIE, &ticket, origin.secure_cookies(state.settings()), None),
  );
  headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache,no-store"));
  headers.insert(PRAGMA, HeaderValue::from_static("no-cache"));
  Ok(response)
}
