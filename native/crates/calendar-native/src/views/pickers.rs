//! The date and time pickers (#1033), drawn from `crate::pickers`' state: a date field with a "Choose date" button
//! and its month grid, and a time as hour and minute spin buttons (with AM/PM in a 12-hour locale).

use super::button;
use crate::App;
use crate::format;
use crate::pickers::{self, Calendar, Field, Part};
use crate::theme::Tokens;
use chrono::{Datelike, NaiveDate, Timelike};
use rune::tok::type_;
use rune::{El, Key, KeyEvent, Tx, col, el, row, text};

/// `field_el` (the typed date field) with its "Choose {label}" button beside it, and the month grid under both while
/// it is open for this field.
pub fn date_picker(field_el: El, field: Field, label: &str, disabled: bool, app: &App, t: &Tokens) -> El {
  let mut out = col().gap(6.0).w_full().child(
    row()
      .gap(6.0)
      .w_full()
      .items_end()
      .child(col().w(0.0).grow(1.0).child(field_el))
      .child(choose_button(field, label, disabled, app, t)),
  );
  if let Some(grid) = calendar(field, app, t) {
    out = out.child(grid);
  }
  out
}

/// The month grid for `field`, while it is open.
#[must_use]
pub fn calendar(field: Field, app: &App, t: &Tokens) -> Option<El> {
  app.calendar.filter(|c| c.field.key == field.key).map(|c| month_grid(c, app, t))
}

/// The "Choose date" button that opens and closes the grid of `field`.
pub fn choose_button(field: Field, label: &str, disabled: bool, app: &App, t: &Tokens) -> El {
  let open = app.calendar.filter(|c| c.field.key == field.key);
  let mut choose = button(&pickers::button_key(field.key), "Choose date", t)
    .label(format!("Choose {}", label.to_lowercase()))
    .expanded(open.is_some());
  choose = if disabled {
    choose.disabled(true)
  } else {
    choose.on_press_tx(move |app: &mut App, tx: &mut Tx| {
      if app.calendar.is_some_and(|c| c.field.key == field.key) {
        pickers::close(app, tx);
      } else {
        pickers::open(app, field, tx);
      }
    })
  };
  choose
}

/// The month grid: the month's name between Previous and Next, the weekday names, and six weeks of days.
fn month_grid(calendar: Calendar, app: &App, t: &Tokens) -> El {
  let key = calendar.field.key;
  let month = calendar.month();
  let title = app.locale.month_year(month);
  let chosen = (calendar.field.edit_text)(app).and_then(|text| format::parse_iso_date(text.trim()));
  let today = app.clock.today();
  let header = row()
    .gap(6.0)
    .w_full()
    .items_center()
    .child(
      button(&format!("{key}-previous-month"), "‹", t)
        .label("Previous month")
        .on_press_tx(|app: &mut App, tx: &mut Tx| pickers::shift_month(app, -1, tx)),
    )
    .child(
      text(&title)
        .key(format!("{key}-month"))
        .font(type_::LABEL)
        .color(t.text)
        .w(0.0)
        .grow(1.0)
        .align(rune::Align::Center),
    )
    .child(
      button(&format!("{key}-next-month"), "›", t)
        .label("Next month")
        .on_press_tx(|app: &mut App, tx: &mut Tx| pickers::shift_month(app, 1, tx)),
    );
  let dates = pickers::grid_dates(month);
  let cell = || el().w(0.0).grow(1.0).h(28.0).items_center().justify_center();
  let weekdays = dates[..7].iter().fold(row().gap(2.0).w_full(), |r, d| {
    let (name, _) = app.locale.day_heading(*d);
    r.child(
      cell()
        .role("columnheader")
        .label(&name)
        .child(text(name).font(type_::LABEL).color(t.text_muted)),
    )
  });
  let mut grid = col()
    .key(format!("{key}-grid"))
    .role("grid")
    .label(&title)
    .gap(2.0)
    .w_full()
    .on_key(|app: &mut App, ev: &KeyEvent, tx: &mut Tx| pickers::grid_key(app, ev, tx))
    .child(weekdays);
  for week in dates.chunks(7) {
    let mut cells = row().role("row").gap(2.0).w_full();
    for &date in week {
      cells = cells.child(day(key, date, month, chosen, today, calendar.focus, app, t));
    }
    grid = grid.child(cells);
  }
  col()
    .key(format!("{key}-calendar"))
    .gap(6.0)
    .w_full()
    .padding(8.0)
    .radius(8.0)
    .border(1.0, t.border_strong)
    .fill(t.surface_raised)
    .child(header)
    .child(grid)
}

/// One day of the grid: named by its full date, marked when chosen or today, dimmed outside the month.
#[allow(clippy::too_many_arguments)]
fn day(
  key: &str,
  date: NaiveDate,
  month: NaiveDate,
  chosen: Option<NaiveDate>,
  today: NaiveDate,
  focus: NaiveDate,
  app: &App,
  t: &Tokens,
) -> El {
  let is_chosen = chosen == Some(date);
  let in_month = date.month() == month.month() && date.year() == month.year();
  let usable = format::in_range(date);
  let mut cell = el()
    .key(pickers::day_key(key, date))
    .role("gridcell")
    .label(app.locale.date(date, true))
    .checked(is_chosen)
    .w(0.0)
    .grow(1.0)
    .h(28.0)
    .radius(6.0)
    .items_center()
    .justify_center()
    .fill(if is_chosen { t.accent } else { t.surface_raised })
    .child(text(date.day().to_string()).font(type_::LABEL).color(if is_chosen {
      t.on_accent
    } else if in_month {
      t.text
    } else {
      t.text_muted
    }));
  if date == today && !is_chosen {
    cell = cell.border(1.0, t.current_border);
  }
  if usable {
    // Only the focused day is a Tab stop; the arrows move between days (the ARIA grid pattern).
    cell
      .focusable(date == focus)
      .on_press_tx(move |app: &mut App, tx: &mut Tx| pickers::choose(app, date, tx))
  } else {
    cell.disabled(true)
  }
}

/// A time as spin buttons: hour, minute and, in a 12-hour locale, AM/PM. Each steps with the arrow and Page keys and
/// takes typed digits; the field's text stays `HH:MM` (empty until a part is set).
pub fn time_picker(field: Field, label: &str, disabled: bool, error: Option<&String>, app: &App, t: &Tokens) -> El {
  let value = (field.edit_text)(app).and_then(pickers::parse_time);
  let twelve = app.locale.twelve_hour();
  let shown = |part: Part| -> String {
    let Some(time) = value else { return "--".to_owned() };
    match part {
      Part::Hour if twelve => format!("{:02}", (time.hour() + 11) % 12 + 1),
      Part::Hour => format!("{:02}", time.hour()),
      Part::Minute => format!("{:02}", time.minute()),
      Part::Period => {
        let (am, pm) = app.locale.periods();
        if time.hour() < 12 { am } else { pm }
      }
    }
  };
  let parts: &[(Part, &str)] = if twelve {
    &[(Part::Hour, "hour"), (Part::Minute, "minute"), (Part::Period, "AM/PM")]
  } else {
    &[(Part::Hour, "hour"), (Part::Minute, "minute")]
  };
  let mut spins = row()
    .key(field.key)
    .role("group")
    .label(label)
    .gap(2.0)
    .items_center()
    .px(6.0)
    .py(4.0)
    .radius(6.0)
    .border(1.0, if error.is_some() { t.error } else { t.border_strong })
    .fill(t.surface_sunken);
  for (i, &(part, name)) in parts.iter().enumerate() {
    if i == 1 {
      spins = spins.child(text(":").color(t.text));
    }
    let next = parts.get(i + 1).map(|(p, _)| spin_key(field.key, *p));
    spins = spins.child(spin(
      field,
      part,
      &format!("{label}, {name}"),
      shown(part),
      next,
      value,
      twelve,
      disabled,
      t,
    ));
  }
  let mut out = col()
    .gap(4.0)
    .w_full()
    .child(text(label).font(type_::LABEL).color(t.text))
    .child(spins);
  if let Some(error) = error {
    out = out.child(
      text(error)
        .key(format!("{}-error", field.key))
        .role("alert")
        .font(type_::BODY)
        .color(t.error),
    );
  }
  out
}

/// The key of one spin button of a time field.
#[must_use]
pub fn spin_key(field: &str, part: Part) -> String {
  let name = match part {
    Part::Hour => "hour",
    Part::Minute => "minute",
    Part::Period => "period",
  };
  format!("{field}-{name}")
}

#[allow(clippy::too_many_arguments)]
fn spin(
  field: Field,
  part: Part,
  label: &str,
  shown: String,
  next: Option<String>,
  value: Option<chrono::NaiveTime>,
  twelve: bool,
  disabled: bool,
  t: &Tokens,
) -> El {
  let key = spin_key(field.key, part);
  let (now, min, max) = match (part, value) {
    (Part::Hour, Some(v)) if twelve => (f64::from((v.hour() + 11) % 12 + 1), 1.0, 12.0),
    (Part::Hour, Some(v)) => (f64::from(v.hour()), 0.0, 23.0),
    (Part::Minute, Some(v)) => (f64::from(v.minute()), 0.0, 59.0),
    (Part::Period, Some(v)) => (f64::from(u8::from(v.hour() >= 12)), 0.0, 1.0),
    (Part::Hour, None) => (0.0, if twelve { 1.0 } else { 0.0 }, if twelve { 12.0 } else { 23.0 }),
    (Part::Minute, None) => (0.0, 0.0, 59.0),
    (Part::Period, None) => (0.0, 0.0, 1.0),
  };
  let mut el = el()
    .key(&key)
    .role("spinbutton")
    .label(label)
    .a11y_value(&shown)
    .range_value(now, min, max)
    .px(4.0)
    .py(2.0)
    .radius(4.0)
    .child(text(shown).font(type_::BODY).color(t.text));
  if disabled {
    return el.disabled(true);
  }
  el = el
    .focusable(true)
    .on_step(move |app: &mut App, delta: i32, _tx: &mut Tx| {
      app.spin_typed = None;
      let edit = (field.edit)(app);
      let stepped = pickers::step(&edit.text, part, delta, twelve);
      edit.replace_text(stepped);
    })
    .on_key(move |app: &mut App, ev: &KeyEvent, tx: &mut Tx| type_into(app, field, part, twelve, next.as_deref(), ev, tx));
  el
}

/// Digits typed into a spin button, and A or P into the AM/PM one.
fn type_into(app: &mut App, field: Field, part: Part, twelve: bool, next: Option<&str>, ev: &KeyEvent, tx: &mut Tx) -> bool {
  let m = ev.mods;
  if m.cmd || m.ctrl || m.alt || m.logo {
    return false;
  }
  let Key::Text(typed_text) = &ev.key else { return false };
  let mut chars = typed_text.chars();
  let (Some(c), None) = (chars.next(), chars.next()) else {
    return false;
  };
  let key = spin_key(field.key, part);
  if part == Part::Period {
    let (am, pm) = app.locale.periods();
    let wanted_pm = match c.to_ascii_lowercase() {
      c if am.to_lowercase().starts_with(c) => false,
      c if pm.to_lowercase().starts_with(c) => true,
      _ => return false,
    };
    let edit = (field.edit)(app);
    let time = pickers::parse_time(&edit.text).unwrap_or_default();
    if (time.hour() >= 12) != wanted_pm {
      let stepped = pickers::step(&edit.text, Part::Period, 1, twelve);
      edit.replace_text(stepped);
    }
    return true;
  }
  let Some(digit) = c.to_digit(10) else { return false };
  let typed = match &app.spin_typed {
    Some((k, digits)) if *k == key => digits.clone(),
    _ => String::new(),
  };
  let edit = (field.edit)(app);
  let (text, complete) = pickers::type_digit(&edit.text, part, &typed, digit, twelve);
  edit.replace_text(text);
  if complete {
    app.spin_typed = None;
    if let Some(next) = next {
      tx.focus(next, true);
    }
  } else {
    app.spin_typed = Some((key, format!("{typed}{digit}")));
  }
  true
}
