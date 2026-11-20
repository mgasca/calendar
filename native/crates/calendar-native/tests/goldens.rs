//! Golden files for the shell, rendered headlessly by the app's own binary (`--tree`, `--snap`).
//!
//! - **Accessibility trees** (roles, names, states, keys, bounds) gate on every platform.
//! - **PNG snapshots** gate on Linux only, where CI renders on lavapipe; GPU output differs between platforms, so
//!   elsewhere the PNG is written for inspection and not compared (ADR-0067).
//!
//! `BLESS=1 just native test` rewrites the goldens; review the diff before committing it. A failing comparison
//! leaves the actual output in `native/target/goldens/` (CI uploads it).

use std::path::{Path, PathBuf};
use std::process::Command;

const SCENES: [&str; 3] = ["today", "week", "tasks"];
const THEMES: [&str; 2] = ["light", "dark"];
/// A channel may differ by this much (8-bit) before a pixel counts as different: rasterizers round differently.
const CHANNEL_TOLERANCE: u8 = 8;
/// The share of pixels that may differ before a snapshot fails.
const PIXEL_TOLERANCE: f64 = 0.001;

fn goldens() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/goldens")
}

fn actual_dir() -> PathBuf {
  let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/goldens");
  std::fs::create_dir_all(&dir).expect("target/goldens is writable");
  dir
}

fn blessing() -> bool {
  std::env::var_os("BLESS").is_some_and(|v| v == "1")
}

/// Runs the app headlessly with `args`, writing to `out`.
fn render(args: &[&str], out: &Path) {
  let output = Command::new(env!("CARGO_BIN_EXE_calendar-native"))
    .args(args)
    .arg(out)
    .output()
    .expect("the calendar-native binary runs");
  assert!(
    output.status.success(),
    "calendar-native {args:?} failed: {}",
    String::from_utf8_lossy(&output.stderr)
  );
}

fn tree(scene: &str, theme: &str) -> serde_json::Value {
  let out = actual_dir().join(format!("{scene}-{theme}.tree.json"));
  render(&["--scene", scene, "--theme", theme, "--scale", "1", "--tree"], &out);
  let json: serde_json::Value = serde_json::from_slice(&std::fs::read(&out).expect("the tree was written")).expect("the tree is JSON");
  assert_eq!(
    json["warnings"],
    serde_json::json!([]),
    "{scene}/{theme} renders without Rune warnings"
  );
  json["accessibility"].clone()
}

#[test]
fn accessibility_trees_match_their_goldens() {
  let mut failures = Vec::new();
  for scene in SCENES {
    for theme in THEMES {
      let actual = tree(scene, theme);
      let path = goldens().join(format!("{scene}-{theme}.a11y.json"));
      let pretty = serde_json::to_string_pretty(&actual).expect("serializes") + "\n";
      if blessing() {
        std::fs::write(&path, &pretty).expect("the golden is writable");
        continue;
      }
      let golden = std::fs::read_to_string(&path).unwrap_or_default();
      if golden != pretty {
        std::fs::write(actual_dir().join(format!("{scene}-{theme}.a11y.json")), &pretty).ok();
        failures.push(format!("{scene}-{theme}"));
      }
    }
  }
  assert!(failures.is_empty(), "accessibility trees differ from tests/goldens: {failures:?}");
}

fn decode(path: &Path) -> (u32, u32, Vec<u8>) {
  let mut decoder = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(path).expect("PNG exists")));
  decoder.set_transformations(png::Transformations::normalize_to_color8() | png::Transformations::ALPHA);
  let mut reader = decoder.read_info().expect("a PNG header");
  let mut buf = vec![0; reader.output_buffer_size().expect("a bounded image")];
  let info = reader.next_frame(&mut buf).expect("a PNG frame");
  buf.truncate(info.buffer_size());
  (info.width, info.height, buf)
}

/// The share of pixels whose channels differ by more than [`CHANNEL_TOLERANCE`], or 1.0 when sizes differ.
fn difference(a: &Path, b: &Path) -> f64 {
  let (wa, ha, pa) = decode(a);
  let (wb, hb, pb) = decode(b);
  if (wa, ha) != (wb, hb) {
    return 1.0;
  }
  let differing = pa
    .as_chunks::<4>()
    .0
    .iter()
    .zip(pb.as_chunks::<4>().0)
    .filter(|(x, y)| x.iter().zip(y.iter()).any(|(p, q)| p.abs_diff(*q) > CHANNEL_TOLERANCE))
    .count();
  #[allow(clippy::cast_precision_loss)]
  let share = differing as f64 / (f64::from(wa) * f64::from(ha));
  share
}

#[test]
fn snapshots_match_their_goldens_on_linux() {
  let mut failures = Vec::new();
  for theme in THEMES {
    let name = format!("today-{theme}.png");
    let actual = actual_dir().join(&name);
    render(&["--scene", "today", "--theme", theme, "--scale", "1", "--snap"], &actual);
    let golden = goldens().join(&name);
    if blessing() {
      std::fs::copy(&actual, &golden).expect("the golden is writable");
    } else if cfg!(target_os = "linux") {
      let share = difference(&golden, &actual);
      if share > PIXEL_TOLERANCE {
        failures.push(format!("{name}: {:.3}% of pixels differ", share * 100.0));
      }
    }
  }
  assert!(failures.is_empty(), "snapshots differ from tests/goldens: {failures:?}");
}
