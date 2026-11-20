//! My tasks (`/tasks`), as the web app's `features/tasks/TaskList.tsx`: four views as tabs, server order, and
//! "Load more" from the page cursor.

use super::{TaskRow, button, heading, remote_state, task_row};
use crate::format;
use crate::route::{Route, TaskView};
use crate::theme::Tokens;
use crate::{App, load};
use calendar_client::generated::TaskResponse;
use rune::tok::type_;
use rune::{El, col, el, row, text};

/// The loaded pages of one task view.
#[derive(Clone, Debug, Default)]
pub struct TaskList {
  pub items: Vec<TaskResponse>,
  pub next_cursor: Option<String>,
}

pub fn view(app: &App, view: TaskView, t: &Tokens) -> El {
  let tabs = TaskView::ALL
    .into_iter()
    .fold(row().key("task-views").role("group").label("Task views").gap(4.0), |tabs, v| {
      let current = v == view;
      tabs.child(
        el()
          .key(format!("view-{}", v.api()))
          .role("button")
          .label(v.label())
          .checked(current)
          .focusable(true)
          .px(10.0)
          .py(5.0)
          .radius(6.0)
          .fill(if current { t.accent_soft } else { t.surface })
          .on_press(move |app: &mut App| load::go(app, Route::Tasks(v)))
          .child(
            text(v.label())
              .font(type_::LABEL)
              .color(if current { t.text } else { t.text_muted }),
          ),
      )
    });
  let mut page = col()
    .key("tasks-page")
    .gap(14.0)
    .w_full()
    .child(heading("tasks-title", "My tasks", 1, t))
    .child(tabs)
    .child(heading("tasks-view-title", view.label(), 2, t));
  if let Some(state) = remote_state(
    &app.tasks,
    "tasks",
    "Loading tasks…",
    "Couldn\u{2019}t load tasks.",
    "Couldn\u{2019}t load tasks.",
    load::reload,
    t,
  ) {
    page = page.child(state);
  }
  let Some(list) = &app.tasks.data else { return page };
  if list.items.is_empty() {
    return page.child(text("No tasks in this view.").key("tasks-empty").color(t.empty_text));
  }
  let rows = list.items.iter().map(|task| task_row(row_for(task, view, app), app, t));
  page = rows.fold(page.child(col().key("task-list").role("list").gap(6.0).w_full()), |page, r| {
    page.child(r)
  });
  if list.next_cursor.is_some() {
    let label = if app.tasks.loading { "Loading…" } else { "Load more" };
    page = page.child(button("tasks-more", label, t).on_press(load::more_tasks));
  }
  page
}

fn row_for<'a>(task: &'a TaskResponse, view: TaskView, app: &App) -> TaskRow<'a> {
  let zone = app.clock.zone;
  let mut due = match (task.due_date.flatten(), task.due_at.flatten()) {
    (Some(date), _) => date.to_string(),
    (None, Some(at)) => format::format_date_time(at, zone),
    (None, None) => "No deadline".to_owned(),
  };
  if view == TaskView::Upcoming && format::is_past_due(task.is_completed, task.due_at.flatten(), app.clock.now()) {
    due.push_str(" · Past due");
  }
  if let Some(Some(notes)) = &task.notes {
    due = format!("{due} — {notes}");
  }
  TaskRow {
    id: task.id,
    key: format!("task-{}", task.id),
    title: &task.title,
    done: task.is_completed,
    overdue: false,
    priority: Some(task.priority.as_deref().unwrap_or("medium")),
    meta: Some(due),
  }
}
