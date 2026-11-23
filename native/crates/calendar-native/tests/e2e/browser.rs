//! The system browser of a native sign-in (ADR-0068), played over HTTP: the app opens the start URL with this
//! instead of the person's browser ([`calendar_native::session::open_with`]). It follows the API's redirects by
//! hand with a cookie jar of its own, signs in at the stub `OpenID Connect` provider (ADR-0064) as the test's person,
//! clicks the confirm button, and follows the 303 to the app's loopback listener, as a browser would.

use std::sync::Arc;
use std::sync::mpsc::{Receiver, channel};

use calendar_client::reqwest::{self, Url, cookie::CookieStore as _, cookie::Jar, redirect::Policy};

/// Who signs in at the stub.
#[derive(Clone, Debug)]
pub struct Person {
  pub email: String,
  pub email_verified: bool,
}

/// What the browser saw: where it ended, and every secret of the round trip, for the personal-data scan.
#[derive(Debug)]
pub struct Visit {
  /// The last URL it was sent to: the app's loopback after a confirm, the web app's sign-in page after a refusal.
  pub landed: String,
  /// Each (description, value) the telemetry must never carry.
  pub secrets: Vec<(String, String)>,
  /// The first step that went wrong, if any.
  pub error: Option<String>,
}

/// Plays the browser for every start URL the app opens, on a thread of its own (the app calls the opener on its
/// effects thread, which must keep serving the loopback). Each visit's result arrives on the returned channel.
pub fn install(web_url: &str, person: Person) -> Receiver<Visit> {
  let (sender, visits) = channel();
  let web_url = web_url.to_owned();
  calendar_native::session::open_with(move |start| {
    let (start, web_url, person, sender) = (start.clone(), web_url.clone(), person.clone(), sender.clone());
    std::thread::spawn(move || {
      let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");
      let mut secrets = Vec::new();
      let visit = match runtime.block_on(sign_in(&start, &web_url, &person, &mut secrets)) {
        Ok(landed) => Visit {
          landed,
          secrets,
          error: None,
        },
        Err(error) => Visit {
          landed: String::new(),
          secrets,
          error: Some(error),
        },
      };
      let _ = sender.send(visit);
    });
    Ok(())
  });
  visits
}

fn query(url: &Url, name: &str) -> Option<String> {
  url.query_pairs().find(|(key, _)| key == name).map(|(_, value)| value.into_owned())
}

fn cookie(jar: &Jar, url: &Url, name: &str) -> Option<String> {
  let header = jar.cookies(url)?;
  header
    .to_str()
    .ok()?
    .split("; ")
    .find_map(|pair| pair.strip_prefix(name).and_then(|rest| rest.strip_prefix('=')).map(str::to_owned))
}

/// One request; answers the status and, for a redirect, the absolute `Location`.
async fn send(request: reqwest::RequestBuilder, at: &Url) -> Result<(reqwest::StatusCode, Option<Url>), String> {
  let response = request.send().await.map_err(|error| format!("{at}: {error}"))?;
  let location = response
    .headers()
    .get(reqwest::header::LOCATION)
    .and_then(|value| value.to_str().ok())
    .and_then(|location| at.join(location).ok());
  Ok((response.status(), location))
}

fn redirected(step: &str, answer: (reqwest::StatusCode, Option<Url>)) -> Result<Url, String> {
  match answer {
    (status, Some(location)) if status.is_redirection() => Ok(location),
    (status, _) => Err(format!("{step} answered {status} without a redirect")),
  }
}

/// Signs in from `start` to the end of the round trip, recording each secret in `secrets`, and answers where the
/// browser landed.
async fn sign_in(start: &Url, web_url: &str, person: &Person, secrets: &mut Vec<(String, String)>) -> Result<String, String> {
  let jar = Arc::new(Jar::default());
  let client = reqwest::Client::builder()
    .cookie_provider(Arc::clone(&jar))
    .redirect(Policy::none())
    .build()
    .map_err(|error| error.to_string())?;
  let mut secret = |description: &str, value: Option<String>| {
    if let Some(value) = value.filter(|value| !value.is_empty()) {
      secrets.push((description.to_owned(), value));
    }
  };
  for name in ["state", "code_challenge", "redirect_uri"] {
    secret(&format!("the native start's {name}"), query(start, name));
  }

  // The start seals the request into the flow cookie and sends the browser to the confirm page, which sends a
  // signed-out browser to the web sign-in.
  let confirm = redirected("GET /api/auth/native/start", send(client.get(start.clone()), start).await?)?;
  secret("the native flow cookie", cookie(&jar, &confirm, "calendar_native"));
  let login = redirected("GET /api/auth/native/confirm", send(client.get(confirm.clone()), &confirm).await?)?;
  let authorize = redirected("GET /api/auth/login", send(client.get(login.clone()), &login).await?)?;
  for name in ["state", "nonce", "code_challenge"] {
    secret(&format!("the authorization request's {name}"), query(&authorize, name));
  }
  secret("the sealed sign-in cookie", cookie(&jar, &login, "calendar_signin"));

  // The stub's login form: the subject stays the same per email, because the API binds an email to one subject.
  let subject = format!("subject-{}", person.email);
  let claims = serde_json::json!({ "email": person.email, "email_verified": person.email_verified }).to_string();
  let form = form_urlencoded::Serializer::new(String::new())
    .append_pair("username", &subject)
    .append_pair("claims", &claims)
    .finish();
  let callback = redirected(
    "POST the stub's form",
    send(
      client
        .post(authorize.clone())
        .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(form),
      &authorize,
    )
    .await?,
  )?;
  secret("the Google subject", Some(subject.clone()));
  secret("the authorization code", query(&callback, "code"));

  // The callback signs the browser in and returns to the confirm page, or refuses and sends it to the web app.
  let after = redirected(
    "GET /api/auth/callback/google",
    send(client.get(callback.clone()), &callback).await?,
  )?;
  secret("the browser's session cookie", cookie(&jar, &after, "calendar_session"));
  if after.path() != "/api/auth/native/confirm" {
    return Ok(after.to_string());
  }
  let (status, _) = send(client.get(after.clone()), &after).await?;
  if status != reqwest::StatusCode::OK {
    return Err(format!("the confirm page answered {status}"));
  }

  // The confirm button: a same-origin form post, which answers 303 to the app's loopback with the code.
  let origin = web_url.trim_end_matches('/');
  let loopback = redirected(
    "POST /api/auth/native/confirm",
    send(
      client
        .post(after.clone())
        .header(reqwest::header::ORIGIN, origin)
        .header("sec-fetch-site", "same-origin"),
      &after,
    )
    .await?,
  )?;
  secret("the handover code", query(&loopback, "code"));
  let (status, _) = send(client.get(loopback.clone()), &loopback).await?;
  if status != reqwest::StatusCode::OK {
    return Err(format!("the app's loopback answered {status}"));
  }
  Ok(loopback.to_string())
}
