//! Shared input validation for domain entities.
//!
//! Lengths are counted in UTF-16 code units and whitespace is Unicode `White_Space`, as the limits were first
//! defined that way.

use crate::error::ArgumentError;

/// Longest title, in UTF-16 code units, after trimming.
pub const MAX_TITLE_LENGTH: usize = 200;
/// Longest location, in UTF-16 code units, after trimming.
pub const MAX_LOCATION_LENGTH: usize = 200;
/// Longest notes, in UTF-16 code units, after trimming.
pub const MAX_NOTES_LENGTH: usize = 4000;

/// Trims a required title; fails when blank or longer than [`MAX_TITLE_LENGTH`].
pub(crate) fn normalize_title(title: &str, param: &'static str) -> Result<String, ArgumentError> {
  let trimmed = title.trim();
  if trimmed.is_empty() {
    return Err(ArgumentError::new(param, "Title is required."));
  }

  if utf16_length(trimmed) > MAX_TITLE_LENGTH {
    return Err(ArgumentError::new(
      param,
      format!("Title must be at most {MAX_TITLE_LENGTH} characters."),
    ));
  }

  Ok(trimmed.to_owned())
}

/// Trims an optional text; blank becomes `None`; fails when longer than `max_length`.
pub(crate) fn normalize_optional(value: Option<&str>, max_length: usize, param: &'static str) -> Result<Option<String>, ArgumentError> {
  let Some(trimmed) = value.map(str::trim).filter(|text| !text.is_empty()) else {
    return Ok(None);
  };

  if utf16_length(trimmed) > max_length {
    return Err(ArgumentError::new(param, format!("Value must be at most {max_length} characters.")));
  }

  Ok(Some(trimmed.to_owned()))
}

/// Trims a text; blank (or missing) becomes `None`. No length limit.
pub(crate) fn trim_to_option(value: Option<&str>) -> Option<String> {
  value.map(str::trim).filter(|text| !text.is_empty()).map(str::to_owned)
}

/// Length in UTF-16 code units: a character outside the Basic Multilingual Plane counts as two.
pub(crate) fn utf16_length(text: &str) -> usize {
  text.encode_utf16().count()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn title_length_counts_utf16_code_units() {
    // U+1F600 is one character, four UTF-8 bytes and two UTF-16 code units.
    assert!(normalize_title(&"\u{1F600}".repeat(100), "title").is_ok());
    let error = normalize_title(&"\u{1F600}".repeat(101), "title").unwrap_err();
    assert_eq!(error, ArgumentError::new("title", "Title must be at most 200 characters."));
  }

  #[test]
  fn messages_and_parameter_names() {
    assert_eq!(
      normalize_title(" \u{a0}\t", "title").unwrap_err(),
      ArgumentError::new("title", "Title is required.")
    );
    assert_eq!(
      normalize_optional(Some(&"n".repeat(4001)), MAX_NOTES_LENGTH, "notes").unwrap_err(),
      ArgumentError::new("notes", "Value must be at most 4000 characters.")
    );
    assert_eq!(normalize_optional(None, 5, "notes"), Ok(None));
    assert_eq!(normalize_optional(Some(" \u{2003} "), 5, "notes"), Ok(None));
    assert_eq!(normalize_optional(Some(" ab "), 2, "notes"), Ok(Some("ab".to_owned())));
  }
}
