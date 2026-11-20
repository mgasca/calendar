//! The desktop window: `just native dev`. Debug builds also take Rune's headless arguments (`--snap`, `--tree`).

fn main() {
  rune::run(calendar_native::spec());
}
