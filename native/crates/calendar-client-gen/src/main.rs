//! Generates `calendar-client`'s `src/generated/` from `contracts/openapi.json` (`just native generate`, part of
//! `just contracts`). The output is committed and never edited by hand; the test below fails when it is stale.

use std::path::{Path, PathBuf};

/// The contract, as the repository-relative path the generated files name.
const CONTRACT: &str = "contracts/openapi.json";

fn repo_root() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn output_dir() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join("../calendar-client/src/generated")
}

/// Every generated file, as (file name, content), from the contract text.
fn generate(contract: &str) -> Vec<(String, String)> {
  use openapi_to_rust::{CodeGenerator, GeneratorConfig, SchemaAnalyzer};
  let spec: serde_json::Value = serde_json::from_str(contract).expect("the contract is JSON");
  let mut analysis = SchemaAnalyzer::new(spec)
    .expect("the contract is OpenAPI")
    .analyze()
    .expect("the contract analyzes");
  let generator = CodeGenerator::new(GeneratorConfig {
    spec_path: CONTRACT.into(),
    output_dir: output_dir(),
    module_name: "generated".to_owned(),
    // No reqwest-tracing middleware: the app does not depend on it, and the browser build cannot use it.
    tracing_enabled: false,
    ..GeneratorConfig::default()
  });
  let result = generator.generate_all(&mut analysis).expect("the client generates");
  result
    .files
    .iter()
    .chain(std::iter::once(&result.mod_file))
    .map(|file| (file.path.to_string_lossy().into_owned(), file.content.clone()))
    .collect()
}

fn contract() -> String {
  std::fs::read_to_string(repo_root().join(CONTRACT)).expect("contracts/openapi.json is readable")
}

fn main() {
  let dir = output_dir();
  if dir.exists() {
    std::fs::remove_dir_all(&dir).expect("the old generated client is removable");
  }
  std::fs::create_dir_all(&dir).expect("the generated directory is writable");
  let files = generate(&contract());
  for (name, content) in &files {
    std::fs::write(dir.join(name), content).expect("a generated file is writable");
  }
  println!(
    "Generated {} files in native/crates/calendar-client/src/generated/ from {CONTRACT}",
    files.len()
  );
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_committed_client_is_the_generated_client() {
    let mut stale = Vec::new();
    let files = generate(&contract());
    for (name, content) in &files {
      if std::fs::read_to_string(output_dir().join(name)).ok().as_deref() != Some(content.as_str()) {
        stale.push(name.clone());
      }
    }
    let committed = std::fs::read_dir(output_dir()).map_or(0, Iterator::count);
    assert!(
      stale.is_empty() && committed == files.len(),
      "native/crates/calendar-client/src/generated/ is stale ({stale:?}, {committed} files committed, {} generated): \
             run `just contracts` (or `just native generate`) and commit the result",
      files.len()
    );
  }
}
