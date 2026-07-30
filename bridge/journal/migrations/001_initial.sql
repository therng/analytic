CREATE TABLE producer_profiles (
  profile_id TEXT PRIMARY KEY,
  login INTEGER NOT NULL UNIQUE,
  server TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  config_digest TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  last_verified_at_utc TEXT NOT NULL
);

CREATE TABLE producer_epochs (
  epoch_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES producer_profiles(profile_id),
  fence_token INTEGER NOT NULL,
  started_at_utc TEXT NOT NULL,
  ended_at_utc TEXT,
  start_reason TEXT NOT NULL,
  end_reason TEXT
);

CREATE TABLE login_locks (
  login INTEGER PRIMARY KEY,
  owner_instance_id TEXT NOT NULL,
  acquired_at_utc TEXT NOT NULL
);

CREATE TABLE history_checkpoints (
  profile_id TEXT PRIMARY KEY REFERENCES producer_profiles(profile_id),
  generation INTEGER NOT NULL,
  next_window_start_raw INTEGER NOT NULL,
  last_window_id TEXT,
  policy_version INTEGER NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE history_windows (
  window_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES producer_profiles(profile_id),
  generation INTEGER NOT NULL,
  window_revision INTEGER NOT NULL,
  start_raw INTEGER NOT NULL,
  end_raw INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('COMMITTED', 'SUPERSEDED')),
  deal_count INTEGER NOT NULL,
  order_count INTEGER NOT NULL,
  deal_digest TEXT NOT NULL,
  order_digest TEXT NOT NULL,
  window_digest TEXT NOT NULL,
  observed_started_at_utc TEXT NOT NULL,
  observed_finished_at_utc TEXT NOT NULL,
  committed_at_utc TEXT NOT NULL,
  UNIQUE(profile_id, generation, start_raw, end_raw, window_revision)
);

CREATE TABLE history_record_versions (
  record_version_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES producer_profiles(profile_id),
  resource TEXT NOT NULL CHECK(resource IN ('deal', 'order')),
  natural_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  payload_json BLOB NOT NULL,
  payload_digest TEXT NOT NULL,
  correction_of TEXT REFERENCES history_record_versions(record_version_id),
  UNIQUE(profile_id, resource, natural_id, payload_digest)
);

CREATE TABLE history_window_records (
  window_id TEXT NOT NULL REFERENCES history_windows(window_id),
  resource TEXT NOT NULL CHECK(resource IN ('deal', 'order')),
  ordinal INTEGER NOT NULL,
  record_version_id TEXT NOT NULL REFERENCES history_record_versions(record_version_id),
  PRIMARY KEY(window_id, resource, ordinal),
  UNIQUE(window_id, record_version_id)
);

CREATE TABLE outbox_messages (
  event_id TEXT PRIMARY KEY,
  window_id TEXT NOT NULL REFERENCES history_windows(window_id),
  profile_id TEXT NOT NULL REFERENCES producer_profiles(profile_id),
  stream_key TEXT NOT NULL,
  envelope_json BLOB NOT NULL,
  payload_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PENDING', 'INFLIGHT', 'PUBLISHED', 'QUARANTINED')),
  attempt_count INTEGER NOT NULL,
  next_attempt_at_utc TEXT NOT NULL,
  claimed_by TEXT,
  claim_expires_at_utc TEXT,
  published_at_utc TEXT,
  redis_entry_id TEXT,
  last_error_class TEXT,
  last_error_redacted TEXT
);

CREATE INDEX outbox_claimable_idx
  ON outbox_messages(state, next_attempt_at_utc, claim_expires_at_utc);

CREATE TABLE live_sequences (
  profile_id TEXT PRIMARY KEY REFERENCES producer_profiles(profile_id),
  producer_epoch_id TEXT NOT NULL REFERENCES producer_epochs(epoch_id),
  next_sequence INTEGER NOT NULL
);

CREATE TABLE failure_events (
  failure_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES producer_profiles(profile_id),
  occurred_at_utc TEXT NOT NULL,
  class TEXT NOT NULL,
  severity TEXT NOT NULL,
  resource TEXT,
  operation TEXT NOT NULL,
  details_redacted TEXT NOT NULL
);
