//! SQL functions the query builder does not ship.

use diesel::sql_types::{Date, Nullable, Timestamp};

diesel::define_sql_function! {
  /// `coalesce(a, b)` over dates: `a`, or `b` when `a` is `NULL`.
  fn coalesce(a: Nullable<Date>, b: Nullable<Date>) -> Nullable<Date>;
}

diesel::define_sql_function! {
  /// `date(timestamp)`: the date of a local timestamp, i.e. `timestamp::date` (Diesel's `cast` does not
  /// cover timestamp to date).
  #[sql_name = "date"]
  fn date_of(timestamp: Timestamp) -> Date;
}
