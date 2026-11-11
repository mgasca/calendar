//! Locates files that tests share with local development, so the two cannot drift (ADR-0016).

use std::path::{Path, PathBuf};

/// The absolute path of a repository file given relative to the repository root, such as
/// `docker/postgres/init/01-roles.sh`. Searches upwards from this crate.
///
/// # Panics
/// When no parent directory holds the file.
pub fn find(relative_path: &str) -> PathBuf {
  let start = Path::new(env!("CARGO_MANIFEST_DIR"));
  start
    .ancestors()
    .map(|dir| dir.join(relative_path))
    .find(|candidate| candidate.is_file())
    .unwrap_or_else(|| panic!("'{relative_path}' not found in any parent of {}.", start.display()))
}

/// The postgres image pinned in `compose.yaml`, as `(name, tag)`.
///
/// # Panics
/// When `compose.yaml` pins no postgres image.
pub fn postgres_image() -> (String, String) {
  let compose = std::fs::read_to_string(find("compose.yaml")).expect("compose.yaml is readable");
  parse_postgres_image(&compose).expect("No postgres image found in compose.yaml.")
}

/// The first `image: postgres:<tag>` line.
fn parse_postgres_image(compose: &str) -> Option<(String, String)> {
  compose.lines().find_map(|line| {
    let image = line.trim().strip_prefix("image:")?.trim();
    let tag = image.strip_prefix("postgres:")?;
    (!tag.is_empty() && !tag.contains(char::is_whitespace)).then(|| ("postgres".to_owned(), tag.to_owned()))
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn finds_the_role_script_and_the_compose_file() {
    assert!(find("docker/postgres/init/01-roles.sh").is_absolute());
    assert!(find("compose.yaml").is_file());
  }

  #[test]
  fn reads_the_image_pinned_in_compose_yaml() {
    let (name, tag) = postgres_image();

    assert_eq!(name, "postgres");
    assert!(tag.chars().next().is_some_and(|c| c.is_ascii_digit()), "{tag}");
  }

  #[test]
  fn parses_only_a_postgres_image_line() {
    let compose = "services:\n  other:\n    image: redis:7\n  postgres:\n    image: postgres:18.6-alpine  \n";

    assert_eq!(
      parse_postgres_image(compose),
      Some(("postgres".to_owned(), "18.6-alpine".to_owned()))
    );
    assert_eq!(parse_postgres_image("image: redis:7\n# image: postgres:1 trailing words\n"), None);
  }
}
