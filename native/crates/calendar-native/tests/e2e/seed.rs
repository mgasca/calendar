//! Test data, seeded through the API as the stack's allow-listed person, as `frontend/apps/e2e/src/fixtures.ts`'s
//! `seed` does: the development seed key (ADR-0027) on the test's own requests to the API. The app never sends it;
//! it signs in through the stub. Every seeded text is registered as personal data.

use calendar_client::reqwest;
use serde_json::Value;

use crate::telemetry::PersonalData;

/// This test's run id, which every seeded text carries, so a test finds only what it seeded.
pub struct Run {
  pub id: String,
}

impl Run {
  pub fn new() -> Self {
    let nanos = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map_or(0, |since| since.subsec_nanos());
    Run {
      id: format!("e2e-{nanos:08x}"),
    }
  }

  /// `text` marked with the run id.
  pub fn label(&self, text: &str) -> String {
    format!("{text} · {}", self.id)
  }
}

/// Blocking writes to the API with the seed key.
pub struct Seed {
  runtime: tokio::runtime::Runtime,
  client: reqwest::Client,
  api_url: String,
  key: String,
}

impl Seed {
  pub fn new(api_url: &str, key: &str) -> Self {
    Seed {
      runtime: tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime"),
      client: reqwest::Client::new(),
      api_url: api_url.trim_end_matches('/').to_owned(),
      key: key.to_owned(),
    }
  }

  fn send(&self, method: &reqwest::Method, path: &str, body: Option<&Value>) -> Value {
    self.runtime.block_on(async {
      let mut request = self
        .client
        .request(method.clone(), format!("{}{path}", self.api_url))
        .header("x-dev-seed-key", &self.key);
      if let Some(body) = body {
        request = request
          .header(reqwest::header::CONTENT_TYPE, "application/json")
          .body(body.to_string());
      }
      let response = request.send().await.expect("the API answers");
      let status = response.status();
      let text = response.text().await.unwrap_or_default();
      assert!(status.is_success(), "seeding {method} {path} answered {status}");
      if text.is_empty() {
        Value::Null
      } else {
        serde_json::from_str(&text).expect("a JSON answer")
      }
    })
  }

  fn remember(personal: &mut PersonalData, kind: &str, body: &Value) {
    for (field, what) in [("title", "title"), ("location", "location"), ("notes", "notes")] {
      if let Some(value) = body[field].as_str() {
        personal.add(&format!("a seeded {kind} {what}"), value);
      }
    }
  }

  /// `POST /api/events` with `body`; answers the created event.
  pub fn event(&self, personal: &mut PersonalData, body: &Value) -> Value {
    Self::remember(personal, "event", body);
    self.send(&reqwest::Method::POST, "/api/events", Some(body))
  }

  /// `POST /api/tasks` with `body`; answers the created task.
  pub fn task(&self, personal: &mut PersonalData, body: &Value) -> Value {
    Self::remember(personal, "task", body);
    self.send(&reqwest::Method::POST, "/api/tasks", Some(body))
  }
}
