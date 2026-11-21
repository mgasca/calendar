//! The one-request loopback listener of a desktop sign-in (RFC 8252, ADR-0068 step 1 and 5).
//!
//! It binds `127.0.0.1` on a port the OS picks (`[::1]` when IPv4 loopback is unavailable), only while a sign-in
//! runs, and waits for the browser's `GET /callback?code=…&state=…`. A request on another path, or one whose `state`
//! is not this attempt's, gets an error page and the listener keeps waiting, so another local process cannot end a
//! sign-in by sending it a wrong callback. It stops at the first callback with the right `state`, or after the
//! timeout.

use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::pkce::constant_time_eq;

/// How long the listener waits for the browser (ADR-0068, step 1).
pub const TIMEOUT: Duration = Duration::from_mins(5);

/// The most a callback request may send before its headers end.
const MAX_REQUEST: usize = 8 * 1024;

/// How long one connection may take to send its request.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Why no code came back.
#[derive(Debug, thiserror::Error)]
pub enum LoopbackError {
  /// Neither loopback address could be bound.
  #[error("cannot listen on the loopback address: {0}")]
  Bind(std::io::Error),
  /// The browser did not come back in time: the sign-in was abandoned or refused.
  #[error("the browser did not return to the app in time")]
  TimedOut,
  /// Accepting a connection failed.
  #[error("the loopback listener failed: {0}")]
  Accept(std::io::Error),
}

/// A bound listener, waiting for one callback.
#[derive(Debug)]
pub struct Loopback {
  listener: TcpListener,
  address: SocketAddr,
}

impl Loopback {
  /// Binds the loopback on a port the OS picks.
  ///
  /// # Errors
  ///
  /// [`LoopbackError::Bind`] when neither `127.0.0.1` nor `[::1]` can be bound.
  pub async fn bind() -> Result<Self, LoopbackError> {
    let listener = match TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await {
      Ok(listener) => listener,
      Err(_) => TcpListener::bind((Ipv6Addr::LOCALHOST, 0)).await.map_err(LoopbackError::Bind)?,
    };
    let address = listener.local_addr().map_err(LoopbackError::Bind)?;
    Ok(Self { listener, address })
  }

  /// The redirect URI the API sends the browser to: `http://127.0.0.1:{port}/callback` or `http://[::1]:…`.
  #[must_use]
  pub fn redirect_uri(&self) -> String {
    match self.address {
      SocketAddr::V4(address) => format!("http://{}:{}/callback", address.ip(), address.port()),
      SocketAddr::V6(address) => format!("http://[{}]:{}/callback", address.ip(), address.port()),
    }
  }

  /// Waits up to `timeout` for the callback that carries `state`, and returns its `code`.
  ///
  /// # Errors
  ///
  /// [`LoopbackError::TimedOut`] when no such callback arrives in time, [`LoopbackError::Accept`] when the listener
  /// fails.
  pub async fn wait(self, state: &str, timeout: Duration) -> Result<String, LoopbackError> {
    tokio::time::timeout(timeout, async {
      loop {
        let (stream, _) = self.listener.accept().await.map_err(LoopbackError::Accept)?;
        if let Some(code) = answer(stream, state).await {
          return Ok(code);
        }
      }
    })
    .await
    .unwrap_or(Err(LoopbackError::TimedOut))
  }
}

/// Reads one request and answers it: the `code` when it is this attempt's callback, `None` otherwise.
async fn answer(mut stream: TcpStream, state: &str) -> Option<String> {
  let request = tokio::time::timeout(REQUEST_TIMEOUT, read_head(&mut stream)).await.ok().flatten();
  let code = request.as_deref().and_then(|head| callback_code(head, state));
  let (status, page) = match (&request, &code) {
    (_, Some(_)) => ("200 OK", SIGNED_IN_PAGE),
    (Some(head), None) if is_callback_path(head) => ("400 Bad Request", WRONG_CALLBACK_PAGE),
    _ => ("404 Not Found", NOT_FOUND_PAGE),
  };
  let response = format!(
    "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\n\
     Referrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{page}",
    page.len()
  );
  // The browser may already have gone; the code is what matters.
  let _ = stream.write_all(response.as_bytes()).await;
  let _ = stream.shutdown().await;
  code
}

/// The request line and headers, up to the blank line, or `None` when the request is too long or not text.
async fn read_head(stream: &mut TcpStream) -> Option<String> {
  let mut buffer = Vec::with_capacity(1024);
  let mut chunk = [0_u8; 1024];
  while !buffer.windows(4).any(|window| window == b"\r\n\r\n") {
    let read = stream.read(&mut chunk).await.ok()?;
    if read == 0 || buffer.len() + read > MAX_REQUEST {
      return None;
    }
    buffer.extend_from_slice(&chunk[..read]);
  }
  String::from_utf8(buffer).ok()
}

/// The target of `GET <target> HTTP/1.1`.
fn target(head: &str) -> Option<&str> {
  let mut parts = head.lines().next()?.split(' ');
  (parts.next()? == "GET").then_some(())?;
  parts.next()
}

fn is_callback_path(head: &str) -> bool {
  target(head).is_some_and(|target| target.split('?').next() == Some("/callback"))
}

/// The `code` of a `GET /callback?code=…&state=…` whose `state` is `expected`.
fn callback_code(head: &str, expected: &str) -> Option<String> {
  let (path, query) = target(head)?.split_once('?')?;
  if path != "/callback" {
    return None;
  }
  let (mut code, mut state) = (None, None);
  for (name, value) in form_urlencoded::parse(query.as_bytes()) {
    match name.as_ref() {
      "code" => code = Some(value.into_owned()),
      "state" => state = Some(value.into_owned()),
      _ => {}
    }
  }
  let state = state?;
  (constant_time_eq(&state, expected)).then_some(())?;
  code.filter(|code| !code.is_empty())
}

const SIGNED_IN_PAGE: &str = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Signed in</title></head>\
<body><h1>You are signed in</h1><p>You can close this tab and go back to the Calendar app.</p></body></html>";

const WRONG_CALLBACK_PAGE: &str = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Not this sign-in</title>\
</head><body><h1>This link is not for the sign-in in progress</h1><p>Start signing in again from the Calendar app.</p>\
</body></html>";

const NOT_FOUND_PAGE: &str = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Not found</title></head>\
<body><h1>Not found</h1></body></html>";

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_a_get_of_the_callback_with_this_state_yields_its_code() {
    let head = |target: &str| format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    assert_eq!(callback_code(&head("/callback?code=c1&state=s"), "s").as_deref(), Some("c1"));
    assert_eq!(callback_code(&head("/callback?state=s&code=a%2Bb"), "s").as_deref(), Some("a+b"));
    assert_eq!(callback_code(&head("/callback?code=c1&state=other"), "s"), None);
    assert_eq!(callback_code(&head("/callback?code=c1"), "s"), None);
    assert_eq!(callback_code(&head("/callback?code=&state=s"), "s"), None);
    assert_eq!(callback_code(&head("/elsewhere?code=c1&state=s"), "s"), None);
    assert_eq!(callback_code(&head("/callback/?code=c1&state=s"), "s"), None);
    assert_eq!(callback_code("POST /callback?code=c1&state=s HTTP/1.1\r\n\r\n", "s"), None);
    assert!(is_callback_path(&head("/callback?x")));
    assert!(!is_callback_path(&head("/favicon.ico")));
  }

  async fn send(address: &str, request: &str) -> String {
    let mut stream = TcpStream::connect(address).await.unwrap();
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    response
  }

  #[tokio::test]
  async fn the_listener_ignores_strays_and_returns_the_code_of_its_callback() {
    let loopback = Loopback::bind().await.unwrap();
    let redirect = loopback.redirect_uri();
    assert!(
      redirect.starts_with("http://127.0.0.1:") && redirect.ends_with("/callback"),
      "{redirect}"
    );
    let address = redirect.trim_start_matches("http://").trim_end_matches("/callback").to_owned();

    let waiting = tokio::spawn(async move { loopback.wait("the-state", Duration::from_secs(10)).await });
    let favicon = send(&address, "GET /favicon.ico HTTP/1.1\r\n\r\n").await;
    assert!(favicon.starts_with("HTTP/1.1 404"), "a stray path is not found");
    let forged = send(&address, "GET /callback?code=forged&state=wrong HTTP/1.1\r\n\r\n").await;
    assert!(forged.starts_with("HTTP/1.1 400"), "a wrong state is refused");
    let callback = send(&address, "GET /callback?code=the-code&state=the-state HTTP/1.1\r\n\r\n").await;
    assert!(callback.starts_with("HTTP/1.1 200"), "the callback is answered");
    assert!(callback.contains("You are signed in") && callback.contains("Cache-Control: no-store"));

    assert_eq!(waiting.await.unwrap().unwrap(), "the-code");
    assert!(
      TcpStream::connect(&address).await.is_err(),
      "the listener closes after its callback"
    );
  }

  #[tokio::test]
  async fn the_listener_gives_up_after_its_timeout() {
    let loopback = Loopback::bind().await.unwrap();
    let result = loopback.wait("s", Duration::from_millis(50)).await;
    assert!(matches!(result, Err(LoopbackError::TimedOut)), "{result:?}");
  }
}
