//! Background work: API calls run off the UI thread and their results are applied to [`App`] on it.
//!
//! [`Effects::run`] takes a future and a function that applies its output. On the desktop one background thread
//! owns a tokio current-thread runtime (reqwest needs tokio); on wasm32 the future runs on the browser's event loop
//! (`spawn_local`). Either way the result is queued, the window is woken, and `poll` ([`Effects::drain`]) applies
//! it before the next frame. [`Effects::manual`] keeps futures until a test runs them.

use crate::App;
use calendar_client::ApiError;
use std::future::Future;
use std::pin::Pin;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};

type Job = Box<dyn FnOnce(&mut App) + Send>;

/// `Send` on the desktop, where futures cross to the background thread; anything on wasm32, which has one thread.
#[cfg(not(target_arch = "wasm32"))]
pub trait MaybeSend: Send {}
#[cfg(not(target_arch = "wasm32"))]
impl<T: Send> MaybeSend for T {}
#[cfg(target_arch = "wasm32")]
pub trait MaybeSend {}
#[cfg(target_arch = "wasm32")]
impl<T> MaybeSend for T {}

/// A queued future: `Send` on the desktop.
pub trait TaskFuture: Future<Output = ()> + MaybeSend {}
impl<F: Future<Output = ()> + MaybeSend> TaskFuture for F {}

type Task = Pin<Box<dyn TaskFuture>>;

enum Mode {
  #[cfg(not(target_arch = "wasm32"))]
  Background(tokio::runtime::Handle),
  #[cfg(target_arch = "wasm32")]
  Local,
  Manual(Mutex<Vec<Task>>),
}

struct Inner {
  jobs: Sender<Job>,
  results: Mutex<Receiver<Job>>,
  waker: Arc<Mutex<Option<rune::Waker>>>,
  mode: Mode,
}

/// Runs futures in the background and applies their results to the app on the UI thread.
#[derive(Clone)]
pub struct Effects(Arc<Inner>);

impl std::fmt::Debug for Effects {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("Effects").finish_non_exhaustive()
  }
}

impl Effects {
  // On wasm32 the queued futures are not `Send` (the browser's fetch), so neither is `Inner`; there is one thread.
  #[cfg_attr(target_arch = "wasm32", allow(clippy::arc_with_non_send_sync))]
  fn with(mode: Mode) -> Self {
    let (jobs, results) = channel();
    Effects(Arc::new(Inner {
      jobs,
      results: Mutex::new(results),
      waker: Arc::new(Mutex::new(None)),
      mode,
    }))
  }

  /// Effects for the running app: a background thread on the desktop, the browser's event loop on wasm32.
  #[must_use]
  pub fn background() -> Self {
    #[cfg(not(target_arch = "wasm32"))]
    {
      let (handle_tx, handle_rx) = channel();
      std::thread::Builder::new()
        .name("calendar-effects".to_owned())
        .spawn(move || {
          let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a tokio runtime");
          handle_tx.send(runtime.handle().clone()).expect("the app waits for the handle");
          runtime.block_on(std::future::pending::<()>());
        })
        .expect("the effects thread starts");
      Self::with(Mode::Background(handle_rx.recv().expect("the effects thread sends its handle")))
    }
    #[cfg(target_arch = "wasm32")]
    {
      Self::with(Mode::Local)
    }
  }

  /// Effects that keep every future until [`Effects::run_pending`]: for headless tests.
  #[must_use]
  pub fn manual() -> Self {
    Self::with(Mode::Manual(Mutex::new(Vec::new())))
  }

  /// Wakes the window when a result is queued (Rune's `AppSpec::setup` gives the waker).
  pub fn set_waker(&self, waker: rune::Waker) {
    *self.0.waker.lock().expect("the waker lock") = Some(waker);
  }

  /// Runs `future`, then `apply` with its output on the UI thread.
  pub fn run<T: Send + 'static>(
    &self,
    future: impl Future<Output = T> + MaybeSend + 'static,
    apply: impl FnOnce(&mut App, T) + Send + 'static,
  ) {
    let inner = Arc::clone(&self.0);
    let task: Task = Box::pin(async move {
      let output = future.await;
      let job: Job = Box::new(move |app| apply(app, output));
      if inner.jobs.send(job).is_ok()
        && let Some(waker) = inner.waker.lock().expect("the waker lock").as_ref()
      {
        waker();
      }
    });
    match &self.0.mode {
      #[cfg(not(target_arch = "wasm32"))]
      Mode::Background(handle) => {
        handle.spawn(task);
      }
      #[cfg(target_arch = "wasm32")]
      Mode::Local => wasm_bindgen_futures::spawn_local(task),
      Mode::Manual(pending) => pending.lock().expect("the pending lock").push(task),
    }
  }

  /// A `Send` handle that queues changes to the app from any thread (the API's 401 hook uses it).
  #[must_use]
  pub fn poster(&self) -> Poster {
    Poster {
      jobs: self.0.jobs.clone(),
      waker: Arc::clone(&self.0.waker),
    }
  }

  /// Applies every queued result; true when any was. Called from `poll` and by tests.
  pub fn drain(&self, app: &mut App) -> bool {
    let jobs: Vec<Job> = self.0.results.lock().expect("the results lock").try_iter().collect();
    let any = !jobs.is_empty();
    for job in jobs {
      job(app);
    }
    any
  }

  /// How many futures a manual [`Effects`] holds.
  #[must_use]
  pub fn pending(&self) -> usize {
    if let Mode::Manual(pending) = &self.0.mode {
      pending.lock().expect("the pending lock").len()
    } else {
      0
    }
  }

  /// Runs every future a manual [`Effects`] holds to completion (on a tokio runtime, for reqwest), queueing results.
  #[cfg(not(target_arch = "wasm32"))]
  pub fn run_pending(&self) {
    let Mode::Manual(pending) = &self.0.mode else { return };
    let tasks: Vec<Task> = pending.lock().expect("the pending lock").drain(..).collect();
    let runtime = tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .expect("a tokio runtime");
    for task in tasks {
      runtime.block_on(task);
    }
  }
}

/// Data from the API as a view shows it: what was last loaded, whether a load is running, and the last error.
#[derive(Clone, Debug)]
pub struct Remote<T> {
  pub data: Option<T>,
  pub loading: bool,
  pub error: Option<ApiError>,
}

impl<T> Default for Remote<T> {
  fn default() -> Self {
    Remote {
      data: None,
      loading: false,
      error: None,
    }
  }
}

impl<T> Remote<T> {
  /// A load started: the last data stays on screen while it runs.
  pub fn start(&mut self) {
    self.loading = true;
  }

  /// A load finished.
  pub fn finish(&mut self, result: Result<T, ApiError>) {
    self.loading = false;
    match result {
      Ok(data) => {
        self.data = Some(data);
        self.error = None;
      }
      Err(error) => self.error = Some(error),
    }
  }
}

/// Queues a change to the app from any thread and wakes the window.
#[derive(Clone)]
pub struct Poster {
  jobs: Sender<Job>,
  waker: Arc<Mutex<Option<rune::Waker>>>,
}

impl Poster {
  /// Applies `change` to the app on the UI thread, before the next frame.
  pub fn post(&self, change: impl FnOnce(&mut App) + Send + 'static) {
    if self.jobs.send(Box::new(change)).is_ok()
      && let Some(waker) = self.waker.lock().expect("the waker lock").as_ref()
    {
      waker();
    }
  }
}
