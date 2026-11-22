# The build caller supplies the Node major from frontend/.node-version.
ARG NODE_VERSION
FROM node:${NODE_VERSION}-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS web
WORKDIR /src/frontend
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
COPY frontend/apps/web/package.json apps/web/
COPY frontend/apps/docs/package.json apps/docs/
COPY frontend/packages/api-client/package.json packages/api-client/
RUN pnpm install --frozen-lockfile --filter @calendar/web...
COPY frontend/ ./
RUN pnpm --filter @calendar/web build

# The Rust toolchain is the one backend/rust-toolchain.toml pins: rustup reads the file, so when this image is
# behind or ahead of the pin it installs the pinned toolchain instead of building with its own.
FROM rust:1.100.0-slim-trixie@sha256:e9d95b74296f7126a83ae3d041aeaba1ff4c478f13abc5cc034fcf7c131c3d4a AS build
WORKDIR /src/backend
COPY backend/rust-toolchain.toml ./
RUN rustup toolchain install
# Dependency layer: the manifests and the lock file with empty sources, so the crates.io dependencies are compiled
# once and reused until a manifest or Cargo.lock changes. Every workspace member needs its manifest, or the lock
# file would no longer match the workspace and --locked would refuse to build.
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/crates/calendar-api/Cargo.toml crates/calendar-api/
COPY backend/crates/calendar-domain/Cargo.toml crates/calendar-domain/
COPY backend/crates/calendar-infrastructure/Cargo.toml crates/calendar-infrastructure/
COPY backend/crates/calendar-migrate/Cargo.toml crates/calendar-migrate/
COPY backend/crates/calendar-testing/Cargo.toml crates/calendar-testing/
RUN for crate in api domain infrastructure migrate testing; do mkdir -p "crates/calendar-$crate/src" || exit 1; done \
    && for crate in api domain infrastructure testing; do : > "crates/calendar-$crate/src/lib.rs" || exit 1; done \
    && echo 'fn main() {}' > crates/calendar-api/src/main.rs \
    && echo 'fn main() {}' > crates/calendar-migrate/src/main.rs \
    && cargo build --release --locked -p calendar-api -p calendar-migrate
# The real sources. Only the four crates the binaries are built from: calendar-testing keeps its empty stand-in.
COPY backend/crates/calendar-domain/src/ crates/calendar-domain/src/
COPY backend/crates/calendar-infrastructure/src/ crates/calendar-infrastructure/src/
COPY backend/crates/calendar-infrastructure/migrations/ crates/calendar-infrastructure/migrations/
COPY backend/crates/calendar-migrate/src/ crates/calendar-migrate/src/
COPY backend/crates/calendar-api/src/ crates/calendar-api/src/
# The stand-in sources above are newer than the copied files' timestamps, so touch the crate roots: Cargo then
# rebuilds the workspace crates and keeps the compiled dependencies.
RUN touch crates/calendar-domain/src/lib.rs crates/calendar-infrastructure/src/lib.rs \
      crates/calendar-api/src/lib.rs crates/calendar-api/src/main.rs crates/calendar-migrate/src/main.rs \
    && cargo build --release --locked -p calendar-api -p calendar-migrate \
    && mkdir /out \
    && cp target/release/calendar-api target/release/calendar-migrate /out/

# The Rune UI's browser bundle (ADR-0067, #1009), served at /native/ from the web root. It starts from the same pinned
# image as `build`, and rustup installs the toolchain native/rust-toolchain.toml pins (Rune's, with the wasm32 target).
# The steps are `just native build-web`'s, without just: cargo, then the wasm-bindgen CLI at the version of the
# wasm-bindgen crate in native/Cargo.lock. Cold, compiling that CLI took about 2 minutes and the dependencies about
# 3 (#1037), so each is a layer of its own that the Buildx cache keeps until its own input moves.
FROM rust:1.100.0-slim-trixie@sha256:e9d95b74296f7126a83ae3d041aeaba1ff4c478f13abc5cc034fcf7c131c3d4a AS native-toolchain
WORKDIR /src/native
COPY native/rust-toolchain.toml ./
RUN rustup toolchain install

# Only the version string reaches the CLI's stage, so a Cargo.lock change that keeps it reuses the compiled CLI.
FROM native-toolchain AS native-bindgen-version
COPY native/Cargo.lock ./
RUN awk '$0 == "name = \"wasm-bindgen\"" { getline; gsub(/"/, "", $3); print $3 }' Cargo.lock > /wasm-bindgen-version \
    && test -s /wasm-bindgen-version

FROM native-toolchain AS native-bindgen
COPY --from=native-bindgen-version /wasm-bindgen-version /tmp/
RUN cargo install wasm-bindgen-cli --version "$(cat /tmp/wasm-bindgen-version)" --locked --bin wasm-bindgen \
      --root /opt/wasm-bindgen

FROM native-toolchain AS native-web
# Dependency layer, as in `build`: the manifests and the lock file with stand-in sources, so Rune and the crates.io
# dependencies compile once and are reused until a manifest or Cargo.lock changes. Every workspace member needs its
# manifest, or --locked would refuse the lock file.
COPY native/Cargo.toml native/Cargo.lock ./
COPY native/crates/calendar-client/Cargo.toml crates/calendar-client/
COPY native/crates/calendar-client-gen/Cargo.toml crates/calendar-client-gen/
COPY native/crates/calendar-native/Cargo.toml crates/calendar-native/
RUN for crate in client client-gen native; do mkdir -p "crates/calendar-$crate/src" || exit 1; done \
    && : > crates/calendar-client/src/lib.rs \
    && : > crates/calendar-native/src/lib.rs \
    && echo 'fn main() {}' > crates/calendar-native/src/main.rs \
    && echo 'fn main() {}' > crates/calendar-client-gen/src/main.rs \
    && cargo build --release --locked --target wasm32-unknown-unknown -p calendar-native --lib
# The real sources of the two crates the bundle is built from, then a touch of their roots, as in `build`, so Cargo
# rebuilds them and keeps the compiled dependencies.
COPY native/crates/calendar-client/src/ crates/calendar-client/src/
COPY native/crates/calendar-native/src/ crates/calendar-native/src/
COPY native/web/index.html web/
COPY --from=native-bindgen /opt/wasm-bindgen/bin/wasm-bindgen /usr/local/bin/
RUN touch crates/calendar-client/src/lib.rs crates/calendar-native/src/lib.rs \
    && cargo build --release --locked --target wasm32-unknown-unknown -p calendar-native --lib \
    && wasm-bindgen --target web --no-typescript --out-dir /out --out-name app \
      target/wasm32-unknown-unknown/release/calendar_native.wasm \
    && cp web/index.html /out/ \
    && rune=$(cargo metadata --locked --format-version 1 --filter-platform wasm32-unknown-unknown \
      | sed -n 's/.*"manifest_path":"\([^"]*\/crates\/rune\/\)Cargo\.toml".*/\1/p') \
    && cp "${rune}assets/web/"Inter-*.ttf /out/

# glibc, CA certificates (PostgreSQL and Google TLS verify against the system store) and a non-root user; no shell.
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2 AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
COPY --from=build /out/ ./
COPY --from=web /src/frontend/apps/web/dist/ ./wwwroot/
COPY --from=native-web /out/ ./wwwroot/native/
USER nonroot
ENTRYPOINT ["/app/calendar-api"]
