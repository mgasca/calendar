---
status: proposed
date: 2026-01-01
decision-makers: tester
---

# Second decision

## Context and Problem Statement

Which option should we pick? See [ADR-0000](0000-first-decision.md).

## Decision Drivers

* **D1 Speed**: faster is better.
* **D2 Cost**: cheaper is better.

## Considered Options

* Option A
* Option B

## Decision Outcome

Chosen option: "Option A", because it is fast (D1) and cheap (D2).

| Driver | **Option A (chosen)** | Option B |
| --- | :---: | :---: |
| D1 Speed | ★★★ | ★☆☆ |
| D2 Cost | ★★☆ | ★★☆ |

### Consequences

* Good, because it is fast.

### Confirmation

A test checks it. Inline code like `ADR-0099` is ignored.

## Pros and Cons of the Options

### Option A

* Good, because **D1 Speed**: fast.
* Neutral, because **D2 Cost**: average.

### Option B

* Bad, because **D1 Speed**: slow.
* Neutral, because **D2 Cost**: average.
