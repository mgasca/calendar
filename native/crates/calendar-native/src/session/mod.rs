//! The signed-in session (ADR-0068, #1008). S3 owns this module; the shell, the views and the effects are S2's, and
//! the signatures below are the ones agreed on #1008.
//!
//! - **Desktop:** **Sign in with Google** opens the system browser at `GET /api/auth/native/start`. The browser runs
//!   the Google sign-in and the confirm click, and the API redirects to a one-request loopback listener
//!   ([`loopback`]) with a 60-second code. The app redeems the code with its PKCE verifier ([`pkce`], [`flow`]) for
//!   the ordinary `calendar_session` cookie, which lands in the cookie jar every API call shares and is kept in the
//!   OS credential store, or in memory when there is none ([`store`]). A restart loads it, so `/api/auth/me` signs
//!   the app straight back in until the session's eight hours are over.
//! - **Browser (WASM):** same origin, so the browser's own cookie and today's `/api/auth/login?returnUrl=/native/`
//!   flow apply.

#[cfg(not(target_arch = "wasm32"))]
pub mod flow;
#[cfg(not(target_arch = "wasm32"))]
pub mod loopback;
#[cfg(not(target_arch = "wasm32"))]
pub mod pkce;
#[cfg(not(target_arch = "wasm32"))]
pub mod store;

use std::sync::Mutex;

use crate::App;
use crate::theme;
use crate::views;
use calendar_client::AuthUserResponse;
use rune::tok::type_;
use rune::{Cx, El, col, text};

/// Where the session stands.
#[derive(Clone, Debug)]
pub enum Session {
  /// `/api/auth/me` is being asked.
  Checking,
  /// Not signed in; `error` says why when something failed.
  SignedOut { error: Option<String> },
  /// The browser sign-in is under way.
  SigningIn,
  /// Signed in as this user.
  SignedIn(AuthUserResponse),
}

/// The origin [`http_client`] was built for. One app runs per process.
static ORIGIN: Mutex<Option<String>> = Mutex::new(None);

/// On the desktop, the cookie jar the API client shares with sign-in and sign-out.
#[cfg(not(target_arch = "wasm32"))]
type ClientParts = std::sync::Arc<calendar_client::reqwest::cookie::Jar>;

#[cfg(not(target_arch = "wasm32"))]
static JAR: Mutex<Option<ClientParts>> = Mutex::new(None);

fn current_origin() -> Option<String> {
  ORIGIN.lock().ok()?.clone()
}

#[cfg(not(target_arch = "wasm32"))]
fn current() -> Option<(String, ClientParts)> {
  Some((current_origin()?, JAR.lock().ok()?.clone()?))
}

/// The HTTP client every API call goes through. On the desktop its cookie jar starts with the stored session, if
/// any, and receives the one a sign-in redeems. On wasm32 the browser sends the same-origin cookie.
#[must_use]
pub fn http_client(origin: &str) -> calendar_client::reqwest::Client {
  if let Ok(mut current) = ORIGIN.lock() {
    *current = Some(origin.to_owned());
  }
  #[cfg(not(target_arch = "wasm32"))]
  {
    let jar = std::sync::Arc::new(calendar_client::reqwest::cookie::Jar::default());
    if let Some(cookie) = store::Store::for_origin(origin).load() {
      add_cookie(&jar, origin, &cookie);
    }
    if let Ok(mut current) = JAR.lock() {
      *current = Some(jar.clone());
    }
    client_with(jar)
  }
  #[cfg(target_arch = "wasm32")]
  {
    calendar_client::reqwest::Client::new()
  }
}

#[cfg(not(target_arch = "wasm32"))]
fn client_with(jar: ClientParts) -> calendar_client::reqwest::Client {
  calendar_client::reqwest::Client::builder()
    .cookie_provider(jar)
    .build()
    .expect("an HTTP client")
}

/// What the window shows while not signed in: the sign-in screen, the wait for the browser with **Cancel**, or the
/// session check.
pub fn view(session: &Session, cx: &mut Cx<App>) -> El {
  let t = theme::tokens(cx.system_dark());
  let screen = col()
    .key("session")
    .role("main")
    .w_full()
    .h_full()
    .padding(24.0)
    .gap(12.0)
    .fill(t.bg);
  match session {
    Session::Checking | Session::SignedIn(_) => {
      screen.child(text("Checking session…").key("session-message").role("status").color(t.text_muted))
    }
    Session::SigningIn => screen
      .child(
        text("Sign in")
          .key("sign-in-heading")
          .role("heading")
          .font(type_::TITLE)
          .color(t.text),
      )
      .child(
        text("Waiting for the browser… Finish signing in there, then come back to this window.")
          .key("session-message")
          .role("status")
          .color(t.text),
      )
      .child(views::button("cancel-sign-in", "Cancel", &t).on_press(cancel)),
    Session::SignedOut { error } => {
      let screen = screen.child(
        text("Sign in")
          .key("sign-in-heading")
          .role("heading")
          .font(type_::TITLE)
          .color(t.text),
      );
      let screen = match error {
        Some(error) => screen.child(text(error.clone()).key("session-message").role("alert").color(t.error)),
        None => screen.child(
          text("Sign in with your Google account to see your calendar.")
            .key("session-message")
            .role("status")
            .color(t.text_muted),
        ),
      };
      screen.child(views::button("sign-in", "Sign in with Google", &t).on_press(start))
    }
  }
}

/// The sign-in attempt in progress: a result is applied only while it is still the current one, so **Cancel** and a
/// newer attempt win over a late answer.
static ATTEMPT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn next_attempt() -> u64 {
  ATTEMPT.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
}

#[cfg(not(target_arch = "wasm32"))]
fn is_current(attempt: u64) -> bool {
  ATTEMPT.load(std::sync::atomic::Ordering::SeqCst) == attempt
}

/// How the desktop app opens the start URL: the system browser, unless a test or the end-to-end driver (#1010)
/// installed its own with [`open_with`].
#[cfg(not(target_arch = "wasm32"))]
type Opener = Box<dyn Fn(&calendar_client::reqwest::Url) -> std::io::Result<()> + Send + Sync>;

#[cfg(not(target_arch = "wasm32"))]
static OPENER: Mutex<Option<Opener>> = Mutex::new(None);

/// Opens the start URL with `opener` instead of the system browser, for this process: the headless tests and the
/// end-to-end driver, which play the browser themselves.
#[cfg(not(target_arch = "wasm32"))]
pub fn open_with(opener: impl Fn(&calendar_client::reqwest::Url) -> std::io::Result<()> + Send + Sync + 'static) {
  if let Ok(mut slot) = OPENER.lock() {
    *slot = Some(Box::new(opener));
  }
}

#[cfg(not(target_arch = "wasm32"))]
fn open(url: &calendar_client::reqwest::Url) -> std::io::Result<()> {
  match OPENER.lock().ok().as_deref().and_then(Option::as_ref) {
    Some(opener) => opener(url),
    None => webbrowser::open(url.as_str()),
  }
}

/// Resolves once `attempt` is no longer the current one (**Cancel**, sign-out, a newer attempt), so the sign-in stops
/// waiting on the loopback and frees its port within a fifth of a second. Polling cannot miss a cancel that came
/// before the future first ran, as a notification could.
#[cfg(not(target_arch = "wasm32"))]
async fn superseded(attempt: u64) {
  while is_current(attempt) {
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
  }
}

/// Starts signing in: on the desktop the browser loopback flow, in the browser the web sign-in, back to `/native/`.
pub fn start(app: &mut App) {
  #[cfg(target_arch = "wasm32")]
  {
    app.session = Session::SigningIn;
    if let Some(window) = web_sys::window() {
      let _ = window.location().set_href("/api/auth/login?returnUrl=%2Fnative%2F");
    }
  }
  #[cfg(not(target_arch = "wasm32"))]
  {
    let Some((origin, jar)) = current() else {
      app.session = Session::SignedOut {
        error: Some("Sign-in could not start. Try again.".to_owned()),
      };
      return;
    };
    let attempt = next_attempt();
    app.session = Session::SigningIn;
    // Signing in is one user action, so its redemption and the session check after it share one trace (#1010).
    let parent = trace_parent();
    let api = app.api.traced(&parent);
    app.effects.run(
      async move {
        // The code is redeemed through a client of its own: the session reaches the shared jar only while this
        // attempt is still the current one, so a sign-in finished in the browser after Cancel signs nobody in.
        let client = flow::traced_client(&origin, &parent).ok()?;
        let signed_in = tokio::select! {
          signed_in = flow::sign_in(&origin, &client, open, loopback::TIMEOUT) => signed_in,
          () = superseded(attempt) => return None,
        };
        let cookie = match signed_in {
          Ok(cookie) => cookie,
          Err(error) => return Some(Err(error.message().to_owned())),
        };
        if !is_current(attempt) {
          return None;
        }
        store::Store::for_origin(&origin).save(&cookie);
        add_cookie(&jar, &origin, &cookie);
        Some(api.me().await.map_err(|_| "Sign-in was not accepted. Try again.".to_owned()))
      },
      move |app: &mut App, outcome: Option<Result<AuthUserResponse, String>>| {
        if !is_current(attempt) || !matches!(app.session, Session::SigningIn) {
          return;
        }
        if let Some(outcome) = outcome {
          app.session = match outcome {
            Ok(user) => Session::SignedIn(user),
            Err(error) => Session::SignedOut { error: Some(error) },
          };
        }
      },
    );
  }
}

/// A new trace for one user action: random ids, never the all-zero ones W3C Trace Context makes invalid.
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn trace_parent() -> calendar_client::TraceParent {
  loop {
    if let Some(parent) = calendar_client::TraceParent::new(rand::random(), rand::random()) {
      return parent;
    }
  }
}

/// Stops waiting for the browser.
pub fn cancel(app: &mut App) {
  next_attempt();
  app.session = Session::SignedOut { error: None };
}

/// Signs out: `POST /api/auth/logout`, then the stored cookie is forgotten whatever the answer (ADR-0068,
/// "Sign-out"). Signing out of the desktop app does not sign the browser out of the web app.
pub fn sign_out(app: &mut App) {
  next_attempt();
  app.session = Session::SignedOut { error: None };
  #[cfg(not(target_arch = "wasm32"))]
  if let Some((origin, parts)) = current() {
    store::Store::for_origin(&origin).clear();
    let client = client_with(parts.clone());
    app
      .effects
      .run(async move { flow::sign_out(&origin, &client).await }, move |_app: &mut App, ()| {
        forget_cookie(&parts);
      });
  }
  #[cfg(target_arch = "wasm32")]
  if let Some(origin) = current_origin() {
    app.effects.run(
      async move {
        let _ = calendar_client::reqwest::Client::new()
          .post(format!("{origin}/api/auth/logout"))
          .send()
          .await;
      },
      |_app: &mut App, ()| {},
    );
  }
}

/// The API answered 401: the session is over, so the stored cookie goes too. Only the first 401 does this: the other
/// requests in flight when a session expires answer 401 as well, and each would repeat a blocking keyring call on the
/// UI thread.
pub fn on_unauthorized(app: &mut App) {
  if matches!(app.session, Session::SignedOut { .. }) {
    return;
  }
  next_attempt();
  #[cfg(not(target_arch = "wasm32"))]
  if let Some((origin, jar)) = current() {
    store::Store::for_origin(&origin).clear();
    forget_cookie(&jar);
  }
  app.session = Session::SignedOut { error: None };
}

/// Puts the session cookie in the shared jar for `origin`.
#[cfg(not(target_arch = "wasm32"))]
fn add_cookie(jar: &ClientParts, origin: &str, cookie: &str) {
  if let Ok(url) = calendar_client::reqwest::Url::parse(origin) {
    jar.add_cookie_str(&format!("{}={cookie}; Path=/; HttpOnly", flow::SESSION_COOKIE), &url);
  }
}

/// Drops the session cookie from the shared jar, so no later request sends it.
#[cfg(not(target_arch = "wasm32"))]
fn forget_cookie(jar: &ClientParts) {
  if let Some((origin, _)) = current()
    && let Ok(url) = calendar_client::reqwest::Url::parse(&origin)
  {
    jar.add_cookie_str(&format!("{}=; Max-Age=0; Path=/", flow::SESSION_COOKIE), &url);
  }
}
