//! The OpenAPI document of the API: `contracts/openapi.json`, the contract every UI consumes.
//!
//! utoipa collects the paths and schemas; [`document`] then rewrites the result into the dialect the .NET
//! generator wrote, which the committed contract and the generated TypeScript client are in: integers that
//! may also be written as strings, `null` first in nullable types, nullable references as `oneOf`, and the
//! key order of that writer. The file therefore stays byte-for-byte stable across the port.

use serde_json::{Map, Value, json};
use utoipa::OpenApi;

use crate::contracts;
use crate::endpoints::{agenda, auth, events, health, tasks};

#[derive(OpenApi)]
#[openapi(
  info(title = "Calendar.Api | v1", version = "1.0.0"),
  paths(
    health::get_health,
    auth::me,
    auth::logout,
    events::create,
    events::get,
    events::update,
    events::delete,
    tasks::list,
    tasks::create,
    tasks::get,
    tasks::update,
    tasks::delete,
    tasks::bulk,
    tasks::complete,
    tasks::reopen,
    agenda::get_day,
    agenda::get_week,
  ),
  components(schemas(
    contracts::AgendaDay,
    contracts::AgendaTaskItem,
    contracts::AgendaTasks,
    contracts::AgendaWindow,
    contracts::AllDayEventItem,
    contracts::AuthUserResponse,
    contracts::BulkTaskAction,
    contracts::BulkTaskItemResult,
    contracts::BulkTaskRequest,
    contracts::BulkTaskResponse,
    contracts::CreateEventRequest,
    contracts::CreateTaskRequest,
    contracts::DayAgendaResponse,
    contracts::EventResponse,
    contracts::HealthResponse,
    contracts::HttpValidationProblemDetails,
    contracts::OverdueTaskFilter,
    contracts::ProblemDetails,
    contracts::TaskPage,
    contracts::TaskResponse,
    contracts::TimedEventItem,
    contracts::UpdateEventRequest,
    contracts::UpdateTaskRequest,
    contracts::WeekAgendaResponse,
  )),
  tags(
    (name = "Health"),
    (name = "Auth"),
    (name = "Events"),
    (name = "Tasks"),
    (name = "Agenda"),
  )
)]
struct ApiDoc;

/// The pattern the .NET generator gave every integer, which may also be sent as a string of digits.
const INTEGER_PATTERN: &str = r"^-?(?:0|[1-9]\d*)$";

/// The OpenAPI document, as committed to `contracts/openapi.json`.
pub fn document() -> Value {
  let mut document = serde_json::to_value(ApiDoc::openapi()).expect("the OpenAPI document serializes to JSON");
  document["openapi"] = json!("3.1.1");
  if let Some(info) = document["info"].as_object_mut() {
    info.retain(|key, _| matches!(key.as_str(), "title" | "version"));
  }
  to_dotnet_dialect(&mut document, false);
  order_keys(&mut document, Container::Root);
  document
}

/// The document with the `servers` entry of the host that serves it, as the Development route returns it.
pub fn document_for_server(url: &str) -> Value {
  let document = document();
  let mut with_server = Map::new();
  for (key, value) in document.as_object().into_iter().flatten() {
    with_server.insert(key.clone(), value.clone());
    if key == "info" {
      with_server.insert("servers".to_owned(), json!([{ "url": url }]));
    }
  }
  Value::Object(with_server)
}

/// The document as text: two-space indentation and no trailing newline, as the .NET build wrote the file.
pub fn to_json(document: &Value) -> String {
  serde_json::to_string_pretty(document).expect("a JSON value serializes")
}

fn is_null_type(schema: &Value) -> bool {
  schema
    .as_object()
    .is_some_and(|object| object.len() == 1 && object.get("type") == Some(&json!("null")))
}

/// Rewrites every schema below `value` into the .NET generator's dialect. `in_parameter` is true inside a
/// parameter, whose schema that generator never marked nullable.
fn to_dotnet_dialect(value: &mut Value, in_parameter: bool) {
  match value {
    Value::Array(items) => items.iter_mut().for_each(|item| to_dotnet_dialect(item, in_parameter)),
    Value::Object(object) => {
      let within = in_parameter || (object.contains_key("in") && object.contains_key("name"));
      for (_, child) in object.iter_mut() {
        to_dotnet_dialect(child, within);
      }
      rewrite_schema(object, within);
    }
    _ => {}
  }
}

fn rewrite_schema(schema: &mut Map<String, Value>, in_parameter: bool) {
  // A string enum is written without its type.
  if schema.contains_key("enum") {
    schema.remove("type");
  }

  // `null` comes first in a nullable type; a parameter is never nullable.
  if let Some(Value::Array(types)) = schema.get_mut("type") {
    types.retain(|name| !(in_parameter && name == "null"));
    types.sort_by_key(|name| name != "null");
    if types.len() == 1 {
      let only = types.remove(0);
      schema.insert("type".to_owned(), only);
    }
  }

  // An integer may also be a string of digits, and an unsigned one says so in its format.
  let integer = match schema.get("type") {
    Some(Value::String(name)) if name == "integer" => Some(vec![json!("integer"), json!("string")]),
    Some(Value::Array(types)) if types.contains(&json!("integer")) => Some(vec![json!("null"), json!("integer"), json!("string")]),
    _ => None,
  };
  if let Some(types) = integer {
    if schema.remove("minimum").is_some() && schema.get("format") == Some(&json!("int32")) {
      schema.insert("format".to_owned(), json!("uint32"));
    }
    schema.insert("type".to_owned(), Value::Array(types));
    schema.insert("pattern".to_owned(), json!(INTEGER_PATTERN));
  }

  // A nullable reference is `null` or the reference, which keeps the description.
  let description = schema.get("description").cloned();
  if let Some(Value::Array(alternatives)) = schema.get_mut("oneOf")
    && alternatives.len() == 2
    && alternatives.iter().any(is_null_type)
    && alternatives.iter().any(|alternative| alternative.get("$ref").is_some())
  {
    alternatives.sort_by_key(|alternative| !is_null_type(alternative));
    if let (Some(description), Some(reference)) = (description, alternatives[1].as_object_mut()) {
      reference.insert("description".to_owned(), description);
      schema.remove("description");
    }
  }

  // An optional parameter says nothing about being required.
  if in_parameter && schema.get("required") == Some(&json!(false)) {
    schema.remove("required");
  }

  // An empty description stands for "undocumented in the contract".
  if schema.get("description") == Some(&json!("")) {
    schema.remove("description");
  }
  // The .NET generator named no property of a string-keyed dictionary.
  schema.remove("propertyNames");
}

/// What kind of object a JSON object of the document is: it decides the order of its keys.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Container {
  Root,
  /// A map whose keys are names (paths, properties, schemas, status codes, media types): order is kept.
  Names(Child),
  PathItem,
  Operation,
  Parameter,
  RequestBody,
  Response,
  MediaType,
  Components,
  Schema,
  Other,
}

/// The kind of the values of a [`Container::Names`] map.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Child {
  PathItem,
  Response,
  MediaType,
  Schema,
}

const ROOT_KEYS: [&str; 6] = ["openapi", "info", "servers", "paths", "components", "tags"];
const PATH_ITEM_KEYS: [&str; 8] = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const OPERATION_KEYS: [&str; 7] = [
  "tags",
  "summary",
  "description",
  "operationId",
  "parameters",
  "requestBody",
  "responses",
];
const PARAMETER_KEYS: [&str; 5] = ["name", "in", "description", "required", "schema"];
const REQUEST_BODY_KEYS: [&str; 3] = ["description", "content", "required"];
const RESPONSE_KEYS: [&str; 2] = ["description", "content"];
const SCHEMA_KEYS: [&str; 11] = [
  "oneOf",
  "enum",
  "required",
  "pattern",
  "type",
  "items",
  "properties",
  "additionalProperties",
  "description",
  "format",
  "$ref",
];

/// Puts the keys of every object in the order the .NET writer used. Keys it did not know keep their place
/// after the known ones.
fn order_keys(value: &mut Value, container: Container) {
  match value {
    Value::Array(items) => items.iter_mut().for_each(|item| order_keys(item, container)),
    Value::Object(object) => {
      let known: &[&str] = match container {
        Container::Root => &ROOT_KEYS,
        Container::PathItem => &PATH_ITEM_KEYS,
        Container::Operation => &OPERATION_KEYS,
        Container::Parameter => &PARAMETER_KEYS,
        Container::RequestBody => &REQUEST_BODY_KEYS,
        Container::Response => &RESPONSE_KEYS,
        Container::Schema => &SCHEMA_KEYS,
        Container::Names(_) | Container::MediaType | Container::Components | Container::Other => &[],
      };
      if !known.is_empty() {
        let mut entries: Vec<(String, Value)> = std::mem::take(object).into_iter().collect();
        entries.sort_by_key(|(key, _)| known.iter().position(|name| name == key).unwrap_or(known.len()));
        object.extend(entries);
      }
      for (key, child) in object.iter_mut() {
        order_keys(child, child_container(container, key));
      }
    }
    _ => {}
  }
}

fn child_container(parent: Container, key: &str) -> Container {
  match (parent, key) {
    (Container::Root, "paths") => Container::Names(Child::PathItem),
    (Container::Root, "components") => Container::Components,
    (Container::Components, "schemas") | (Container::Schema, "properties") => Container::Names(Child::Schema),
    (Container::Names(Child::PathItem), _) => Container::PathItem,
    (Container::Names(Child::Response), _) => Container::Response,
    (Container::Names(Child::MediaType), _) => Container::MediaType,
    (Container::Names(Child::Schema), _)
    | (Container::Parameter | Container::MediaType, "schema")
    | (Container::Schema, "items" | "additionalProperties" | "oneOf") => Container::Schema,
    (Container::PathItem, _) => Container::Operation,
    (Container::Operation, "parameters") => Container::Parameter,
    (Container::Operation, "requestBody") => Container::RequestBody,
    (Container::Operation, "responses") => Container::Names(Child::Response),
    (Container::RequestBody | Container::Response, "content") => Container::Names(Child::MediaType),
    _ => Container::Other,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// The committed contract is this document, byte for byte. When this fails after a deliberate change to an
  /// endpoint or a contract type, regenerate it: `cargo run -p calendar-api -- --openapi ../contracts/openapi.json`
  /// (then the TypeScript client, `just contracts`).
  #[test]
  fn the_committed_contract_is_the_generated_document() {
    let committed = include_str!("../../../../contracts/openapi.json");
    assert!(to_json(&document()) == committed, "contracts/openapi.json is stale: regenerate it");
  }

  #[test]
  fn the_document_is_deterministic() {
    assert_eq!(to_json(&document()), to_json(&document()));
  }

  #[test]
  fn the_development_document_names_its_server() {
    let document = document_for_server("http://localhost:5041/");
    assert_eq!(document["servers"], json!([{ "url": "http://localhost:5041/" }]));
    let keys: Vec<&String> = document.as_object().unwrap().keys().collect();
    assert_eq!(keys, ["openapi", "info", "servers", "paths", "components", "tags"]);
  }
}
