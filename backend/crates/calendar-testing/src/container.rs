//! Starting a PostgreSQL container on a host port the tests choose (#950).
//!
//! Docker picks a published port from 32768 upwards, the same range Linux gives client sockets their source ports
//! from. Under parallel load a test's connection to one container can therefore already hold the port Docker
//! publishes the next one on, and Docker Desktop on WSL, whose forwarder cannot bind it, leaves that port refusing
//! for the container's whole life. A port below the ephemeral range is never a source port, so choose one there.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::net::{Ipv4Addr, TcpListener};
use std::ops::Range;
use std::process::Command;

use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::core::ContainerPort;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ContainerRequest, ImageExt};

/// The lowest port a test container is published on: clear of the ports local development uses.
const LOWEST: u16 = 20_000;
/// Where Linux's ephemeral range starts when `/proc` does not say.
const DEFAULT_EPHEMERAL_LOW: u16 = 32_768;
/// How many ports to try before giving up: another process can take a free port before Docker binds it.
const START_ATTEMPTS: usize = 5;

/// Starts the container `request` builds, published on a free host port below the ephemeral range, and returns it
/// with that port. `request` is called again for each attempt, because a request is consumed by its start.
///
/// # Panics
/// When no port can be found or the container fails to start on any of [`START_ATTEMPTS`] ports.
pub async fn start_postgres<F>(request: F) -> (ContainerAsync<Postgres>, u16)
where
  F: Fn() -> ContainerRequest<Postgres>,
{
  let range = publishable_ports();
  let mut failures = Vec::new();
  for _ in 0..START_ATTEMPTS {
    let port = free_port(&range).unwrap_or_else(|| panic!("no free port in {range:?} for a test container"));
    // Named, because a container that was created but could not start is not removed by Testcontainers.
    let name = format!("calendar-test-{:016x}", RandomState::new().build_hasher().finish());
    let started = request()
      .with_container_name(&name)
      .with_mapped_port(port, ContainerPort::Tcp(5432))
      .start()
      .await;
    match started {
      Ok(container) => return (container, port),
      Err(error) => {
        failures.push(format!("{port}: {error}"));
        // Best effort: a leftover costs only a stopped container.
        let _ = Command::new("docker").args(["rm", "-fv", &name]).output();
      }
    }
  }
  panic!(
    "the PostgreSQL container does not start (is Docker running?); tried {}",
    failures.join("; ")
  );
}

/// The host ports a test container may be published on: from [`LOWEST`] to where the ephemeral range starts.
pub fn publishable_ports() -> Range<u16> {
  let ephemeral_low = std::fs::read_to_string("/proc/sys/net/ipv4/ip_local_port_range")
    .ok()
    .and_then(|text| text.split_whitespace().next()?.parse::<u16>().ok())
    .unwrap_or(DEFAULT_EPHEMERAL_LOW);
  // A range starting that low leaves nothing below it; fall back to the usual one rather than an empty range.
  let end = if ephemeral_low > LOWEST + 1_000 {
    ephemeral_low
  } else {
    DEFAULT_EPHEMERAL_LOW
  };
  LOWEST..end
}

/// A port in `range` that nothing on this host has bound, starting from a random one so that parallel test
/// processes rarely pick the same.
pub fn free_port(range: &Range<u16>) -> Option<u16> {
  let size = range.end.checked_sub(range.start).filter(|size| *size > 0)?;
  let offset = u16::try_from(RandomState::new().build_hasher().finish() % u64::from(size)).expect("below the range size");
  (0..size)
    .map(|step| range.start + (offset + step) % size)
    .find(|port| TcpListener::bind((Ipv4Addr::UNSPECIFIED, *port)).is_ok())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_ports_lie_below_the_ephemeral_range() {
    let range = publishable_ports();

    assert_eq!(range.start, LOWEST);
    if let Ok(text) = std::fs::read_to_string("/proc/sys/net/ipv4/ip_local_port_range") {
      let low: u16 = text.split_whitespace().next().unwrap().parse().unwrap();
      assert!(range.end <= low, "{range:?} reaches into the ephemeral range from {low}");
    }
  }

  #[test]
  fn a_free_port_is_in_the_range_and_can_be_bound() {
    let range = publishable_ports();

    let port = free_port(&range).unwrap();

    assert!(range.contains(&port), "{port}");
    TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).unwrap();
  }

  #[test]
  fn a_port_in_use_is_skipped() {
    let held = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).unwrap();
    let port = held.local_addr().unwrap().port();

    assert_eq!(free_port(&(port..port + 1)), None);
  }
}
