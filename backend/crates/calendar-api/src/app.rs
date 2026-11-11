//! Builds the application: the routes, the fallbacks and the hosting middleware (ports `Program.cs`).

use std::net::SocketAddr;

use axum::Router;
use axum::extract::{Request, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use tokio::net::TcpListener;

use crate::auth::google;
use crate::endpoints::{agenda, auth, events, health, tasks};
use crate::hosting::{self, RequestOrigin};
use crate::openapi;
use crate::problem::Problem;
use crate::state::{AppOptions, AppState, StartupError};

/// Builds the application from `options`. Fails only on a configuration the API must not start with.
pub fn build(options: AppOptions) -> Result<Router, StartupError> {
  Ok(router(AppState::new(options)?))
}

/// The application over an existing state.
pub fn router(state: AppState) -> Router {
  let mut routes = Router::new()
    .route("/api/health", get(health::get_health))
    .route("/api/auth/login", get(google::login))
    .route(google::CALLBACK_PATH, get(google::callback))
    .route("/api/auth/me", get(auth::me))
    .route("/api/auth/logout", post(auth::logout))
    .route("/api/events", post(events::create))
    .route("/api/events/{id}", get(events::get).put(events::update).delete(events::delete))
    .route("/api/tasks", get(tasks::list).post(tasks::create))
    .route("/api/tasks/bulk", post(tasks::bulk))
    .route("/api/tasks/{id}", get(tasks::get).put(tasks::update).delete(tasks::delete))
    .route("/api/tasks/{id}/complete", post(tasks::complete))
    .route("/api/tasks/{id}/reopen", post(tasks::reopen))
    .route("/api/agenda/day", get(agenda::get_day))
    .route("/api/agenda/week", get(agenda::get_week));
  if state.settings().is_development() {
    routes = routes.route("/openapi/v1.json", get(openapi_document));
  }
  let routes = routes
    .fallback(fallback)
    .method_not_allowed_fallback(fallback)
    .with_state(state.clone());

  // The hosting middleware must see a request before it is routed (it rewrites API paths and serves static
  // files), so it wraps the routes as a whole rather than each of them.
  Router::new()
    .fallback_service(routes)
    .layer(middleware::from_fn_with_state(state, hosting::middleware))
}

/// The OpenAPI document, in Development only, where the .NET host served it.
async fn openapi_document(origin: RequestOrigin) -> Response {
  let mut response = openapi::to_json(&openapi::document_for_server(&format!("{}/", origin.base_url()))).into_response();
  response
    .headers_mut()
    .insert(CONTENT_TYPE, HeaderValue::from_static("application/json;charset=utf-8"));
  response
}

/// Everything no route matches. Under `/api` that is a `404` problem, whatever the method. Anywhere else it
/// is the web app, whose client-side router owns the path: `index.html`, never cached, unless the path has a
/// file extension or the web root holds no `index.html`.
async fn fallback(State(state): State<AppState>, request: Request) -> Response {
  let path = request.uri().path();
  if hosting::is_api_path(path) || hosting::has_extension(path) {
    return Problem::not_found().into_response();
  }
  match tokio::fs::read(state.settings().web_root.join("index.html")).await {
    Ok(index) => {
      let body = if request.method() == Method::HEAD { Vec::new() } else { index };
      let mut response = (StatusCode::OK, body).into_response();
      response.headers_mut().insert(CONTENT_TYPE, HeaderValue::from_static("text/html"));
      response.headers_mut().insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
      response
    }
    Err(_) => Problem::not_found().into_response(),
  }
}

/// Serves `app` on every address of `ASPNETCORE_URLS` until `shutdown` completes.
pub async fn serve(app: Router, addresses: &[SocketAddr], shutdown: impl Future<Output = ()> + Send + 'static) -> std::io::Result<()> {
  let mut listeners = Vec::new();
  let mut last_error = None;
  for address in addresses {
    match TcpListener::bind(address).await {
      Ok(listener) => {
        tracing::info!("Now listening on: http://{address}");
        listeners.push(listener);
      }
      // `localhost` names both loopback addresses; a host without IPv6 still serves on the other.
      Err(error) => {
        tracing::warn!("Cannot listen on {address}: {error}");
        last_error = Some(error);
      }
    }
  }
  if listeners.is_empty() {
    return Err(last_error.unwrap_or_else(|| std::io::Error::other("no address to listen on")));
  }

  let (stop, _) = tokio::sync::watch::channel(false);
  let mut servers = tokio::task::JoinSet::new();
  for listener in listeners {
    let app = app.clone();
    let mut stopped = stop.subscribe();
    servers.spawn(async move {
      axum::serve(listener, app)
        .with_graceful_shutdown(async move {
          let _ = stopped.wait_for(|stop| *stop).await;
        })
        .await
    });
  }
  tokio::spawn(async move {
    shutdown.await;
    let _ = stop.send(true);
  });

  while let Some(finished) = servers.join_next().await {
    finished.map_err(std::io::Error::other)??;
  }
  Ok(())
}
