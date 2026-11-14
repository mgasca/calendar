//! Field errors for a `400` validation problem (ports `RequestValidation.cs`).

use calendar_domain::error::ArgumentError;
use calendar_domain::time::IanaZone;
use calendar_domain::time::time_zones;
use chrono::NaiveDate;

use crate::error::ApiError;
use crate::problem::Problem;
use crate::text::is_blank;

/// The first date the API accepts. Dates outside the range are refused so extreme values never reach date
/// arithmetic.
pub const MIN_DATE: NaiveDate = NaiveDate::from_ymd_opt(1900, 1, 1).expect("a valid date");
/// The last date the API accepts.
pub const MAX_DATE: NaiveDate = NaiveDate::from_ymd_opt(2200, 12, 31).expect("a valid date");

/// Whether `date` is within [`MIN_DATE`]..=[`MAX_DATE`], so date arithmetic on it is safe.
pub fn is_supported_date(date: NaiveDate) -> bool {
  (MIN_DATE..=MAX_DATE).contains(&date)
}

/// Collects field errors, keeping the order in which fields first failed.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct FieldErrors {
  errors: Vec<(String, Vec<String>)>,
}

impl FieldErrors {
  /// No errors yet.
  pub fn new() -> Self {
    Self::default()
  }

  /// Whether any field failed.
  pub fn any(&self) -> bool {
    !self.errors.is_empty()
  }

  /// The errors by field, in the order fields first failed.
  pub fn entries(&self) -> &[(String, Vec<String>)] {
    &self.errors
  }

  /// The `400` validation problem of these errors.
  pub fn into_problem(self) -> Problem {
    Problem::validation(self.errors)
  }

  /// `Ok` when no field failed; otherwise these errors, which `?` turns into their `400` problem.
  pub fn into_result(self) -> Result<(), Self> {
    if self.any() { Err(self) } else { Ok(()) }
  }

  /// One domain argument error, under the API field its parameter came from.
  pub fn from_domain(error: ArgumentError) -> Self {
    let mut errors = Self::new();
    errors.add(domain_field(error.param), error.message);
    errors
  }

  /// Adds `message` to `field`.
  pub fn add(&mut self, field: &str, message: impl Into<String>) {
    match self.errors.iter_mut().find(|(name, _)| name == field) {
      Some((_, messages)) => messages.push(message.into()),
      None => self.errors.push((field.to_owned(), vec![message.into()])),
    }
  }

  /// Adds `message` unless `present`.
  pub fn require(&mut self, present: bool, field: &str, message: impl Into<String>) {
    if !present {
      self.add(field, message);
    }
  }

  /// Adds `message` when `present`.
  pub fn forbid(&mut self, present: bool, field: &str, message: impl Into<String>) {
    if present {
      self.add(field, message);
    }
  }

  /// Refuses a date outside [`MIN_DATE`]..=[`MAX_DATE`].
  pub fn check_date(&mut self, date: Option<NaiveDate>, field: &str) {
    if date.is_some_and(|date| !is_supported_date(date)) {
      self.add(field, "Date must be between 1900-01-01 and 2200-12-31.");
    }
  }

  /// Requires a date within the supported range; returns it, or `None` when it is missing. An out-of-range
  /// date is returned and reported.
  pub fn require_date(&mut self, date: Option<NaiveDate>, field: &str) -> Option<NaiveDate> {
    if date.is_none() {
      self.add(field, format!("{field} is required (YYYY-MM-DD)."));
    } else {
      self.check_date(date, field);
    }
    date
  }

  /// Requires an IANA time zone id; returns the resolved zone, or `None` when it is missing or unknown.
  pub fn require_time_zone(&mut self, time_zone: Option<&str>, field: &str) -> Option<IanaZone> {
    let Some(id) = time_zone.filter(|id| !is_blank(id)) else {
      self.add(field, format!("{field} is required (IANA id, e.g. America/New_York)."));
      return None;
    };
    let zone = time_zones::try_find_iana(id);
    if zone.is_none() {
      self.add(field, format!("'{id}' is not a valid IANA time zone id."));
    }
    zone
  }

  /// Reports a domain argument error under the API field its parameter came from.
  pub fn add_domain_error(&mut self, error: &ArgumentError) {
    self.add(domain_field(error.param), error.message.clone());
  }
}

/// The API field a domain parameter is reported under.
fn domain_field(param: &str) -> &str {
  match param {
    "timeZoneId" => "timeZone",
    "" => "request",
    name => name,
  }
}

/// Field errors answer with their `400` validation problem.
impl From<FieldErrors> for ApiError {
  fn from(errors: FieldErrors) -> Self {
    errors.into_problem().into()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn errors_keep_field_order_and_group_messages() {
    let mut errors = FieldErrors::new();
    assert!(!errors.any());
    errors.add("b", "one");
    errors.add("a", "two");
    errors.add("b", "three");
    assert_eq!(
      errors.entries(),
      [
        ("b".to_owned(), vec!["one".to_owned(), "three".to_owned()]),
        ("a".to_owned(), vec!["two".to_owned()])
      ]
    );
  }

  #[test]
  fn dates_and_zones_are_required_and_checked() {
    let mut errors = FieldErrors::new();
    assert_eq!(errors.require_date(None, "today"), None);
    assert!(errors.require_date(NaiveDate::from_ymd_opt(1899, 12, 31), "date").is_some());
    assert!(errors.require_date(NaiveDate::from_ymd_opt(2200, 12, 31), "ok").is_some());
    assert!(errors.require_time_zone(None, "timeZone").is_none());
    assert!(errors.require_time_zone(Some("  "), "blank").is_none());
    assert!(errors.require_time_zone(Some("Mars/Phobos"), "zone").is_none());
    assert_eq!(errors.require_time_zone(Some("utc"), "fine").map(IanaZone::id), Some("UTC"));
    let messages: Vec<_> = errors
      .entries()
      .iter()
      .map(|(field, messages)| (field.as_str(), messages[0].as_str()))
      .collect();
    assert_eq!(
      messages,
      [
        ("today", "today is required (YYYY-MM-DD)."),
        ("date", "Date must be between 1900-01-01 and 2200-12-31."),
        ("timeZone", "timeZone is required (IANA id, e.g. America/New_York)."),
        ("blank", "blank is required (IANA id, e.g. America/New_York)."),
        ("zone", "'Mars/Phobos' is not a valid IANA time zone id."),
      ]
    );
  }

  #[test]
  fn domain_errors_map_to_api_fields() {
    let mut errors = FieldErrors::new();
    errors.add_domain_error(&ArgumentError::new("timeZoneId", "bad zone"));
    errors.add_domain_error(&ArgumentError::new("title", "Title is required."));
    errors.add_domain_error(&ArgumentError::new("", "odd"));
    let fields: Vec<_> = errors.entries().iter().map(|(field, _)| field.as_str()).collect();
    assert_eq!(fields, ["timeZone", "title", "request"]);
  }

  #[test]
  fn errors_convert_to_their_validation_problem() {
    assert_eq!(FieldErrors::new().into_result(), Ok(()));
    let mut errors = FieldErrors::new();
    errors.add("title", "Title is required.");
    assert_eq!(errors.clone().into_result(), Err(errors.clone()));
    assert_eq!(FieldErrors::from_domain(ArgumentError::new("title", "Title is required.")), errors);

    let problem = |error: ApiError| match error {
      ApiError::Problem(problem) => *problem,
      ApiError::Internal(reason) => panic!("internal: {reason}"),
    };
    assert_eq!(problem(ApiError::from(errors.clone())), errors.into_problem());
  }
}
