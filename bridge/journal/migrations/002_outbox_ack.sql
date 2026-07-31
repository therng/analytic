ALTER TABLE outbox_messages
  ADD COLUMN delivery_failure_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE outbox_messages
  ADD COLUMN quarantined_at_utc TEXT;

CREATE INDEX outbox_window_siblings_idx
  ON outbox_messages(window_id, state);

CREATE INDEX outbox_published_cleanup_idx
  ON outbox_messages(state, published_at_utc);
