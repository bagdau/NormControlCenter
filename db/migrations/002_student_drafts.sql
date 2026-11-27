CREATE TABLE IF NOT EXISTS student_drafts (
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  snapshot_json JSONB NOT NULL,
  replies_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  mode TEXT NOT NULL CHECK (mode IN ('builder', 'upload')),
  idempotency_key TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (student_id, assignment_id)
);
