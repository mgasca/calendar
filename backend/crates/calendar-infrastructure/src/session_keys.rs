//! The key that seals session cookies. It replaces the ASP.NET Data Protection key ring: one row in
//! `session_keys`, created by whichever instance starts first and then shared by all of them.

use diesel::prelude::*;
use diesel_async::{AsyncPgConnection, RunQueryDsl};

use crate::error::Error;
use crate::schema::session_keys;

/// The length of the key, which the table enforces.
pub const KEY_LENGTH: usize = 32;

/// The session key. Its `Debug` form does not show the key.
#[derive(Clone, PartialEq, Eq)]
pub struct SessionKey(pub [u8; KEY_LENGTH]);

impl std::fmt::Debug for SessionKey {
  fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    formatter.write_str("SessionKey(<redacted>)")
  }
}

/// The stored session key, created from `generate` when there is none yet.
///
/// `generate` must return fresh random bytes; it is only called when the table is empty. Two instances that
/// start together both insert, `ON CONFLICT (id) DO NOTHING` lets one row win, and both read that row back,
/// so they always agree. `calendar_app` can neither update nor delete the row: rotating the key is the
/// migrator's work: delete the row, then restart every instance. A running instance keeps the key it loaded,
/// so sessions end only once each one has restarted.
pub async fn get_or_create(conn: &mut AsyncPgConnection, generate: impl FnOnce() -> [u8; KEY_LENGTH] + Send) -> Result<SessionKey, Error> {
  if let Some(key) = stored(conn).await? {
    return Ok(key);
  }

  let candidate = generate();
  diesel::insert_into(session_keys::table)
    .values(session_keys::key_material.eq(&candidate[..]))
    .on_conflict(session_keys::id)
    .do_nothing()
    .execute(conn)
    .await?;
  stored(conn).await?.ok_or(Error::NotFound)
}

async fn stored(conn: &mut AsyncPgConnection) -> Result<Option<SessionKey>, Error> {
  let material: Option<Vec<u8>> = session_keys::table
    .select(session_keys::key_material)
    .first(conn)
    .await
    .optional()?;
  material
    .map(|bytes| {
      <[u8; KEY_LENGTH]>::try_from(bytes).map(SessionKey).map_err(|_| Error::InvalidRow {
        entity: "session key",
        reason: "the key is not 32 bytes",
      })
    })
    .transpose()
}
