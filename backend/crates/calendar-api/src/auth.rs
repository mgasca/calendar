//! Who a request acts as (ADR-0027, ADR-0041).
//!
//! Every route needs a signed-in user except health, the sign-in routes, static files and the web app's
//! fallback: a handler asks for one by taking a [`CurrentUser`]. A request is signed in by its session cookie
//! ([`session`]), set after a Google sign-in ([`google`]), or, in Development with `Auth__DevSeedKey` set, by
//! the `X-Dev-Seed-Key` header ([`dev_seed`]). API requests are answered `401` or `403`, never redirected.

pub mod dev_seed;
pub mod google;
pub mod session;

use axum::extract::FromRequestParts;
use axum::http::header::SET_COOKIE;
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use uuid::Uuid;

use crate::error::ApiError;
use crate::hosting::RequestOrigin;
use crate::problem::Problem;
use crate::state::AppState;

/// The signed-in person of a request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Principal {
  /// Their `users.id`: the owner of every row the request reads or writes (ADR-0041).
  pub user_id: Uuid,
  /// Their display name, if the identity provider gave one.
  pub name: Option<String>,
  /// Their email.
  pub email: Option<String>,
  /// Their picture URL, if any.
  pub picture: Option<String>,
}

/// What an [`Authenticator`] makes of a request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthOutcome {
  /// The request acts as this person.
  Authenticated(Principal),
  /// Nobody is signed in: `401`.
  Anonymous,
  /// Someone is signed in but may not do this: `403`. No production route denies a signed-in user today.
  Forbidden,
}

/// A test-only authentication hook: when the application is built with one, it decides who each request acts
/// as, in place of the session cookie (the .NET tests registered a fake authentication scheme the same way).
/// Production builds the application without one. It is not consulted while the Development seed scheme is
/// enabled, where only the cookie and the seed key count, as in the .NET policy.
pub trait Authenticator: Send + Sync + 'static {
  /// Who the request with these headers acts as.
  fn authenticate(&self, headers: &HeaderMap) -> AuthOutcome;
}

/// Why a request is not let through.
#[derive(Debug)]
pub enum AuthRejection {
  /// Not signed in. `clear_session` ends a session cookie that carries no user id.
  Unauthorized {
    /// Whether to tell the browser to drop its session cookie.
    clear_session: bool,
    /// Whether that cookie must carry `Secure`.
    secure: bool,
  },
  /// Signed in, but not allowed.
  Forbidden,
  /// Authentication itself failed (the database is unreachable, for example).
  Failed(ApiError),
}

impl IntoResponse for AuthRejection {
  fn into_response(self) -> Response {
    match self {
      Self::Unauthorized { clear_session, secure } => {
        let problem = Problem::status(StatusCode::UNAUTHORIZED);
        if clear_session {
          problem
            .with_header(SET_COOKIE, session::clear_cookie(session::SESSION_COOKIE, secure))
            .into_response()
        } else {
          problem.into_response()
        }
      }
      Self::Forbidden => Problem::status(StatusCode::FORBIDDEN).into_response(),
      Self::Failed(error) => error.into_response(),
    }
  }
}

/// Extracts the signed-in person, or rejects the request with `401` (or `403`).
#[derive(Debug, Clone)]
pub struct CurrentUser(pub Principal);

impl FromRequestParts<AppState> for CurrentUser {
  type Rejection = AuthRejection;

  async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
    authenticate(state, parts).await.map(Self)
  }
}

/// Decides who the request acts as.
pub async fn authenticate(state: &AppState, parts: &Parts) -> Result<Principal, AuthRejection> {
  let secure = RequestOrigin::of_parts(parts).secure_cookies(state.settings());
  let anonymous = AuthRejection::Unauthorized {
    clear_session: false,
    secure,
  };
  let seed_enabled = state.settings().seed_enabled();

  if !seed_enabled && let Some(authenticator) = state.authenticator() {
    return match authenticator.authenticate(&parts.headers) {
      AuthOutcome::Authenticated(principal) => Ok(principal),
      AuthOutcome::Anonymous => Err(anonymous),
      AuthOutcome::Forbidden => Err(AuthRejection::Forbidden),
    };
  }

  if let Some(cookie) = session::cookie_value(&parts.headers, session::SESSION_COOKIE) {
    let sealer = state.sealer().await.map_err(AuthRejection::Failed)?;
    if let Some(ticket) = session::SessionTicket::open(&sealer, cookie, state.now()) {
      // A session without a user id is not a session: it ends here, and the person signs in again (ADR-0041).
      return ticket.principal().ok_or(AuthRejection::Unauthorized {
        clear_session: true,
        secure,
      });
    }
    tracing::debug!("the session cookie is expired or cannot be opened");
  }

  if seed_enabled && let Some(principal) = dev_seed::authenticate(state, &parts.headers).await.map_err(AuthRejection::Failed)? {
    return Ok(principal);
  }

  Err(anonymous)
}
