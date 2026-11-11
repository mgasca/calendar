//! String comparisons with the semantics of the .NET ones the API relied on.

use std::cmp::Ordering;

/// The UTF-16 code units of `value` with every character upper-cased by its simple (one-to-one) mapping:
/// the key `StringComparer.OrdinalIgnoreCase` compares by.
fn ordinal_ignore_case_key(value: &str) -> impl Iterator<Item = u16> + '_ {
  value.chars().flat_map(|c| {
    let mut upper = c.to_uppercase();
    let mapped = match (upper.next(), upper.next()) {
      (Some(single), None) => single,
      _ => c,
    };
    let mut units = [0_u16; 2];
    let encoded = mapped.encode_utf16(&mut units).len();
    units.into_iter().take(encoded)
  })
}

/// Compares like `StringComparer.OrdinalIgnoreCase`: by UTF-16 code unit, ignoring case.
pub fn ordinal_ignore_case_cmp(a: &str, b: &str) -> Ordering {
  ordinal_ignore_case_key(a).cmp(ordinal_ignore_case_key(b))
}

/// Equality like `StringComparison.OrdinalIgnoreCase`.
pub fn ordinal_ignore_case_eq(a: &str, b: &str) -> bool {
  ordinal_ignore_case_cmp(a, b) == Ordering::Equal
}

/// Whether `value` is `null`, empty or only white space, like `string.IsNullOrWhiteSpace`.
pub fn is_blank(value: Option<&str>) -> bool {
  value.is_none_or(|text| text.chars().all(char::is_whitespace))
}

/// The length `string.Length` reports: UTF-16 code units.
pub fn utf16_len(value: &str) -> usize {
  value.encode_utf16().count()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn compares_ignoring_case_by_code_unit() {
    assert_eq!(ordinal_ignore_case_cmp("alpha", "ALPHA"), Ordering::Equal);
    assert_eq!(ordinal_ignore_case_cmp("alpha", "Beta"), Ordering::Less);
    assert_eq!(ordinal_ignore_case_cmp("beta", "Alpha"), Ordering::Greater);
    assert_eq!(ordinal_ignore_case_cmp("a", "ab"), Ordering::Less);
    // '_' (0x5F) sorts after upper-case letters and before lower-case ones; upper-casing decides.
    assert_eq!(ordinal_ignore_case_cmp("a_", "aB"), Ordering::Greater);
    assert!(ordinal_ignore_case_eq("User@Example.com", "user@example.COM"));
    assert!(!ordinal_ignore_case_eq("straße", "STRASSE"));
  }

  #[test]
  fn blank_is_none_empty_or_white_space() {
    assert!(is_blank(None));
    assert!(is_blank(Some("")));
    assert!(is_blank(Some(" \t\u{a0}")));
    assert!(!is_blank(Some(" x ")));
  }
}
