use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::json::{self, FromJson, JsonResult};

/// The body of `GET /api/health`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(description = "")]
pub struct HealthResponse {
  #[allow(missing_docs, reason = "undocumented in the contract")]
  pub status: String,
}

/// The signed-in person, as `GET /api/auth/me` returns them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(description = "")]
pub struct AuthUserResponse {
  #[allow(missing_docs, reason = "undocumented in the contract")]
  pub name: String,
  #[allow(missing_docs, reason = "undocumented in the contract")]
  pub email: String,
  #[allow(missing_docs, reason = "undocumented in the contract")]
  #[schema(required = true)]
  pub picture_url: Option<String>,
}

/// Redeem a native sign-in's handover code for a session (the desktop app's loopback sign-in).
#[derive(Debug, Clone, PartialEq, Eq, ToSchema)]
#[schema(rename_all = "camelCase")]
pub struct NativeSessionRequest {
  /// The `code` the API sent to the app's loopback redirect.
  pub code: String,
  /// The PKCE code verifier whose S256 challenge the app sent to `GET /api/auth/login`.
  pub code_verifier: String,
  /// The loopback redirect URI the app sent to `GET /api/auth/login`.
  pub redirect_uri: String,
}

/// A property of [`NativeSessionRequest`].
#[derive(Debug, Clone, Copy)]
enum NativeSessionProperty {
  Code,
  CodeVerifier,
  RedirectUri,
}

const NATIVE_SESSION_PROPERTIES: [(&str, NativeSessionProperty); 3] = [
  ("code", NativeSessionProperty::Code),
  ("codeVerifier", NativeSessionProperty::CodeVerifier),
  ("redirectUri", NativeSessionProperty::RedirectUri),
];

impl FromJson for NativeSessionRequest {
  const TYPE_NAME: &'static str = "Calendar.Api.Contracts.NativeSessionRequest";

  fn from_json(value: &Value, path: &str) -> JsonResult<Self> {
    let (mut code, mut code_verifier, mut redirect_uri) = (None, None, None);
    for (key, value) in json::object(value, path, Self::TYPE_NAME)? {
      let Some((name, property)) = json::property(&NATIVE_SESSION_PROPERTIES, key) else {
        continue;
      };
      let read = Some(json::string(value, &json::child(path, name))?.unwrap_or_default());
      match property {
        NativeSessionProperty::Code => code = read,
        NativeSessionProperty::CodeVerifier => code_verifier = read,
        NativeSessionProperty::RedirectUri => redirect_uri = read,
      }
    }
    match (code, code_verifier, redirect_uri) {
      (Some(code), Some(code_verifier), Some(redirect_uri)) => Ok(Self {
        code,
        code_verifier,
        redirect_uri,
      }),
      (code, code_verifier, redirect_uri) => {
        let missing: Vec<&str> = [
          code.is_none().then_some("code"),
          code_verifier.is_none().then_some("codeVerifier"),
          redirect_uri.is_none().then_some("redirectUri"),
        ]
        .into_iter()
        .flatten()
        .collect();
        Err(json::missing_required(path, Self::TYPE_NAME, &missing))
      }
    }
  }
}
