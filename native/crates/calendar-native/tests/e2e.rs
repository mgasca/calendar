//! The Rune app's user flows end to end (#1010, story 0064 for the native app): the real app, headless through
//! Rune's `Runtime` (no window, no GPU), against a throwaway stack from `just e2e up` (ADR-0063), with the stub
//! `OpenID Connect` provider standing in for Google (ADR-0064). Each test is tagged with its CALM flow
//! (`// @flow:<id>`, checked by the flow binding in `frontend/apps/e2e/src/binding`) and proves the flow observable
//! in otel-stack, as the web app's flow tests do: one trace per user action, its API logs, its request metrics, and
//! no personal data in any of them.
//!
//! The tests are `#[ignore]`d, so `just native test` skips them; `just e2e native` starts a stack and runs them one
//! at a time (`--ignored --test-threads=1`), and `just e2e native-on <project>` runs them against a running one.
//! The session lives in memory: they never touch the person's keyring.
#![cfg(not(target_arch = "wasm32"))]

#[path = "e2e/browser.rs"]
mod browser;
#[path = "e2e/telemetry.rs"]
mod telemetry;

use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use calendar_native::clock::Clock;
use calendar_native::fetch::Effects;
use calendar_native::session::{self, Session, store::Store};
use calendar_native::{App, load, view};
use rune::{Env, Runtime};

use browser::Person;
use telemetry::{Action, Backends, Expect, Flow, Http, PersonalData, api, route};

/// The app's statics (its origin, cookie jar and browser opener) are per process, and each flow test owns the
/// telemetry since it began: one test at a time.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// The settings `just e2e up` writes to the run's `stack.env`.
struct Stack {
  web_url: String,
  email: String,
  backends: Backends,
}

fn stack() -> Stack {
  let read = |name: &str| {
    std::env::var(name).unwrap_or_else(|_| {
      panic!(
        "No end-to-end stack: {name} is not set. Run these tests with 'just e2e native', or against a running stack \
         with 'just e2e native-on <project>' (see 'just e2e ls')."
      )
    })
  };
  Stack {
    web_url: read("CALENDAR_E2E_WEB_URL"),
    email: read("CALENDAR_E2E_ALLOWED_EMAIL"),
    backends: Backends {
      tempo: read("CALENDAR_E2E_TEMPO_URL"),
      loki: read("CALENDAR_E2E_LOKI_URL"),
      prometheus: read("CALENDAR_E2E_PROMETHEUS_URL"),
    },
  }
}

/// The real app on the stack's origin, as the desktop build runs it (background effects, the system clock), but
/// headless and with its session in memory, starting signed out.
fn app(stack: &Stack) -> Runtime<App> {
  session::store::use_memory_store();
  Store::for_origin(&stack.web_url).clear();
  let app = App::new(&stack.web_url, Clock::system(), Effects::background());
  let mut rt = Runtime::new(
    app,
    view,
    (960.0, 1200.0),
    Env {
      system_dark: false,
      scale: 1.0,
    },
  );
  rt.frame(0.0);
  rt
}

/// Runs the app's poll (finished requests applied, then whatever the page needs fetched) and draws frames until
/// `done`, as the window's event loop would.
fn run_until(rt: &mut Runtime<App>, what: &str, timeout: Duration, done: impl Fn(&App) -> bool) {
  let deadline = Instant::now() + timeout;
  loop {
    let effects = rt.state.effects.clone();
    effects.drain(&mut rt.state);
    load::ensure(&mut rt.state);
    rt.frame(1.0 / 60.0);
    if done(&rt.state) {
      rt.settle_all();
      rt.frame(1.0 / 60.0);
      return;
    }
    assert!(
      Instant::now() < deadline,
      "{what}: not within {} s (session: {:?})",
      timeout.as_secs(),
      rt.state.session
    );
    std::thread::sleep(Duration::from_millis(20));
  }
}

fn press(rt: &mut Runtime<App>, key: &str) {
  let (x, y) = rt.find(key).unwrap_or_else(|| panic!("no element keyed {key}"));
  rt.pointer_down(x, y);
  rt.pointer_up(x, y);
  rt.frame(1.0 / 60.0);
  rt.settle_all();
  rt.frame(1.0 / 60.0);
}

fn signed_out(app: &App) -> bool {
  matches!(app.session, Session::SignedOut { .. })
}

/// The routes every native sign-in hits up to the stub's callback.
const UP_TO_THE_CALLBACK: [telemetry::Route; 4] = [
  route("GET", "/api/auth/native/start", 1),
  // Signed out, then signed in: the redirect to the web sign-in, then the confirm page.
  route("GET", "/api/auth/native/confirm", 1),
  route("GET", "/api/auth/login", 1),
  route("GET", "/api/auth/callback/google", 1),
];

fn root(http: &Http, stack: &Stack, since: SystemTime, name: &str, expect: Expect) -> Action {
  Action {
    trace_id: telemetry::root_trace(http, &stack.backends, name, since),
    expect,
    logs: &[],
  }
}

fn chain(chain: Vec<telemetry::Matcher>) -> Expect {
  Expect { chain, spans: vec![] }
}

// @flow:sign-in-flow
#[test]
#[ignore = "needs an end-to-end stack: just e2e native"]
fn an_allow_listed_person_signs_in_through_the_browser_and_the_round_trip_is_traced_logged_and_measured_without_personal_data() {
  let _one = ONE_AT_A_TIME.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  let stack = stack();
  let http = Http::new();
  let since = SystemTime::now();
  let routes = [
    route("GET", "/api/auth/native/start", 1),
    route("GET", "/api/auth/native/confirm", 2),
    route("GET", "/api/auth/login", 1),
    route("GET", "/api/auth/callback/google", 1),
    route("POST", "/api/auth/native/confirm", 1),
    route("POST", "/api/auth/native/token", 1),
    // The check before signing in (401) and the one after (200).
    route("GET", "/api/auth/me", 2),
  ];
  let before = telemetry::request_counts(&http, &stack.backends, &routes);
  let visits = browser::install(
    &stack.web_url,
    Person {
      email: stack.email.clone(),
      email_verified: true,
    },
  );

  let mut rt = app(&stack);
  run_until(&mut rt, "the session check", Duration::from_secs(30), signed_out);
  press(&mut rt, "sign-in");
  assert!(matches!(rt.state.session, Session::SigningIn), "{:?}", rt.state.session);
  run_until(&mut rt, "signed in", Duration::from_secs(60), |app| {
    matches!(app.session, Session::SignedIn(_))
  });
  let visit = visits.recv_timeout(Duration::from_secs(5)).expect("the browser finished");
  assert_eq!(visit.error, None);
  assert!(
    visit.landed.starts_with("http://127.0.0.1:"),
    "the browser ends on the loopback: {}",
    visit.landed
  );

  // Signed in as the allow-listed person, with the session kept for the next start.
  let Session::SignedIn(user) = &rt.state.session else {
    unreachable!()
  };
  assert_eq!(user.email, stack.email);
  assert!(rt.find("sign-out").is_some(), "the signed-in shell");
  let cookie = Store::for_origin(&stack.web_url).load().expect("the session is stored");

  let mut personal = PersonalData::default();
  personal.add("the email signing in", &stack.email);
  personal.add("the user's name", &user.name);
  personal.add("the app's session cookie", &cookie);
  for (description, value) in &visit.secrets {
    personal.add(description, value);
  }

  // The browser's steps are full-page navigations, so each is a trace the API starts. The app's own requests carry
  // its traceparent: the redemption and the session check after it are one trace, the sign-in's.
  let sign_in = telemetry::trace_with_span(&http, &stack.backends, "POST /api/auth/native/token", since);
  telemetry::expect_flow(
    &http,
    &stack.backends,
    &Flow {
      since,
      personal: &personal,
      actions: vec![
        root(
          &http,
          &stack,
          since,
          "GET /api/auth/native/start",
          chain(vec![api(&["GET /api/auth/native/start"])]),
        ),
        root(
          &http,
          &stack,
          since,
          "GET /api/auth/login",
          chain(vec![api(&["GET /api/auth/login"])]),
        ),
        root(
          &http,
          &stack,
          since,
          "GET /api/auth/callback/google",
          chain(vec![
            api(&["GET /api/auth/callback/google"]),
            api(&["SELECT users", "UPDATE users", "INSERT users"]),
          ]),
        ),
        root(
          &http,
          &stack,
          since,
          "POST /api/auth/native/confirm",
          chain(vec![api(&["POST /api/auth/native/confirm"])]),
        ),
        Action {
          trace_id: sign_in,
          expect: Expect {
            // The redemption checks that the person still exists.
            chain: vec![api(&["POST /api/auth/native/token"]), api(&["SELECT users"])],
            spans: vec![api(&["GET /api/auth/me"])],
          },
          logs: &[],
        },
      ],
      routes: &routes,
      before: &before,
    },
  );
}

/// A sign-in the API refuses at the callback: the browser lands on the web app's access-denied page and never on the
/// app's loopback, so the app keeps waiting until **Cancel**, then is signed out with nothing stored, and no code was
/// redeemed.
fn refused_sign_in(person: Person, logs: &'static [&'static str]) {
  let _one = ONE_AT_A_TIME.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  let stack = stack();
  let http = Http::new();
  let since = SystemTime::now();
  let before = telemetry::request_counts(&http, &stack.backends, &UP_TO_THE_CALLBACK);
  let email = person.email.clone();
  let visits = browser::install(&stack.web_url, person);

  let mut rt = app(&stack);
  run_until(&mut rt, "the session check", Duration::from_secs(30), signed_out);
  press(&mut rt, "sign-in");
  let visit = visits.recv_timeout(Duration::from_secs(60)).expect("the browser finished");
  assert_eq!(visit.error, None);
  assert!(
    visit.landed.ends_with("/signin?error=access_denied"),
    "the browser lands on the access-denied page: {}",
    visit.landed
  );
  assert!(
    matches!(rt.state.session, Session::SigningIn),
    "the app is still waiting: {:?}",
    rt.state.session
  );
  press(&mut rt, "cancel-sign-in");
  run_until(&mut rt, "signed out", Duration::from_secs(5), |app| {
    matches!(app.session, Session::SignedOut { error: None })
  });
  assert!(rt.find("sign-in").is_some(), "the sign-in screen is back");
  assert_eq!(Store::for_origin(&stack.web_url).load(), None, "nothing is stored");

  let mut personal = PersonalData::default();
  personal.add("the email signing in", &email);
  for (description, value) in &visit.secrets {
    personal.add(description, value);
  }
  telemetry::expect_flow(
    &http,
    &stack.backends,
    &Flow {
      since,
      personal: &personal,
      actions: vec![
        root(
          &http,
          &stack,
          since,
          "GET /api/auth/native/start",
          chain(vec![api(&["GET /api/auth/native/start"])]),
        ),
        root(
          &http,
          &stack,
          since,
          "GET /api/auth/login",
          chain(vec![api(&["GET /api/auth/login"])]),
        ),
        Action {
          // The callback refuses before any query, and the API logs why.
          trace_id: telemetry::root_trace(&http, &stack.backends, "GET /api/auth/callback/google", since),
          expect: chain(vec![api(&["GET /api/auth/callback/google"])]),
          logs,
        },
      ],
      routes: &UP_TO_THE_CALLBACK,
      before: &before,
    },
  );
  // Every trace since the test began is in Tempo by now, and none redeemed a code.
  assert_eq!(
    telemetry::traces_with_span(&http, &stack.backends, "POST /api/auth/native/token", since),
    Ok(vec![]),
    "a refused sign-in redeems no code"
  );
}

// @flow:sign-in-flow
#[test]
#[ignore = "needs an end-to-end stack: just e2e native"]
fn a_person_whose_email_is_not_allow_listed_never_reaches_the_app_and_cancel_leaves_it_signed_out() {
  let run = SystemTime::now()
    .duration_since(SystemTime::UNIX_EPOCH)
    .map_or(0, |since| since.as_millis());
  refused_sign_in(
    Person {
      email: format!("denied-{run}@example.com"),
      email_verified: true,
    },
    &["request finished", "Google sign-in failed"],
  );
}

// @flow:sign-in-flow
#[test]
#[ignore = "needs an end-to-end stack: just e2e native"]
fn an_unverified_email_never_reaches_the_app_and_cancel_leaves_it_signed_out() {
  let stack = stack();
  refused_sign_in(
    Person {
      email: stack.email,
      email_verified: false,
    },
    &["request finished", "Google sign-in failed"],
  );
}
