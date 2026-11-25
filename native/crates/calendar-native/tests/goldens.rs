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

const SCENES: [&str; 17] = [
  "today",
  "today-notice",
  "today-empty",
  "today-loading",
  "today-error",
  "week",
  "week-busy",
  "tasks",
  "signed-out",
  "today-toggle-error",
  "today-delete",
  "add-event",
  "add-event-calendar",
  "event-form-errors",
  "edit-task",
  "triage",
  "triage-selected",
];
/// The scenes with PNG snapshots (Linux).
const SNAPSHOTS: [&str; 9] = [
  "today",
  "today-notice",
  "week",
  "week-busy",
  "today-delete",
  "add-event",
  "add-event-calendar",
  "edit-task",
  "triage-selected",
];
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

/// Runs the app headlessly with `args`, writing to `out`; the error is the binary's stderr.
fn try_render(args: &[&str], out: &Path) -> Result<(), String> {
  let output = Command::new(env!("CARGO_BIN_EXE_calendar-native"))
    .args(args)
    .arg(out)
    .output()
    .expect("the calendar-native binary runs");
  if output.status.success() {
    Ok(())
  } else {
    Err(format!(
      "calendar-native {args:?} failed: {}",
      String::from_utf8_lossy(&output.stderr)
    ))
  }
}

fn render(args: &[&str], out: &Path) {
  if let Err(error) = try_render(args, out) {
    panic!("{error}");
  }
}

/// What a snapshot render that failed means: on Linux, where CI installs lavapipe, a failure; elsewhere a runner may
/// have no GPU adapter, and PNGs there are artefacts only (ADR-0067), so it is logged and skipped.
fn snapshot_render_failed(linux: bool, error: String) -> Result<(), String> {
  if linux {
    Err(error)
  } else {
    eprintln!("skipping the snapshot (PNGs gate on Linux only): {error}");
    Ok(())
  }
}

#[test]
fn a_snapshot_that_cannot_render_fails_on_linux_only() {
  assert!(snapshot_render_failed(true, "no adapter".to_owned()).is_err());
  assert!(snapshot_render_failed(false, "no adapter".to_owned()).is_ok());
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
  // Each render is its own process; they run side by side (pre-merge review of #1023), then compare in order.
  let pairs: Vec<_> = SCENES.into_iter().flat_map(|scene| THEMES.map(|theme| (scene, theme))).collect();
  let rendered = in_parallel(&pairs, |&(scene, theme)| tree(scene, theme));
  let trees = pairs.iter().zip(rendered).map(|(&(scene, theme), actual)| (scene, theme, actual));
  let mut failures = Vec::new();
  for (scene, theme, actual) in trees {
    {
      let path = goldens().join(format!("{scene}-{theme}.a11y.json"));
      let pretty = serde_json::to_string_pretty(&sorted(actual)).expect("serializes") + "\n";
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

/// `value` with every object's keys in sorted order. `serde_json` keeps insertion order when any crate in the workspace
/// enables its `preserve_order` feature (`calendar-client` does), so the goldens fix the order themselves.
fn sorted(value: serde_json::Value) -> serde_json::Value {
  match value {
    serde_json::Value::Object(map) => {
      let mut entries: Vec<_> = map.into_iter().collect();
      entries.sort_by(|(a, _), (b, _)| a.cmp(b));
      serde_json::Value::Object(entries.into_iter().map(|(k, v)| (k, sorted(v))).collect())
    }
    serde_json::Value::Array(items) => serde_json::Value::Array(items.into_iter().map(sorted).collect()),
    other => other,
  }
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
  let pairs: Vec<_> = SNAPSHOTS.into_iter().flat_map(|s| THEMES.map(|t| (s, t))).collect();
  // The renders run side by side; the comparisons follow in order.
  let rendered = in_parallel(&pairs, |&(scene, theme)| {
    let actual = actual_dir().join(format!("{scene}-{theme}.png"));
    try_render(&["--scene", scene, "--theme", theme, "--scale", "1", "--snap"], &actual)
  });
  let mut failures = Vec::new();
  for (&(scene, theme), result) in pairs.iter().zip(rendered) {
    let name = format!("{scene}-{theme}.png");
    let actual = actual_dir().join(&name);
    if let Err(error) = result {
      if let Err(error) = snapshot_render_failed(cfg!(target_os = "linux"), error) {
        failures.push(error);
      }
      continue;
    }
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

/// `render` for every job, at most as many at a time as the machine has cores (pre-merge review of #1024: each
/// job is a process, and lavapipe renders on every core); results in the jobs' order.
fn in_parallel<J: Sync, R: Send>(jobs: &[J], render: impl Fn(&J) -> R + Sync) -> Vec<R> {
  let width = std::thread::available_parallelism().map_or(4, std::num::NonZero::get);
  let mut results = Vec::with_capacity(jobs.len());
  for chunk in jobs.chunks(width) {
    let render = &render;
    results.extend(std::thread::scope(|s| {
      let handles: Vec<_> = chunk.iter().map(|job| s.spawn(move || render(job))).collect();
      handles.into_iter().map(|h| h.join().expect("a render thread")).collect::<Vec<_>>()
    }));
  }
  results
}

#[test]
fn renders_run_at_most_a_core_count_at_a_time_and_keep_their_order() {
  use std::sync::atomic::{AtomicUsize, Ordering};
  let (running, peak) = (AtomicUsize::new(0), AtomicUsize::new(0));
  let jobs: Vec<usize> = (0..64).collect();
  let out = in_parallel(&jobs, |&n| {
    let now = running.fetch_add(1, Ordering::SeqCst) + 1;
    peak.fetch_max(now, Ordering::SeqCst);
    std::thread::sleep(std::time::Duration::from_millis(2));
    running.fetch_sub(1, Ordering::SeqCst);
    n * 2
  });
  assert_eq!(out, jobs.iter().map(|n| n * 2).collect::<Vec<_>>());
  let cores = std::thread::available_parallelism().map_or(4, std::num::NonZero::get);
  assert!(
    peak.load(Ordering::SeqCst) <= cores,
    "{} at once on {cores} cores",
    peak.load(Ordering::SeqCst)
  );
}
