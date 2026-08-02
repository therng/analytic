# Native Published Outbox Replay Design

## Problem

Redis and PostgreSQL can be rebuilt independently of the native bridge's SQLite journals. A journal row in `PUBLISHED` state records a successful prior delivery, so the normal dispatcher correctly never emits it again. The current runtime has no controlled way to rehydrate an empty downstream from those durable envelopes.

## Decision

Add an operator-only Python command that reads `PUBLISHED` history envelopes from one explicit SQLite journal and appends them to the configured native Redis history stream. It never changes the source SQLite database, its outbox state, checkpoint, locks, health files, or the live key.

The command requires an explicit confirmation phrase and a supplied recovery target identifier. Before emitting anything, it validates that every selected row has the requested login's canonical stream key, that its envelope is valid JSON with a supported history message type, and that rows are replayed in a stable history-window order: non-window records first, then `history.window`, with `event_id` as the deterministic tie-breaker. A target that already has a replay marker for the same source journal identity and target identifier fails closed. A successful run writes only that marker to Redis after every envelope has been appended.

## Boundary and Failure Model

- SQLite remains the acquisition authority and is opened using SQLite URI `mode=ro`.
- Redis is the target transport. The command does not acquire or replace the live bridge lease because it appends only immutable history envelopes and never publishes live state.
- The operation is at-least-once. A process failure after `XADD` and before the marker can cause a later invocation to append duplicate envelopes; Worker V2's history-event idempotency remains the consumer-side protection.
- A source journal with no matching `PUBLISHED` history envelopes is a safe no-op and emits no marker.
- The command is intentionally per-journal/per-login. Cross-account replay is an explicit operator loop, not an implicit bulk mutation.

## Operational Contract

The recovery command will be invoked only after the operator has separately established a clean target Redis/PostgreSQL stack and stopped the normal bridge service for the selected login. It will report counts and event IDs only, never Redis credentials, Redis values, lease tokens, or envelope payloads.

## Verification

Focused tests must prove immutable source reads, deterministic record-before-window ordering, rejection of mismatched stream/login or malformed envelopes before any append, replay marker idempotency, and no marker for an empty selection. Existing bridge and worker focused suites plus lint/build will be run before any deployment. VPS replay remains a separately authorized runtime action.
