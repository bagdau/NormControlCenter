-- NormoControlCenter PostgreSQL Schema (Migration 001)
-- Target timezone: Asia/Almaty (UTC+5)

CREATE TABLE IF NOT EXISTS faculties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  faculty_id TEXT NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS study_groups (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE,
  year_label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  group_id TEXT REFERENCES study_groups(id) ON DELETE SET NULL,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_assignments (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
  discipline TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, group_id, discipline)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  discipline TEXT NOT NULL,
  pinned_announcement TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS space_materials (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url_or_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  work_type TEXT NOT NULL CHECK (work_type IN ('Лабораторная', 'Курсовая', 'Дипломная', 'Практическая', 'СРС')),
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  template_version TEXT NOT NULL DEFAULT 'v1.0-demo',
  deadline_at TIMESTAMPTZ NOT NULL,
  resubmit_deadline_at TIMESTAMPTZ,
  late_policy TEXT NOT NULL DEFAULT 'allow_late' CHECK (late_policy IN ('allow_late', 'block_after_deadline')),
  expected_feedback_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'in_review', 'revision_needed', 'resubmitted', 'approved_in_system')),
  current_version_num INTEGER NOT NULL DEFAULT 1,
  is_late BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS submission_versions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  version_num INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('upload', 'builder_snapshot')),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_key TEXT,
  sha256_hex TEXT NOT NULL,
  snapshot_json JSONB,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_late BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (submission_id, version_num),
  UNIQUE (submission_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES submission_versions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sha256_hex TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timezone_label TEXT NOT NULL DEFAULT 'Asia/Almaty (UTC+5)'
);

CREATE TABLE IF NOT EXISTS remark_packages (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  version_num INTEGER NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS remarks (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES remark_packages(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  version_num INTEGER NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  x_norm DOUBLE PRECISION,
  y_norm DOUBLE PRECISION,
  severity TEXT NOT NULL CHECK (severity IN ('mandatory', 'recommended')),
  gost_rule TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  student_reply TEXT NOT NULL DEFAULT '',
  replied_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submissions_group_status ON submissions (group_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_remarks_submission_ver ON remarks (submission_id, version_num, status);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_active ON teacher_assignments (teacher_id, active);
