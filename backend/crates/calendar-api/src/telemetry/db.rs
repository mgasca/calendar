//! One client span per Diesel query, named `<operation> <table>` and carrying the statement without its bind
//! values.

use std::collections::VecDeque;
use std::fmt::{self, Write as _};

use diesel::connection::{Instrumentation, InstrumentationEvent};
use tracing::Span;
use tracing::field::Empty;

/// What Diesel's debug text puts between the statement and the bind values.
const BINDS_MARKER: &str = " -- binds: ";

/// The Diesel instrumentation that opens a span when a query starts and closes it when the query finishes.
/// It is set on each pooled connection when a request takes it ([`crate::state::AppState::db`]).
#[derive(Default)]
pub struct DatabaseSpans {
  /// The spans of the queries that have started and not finished, oldest first: a pipelined connection can
  /// send several before the first one finishes, and they finish in order.
  open: VecDeque<Span>,
}

impl Instrumentation for DatabaseSpans {
  fn on_connection_event(&mut self, event: InstrumentationEvent<'_>) {
    match event {
      InstrumentationEvent::StartQuery { query, .. } => {
        let span = tracing::info_span!(
          "db.query",
          otel.name = Empty,
          otel.kind = "client",
          otel.status_code = Empty,
          db.system.name = "postgresql",
          db.operation.name = Empty,
          db.collection.name = Empty,
          db.query.text = Empty,
          error.type = Empty,
        );
        if !span.is_disabled() {
          let statement = statement(&query);
          let (operation, table) = shape(&statement);
          span.record("otel.name", span_name(operation.as_deref(), table.as_deref()));
          if let Some(operation) = &operation {
            span.record("db.operation.name", operation.as_str());
          }
          if let Some(table) = &table {
            span.record("db.collection.name", table.as_str());
          }
          span.record("db.query.text", statement.as_str());
        }
        self.open.push_back(span);
      }
      InstrumentationEvent::FinishQuery { error, .. } => {
        if let Some(span) = self.open.pop_front()
          && error.is_some()
        {
          span.record("otel.status_code", "error");
          span.record("error.type", "database");
        }
      }
      _ => {}
    }
  }
}

/// The statement of Diesel's debug text, stopping before the bind values: formatting is abandoned as soon as
/// the marker is written, so the values are never even formatted.
pub fn statement(query: &dyn fmt::Display) -> String {
  struct UpToBinds(String);
  impl fmt::Write for UpToBinds {
    fn write_str(&mut self, s: &str) -> fmt::Result {
      self.0.push_str(s);
      if let Some(position) = self.0.find(BINDS_MARKER) {
        self.0.truncate(position);
        return Err(fmt::Error);
      }
      Ok(())
    }
  }
  let mut text = UpToBinds(String::new());
  let _ = write!(text, "{query}");
  text.0
}

/// The operation (`SELECT`, `INSERT`, ...) and the first table a statement names.
pub fn shape(statement: &str) -> (Option<String>, Option<String>) {
  let mut words = statement
    .split(|c: char| c.is_whitespace() || matches!(c, '(' | ')' | ',' | ';'))
    .filter(|word| !word.is_empty());
  let Some(first) = words.next() else { return (None, None) };
  let operation = first.to_ascii_uppercase();
  if !operation.chars().all(|c| c.is_ascii_alphabetic()) {
    return (None, None);
  }
  let after = match operation.as_str() {
    "SELECT" | "DELETE" => "FROM",
    "INSERT" => "INTO",
    "UPDATE" => "UPDATE",
    _ => return (Some(operation), None),
  };
  let table = if after == "UPDATE" {
    words.next()
  } else {
    let mut words = words;
    words.find(|word| word.eq_ignore_ascii_case(after)).and_then(|_| words.next())
  }
  .map(table_name)
  .filter(|table| !table.is_empty() && table.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.'));
  (Some(operation), table)
}

/// `"tasks"` or `"public"."tasks"` as `tasks` or `public.tasks`.
fn table_name(word: &str) -> String {
  word.replace('"', "")
}

fn span_name(operation: Option<&str>, table: Option<&str>) -> String {
  match (operation, table) {
    (Some(operation), Some(table)) => format!("{operation} {table}"),
    (Some(operation), None) => operation.to_owned(),
    (None, _) => "postgresql".to_owned(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  struct Debugged(&'static str, &'static str);
  impl fmt::Display for Debugged {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
      write!(f, "{}{BINDS_MARKER}{:?}", self.0, Secret(self.1))
    }
  }
  struct Secret(&'static str);
  impl fmt::Debug for Secret {
    fn fmt(&self, _: &mut fmt::Formatter<'_>) -> fmt::Result {
      panic!("a bind value was formatted: {}", self.0)
    }
  }

  #[test]
  fn the_statement_stops_before_the_binds_without_formatting_them() {
    let query = Debugged(r#"SELECT "tasks"."id" FROM "tasks" WHERE "tasks"."title" = $1"#, "Dentist with Ana");
    assert_eq!(statement(&query), r#"SELECT "tasks"."id" FROM "tasks" WHERE "tasks"."title" = $1"#);
  }

  #[test]
  fn a_statement_without_binds_is_kept_whole() {
    assert_eq!(
      statement(&"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"),
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
    );
  }

  #[test]
  fn the_shape_is_the_operation_and_the_first_table() {
    let cases = [
      (
        r#"SELECT "events"."id", "events"."title" FROM "events" WHERE ("events"."owner_id" = $1)"#,
        "SELECT events",
      ),
      (
        r#"INSERT INTO "tasks" ("id", "title") VALUES ($1, $2) RETURNING "tasks"."xmin""#,
        "INSERT tasks",
      ),
      (r#"UPDATE "tasks" SET "title" = $1 WHERE "tasks"."id" = $2"#, "UPDATE tasks"),
      (r#"DELETE FROM "events" WHERE "events"."id" = $1"#, "DELETE events"),
      (
        r#"(SELECT "tasks"."id" FROM "tasks") UNION ALL (SELECT "tasks"."id" FROM "tasks")"#,
        "SELECT tasks",
      ),
      ("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY", "BEGIN"),
      ("COMMIT", "COMMIT"),
      ("SELECT 1", "SELECT"),
      ("", "postgresql"),
    ];
    for (statement, expected) in cases {
      let (operation, table) = shape(statement);
      assert_eq!(span_name(operation.as_deref(), table.as_deref()), expected, "{statement}");
    }
  }
}
