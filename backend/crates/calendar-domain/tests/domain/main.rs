//! The domain tests: one test binary for the pure rules, with no I/O and no Docker. Add a module here instead of
//! a new file beside `main.rs`. Fixtures that more than one module needs live in `support`.

mod support;

mod calendar_event;
mod date_range_window;
mod day_inclusion;
mod day_window;
mod time_zones;
mod todo_task;
mod user;
