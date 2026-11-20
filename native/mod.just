# Rune UI recipes (`just native <recipe>`, ADR-0067). They run in native/, its own Cargo workspace, so
# native/rust-toolchain.toml (Rune's Rust pin) and native/Cargo.lock apply.

set shell := ["bash", "-euo", "pipefail", "-c"]

import '../just/run.just'

# List this module's recipes
[default]
[private]
list:
    @just --list native

# Download the locked crates, for the desktop and the browser
restore:
    cargo fetch --locked
    cargo fetch --locked --target wasm32-unknown-unknown

# Build the workspace, tests included
build:
    cargo build --workspace --all-targets --locked

# Run the headless tests (element trees, accessibility goldens, PNG snapshots on Linux); BLESS=1 rewrites goldens
[positional-arguments]
test *args:
    cargo test --workspace --locked "$@"

# Clippy with warnings as errors for the desktop and wasm32, and the formatting check
lint: lint-desktop lint-wasm

# Clippy for the desktop (tests included) and the formatting check; CI's desktop rows run this half
lint-desktop:
    cargo clippy --workspace --all-targets --locked -- -D warnings
    cargo fmt --all --check

# Clippy for the browser build (wasm32); CI's WASM row runs this half
lint-wasm:
    cargo clippy --workspace --lib --locked --target wasm32-unknown-unknown -- -D warnings

# Auto-format the workspace
format:
    cargo fmt --all

# Open the app in a window (Linux/WSLg, macOS, Windows)
dev:
    cargo run --locked -p calendar-native

# Build the browser bundle into native/target/web/ (release wasm, then wasm-bindgen at the version native/Cargo.lock pins)
build-web:
    #!/usr/bin/env bash
    set -euo pipefail
    want="$(cargo pkgid -p wasm-bindgen | sed 's/.*@//')"
    have="$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || true)"
    if [ "$have" != "$want" ]; then
        echo "wasm-bindgen ${have:-is not installed}; native/Cargo.lock wants $want." >&2
        echo "Run: cargo install wasm-bindgen-cli --version $want --locked" >&2
        exit 1
    fi
    cargo build --release --locked --target wasm32-unknown-unknown -p calendar-native --lib
    rm -rf target/web
    wasm-bindgen --target web --no-typescript --out-dir target/web --out-name app \
        target/wasm32-unknown-unknown/release/calendar_native.wasm
    cp web/index.html target/web/
    echo "Built native/target/web/ ($(du -h target/web/app_bg.wasm | cut -f1) wasm)"

# Remove Cargo build outputs
clean:
    cargo clean
