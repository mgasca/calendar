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
FROM rust:1.99.1-slim-trixie@sha256:f6c4a35d21dbb3c89d7a8d056c193e94fc09037f2b58dd858b09c39a47dd02d7 AS build
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

# glibc, CA certificates (PostgreSQL and Google TLS verify against the system store) and a non-root user; no shell.
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:cc66d222f0a7ec996b78a99fe76a969bc80b539a5016ad866c14d1949bc6d0ab AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
COPY --from=build /out/ ./
COPY --from=web /src/frontend/apps/web/dist/ ./wwwroot/
USER nonroot
ENTRYPOINT ["/app/calendar-api"]
