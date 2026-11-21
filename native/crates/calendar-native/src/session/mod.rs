//! The signed-in session. **A stub owned by #1008 (worker S3)**: the signatures are agreed on #1008 and stay;
//! #1008 replaces the bodies with the browser loopback sign-in (ADR-0068), the keyring cookie store and sign-out.

use crate::App;
use crate::theme;
use calendar_client::AuthUserResponse;
use rune::{Cx, El, col, text};

/// Where the session stands.
#[derive(Clone, Debug)]
pub enum Session {
  /// `/api/auth/me` is being asked.
  Checking,
  /// Not signed in; `error` says why when something failed.
  SignedOut { error: Option<String> },
  /// The browser sign-in is under way (#1008).
  SigningIn,
  /// Signed in as this user.
  SignedIn(AuthUserResponse),
}

/// The HTTP client every API call goes through. The stub keeps cookies in memory on the desktop; #1008 loads and
/// stores them in the OS credential store. On wasm32 the browser sends the same-origin cookie.
#[must_use]
pub fn http_client(_origin: &str) -> calendar_client::reqwest::Client {
  #[cfg(not(target_arch = "wasm32"))]
  {
    calendar_client::reqwest::Client::builder()
      .cookie_store(true)
      .build()
      .expect("an HTTP client")
  }
  #[cfg(target_arch = "wasm32")]
  {
    calendar_client::reqwest::Client::new()
  }
}

/// What the window shows while not signed in.
pub fn view(session: &Session, cx: &mut Cx<App>) -> El {
  let t = theme::tokens(cx.system_dark());
  let message = match session {
    Session::Checking => "Checking session…".to_owned(),
    Session::SigningIn => "Waiting for the browser…".to_owned(),
    Session::SignedOut { error: Some(error) } => error.clone(),
    Session::SignedOut { error: None } | Session::SignedIn(_) => "You are signed out.".to_owned(),
  };
  col()
    .key("session")
    .role("main")
    .w_full()
    .h_full()
    .padding(24.0)
    .fill(t.bg)
    .child(text(message).key("session-message").role("status").color(t.text))
}

/// Starts signing in (#1008).
pub fn start(app: &mut App) {
  app.session = Session::SignedOut {
    error: Some("Signing in from the native app arrives with #1008.".to_owned()),
  };
}

/// Signs out (#1008).
pub fn sign_out(app: &mut App) {
  app.session = Session::SignedOut { error: None };
}

/// The API answered 401: the session is over.
pub fn on_unauthorized(app: &mut App) {
  app.session = Session::SignedOut { error: None };
}
