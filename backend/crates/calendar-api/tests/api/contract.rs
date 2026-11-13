//! `contracts/openapi.json` is what `calendar-api --openapi` writes today (#778). The binary writes
//! `openapi::to_json(&openapi::document())` with `std::fs::write`, so the same bytes are built here and compared
//! with the committed file, byte for byte. No database: the check takes milliseconds inside the test run instead
//! of a separate build in CI.

use std::path::Path;

use calendar_api::openapi;

#[test]
fn the_committed_contract_is_what_the_api_generates() {
  let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../contracts/openapi.json");
  let committed = std::fs::read(&path).unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
  let generated = openapi::to_json(&openapi::document());

  assert!(
    committed == generated.as_bytes(),
    "contracts/openapi.json is stale. Run 'just contracts' and commit the result."
  );
}
