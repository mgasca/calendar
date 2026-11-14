//! Google sign-in: the OAuth 2.0 authorization-code flow with `state`, PKCE and an OpenID Connect `nonce`.
//!
//! `GET /api/auth/login` redirects to Google and keeps the flow's secrets in a short-lived sealed cookie.
//! Google redirects back to `/api/auth/callback/google`, where the code is exchanged, the ID token's
//! audience, issuer, expiry and nonce are checked, and the person's claims are read from the userinfo
//! endpoint. Only a verified, allow-listed email is signed in (ADR-0027); the person then gets, or claims,
//! their `users` row and its id travels in the session cookie (ADR-0041). Every failure of the callback ends
//! at `/signin?error=access_denied`.
//!
//! The ID token arrives straight from Google's token endpoint over TLS, which OpenID Connect Core 3.1.3.7
//! accepts in place of checking its signature, so no JWKS is fetched.
//!
//! In Development only, the endpoints and the accepted issuer can point at a stub provider on a loopback
//! address (`config::GoogleOverrides`, ADR-0064); the settings refuse every other use at startup.

use axum::extract::State;
use axum::http::header::{LOCATION, SET_COOKIE};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use calendar_infrastructure::users::{self, SignIn};
use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use super::Principal;
use super::session::{self, SessionTicket};
use crate::config::{GoogleCredentials, GoogleOverrides};
use crate::endpoints::request::QueryParams;
use crate::error::ApiError;
use crate::hosting::RequestOrigin;
use crate::problem::Problem;
use crate::state::AppState;
use crate::text::is_blank;

/// The path Google redirects back to. It is registered with the OAuth client, so it must not change.
pub const CALLBACK_PATH: &str = "/api/auth/callback/google";

/// Where a failed sign-in ends.
pub const FAILURE_REDIRECT: &str = "/signin?error=access_denied";

/// The cookie that carries the flow's `state`, PKCE verifier, nonce and return URL to the callback.
pub const SIGN_IN_COOKIE: &str = "calendar_signin";

const SIGN_IN_PURPOSE: &str = "calendar.signin.v1";
const SIGN_IN_LIFETIME: TimeDelta = TimeDelta::minutes(15);
const SCOPE: &str = "openid profile email";
const ISSUERS: [&str; 2] = ["https://accounts.google.com", "accounts.google.com"];

/// Where Google's OAuth 2.0 endpoints are. Tests point them at a local fake; in Development the settings can
/// point them at a stub provider ([`GoogleEndpoints::overridden_by`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleEndpoints {
  /// The authorization endpoint the browser is sent to.
  pub authorize: String,
  /// The token endpoint the code is exchanged at.
  pub token: String,
  /// The userinfo endpoint the person's claims are read from.
  pub user_info: String,
}

impl Default for GoogleEndpoints {
  fn default() -> Self {
    Self {
      authorize: "https://accounts.google.com/o/oauth2/v2/auth".to_owned(),
      token: "https://oauth2.googleapis.com/token".to_owned(),
      user_info: "https://www.googleapis.com/oauth2/v3/userinfo".to_owned(),
    }
  }
}

impl GoogleEndpoints {
  /// These endpoints with each one the settings override replaced. The settings have already refused
  /// overrides outside Development or off loopback.
  #[must_use]
  pub fn overridden_by(self, overrides: &GoogleOverrides) -> Self {
    let pick = |value: &Option<String>, current: String| value.as_deref().map_or(current, |value| value.trim().to_owned());
    Self {
      authorize: pick(&overrides.authorization_endpoint, self.authorize),
      token: pick(&overrides.token_endpoint, self.token),
      user_info: pick(&overrides.user_info_endpoint, self.user_info),
    }
  }
}

/// Whether `issuer` is accepted in an ID token: the overriding issuer when one is set, Google's otherwise.
fn is_accepted_issuer(issuer: &str, overrides: &GoogleOverrides) -> bool {
  match overrides.issuer.as_deref() {
    Some(expected) => issuer == expected.trim(),
    None => ISSUERS.contains(&issuer),
  }
}

/// Restricts a post-sign-in return URL to a local path (`ApiAuthentication.LocalReturnUrl`): it must start
/// with one `/`, not continue with `/` or `\`, and hold no backslash or control character. Anything else
/// becomes `/`.
pub fn local_return_url(url: Option<&str>) -> &str {
  match url {
    Some(url) if is_local(url) => url,
    _ => "/",
  }
}

fn is_local(url: &str) -> bool {
  let mut characters = url.chars();
  characters.next() == Some('/')
    && !matches!(characters.next(), Some('/' | '\\'))
    && !url.contains('\\')
    && !url.chars().any(char::is_control)
}

/// What the sign-in cookie holds between the redirect to Google and the callback.
#[derive(Debug, Serialize, Deserialize)]
struct SignInState {
  state: String,
  verifier: String,
  nonce: String,
  return_url: String,
  expires_at: DateTime<Utc>,
}

fn random_token() -> String {
  let mut bytes = [0_u8; 32];
  rand::fill(&mut bytes);
  URL_SAFE_NO_PAD.encode(bytes)
}

/// `GET /api/auth/login`: starts a Google sign-in, or explains that Google is not configured.
pub async fn login(State(state): State<AppState>, origin: RequestOrigin, query: QueryParams) -> Result<Response, ApiError> {
  let Some(credentials) = &state.settings().google else {
    return Err(
      Problem::titled(StatusCode::SERVICE_UNAVAILABLE, "Google sign-in is not configured.")
        .with_detail(
          "Set Auth__Google__ClientId and Auth__Google__ClientSecret for the API, then restart it. \
           See backend/README.md, 'Google sign-in setup'.",
        )
        .into(),
    );
  };

  let return_url = query.get("returnUrl");
  let flow = SignInState {
    state: random_token(),
    verifier: random_token(),
    nonce: random_token(),
    return_url: local_return_url(return_url.as_deref()).to_owned(),
    expires_at: state.now() + SIGN_IN_LIFETIME,
  };
  let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(flow.verifier.as_bytes()));
  let authorize = form_urlencoded::Serializer::new(String::new())
    .append_pair("client_id", &credentials.client_id)
    .append_pair("redirect_uri", &redirect_uri(&origin))
    .append_pair("response_type", "code")
    .append_pair("scope", SCOPE)
    .append_pair("state", &flow.state)
    .append_pair("code_challenge", &challenge)
    .append_pair("code_challenge_method", "S256")
    .append_pair("nonce", &flow.nonce)
    .finish();
  let separator = if state.google_endpoints().authorize.contains('?') {
    '&'
  } else {
    '?'
  };
  let location = format!("{}{separator}{authorize}", state.google_endpoints().authorize);

  let sealed = state
    .sealer()
    .await?
    .seal(SIGN_IN_PURPOSE, &serde_json::to_vec(&flow).map_err(ApiError::internal)?);
  let secure = origin.secure_cookies(state.settings());
  let cookie = session::set_cookie(SIGN_IN_COOKIE, &sealed, secure, Some(SIGN_IN_LIFETIME.num_seconds()));
  Ok(redirect(&location, [cookie]))
}

/// `GET /api/auth/callback/google`: finishes the sign-in and redirects to the return URL, or to
/// [`FAILURE_REDIRECT`] when anything is wrong.
pub async fn callback(
  State(state): State<AppState>,
  origin: RequestOrigin,
  query: QueryParams,
  headers: axum::http::HeaderMap,
) -> Response {
  let secure = origin.secure_cookies(state.settings());
  let clear_flow = session::clear_cookie(SIGN_IN_COOKIE, secure);
  match complete(&state, &origin, &query, &headers).await {
    Ok((principal, return_url)) => match state.sealer().await {
      Ok(sealer) => {
        let ticket = SessionTicket::issue(&principal, state.now()).seal(&sealer);
        let session = session::set_cookie(session::SESSION_COOKIE, &ticket, secure, None);
        redirect(&return_url, [clear_flow, session])
      }
      Err(error) => error.into_response(),
    },
    Err(reason) => {
      tracing::warn!(%reason, "Google sign-in failed");
      redirect(FAILURE_REDIRECT, [clear_flow])
    }
  }
}

fn redirect<const N: usize>(location: &str, cookies: [HeaderValue; N]) -> Response {
  let mut response = StatusCode::FOUND.into_response();
  match HeaderValue::from_str(location) {
    Ok(location) => {
      response.headers_mut().insert(LOCATION, location);
    }
    Err(_) => {
      response.headers_mut().insert(LOCATION, HeaderValue::from_static("/"));
    }
  }
  for cookie in cookies {
    response.headers_mut().append(SET_COOKIE, cookie);
  }
  response
}

fn redirect_uri(origin: &RequestOrigin) -> String {
  format!("{}://{}{CALLBACK_PATH}", origin.scheme, origin.host)
}

/// Runs the callback; the error is the reason for the log.
async fn complete(
  state: &AppState,
  origin: &RequestOrigin,
  query: &QueryParams,
  headers: &axum::http::HeaderMap,
) -> Result<(Principal, String), String> {
  let credentials = state.settings().google.as_ref().ok_or("Google sign-in is not configured")?;
  if let Some(error) = query.get("error") {
    return Err(format!("Google answered with the error '{error}'"));
  }
  let code = query
    .get("code")
    .filter(|code| !code.is_empty())
    .ok_or("the callback carries no code")?;
  let returned_state = query.get("state").ok_or("the callback carries no state")?;

  let cookie = session::cookie_value(headers, SIGN_IN_COOKIE).ok_or("the sign-in cookie is missing")?;
  let sealer = state
    .sealer()
    .await
    .map_err(|error| format!("the session key is unavailable: {error}"))?;
  let flow: SignInState = sealer
    .open(SIGN_IN_PURPOSE, cookie)
    .and_then(|json| serde_json::from_slice(&json).ok())
    .ok_or("the sign-in cookie cannot be opened")?;
  if state.now() >= flow.expires_at {
    return Err("the sign-in took too long".to_owned());
  }
  if !bool::from(flow.state.as_bytes().ct_eq(returned_state.as_bytes())) {
    return Err("the state does not match the sign-in cookie".to_owned());
  }

  let tokens = exchange_code(state, credentials, &redirect_uri(origin), &code, &flow.verifier).await?;
  let subject = check_id_token(
    &tokens.id_token,
    credentials,
    &state.settings().google_overrides,
    &flow.nonce,
    state.now(),
  )?;
  let user = fetch_user(state, &tokens.access_token).await?;
  if user.sub.as_deref() != Some(subject.as_str()) {
    return Err("the userinfo subject is not the ID token's".to_owned());
  }

  let principal = sign_in(state, &user).await.map_err(|error| error.to_string())?;
  Ok((principal, flow.return_url))
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
  access_token: String,
  id_token: String,
}

async fn exchange_code(
  state: &AppState,
  credentials: &GoogleCredentials,
  redirect_uri: &str,
  code: &str,
  verifier: &str,
) -> Result<TokenResponse, String> {
  let form = form_urlencoded::Serializer::new(String::new())
    .append_pair("grant_type", "authorization_code")
    .append_pair("code", code)
    .append_pair("redirect_uri", redirect_uri)
    .append_pair("client_id", &credentials.client_id)
    .append_pair("client_secret", &credentials.client_secret)
    .append_pair("code_verifier", verifier)
    .finish();
  let response = state
    .http()
    .ok_or("Google sign-in is not configured")?
    .post(&state.google_endpoints().token)
    .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
    .header(reqwest::header::ACCEPT, "application/json")
    .body(form)
    .send()
    .await
    .map_err(|error| format!("the token request failed: {}", error.without_url()))?;
  if !response.status().is_success() {
    return Err(format!("the token endpoint answered {}", response.status()));
  }
  response
    .json()
    .await
    .map_err(|_| "the token response holds no access token and ID token".to_owned())
}

/// Checks the claims of the ID token (audience, issuer, expiry, nonce) and returns its subject.
fn check_id_token(
  id_token: &str,
  credentials: &GoogleCredentials,
  overrides: &GoogleOverrides,
  nonce: &str,
  now: DateTime<Utc>,
) -> Result<String, String> {
  let payload = id_token.split('.').nth(1).ok_or("the ID token is not a JWT")?;
  let claims: Value = URL_SAFE_NO_PAD
    .decode(payload.trim_end_matches('='))
    .ok()
    .and_then(|json| serde_json::from_slice(&json).ok())
    .ok_or("the ID token's claims cannot be read")?;

  let audience_matches = match &claims["aud"] {
    Value::String(audience) => *audience == credentials.client_id,
    Value::Array(audiences) => audiences.iter().any(|audience| audience.as_str() == Some(&credentials.client_id)),
    _ => false,
  };
  if !audience_matches {
    return Err("the ID token is for another client".to_owned());
  }
  if !claims["iss"].as_str().is_some_and(|issuer| is_accepted_issuer(issuer, overrides)) {
    return Err("the ID token is not from the expected issuer".to_owned());
  }
  if claims["exp"].as_i64().is_none_or(|expiry| now.timestamp() >= expiry) {
    return Err("the ID token has expired".to_owned());
  }
  if !claims["nonce"]
    .as_str()
    .is_some_and(|value| bool::from(value.as_bytes().ct_eq(nonce.as_bytes())))
  {
    return Err("the ID token's nonce does not match the sign-in cookie".to_owned());
  }
  claims["sub"]
    .as_str()
    .filter(|subject| !is_blank(Some(subject)))
    .map(str::to_owned)
    .ok_or_else(|| "the ID token has no subject".to_owned())
}

/// The claims Google's userinfo endpoint returns about the person signing in.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GoogleUser {
  /// `sub`: Google's stable id of the account.
  pub sub: Option<String>,
  /// `email`.
  pub email: Option<String>,
  /// `email_verified`: only JSON `true` counts.
  pub email_verified: bool,
  /// `name`.
  pub name: Option<String>,
  /// `picture`.
  pub picture: Option<String>,
}

impl GoogleUser {
  /// Reads the claims from a userinfo document.
  pub fn from_claims(claims: &Value) -> Self {
    let text = |name: &str| claims[name].as_str().map(str::to_owned);
    Self {
      sub: text("sub"),
      email: text("email"),
      email_verified: claims["email_verified"] == Value::Bool(true),
      name: text("name"),
      picture: text("picture"),
    }
  }
}

async fn fetch_user(state: &AppState, access_token: &str) -> Result<GoogleUser, String> {
  let response = state
    .http()
    .ok_or("Google sign-in is not configured")?
    .get(&state.google_endpoints().user_info)
    .bearer_auth(access_token)
    .header(reqwest::header::ACCEPT, "application/json")
    .send()
    .await
    .map_err(|error| format!("the userinfo request failed: {}", error.without_url()))?;
  if !response.status().is_success() {
    return Err(format!("the userinfo endpoint answered {}", response.status()));
  }
  let claims: Value = response.json().await.map_err(|_| "the userinfo response is not JSON".to_owned())?;
  Ok(GoogleUser::from_claims(&claims))
}

/// Why a person who authenticated with Google is not signed in.
#[derive(Debug, thiserror::Error)]
pub enum SignInError {
  /// The email is not verified or not on the allow-list.
  #[error("Access denied")]
  AccessDenied,
  /// Google sent no subject, so the account cannot be told apart from others.
  #[error("The identity provider sent no subject.")]
  NoSubject,
  /// The user row could not be resolved.
  #[error("the user could not be resolved: {0}")]
  Directory(String),
}

/// Signs in a person Google authenticated: checks the allow-list, then [`attach_user`].
pub async fn sign_in(state: &AppState, user: &GoogleUser) -> Result<Principal, SignInError> {
  if !state.settings().is_allowed(user.email.as_deref(), user.email_verified) {
    return Err(SignInError::AccessDenied);
  }
  let email = user.email.as_deref().ok_or(SignInError::AccessDenied)?;
  attach_user(state, user.sub.as_deref(), email, user.name.as_deref(), user.picture.as_deref()).await
}

/// Resolves the signed-in person's `users` row from their Google claims and returns the principal that
/// carries its id (ADR-0041, `ApiAuthentication.AttachUserAsync`). Fails when Google sent no subject.
pub async fn attach_user(
  state: &AppState,
  subject: Option<&str>,
  email: &str,
  name: Option<&str>,
  picture: Option<&str>,
) -> Result<Principal, SignInError> {
  let subject = subject.filter(|subject| !is_blank(Some(subject))).ok_or(SignInError::NoSubject)?;
  let mut connection = state.db().await.map_err(|error| SignInError::Directory(error.to_string()))?;
  let sign_in = SignIn {
    email,
    google_subject: Some(subject),
    display_name: name,
    picture_url: picture,
  };
  let user = users::resolve(&mut connection, state.now(), &sign_in, state.settings().first_allowed_email())
    .await
    .map_err(|error| SignInError::Directory(error.to_string()))?;
  Ok(Principal {
    user_id: user.id(),
    name: name.map(str::to_owned),
    email: Some(email.to_owned()),
    picture: picture.map(str::to_owned),
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use chrono::TimeZone;
  use serde_json::json;

  #[test]
  fn return_urls_are_local() {
    assert_eq!(local_return_url(Some("/day/2026-10-29?x=1")), "/day/2026-10-29?x=1");
    assert_eq!(local_return_url(Some("/")), "/");
    assert_eq!(local_return_url(Some("//evil.test")), "/");
    assert_eq!(local_return_url(Some("/\\evil.test")), "/");
    assert_eq!(local_return_url(Some("/a\\b")), "/");
    assert_eq!(local_return_url(Some("/a\nb")), "/");
    assert_eq!(local_return_url(Some("https://evil.test")), "/");
    assert_eq!(local_return_url(Some("")), "/");
    assert_eq!(local_return_url(None), "/");
  }

  fn token(claims: &Value) -> String {
    format!("e30.{}.signature", URL_SAFE_NO_PAD.encode(claims.to_string()))
  }

  #[test]
  fn the_id_token_must_be_for_this_client_from_google_fresh_and_carry_the_nonce() {
    let credentials = GoogleCredentials {
      client_id: "client".to_owned(),
      client_secret: "secret".to_owned(),
    };
    let now = Utc.with_ymd_and_hms(2026, 10, 26, 15, 0, 0).unwrap();
    // A fresh nonce per run, as in a real sign-in, rather than a literal.
    let nonce = uuid::Uuid::new_v4().to_string();
    let nonce = nonce.as_str();
    let good = json!({"aud": "client", "iss": "https://accounts.google.com", "exp": now.timestamp() + 60, "nonce": nonce, "sub": "s"});
    assert_eq!(
      check_id_token(&token(&good), &credentials, &GoogleOverrides::default(), nonce, now),
      Ok("s".to_owned())
    );

    let with = |name: &str, value: Value| {
      let mut claims = good.clone();
      claims[name] = value;
      check_id_token(&token(&claims), &credentials, &GoogleOverrides::default(), nonce, now)
    };
    assert_eq!(with("aud", json!(["other", "client"])), Ok("s".to_owned()));
    assert_eq!(with("iss", json!("accounts.google.com")), Ok("s".to_owned()));
    assert!(with("aud", json!("other")).is_err());
    assert!(with("iss", json!("https://evil.test")).is_err());
    assert!(with("exp", json!(now.timestamp())).is_err());
    assert!(with("nonce", json!("other")).is_err());
    assert!(with("sub", json!(" ")).is_err());
    assert!(check_id_token("not-a-jwt", &credentials, &GoogleOverrides::default(), nonce, now).is_err());
  }

  #[test]
  fn an_overriding_issuer_is_the_only_one_accepted() {
    let credentials = GoogleCredentials {
      client_id: "client".to_owned(),
      client_secret: "secret".to_owned(),
    };
    let overrides = GoogleOverrides {
      issuer: Some("http://127.0.0.1:55280/google".to_owned()),
      ..GoogleOverrides::default()
    };
    let now = Utc.with_ymd_and_hms(2026, 11, 13, 15, 0, 0).unwrap();
    let nonce = uuid::Uuid::new_v4().to_string();
    let check = |issuer: &str| {
      let claims = json!({"aud": "client", "iss": issuer, "exp": now.timestamp() + 60, "nonce": nonce, "sub": "s"});
      check_id_token(&token(&claims), &credentials, &overrides, &nonce, now)
    };
    assert_eq!(check("http://127.0.0.1:55280/google"), Ok("s".to_owned()));
    assert!(check("https://accounts.google.com").is_err());
    assert!(check("accounts.google.com").is_err());
    assert!(check("http://127.0.0.1:55280/other").is_err());
  }

  #[test]
  fn endpoint_overrides_replace_only_their_own_endpoint() {
    let overrides = GoogleOverrides {
      token_endpoint: Some(" http://127.0.0.1:55280/google/token ".to_owned()),
      ..GoogleOverrides::default()
    };
    let endpoints = GoogleEndpoints::default().overridden_by(&overrides);
    assert_eq!(endpoints.token, "http://127.0.0.1:55280/google/token");
    assert_eq!(endpoints.authorize, GoogleEndpoints::default().authorize);
    assert_eq!(endpoints.user_info, GoogleEndpoints::default().user_info);
    assert_eq!(
      GoogleEndpoints::default().overridden_by(&GoogleOverrides::default()),
      GoogleEndpoints::default()
    );
  }

  #[test]
  fn only_json_true_verifies_an_email() {
    assert!(GoogleUser::from_claims(&json!({"email_verified": true})).email_verified);
    assert!(!GoogleUser::from_claims(&json!({"email_verified": "true"})).email_verified);
    assert!(!GoogleUser::from_claims(&json!({})).email_verified);
  }
}
