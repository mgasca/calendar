---
status: in-progress
date: 2026-11-06
issue: https://github.com/mgasca/calendar/issues/285
pr: [https://github.com/mgasca/calendar/pull/338, https://github.com/mgasca/calendar/pull/339]
adrs: ["0025"]
---

# 0032 Give each Pages publication attempt a distinct build version

## Story

> As a documentation reviewer, I need reliable publication so that a Pages lock does not delay reviewing and delivering changes.

## Background

Issue #285 records repeated HTTP 400 failures referring to a deployment that the Pages API reports as successful. Run [42229554170](https://github.com/mgasca/calendar/actions/runs/42229554170) repeats the failure. Serialized workflows alone have not prevented it. Reusing the default-branch SHA as the Pages build version is the suspected cause, not a confirmed GitHub diagnosis.

### Agreed scope

Give each publication and retry its own build version while preserving the snapshot guard, artifact selection and permissions. No Pages settings changes or cancellation of finished deployments.

### Acceptance criteria

1. Separate runs publishing the same snapshot receive different SHA-shaped build versions.
2. Re-running only the deploy job receives a fresh version.
3. An obsolete snapshot remains ineligible for deployment.
4. After delivery, observe successful live publication; record whether the lock recurs.

## Design decisions

[ADR-0025](../decisions/0025-github-pages-pr-previews.md) retains the combined snapshot and trusted publisher. No new architecture decision is needed.

The pinned deploy-pages action reads its build version from `process.env.GITHUB_SHA`. Derive a SHA-shaped identifier from the snapshot, run ID and run attempt and supply it only to that action's environment. Artifact names alone do not change the Pages build version. Source revision validation and OIDC claims retain their original values.

## Implementation notes

Implemented in `.github/workflows/pages.yml`, with [regression coverage](../../frontend/apps/docs/src/lib/pages-workflow.test.ts) executing its current-snapshot script for acceptance criteria 1–3. The identity test failed against the old workflow and passed after restoring the fix. The local docs suite passed 175 tests, with targeted ESLint and Prettier checks also passing. Live GitHub behavior cannot be proved locally; criterion 4 remains open until publication after merge is observed.

## User guide

Publication continues automatically after eligible CI and on PR closure. If a transient failure occurs, re-run failed jobs to deploy the retained artifact with a fresh build version. A newer snapshot still supersedes an older run.
