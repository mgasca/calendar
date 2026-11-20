//! Bulk task actions for triage, as the web app's `features/triage/Triage.tsx` and `bulkBatches.ts`: the request
//! bodies, explicit ids in batches of 500 sent one after another, the server-side "all overdue" filter, and the
//! notices a result or a failure shows.

use calendar_client::generated::{BulkTaskAction, BulkTaskRequest, BulkTaskResponse, OverdueTaskFilter, OverdueTaskFilterExpectedTotal};
use calendar_client::{Api, ApiError, Day, as_count};
use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;

/// The most ids one request carries (the web app's `BULK_ID_LIMIT`).
pub const BATCH: usize = 500;

/// What the toolbar does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
  Complete,
  SetDueDate(NaiveDate),
  SetDueInstant(DateTime<Utc>),
  ClearDeadline,
  Delete,
}

/// Which tasks: the ones ticked, or every overdue task on the server ("Select all {total} overdue").
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
  Ids(Vec<Uuid>),
  AllOverdue { expected_total: i64 },
}

/// The requests that carry `action` to `target`: one per 500 ids, or one with the filter.
#[must_use]
pub fn requests(action: Action, target: &Target, day: &Day) -> Vec<BulkTaskRequest> {
  let base = || {
    let mut request = BulkTaskRequest::new(match action {
      Action::Complete => BulkTaskAction::Complete,
      Action::SetDueDate(_) => BulkTaskAction::SetDueDate,
      Action::SetDueInstant(_) => BulkTaskAction::SetDueInstant,
      Action::ClearDeadline => BulkTaskAction::ClearDeadline,
      Action::Delete => BulkTaskAction::Delete,
    });
    match action {
      Action::SetDueDate(date) => request.due_date = Some(Some(date)),
      Action::SetDueInstant(at) => request.due_at = Some(Some(at)),
      _ => {}
    }
    request
  };
  match target {
    Target::Ids(ids) => ids
      .chunks(BATCH)
      .map(|chunk| {
        let mut request = base();
        request.ids = Some(Some(chunk.iter().map(Uuid::to_string).collect()));
        request
      })
      .collect(),
    Target::AllOverdue { expected_total } => {
      let mut request = base();
      request.filter = Some(Some(OverdueTaskFilter {
        view: "overdue".to_owned(),
        today: day.today,
        time_zone: day.time_zone.clone(),
        expected_total: OverdueTaskFilterExpectedTotal::Integer(i32::try_from(*expected_total).unwrap_or(i32::MAX)),
      }));
      vec![request]
    }
  }
}

/// The batches' results added up.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Totals {
  pub applied: i64,
  pub skipped: i64,
  pub not_found: i64,
}

impl Totals {
  fn add(&mut self, response: &BulkTaskResponse) {
    self.applied += as_count(&response.applied);
    self.skipped += as_count(&response.skipped);
    self.not_found += as_count(&response.not_found);
  }
}

/// A failed batch, after `applied` tasks were changed by the batches before it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
  pub applied: i64,
  pub error: ApiError,
}

/// Sends `requests` one after another; the first that fails stops the rest.
pub async fn send(api: &Api, requests: Vec<BulkTaskRequest>) -> Result<Totals, Failure> {
  let mut totals = Totals::default();
  for request in requests {
    match api.bulk_tasks(request).await {
      Ok(response) => totals.add(&response),
      Err(error) => {
        return Err(Failure {
          applied: totals.applied,
          error,
        });
      }
    }
  }
  Ok(totals)
}

/// The notice after every batch succeeded: "3 skipped" when any task was skipped or not found, else "12 tasks
/// updated".
#[must_use]
pub fn done(totals: Totals) -> String {
  let left_out = totals.skipped + totals.not_found;
  if left_out > 0 {
    format!("{left_out} skipped")
  } else {
    format!("{} tasks updated", totals.applied)
  }
}

/// What a failure means for the page: its notice, and whether the selection is cleared and the list refetched.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outcome {
  pub notice: String,
  pub clear_selection: bool,
}

/// The web app's failure handling: progress first, then a 409 with nothing applied (the overdue set changed), then
/// the error itself.
#[must_use]
pub fn failed(failure: &Failure) -> Outcome {
  const MESSAGE: &str = "Couldn\u{2019}t apply action.";
  if failure.applied > 0 {
    Outcome {
      notice: format!("{} tasks applied before failure. {MESSAGE}", failure.applied),
      clear_selection: false,
    }
  } else if failure.error.status == Some(409) {
    Outcome {
      notice: "The overdue count changed. Review the updated list.".to_owned(),
      clear_selection: true,
    }
  } else {
    Outcome {
      notice: MESSAGE.to_owned(),
      clear_selection: false,
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn day() -> Day {
    Day {
      today: "2026-11-20".parse().unwrap(),
      time_zone: "Europe/Madrid".to_owned(),
    }
  }

  #[test]
  fn ids_go_in_batches_of_five_hundred() {
    let ids: Vec<Uuid> = (0..1001u128).map(Uuid::from_u128).collect();
    let batches = requests(Action::Complete, &Target::Ids(ids), &day());
    let sizes: Vec<usize> = batches.iter().map(|r| r.ids.clone().flatten().unwrap().len()).collect();
    assert_eq!(sizes, [500, 500, 1]);
    assert!(batches.iter().all(|r| r.filter.is_none() && r.action == BulkTaskAction::Complete));
  }

  #[test]
  fn all_overdue_sends_one_filter_with_the_count_seen() {
    let batches = requests(Action::ClearDeadline, &Target::AllOverdue { expected_total: 873 }, &day());
    assert_eq!(batches.len(), 1);
    let body = serde_json::to_value(&batches[0]).unwrap();
    assert_eq!(body["action"], "clearDeadline");
    assert_eq!(
      body["filter"],
      serde_json::json!({ "view": "overdue", "today": "2026-11-20", "timeZone": "Europe/Madrid", "expectedTotal": 873 })
    );
    assert!(body.get("ids").is_none_or(serde_json::Value::is_null));
  }

  #[test]
  fn reschedules_carry_their_date_or_instant() {
    let ids = Target::Ids(vec![Uuid::nil()]);
    let date = serde_json::to_value(&requests(Action::SetDueDate("2026-11-23".parse().unwrap()), &ids, &day())[0]).unwrap();
    assert_eq!(
      (date["action"].as_str(), date["dueDate"].as_str()),
      (Some("setDueDate"), Some("2026-11-23"))
    );
    let at: DateTime<Utc> = "2026-11-23T08:30:00Z".parse().unwrap();
    let instant = serde_json::to_value(&requests(Action::SetDueInstant(at), &ids, &day())[0]).unwrap();
    assert_eq!(
      (instant["action"].as_str(), instant["dueAt"].as_str()),
      (Some("setDueInstant"), Some("2026-11-23T08:30:00Z"))
    );
  }

  #[test]
  fn notices_are_the_web_apps() {
    assert_eq!(
      done(Totals {
        applied: 12,
        skipped: 0,
        not_found: 0
      }),
      "12 tasks updated"
    );
    assert_eq!(
      done(Totals {
        applied: 9,
        skipped: 2,
        not_found: 1
      }),
      "3 skipped"
    );
    let error = |status| ApiError {
      status: Some(status),
      message: None,
    };
    assert_eq!(
      failed(&Failure {
        applied: 500,
        error: error(500)
      }),
      Outcome {
        notice: "500 tasks applied before failure. Couldn\u{2019}t apply action.".to_owned(),
        clear_selection: false
      }
    );
    assert_eq!(
      failed(&Failure {
        applied: 0,
        error: error(409)
      }),
      Outcome {
        notice: "The overdue count changed. Review the updated list.".to_owned(),
        clear_selection: true
      }
    );
    assert_eq!(
      failed(&Failure {
        applied: 0,
        error: error(500)
      })
      .notice,
      "Couldn\u{2019}t apply action."
    );
  }
}
