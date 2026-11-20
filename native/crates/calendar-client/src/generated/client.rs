//! Generated HTTP client for regular API requests
//!
//! This file contains the HTTP client implementation for GET, POST, etc.
//! Do not edit manually - regenerate using the appropriate script.
#![allow(clippy::format_in_format_args)]
#![allow(clippy::let_unit_value)]
use super::types::*;
use thiserror::Error;
/// The generated validation-problem profile based on RFC 9457.
/// The distinctive namespace avoids collisions with user schemas.
pub mod openapi_to_rust_problem {
    #[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
    pub struct ProblemDetails {
        #[serde(rename = "type")]
        pub type_uri: String,
        pub title: String,
        pub status: u16,
        pub code: String,
        #[serde(default)]
        pub errors: Vec<InvalidParameter>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub detail: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub instance: Option<String>,
    }
    #[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
    pub struct InvalidParameter {
        pub code: String,
        pub location: String,
        pub message: String,
    }
}
/// Transport-level errors: failures where no safely inspectable
/// HTTP response is available to the caller.
///
/// HTTP responses with non-2xx status codes are surfaced as
/// [`ApiError`] inside [`ApiOpError::Api`], not here, so callers can
/// always inspect status, headers, and the raw body when the server
/// actually responded.
#[derive(Error, Debug)]
pub enum HttpError {
    /// Network or connection error (from reqwest)
    #[error("Network error")]
    Network(#[from] reqwest::Error),
    /// Middleware error (from reqwest-middleware)
    #[error("Middleware error")]
    Middleware(#[from] reqwest_middleware::Error),
    /// Request serialization error
    #[error("Failed to serialize request: {0}")]
    Serialization(String),
    /// Authentication error
    #[error("Authentication error: {0}")]
    Auth(String),
    /// Request timeout
    #[error("Request timeout")]
    Timeout,
    /// A response body exceeded the configured in-memory limit
    #[error("Response body exceeded configured limit of {limit} bytes")]
    ResponseTooLarge { limit: usize },
    /// Invalid configuration
    #[error("Configuration error: {0}")]
    Config(String),
    /// Generic error
    #[error("{0}")]
    Other(String),
}
impl HttpError {
    /// Create a serialization error
    pub fn serialization_error(error: impl std::fmt::Display) -> Self {
        Self::Serialization(error.to_string())
    }
    /// Check if this transport error is retryable
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::Network(_) | Self::Middleware(_) | Self::Timeout)
    }
}
/// Envelope returned for any HTTP response that we received but
/// couldn't (or didn't) treat as a successful typed result.
///
/// Includes both non-2xx responses and 2xx responses whose body
/// failed to deserialize into the expected success type. `status`,
/// `headers`, and `raw_body` preserve what the server actually sent,
/// while `body` is a convenient lossy UTF-8 rendering. `typed`
/// carries the parsed per-operation error variant
/// when the body matched a declared schema. Formatting the error
/// limits only the displayed body preview; the public fields
/// retain the complete response and parsing details.
#[derive(Debug, Clone)]
pub struct ApiError<E> {
    pub status: u16,
    pub headers: reqwest::header::HeaderMap,
    pub body: String,
    /// Exact response bytes before lossy UTF-8 conversion.
    pub raw_body: Vec<u8>,
    pub typed: Option<E>,
    pub parse_error: Option<String>,
}
const API_ERROR_BODY_DISPLAY_LIMIT: usize = 500;
const API_ERROR_BODY_TRUNCATION_MARKER: &str = "... [truncated]";
fn display_api_error_body(body: &str) -> std::borrow::Cow<'_, str> {
    let Some((end, _)) = body.char_indices().nth(API_ERROR_BODY_DISPLAY_LIMIT) else {
        return std::borrow::Cow::Borrowed(body);
    };
    let mut displayed = String::with_capacity(
        end + API_ERROR_BODY_TRUNCATION_MARKER.len(),
    );
    displayed.push_str(&body[..end]);
    displayed.push_str(API_ERROR_BODY_TRUNCATION_MARKER);
    std::borrow::Cow::Owned(displayed)
}
impl<E> ApiError<E> {
    pub fn is_client_error(&self) -> bool {
        (400..500).contains(&self.status)
    }
    pub fn is_server_error(&self) -> bool {
        (500..600).contains(&self.status)
    }
    /// Retry guidance for the response. Mirrors the previous
    /// HttpError logic for backwards-compatible retry middleware.
    pub fn is_retryable(&self) -> bool {
        matches!(self.status, 429 | 500 | 502 | 503 | 504)
    }
    /// Decode the generated RFC 9457 validation-problem profile
    /// without replacing a documented per-operation error in `typed`.
    ///
    /// Returns `None` unless the response's `Content-Type` is
    /// `application/problem+json`, which is how RFC 9457 identifies
    /// a problem document. Most third-party APIs return their
    /// errors as plain `application/json`, so this yields `None`
    /// against them by design — use `typed` for a documented
    /// per-operation error body, or `body` for the raw payload.
    /// Servers generated by this tool always emit the problem
    /// media type, so this succeeds against them.
    pub fn problem_details(&self) -> Option<openapi_to_rust_problem::ProblemDetails> {
        let content_type = self
            .headers
            .get(reqwest::header::CONTENT_TYPE)?
            .to_str()
            .ok()?;
        let media_type = content_type.split(';').next()?.trim();
        if !media_type.eq_ignore_ascii_case("application/problem+json") {
            return None;
        }
        serde_json::from_str(&self.body).ok()
    }
}
impl<E: std::fmt::Debug> std::fmt::Display for ApiError<E> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "API error {}: {}", self.status, display_api_error_body(& self.body))?;
        if let Some(typed) = &self.typed {
            write!(f, "; typed: {typed:?}")?;
        }
        if let Some(parse_error) = &self.parse_error {
            write!(f, "; parse error: {parse_error}")?;
        }
        Ok(())
    }
}
impl<E: std::fmt::Debug> std::error::Error for ApiError<E> {}
/// Result error type returned by every generated operation method.
///
/// `Transport` covers failures where we never got an inspectable
/// response (network, timeout, middleware, request-side
/// serialization). `Api` covers any case where the server *did*
/// respond — the envelope always carries status + headers + raw
/// body even when the typed deserialize fails.
#[derive(Debug, Error)]
pub enum ApiOpError<E: std::fmt::Debug> {
    #[error(transparent)]
    Transport(#[from] HttpError),
    #[error(transparent)]
    Api(ApiError<E>),
}
impl<E: std::fmt::Debug> ApiOpError<E> {
    /// Returns the API envelope when this is an `Api` variant.
    pub fn api(&self) -> Option<&ApiError<E>> {
        match self {
            Self::Api(e) => Some(e),
            Self::Transport(_) => None,
        }
    }
    /// True when the underlying error came from the server (i.e.
    /// any `Api` variant) rather than the transport layer.
    pub fn is_api_error(&self) -> bool {
        matches!(self, Self::Api(_))
    }
}
impl<E: std::fmt::Debug> From<reqwest::Error> for ApiOpError<E> {
    fn from(e: reqwest::Error) -> Self {
        Self::Transport(HttpError::Network(e))
    }
}
impl<E: std::fmt::Debug> From<reqwest_middleware::Error> for ApiOpError<E> {
    fn from(e: reqwest_middleware::Error) -> Self {
        Self::Transport(HttpError::Middleware(e))
    }
}
/// Result alias for transport-only error paths (e.g. helpers that
/// don't have a per-operation error type). Generated operation
/// methods use [`ApiOpError`] directly.
pub type HttpResult<T> = Result<T, HttpError>;
use reqwest_middleware::{ClientBuilder, ClientWithMiddleware};
use std::collections::BTreeMap;
/// Default upper bound for any response body buffered in memory.
pub const DEFAULT_MAX_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;
/// HTTP client for making API requests
#[derive(Clone)]
pub struct HttpClient {
    base_url: String,
    api_key: Option<String>,
    http_client: ClientWithMiddleware,
    custom_headers: BTreeMap<String, String>,
    max_response_body_bytes: usize,
}
async fn __read_bounded_response_body(
    response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, HttpError> {
    use futures_util::StreamExt;
    let mut body = Vec::new();
    let mut stream = std::pin::pin!(response.bytes_stream());
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(HttpError::Network)?;
        let next_len = body.len().checked_add(chunk.len());
        if next_len.is_none_or(|next_len| next_len > limit) {
            return Err(HttpError::ResponseTooLarge {
                limit,
            });
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}
impl HttpClient {
    /// Create a new HTTP client with default configuration
    pub fn new() -> Self {
        Self::with_client(reqwest::Client::new())
    }
    /// Create an HTTP client using a preconfigured reqwest client.
    ///
    /// Preserves the supplied client's transport settings (for example,
    /// TLS identity, trusted roots, proxy, timeout, and default headers).
    pub fn with_client(client: reqwest::Client) -> Self {
        let http_client = ClientBuilder::new(client).build();
        Self {
            base_url: "".to_string(),
            api_key: None,
            http_client,
            custom_headers: BTreeMap::new(),
            max_response_body_bytes: 8388608usize,
        }
    }
    /// Set the base URL for all requests
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }
    /// Set the API key for authentication
    pub fn with_api_key(mut self, api_key: impl Into<String>) -> Self {
        self.api_key = Some(api_key.into());
        self
    }
    /// Set the maximum number of response-body bytes buffered in memory.
    pub fn with_max_response_body_bytes(mut self, limit: usize) -> Self {
        self.max_response_body_bytes = limit;
        self
    }
    /// Add a custom header to all requests
    pub fn with_header(
        mut self,
        name: impl Into<String>,
        value: impl Into<String>,
    ) -> Self {
        self.custom_headers.insert(name.into(), value.into());
        self
    }
    /// Add multiple custom headers
    pub fn with_headers(mut self, headers: BTreeMap<String, String>) -> Self {
        self.custom_headers.extend(headers);
        self
    }
}
impl Default for HttpClient {
    fn default() -> Self {
        Self::new()
    }
}
fn __pct_encode_path_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push_str(&format!("{:02X}", b));
            }
        }
    }
    out
}
///Typed error responses for `BulkTasks`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum BulkTasksApiError {
    Status400(ProblemDetails),
    Status409(ProblemDetails),
}
///Typed error responses for `CompleteTask`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum CompleteTaskApiError {
    Status404(ProblemDetails),
    Status409(ProblemDetails),
}
///Typed error responses for `CreateEvent`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum CreateEventApiError {
    Status400(HttpValidationProblemDetails),
}
///Typed error responses for `CreateTask`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum CreateTaskApiError {
    Status400(HttpValidationProblemDetails),
}
///Typed error responses for `DeleteEvent`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum DeleteEventApiError {
    Status404(ProblemDetails),
    Status409(ProblemDetails),
}
///Typed error responses for `DeleteTask`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum DeleteTaskApiError {
    Status404(ProblemDetails),
}
///Typed error responses for `GetDayAgenda`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum GetDayAgendaApiError {
    Status400(HttpValidationProblemDetails),
}
///Typed error responses for `GetEvent`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum GetEventApiError {
    Status404(ProblemDetails),
}
///Typed error responses for `GetTask`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum GetTaskApiError {
    Status404(ProblemDetails),
}
///Typed error responses for `GetWeekAgenda`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum GetWeekAgendaApiError {
    Status400(HttpValidationProblemDetails),
}
///Typed error responses for `ListTasks`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum ListTasksApiError {
    Status400(HttpValidationProblemDetails),
}
///Typed error responses for `RedeemNativeCode`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum RedeemNativeCodeApiError {
    Status400(ProblemDetails),
}
///Typed error responses for `ReopenTask`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum ReopenTaskApiError {
    Status404(ProblemDetails),
    Status409(ProblemDetails),
}
///Typed error responses for `UpdateEvent`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum UpdateEventApiError {
    Status400(HttpValidationProblemDetails),
    Status404(ProblemDetails),
    Status409(ProblemDetails),
}
///Typed error responses for `UpdateTask`. One variant per declared non-2xx response.
#[derive(Debug, Clone)]
pub enum UpdateTaskApiError {
    Status400(HttpValidationProblemDetails),
    Status404(ProblemDetails),
    Status409(ProblemDetails),
}
impl HttpClient {
    /// `POST /api/tasks/bulk`
    pub async fn bulk_tasks(
        &self,
        request: BulkTaskRequest,
    ) -> Result<BulkTaskResponse, ApiOpError<BulkTasksApiError>> {
        let request_url = format!("{}{}", self.base_url, "/api/tasks/bulk");
        let mut req = self.http_client.post(request_url);
        req = req
            .body(serde_json::to_vec(&request).map_err(HttpError::serialization_error)?)
            .header("content-type", "application/json");
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 200u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "200",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<BulkTasksApiError>;
            let parse_error: Option<String>;
            match status_code {
                400u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(BulkTasksApiError::Status400(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                409u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(BulkTasksApiError::Status409(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `POST /api/tasks/{id}/complete`
    pub async fn complete_task(
        &self,
        id: impl AsRef<str>,
    ) -> Result<TaskResponse, ApiOpError<CompleteTaskApiError>> {
        let request_url = format!(
            "{}{}", self.base_url, format!("/api/tasks/{}/complete",
            __pct_encode_path_segment(id.as_ref()))
        );
        let mut req = self.http_client.post(request_url);
        req = req.header(reqwest::header::CONTENT_LENGTH, "0");
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 200u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "200",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<CompleteTaskApiError>;
            let parse_error: Option<String>;
            match status_code {
                404u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(CompleteTaskApiError::Status404(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                409u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(CompleteTaskApiError::Status409(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `POST /api/events`
    pub async fn create_event(
        &self,
        request: CreateEventRequest,
    ) -> Result<EventResponse, ApiOpError<CreateEventApiError>> {
        let request_url = format!("{}{}", self.base_url, "/api/events");
        let mut req = self.http_client.post(request_url);
        req = req
            .body(serde_json::to_vec(&request).map_err(HttpError::serialization_error)?)
            .header("content-type", "application/json");
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 201u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "201",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<CreateEventApiError>;
            let parse_error: Option<String>;
            match status_code {
                400u16 => {
                    match serde_json::from_str::<
                        HttpValidationProblemDetails,
                    >(&body_text) {
                        Ok(v) => {
                            typed = Some(CreateEventApiError::Status400(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `POST /api/tasks`
    pub async fn create_task(
        &self,
        request: CreateTaskRequest,
    ) -> Result<TaskResponse, ApiOpError<CreateTaskApiError>> {
        let request_url = format!("{}{}", self.base_url, "/api/tasks");
        let mut req = self.http_client.post(request_url);
        req = req
            .body(serde_json::to_vec(&request).map_err(HttpError::serialization_error)?)
            .header("content-type", "application/json");
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 201u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "201",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<CreateTaskApiError>;
            let parse_error: Option<String>;
            match status_code {
                400u16 => {
                    match serde_json::from_str::<
                        HttpValidationProblemDetails,
                    >(&body_text) {
                        Ok(v) => {
                            typed = Some(CreateTaskApiError::Status400(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `DELETE /api/events/{id}`
    pub async fn delete_event(
        &self,
        id: impl AsRef<str>,
    ) -> Result<(), ApiOpError<DeleteEventApiError>> {
        let request_url = format!(
            "{}{}", self.base_url, format!("/api/events/{}", __pct_encode_path_segment(id
            .as_ref()))
        );
        let mut req = self.http_client.delete(request_url);
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            req = req.header(name, value);
        }
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 204u16 {
            let _ = body_text;
            let _ = raw_body;
            let _ = headers;
            Ok(())
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "204",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<DeleteEventApiError>;
            let parse_error: Option<String>;
            match status_code {
                404u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(DeleteEventApiError::Status404(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                409u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(DeleteEventApiError::Status409(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `DELETE /api/tasks/{id}`
    pub async fn delete_task(
        &self,
        id: impl AsRef<str>,
    ) -> Result<(), ApiOpError<DeleteTaskApiError>> {
        let request_url = format!(
            "{}{}", self.base_url, format!("/api/tasks/{}", __pct_encode_path_segment(id
            .as_ref()))
        );
        let mut req = self.http_client.delete(request_url);
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            req = req.header(name, value);
        }
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 204u16 {
            let _ = body_text;
            let _ = raw_body;
            let _ = headers;
            Ok(())
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "204",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<DeleteTaskApiError>;
            let parse_error: Option<String>;
            match status_code {
                404u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(DeleteTaskApiError::Status404(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `GET /api/auth/me`
    pub async fn get_current_user(
        &self,
    ) -> Result<AuthUserResponse, ApiOpError<serde_json::Value>> {
        let request_url = format!("{}{}", self.base_url, "/api/auth/me");
        let mut req = self.http_client.get(request_url);
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 200u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "200",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<serde_json::Value>;
            let parse_error: Option<String>;
            match status_code {
                _ => {
                    match serde_json::from_str::<serde_json::Value>(&body_text) {
                        Ok(v) => {
                            typed = Some(v);
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// Everything for one local day: all-day events, timed events, and due-today and overdue tasks.
    ///
    /// `GET /api/agenda/day`
    pub async fn get_day_agenda(
        &self,
        date: impl AsRef<str>,
        time_zone: impl AsRef<str>,
    ) -> Result<DayAgendaResponse, ApiOpError<GetDayAgendaApiError>> {
        let request_url = format!("{}{}", self.base_url, "/api/agenda/day");
        let mut req = self.http_client.get(request_url);
        {
            let mut query_params: Vec<(String, String)> = Vec::new();
            query_params.push(("date".to_string(), date.as_ref().to_string()));
            query_params.push(("timeZone".to_string(), time_zone.as_ref().to_string()));
            if !query_params.is_empty() {
                req = req.query(&query_params);
            }
        }
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 200u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "200",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<GetDayAgendaApiError>;
            let parse_error: Option<String>;
            match status_code {
                400u16 => {
                    match serde_json::from_str::<
                        HttpValidationProblemDetails,
                    >(&body_text) {
                        Ok(v) => {
                            typed = Some(GetDayAgendaApiError::Status400(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `GET /api/events/{id}`
    pub async fn get_event(
        &self,
        id: impl AsRef<str>,
    ) -> Result<EventResponse, ApiOpError<GetEventApiError>> {
        let request_url = format!(
            "{}{}", self.base_url, format!("/api/events/{}", __pct_encode_path_segment(id
            .as_ref()))
        );
        let mut req = self.http_client.get(request_url);
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 200u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "200",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<GetEventApiError>;
            let parse_error: Option<String>;
            match status_code {
                404u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(GetEventApiError::Status404(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `GET /api/health`
    pub async fn get_health(
        &self,
    ) -> Result<HealthResponse, ApiOpError<serde_json::Value>> {
        let request_url = format!("{}{}", self.base_url, "/api/health");
        let mut req = self.http_client.get(request_url);
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 200u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "200",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<serde_json::Value>;
            let parse_error: Option<String>;
            match status_code {
                _ => {
                    match serde_json::from_str::<serde_json::Value>(&body_text) {
                        Ok(v) => {
                            typed = Some(v);
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `GET /api/tasks/{id}`
    pub async fn get_task(
        &self,
        id: impl AsRef<str>,
    ) -> Result<TaskResponse, ApiOpError<GetTaskApiError>> {
        let request_url = format!(
            "{}{}", self.base_url, format!("/api/tasks/{}", __pct_encode_path_segment(id
            .as_ref()))
        );
        let mut req = self.http_client.get(request_url);
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 200u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "200",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<GetTaskApiError>;
            let parse_error: Option<String>;
            match status_code {
                404u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(GetTaskApiError::Status404(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// The ISO week (Monday to Sunday) containing a local date: all-day events once per week, timed events and due tasks per day, and the tasks overdue as of today that were due before the week.
    ///
    /// `GET /api/agenda/week`
    pub async fn get_week_agenda(
        &self,
        date: impl AsRef<str>,
        time_zone: impl AsRef<str>,
        today: impl AsRef<str>,
    ) -> Result<WeekAgendaResponse, ApiOpError<GetWeekAgendaApiError>> {
        let request_url = format!("{}{}", self.base_url, "/api/agenda/week");
        let mut req = self.http_client.get(request_url);
        {
            let mut query_params: Vec<(String, String)> = Vec::new();
            query_params.push(("date".to_string(), date.as_ref().to_string()));
            query_params.push(("timeZone".to_string(), time_zone.as_ref().to_string()));
            query_params.push(("today".to_string(), today.as_ref().to_string()));
            if !query_params.is_empty() {
                req = req.query(&query_params);
            }
        }
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 200u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "200",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<GetWeekAgendaApiError>;
            let parse_error: Option<String>;
            match status_code {
                400u16 => {
                    match serde_json::from_str::<
                        HttpValidationProblemDetails,
                    >(&body_text) {
                        Ok(v) => {
                            typed = Some(GetWeekAgendaApiError::Status400(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `GET /api/tasks`
    pub async fn list_tasks(
        &self,
        view: impl AsRef<str>,
        today: Option<impl AsRef<str>>,
        time_zone: Option<impl AsRef<str>>,
        limit: Option<i32>,
        cursor: Option<impl AsRef<str>>,
    ) -> Result<TaskPage, ApiOpError<ListTasksApiError>> {
        let request_url = format!("{}{}", self.base_url, "/api/tasks");
        let mut req = self.http_client.get(request_url);
        {
            let mut query_params: Vec<(String, String)> = Vec::new();
            query_params.push(("view".to_string(), view.as_ref().to_string()));
            if let Some(v) = today {
                query_params.push(("today".to_string(), v.as_ref().to_string()));
            }
            if let Some(v) = time_zone {
                query_params.push(("timeZone".to_string(), v.as_ref().to_string()));
            }
            if let Some(v) = limit {
                query_params.push(("limit".to_string(), v.to_string()));
            }
            if let Some(v) = cursor {
                query_params.push(("cursor".to_string(), v.as_ref().to_string()));
            }
            if !query_params.is_empty() {
                req = req.query(&query_params);
            }
        }
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 200u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "200",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<ListTasksApiError>;
            let parse_error: Option<String>;
            match status_code {
                400u16 => {
                    match serde_json::from_str::<
                        HttpValidationProblemDetails,
                    >(&body_text) {
                        Ok(v) => {
                            typed = Some(ListTasksApiError::Status400(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `POST /api/auth/logout`
    pub async fn logout(&self) -> Result<(), ApiOpError<serde_json::Value>> {
        let request_url = format!("{}{}", self.base_url, "/api/auth/logout");
        let mut req = self.http_client.post(request_url);
        req = req.header(reqwest::header::CONTENT_LENGTH, "0");
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            req = req.header(name, value);
        }
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 204u16 {
            let _ = body_text;
            let _ = raw_body;
            let _ = headers;
            Ok(())
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "204",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<serde_json::Value>;
            let parse_error: Option<String>;
            match status_code {
                _ => {
                    match serde_json::from_str::<serde_json::Value>(&body_text) {
                        Ok(v) => {
                            typed = Some(v);
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `POST /api/auth/native/token`
    pub async fn redeem_native_code(
        &self,
        request: NativeSessionRequest,
    ) -> Result<(), ApiOpError<RedeemNativeCodeApiError>> {
        let request_url = format!("{}{}", self.base_url, "/api/auth/native/token");
        let mut req = self.http_client.post(request_url);
        req = req
            .body(serde_json::to_vec(&request).map_err(HttpError::serialization_error)?)
            .header("content-type", "application/json");
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            req = req.header(name, value);
        }
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 204u16 {
            let _ = body_text;
            let _ = raw_body;
            let _ = headers;
            Ok(())
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "204",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<RedeemNativeCodeApiError>;
            let parse_error: Option<String>;
            match status_code {
                400u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(RedeemNativeCodeApiError::Status400(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `POST /api/tasks/{id}/reopen`
    pub async fn reopen_task(
        &self,
        id: impl AsRef<str>,
    ) -> Result<TaskResponse, ApiOpError<ReopenTaskApiError>> {
        let request_url = format!(
            "{}{}", self.base_url, format!("/api/tasks/{}/reopen",
            __pct_encode_path_segment(id.as_ref()))
        );
        let mut req = self.http_client.post(request_url);
        req = req.header(reqwest::header::CONTENT_LENGTH, "0");
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 200u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "200",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<ReopenTaskApiError>;
            let parse_error: Option<String>;
            match status_code {
                404u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(ReopenTaskApiError::Status404(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                409u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(ReopenTaskApiError::Status409(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `PUT /api/events/{id}`
    pub async fn update_event(
        &self,
        id: impl AsRef<str>,
        request: UpdateEventRequest,
    ) -> Result<EventResponse, ApiOpError<UpdateEventApiError>> {
        let request_url = format!(
            "{}{}", self.base_url, format!("/api/events/{}", __pct_encode_path_segment(id
            .as_ref()))
        );
        let mut req = self.http_client.put(request_url);
        req = req
            .body(serde_json::to_vec(&request).map_err(HttpError::serialization_error)?)
            .header("content-type", "application/json");
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 200u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "200",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<UpdateEventApiError>;
            let parse_error: Option<String>;
            match status_code {
                400u16 => {
                    match serde_json::from_str::<
                        HttpValidationProblemDetails,
                    >(&body_text) {
                        Ok(v) => {
                            typed = Some(UpdateEventApiError::Status400(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                404u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(UpdateEventApiError::Status404(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                409u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(UpdateEventApiError::Status409(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
    /// `PUT /api/tasks/{id}`
    pub async fn update_task(
        &self,
        id: impl AsRef<str>,
        request: UpdateTaskRequest,
    ) -> Result<TaskResponse, ApiOpError<UpdateTaskApiError>> {
        let request_url = format!(
            "{}{}", self.base_url, format!("/api/tasks/{}", __pct_encode_path_segment(id
            .as_ref()))
        );
        let mut req = self.http_client.put(request_url);
        req = req
            .body(serde_json::to_vec(&request).map_err(HttpError::serialization_error)?)
            .header("content-type", "application/json");
        if let Some(api_key) = &self.api_key {
            req = req.bearer_auth(api_key);
        }
        for (name, value) in &self.custom_headers {
            if !name.eq_ignore_ascii_case("accept") {
                req = req.header(name, value);
            }
        }
        req = req.header(reqwest::header::ACCEPT, "application/json");
        let response = req.send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let headers = response.headers().clone();
        let body_bytes = __read_bounded_response_body(
                response,
                self.max_response_body_bytes,
            )
            .await?;
        let raw_body = body_bytes;
        let body_text = String::from_utf8_lossy(&raw_body).into_owned();
        if false || status_code == 200u16 {
            match serde_json::from_str(&body_text) {
                Ok(body) => Ok(body),
                Err(e) => {
                    Err(
                        ApiOpError::Api(ApiError {
                            status: status_code,
                            headers: headers,
                            body: body_text,
                            raw_body,
                            typed: None,
                            parse_error: Some(
                                format!("failed to deserialize 2xx response body: {}", e),
                            ),
                        }),
                    )
                }
            }
        } else if status.is_success() {
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed: None,
                    parse_error: Some(
                        format!(
                            "unexpected successful status {}; generated return type selects `{}`",
                            status_code, "200",
                        ),
                    ),
                }),
            )
        } else {
            let typed: Option<UpdateTaskApiError>;
            let parse_error: Option<String>;
            match status_code {
                400u16 => {
                    match serde_json::from_str::<
                        HttpValidationProblemDetails,
                    >(&body_text) {
                        Ok(v) => {
                            typed = Some(UpdateTaskApiError::Status400(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                404u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(UpdateTaskApiError::Status404(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                409u16 => {
                    match serde_json::from_str::<ProblemDetails>(&body_text) {
                        Ok(v) => {
                            typed = Some(UpdateTaskApiError::Status409(v));
                            parse_error = None;
                        }
                        Err(e) => {
                            typed = None;
                            parse_error = Some(e.to_string());
                        }
                    }
                }
                _ => {
                    typed = None;
                    parse_error = None;
                }
            }
            Err(
                ApiOpError::Api(ApiError {
                    status: status_code,
                    headers,
                    body: body_text,
                    raw_body,
                    typed,
                    parse_error,
                }),
            )
        }
    }
}
