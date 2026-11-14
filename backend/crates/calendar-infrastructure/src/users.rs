//! The user directory (ports the data access of `Calendar.Api/Auth/UserDirectory.cs`): finds or creates the
//! `users` row of a signed-in identity (ADR-0041). Users are not scoped to an owner: sign-in looks them up
//! before there is one.

#![allow(clippy::ref_option_ref, reason = "the AsChangeset derive borrows the Option<&str> fields")]

use calendar_domain::users::{User, UserRecord};
use chrono::{DateTime, Utc};
use diesel::pg::Pg;
use diesel::prelude::*;
use diesel_async::{AsyncPgConnection, RunQueryDsl};
use uuid::Uuid;

use crate::error::Error;
use crate::schema::users;

/// A whole `users` row, the shape every read here returns.
#[derive(Queryable, Selectable)]
#[diesel(table_name = users, check_for_backend(Pg))]
struct UserRow {
  id: Uuid,
  google_subject: Option<String>,
  email: Option<String>,
  display_name: Option<String>,
  picture_url: Option<String>,
  created_at: DateTime<Utc>,
  last_signed_in_at: Option<DateTime<Utc>>,
}

impl From<UserRow> for User {
  fn from(row: UserRow) -> Self {
    User::restore(UserRecord {
      id: row.id,
      google_subject: row.google_subject,
      email: row.email,
      display_name: row.display_name,
      picture_url: row.picture_url,
      created_at: row.created_at,
      last_signed_in_at: row.last_signed_in_at,
    })
  }
}

/// The columns an insert writes: the ones a sign-in may change, plus the id and the creation time.
#[derive(Insertable)]
#[diesel(table_name = users)]
struct NewUser<'a> {
  id: Uuid,
  created_at: DateTime<Utc>,
  #[diesel(embed)]
  changes: UserChanges<'a>,
}

impl<'a> NewUser<'a> {
  fn of(user: &'a User) -> Self {
    Self {
      id: user.id(),
      created_at: user.created_at(),
      changes: UserChanges::of(user),
    }
  }
}

/// The columns a sign-in may change: never the id or the creation time. Also `Insertable`, to embed in
/// [`NewUser`].
#[derive(Insertable, AsChangeset)]
#[diesel(table_name = users, treat_none_as_null = true)]
struct UserChanges<'a> {
  google_subject: Option<&'a str>,
  email: Option<&'a str>,
  display_name: Option<&'a str>,
  picture_url: Option<&'a str>,
  last_signed_in_at: Option<DateTime<Utc>>,
}

impl<'a> UserChanges<'a> {
  fn of(user: &'a User) -> Self {
    Self {
      google_subject: user.google_subject(),
      email: user.email(),
      display_name: user.display_name(),
      picture_url: user.picture_url(),
      last_signed_in_at: user.last_signed_in_at(),
    }
  }
}

/// The identity a sign-in presents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SignIn<'a> {
  /// The verified email; matched and stored lower-cased.
  pub email: &'a str,
  /// Google's `sub` claim, or `None` for the Development seed scheme.
  pub google_subject: Option<&'a str>,
  /// The display name to record, or `None` to keep the current one.
  pub display_name: Option<&'a str>,
  /// The picture URL to record, or `None` to keep the current one.
  pub picture_url: Option<&'a str>,
}

/// Resolves the user row of `sign_in`, creating it when none matches, and records the sign-in at `now`.
///
/// Sign-in and the seed scheme share one lookup order: by Google subject; failing that, by lower-cased email
/// (a real sign-in only matches a row that has no subject yet, so another Google account never takes over a
/// claimed row; the seed scheme asserts no Google identity and matches its email whatever the row's subject);
/// failing that, when the email is `first_allowed_email` (the first entry of `Auth:AllowedEmails`, trimmed),
/// the unclaimed legacy placeholder; otherwise a new row. A real sign-in fills in the subject of a matched
/// row; the seed scheme never sets one.
///
/// Two first sign-ins of the same person can race: the loser's write hits a unique index, and the lookup is
/// then repeated once and finds the winner's row. A second unique violation is returned as
/// [`Error::UniqueViolation`]; that is also how a Google account presenting an email that another account's
/// row holds is refused. A blank email is [`Error::Domain`].
pub async fn resolve(
  conn: &mut AsyncPgConnection,
  now: DateTime<Utc>,
  sign_in: &SignIn<'_>,
  first_allowed_email: Option<&str>,
) -> Result<User, Error> {
  let email = User::normalize_email(sign_in.email)?;
  let is_first_allowed = match first_allowed_email {
    Some(first) => User::normalize_email(first)? == email,
    None => false,
  };

  let mut retried = false;
  loop {
    let found = find_for_sign_in(conn, &email, sign_in.google_subject, is_first_allowed).await?;
    let (user, written) = match found {
      None => {
        let user = User::create(now, &email, sign_in.google_subject, sign_in.display_name, sign_in.picture_url)?;
        let written = diesel::insert_into(users::table).values(NewUser::of(&user)).execute(conn).await;
        (user, written)
      }
      Some(mut user) => {
        user.sign_in(now, &email, sign_in.google_subject, sign_in.display_name, sign_in.picture_url)?;
        let written = diesel::update(users::table.find(user.id()))
          .set(UserChanges::of(&user))
          .execute(conn)
          .await;
        (user, written)
      }
    };

    match written.map_err(Error::from) {
      Ok(0) => return Err(Error::NotFound),
      Ok(_) => return Ok(user),
      // Two first sign-ins of the same person raced; the other request's row wins and the lookup finds it.
      Err(Error::UniqueViolation { .. }) if !retried => retried = true,
      Err(error) => return Err(error),
    }
  }
}

/// The user `id`, or `None`.
pub async fn find(conn: &mut AsyncPgConnection, id: Uuid) -> Result<Option<User>, Error> {
  let row = users::table
    .find(id)
    .select(UserRow::as_select())
    .first::<UserRow>(conn)
    .await
    .optional()?;
  Ok(row.map(User::from))
}

async fn find_for_sign_in(
  conn: &mut AsyncPgConnection,
  email: &str,
  google_subject: Option<&str>,
  is_first_allowed: bool,
) -> Result<Option<User>, Error> {
  let mut row = match google_subject {
    Some(subject) => {
      let by_subject = first(conn, users::table.filter(users::google_subject.eq(subject)).into_boxed()).await?;
      if by_subject.is_some() {
        by_subject
      } else {
        let unclaimed = users::table.filter(users::email.eq(email)).filter(users::google_subject.is_null());
        first(conn, unclaimed.into_boxed()).await?
      }
    }
    None => first(conn, users::table.filter(users::email.eq(email)).into_boxed()).await?,
  };
  if row.is_none() && is_first_allowed {
    let placeholder = users::table
      .filter(users::id.eq(User::LEGACY_OWNER_ID))
      .filter(users::google_subject.is_null())
      .filter(users::email.is_null());
    row = first(conn, placeholder.into_boxed()).await?;
  }

  Ok(row.map(User::from))
}

async fn first(conn: &mut AsyncPgConnection, query: users::BoxedQuery<'_, Pg>) -> Result<Option<UserRow>, Error> {
  let row = query.select(UserRow::as_select()).first::<UserRow>(conn).await.optional()?;
  Ok(row)
}
