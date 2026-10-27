---
status: implemented
date: 2026-10-27
adrs: [0018, 0019, 0020, 0021]
---

# 0003 Add todo tasks

## Story

> As a calendar editor, I need to be able to add todo tasks so that I can track the things I need to do.

## Background

The Today view already supports task completion and reopening; creation previously required an API call. This story adds a creation form and a personal task list, with dated tasks also visible on the calendar.

### Agreed scope

* Create from the calendar or My tasks. The calendar prefills its selected date; My tasks defaults to no deadline.
* Required title, completion checkbox, optional deadline, low/medium/high priority (default medium), and optional notes.
* A deadline is a floating date, an exact instant, or absent, following ADR-0018. Never both date and instant.
* Upcoming (today and later), Overdue (before today), Completed, and No deadline views. Exact deadlines earlier today carry a Past due label.
* Dated tasks appear in the calendar's day agenda; undated tasks appear only in the personal list. Tasks do not reserve event duration or link to events.
* Complete and reopen from both calendar and list. Preserve today's existing completion visibility rules (ADR-0021).
* Existing single-user mode (ADR-0019). Authentication, editor permission checks, and per-user privacy are future requirements, not implemented by this story.
* Reminders are a follow-up story. The intended design lets each editor choose in-app, email, or neither; delivery timing and preference storage remain to be designed.
* Editing and deleting tasks are outside this story.

### Acceptance criteria

1. Create from calendar or task list, with title required and deadline optional.
2. Persist priority and notes with the task; reject invalid priority, blank/overlong title, and overlong notes.
3. Saving refreshes calendar and list data. A failed save retains form values and permits retry.
4. Tasks appear in the correct view based on completion and the viewer's local date/timezone.
5. Completing/reopening persists and refreshes both views.
6. Preserve floating dates across zones and normalize exact deadlines to UTC. Reject nonexistent local times and ask which occurrence of an ambiguous time is intended.
7. Controls have accessible labels and work with a keyboard; saving disables duplicate submission.

## Design decisions

* [ADR-0018](../decisions/0018-time-representation-and-bcl-date-time-types.md): deadline representation.
* [ADR-0019](../decisions/0019-single-user-mode-with-authentication-deferred.md): single user, no ownership checks.
* [ADR-0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md): reuse day agenda for calendar display.
* [ADR-0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md): device date and timezone, existing overdue/completion inclusion.
* The existing day agenda gains a date selector rather than introducing speculative week/month endpoints.
* The personal list loads all tasks in single-user mode and classifies them locally. Revisit pagination and server filtering as data volume grows.
* Upcoming and overdue sort by deadline, then priority and title; Completed sorts by newest completion; No deadline sorts by priority and title.
* Title length remains 200 characters and notes are limited to 4000, matching existing event validation conventions.
* Exact deadlines are entered in the browser timezone. Repeated DST times expose their UTC offsets for explicit selection.

## Implementation notes

* Domain: `TodoTask` gains validated priority and normalized notes.
* Persistence: `TaskDetails` migration adds notes and priority; existing tasks receive medium priority.
* API: `GET /api/tasks` lists tasks; existing create/get/complete/reopen and agenda responses include priority and notes.
* Web: `features/tasks/TaskForm.tsx`, `TaskList.tsx`; app navigation switches between calendar and My tasks.
* Completion uses existing optimistic concurrency behavior. A conflict refreshes the list and asks the user to retry.

### Validation

* Backend: all API and PostgreSQL integration tests pass; domain tests cover priority validation and notes normalization/limits.
* Frontend: creation with all deadline types, failed-save retry, completion/reopening, list classification, and calendar/list synchronization are tested through MSW and Testing Library.
* DST tests cover a spring gap and both occurrences of a fall overlap in America/New_York.
* The web production build, frontend type checking, ESLint, and Prettier checks pass.

### Limitations and follow-ups

* The personal list fetches all tasks; pagination and server-side filtering are deferred for the current single-user scale.
* Authentication and calendar edit permissions must precede multi-user use. Tasks must eventually be scoped to their authenticated creator in every list, agenda, read, and write operation.
* The reminder follow-up retains the choice of in-app, email, or neither. It must define date-only reminder timing, exact-time reminder timing, timezone behavior while travelling, delivery when the app is closed, and preference storage.

## User guide

Choose **Add task** on the calendar to start with the displayed date, or open **My tasks** and choose **Add task** to start without a deadline. Enter a title, choose a deadline and priority if needed, add notes, and select **Save task**. For an exact deadline the form shows your device timezone; if the local time occurs twice, select its offset.

Use **Upcoming**, **Overdue**, **Completed**, or **No deadline** to review tasks. Tick a task to complete it, or untick it to reopen it. In the calendar, choose a date to see that day's agenda; **Today** restores the live local day.

Reminder delivery, shared calendars, permissions, task editing, and deletion are not available in this version.
