import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { computeSha256, hashPassword } from '../security';
import {
  Assignment,
  AuditLog,
  Department,
  Faculty,
  LabReportSnapshot,
  LatePolicy,
  PublicUser,
  Receipt,
  Remark,
  RemarkPackage,
  RemarkSeverity,
  Space,
  SpaceMaterial,
  StudyGroup,
  Submission,
  SubmissionVersion,
  TeacherAssignment,
  UserRecord,
  WorkType,
} from '../types';

export interface SubmissionBundle {
  submission: Submission;
  assignment: Assignment;
  student: PublicUser;
  groupName: string;
  versions: SubmissionVersion[];
  receipts: Receipt[];
  packages: RemarkPackage[];
}

export interface QueueRowView {
  submission: Submission;
  assignment: Assignment;
  student: PublicUser;
  groupName: string;
  latestVersion: SubmissionVersion | null;
  openMandatoryCount: number;
  openRecommendedCount: number;
  waitHours: number;
}

export interface SubmitVersionInput {
  assignmentId: string;
  studentId: string;
  idempotencyKey: string;
  sourceKind: 'upload' | 'builder_snapshot';
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string | null;
  sha256Hex: string;
  snapshot: LabReportSnapshot | null;
  replies?: { remarkId: string; replyText: string }[];
}

export interface StudentDraft {
  snapshot: LabReportSnapshot;
  replies: Record<string, string>;
  mode: 'builder' | 'upload';
  idempotencyKey: string;
  updatedAt: string;
}

export interface IRepository {
  readonly mode: 'test-in-memory' | 'postgresql';
  readonly persistsAcrossRestart: boolean;

  healthCheck(): Promise<{ ok: boolean; dbReady: boolean }>;

  // Auth & Sessions
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  toPublicUser(user: UserRecord): Promise<PublicUser>;
  createSession(tokenHash: string, userId: string, expiresAt: string): Promise<void>;
  getSessionUser(tokenHash: string): Promise<UserRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  changeUserPassword(userId: string, newPassword: string): Promise<void>;

  // Structure & Admin
  listFaculties(): Promise<Faculty[]>;
  listDepartments(): Promise<Department[]>;
  listGroups(): Promise<StudyGroup[]>;
  createFaculty(input: { name: string; code: string }): Promise<Faculty>;
  createDepartment(input: { facultyId: string; name: string; code: string }): Promise<Department>;
  listUsers(): Promise<PublicUser[]>;
  listTeacherAssignments(): Promise<TeacherAssignment[]>;
  createGroup(input: { departmentId: string; name: string; yearLabel: string }): Promise<StudyGroup>;
  createUser(input: {
    email: string;
    password: string;
    fullName: string;
    shortName: string;
    role: 'student' | 'teacher' | 'admin';
    groupId: string | null;
    departmentId: string | null;
  }): Promise<PublicUser>;
  toggleUserActive(userId: string, active: boolean): Promise<PublicUser | null>;
  upsertTeacherAssignment(input: {
    teacherId: string;
    groupId: string;
    discipline: string;
    active: boolean;
  }): Promise<TeacherAssignment>;
  toggleTeacherAssignment(id: string, active: boolean): Promise<TeacherAssignment | null>;
  isTeacherAssignedToGroup(teacherId: string, groupId: string): Promise<boolean>;

  // Spaces & Assignments
  listSpacesForUser(user: UserRecord): Promise<{ spaces: Space[]; materials: SpaceMaterial[] }>;
  createSpace(input: {
    teacherId: string;
    groupId: string;
    title: string;
    discipline: string;
    pinnedAnnouncement: string;
  }): Promise<Space>;
  updateSpaceAnnouncement(spaceId: string, announcement: string): Promise<Space | null>;
  addSpaceMaterial(input: {
    spaceId: string;
    title: string;
    description: string;
    urlOrNote: string;
  }): Promise<SpaceMaterial>;
  listAssignmentsForUser(user: UserRecord): Promise<Assignment[]>;
  getAssignmentById(id: string): Promise<Assignment | null>;
  createAssignment(input: {
    spaceId: string;
    groupId: string;
    teacherId: string;
    code: string;
    workType: WorkType;
    title: string;
    instructions: string;
    templateVersion: string;
    deadlineAt: string;
    latePolicy: LatePolicy;
    expectedFeedbackDate: string | null;
  }): Promise<Assignment>;

  // Submissions, Versions & Receipts
  getStudentDraft(studentId: string, assignmentId: string): Promise<StudentDraft | null>;
  saveStudentDraft(studentId: string, assignmentId: string, draft: Omit<StudentDraft, 'updatedAt'>): Promise<StudentDraft>;
  deleteStudentDraft(studentId: string, assignmentId: string): Promise<void>;
  listStudentSubmissions(studentId: string): Promise<SubmissionBundle[]>;
  listTeacherQueue(teacherId: string): Promise<QueueRowView[]>;
  claimNextQueueSubmission(teacherId: string): Promise<QueueRowView | null>;
  getSubmissionBundle(submissionId: string): Promise<SubmissionBundle | null>;
  getSubmissionVersion(submissionId: string, versionId: string): Promise<SubmissionVersion | null>;
  submitVersionAtomic(
    input: SubmitVersionInput
  ): Promise<{ bundle: SubmissionBundle; receipt: Receipt; deduplicated: boolean }>;

  // Review & Remarks
  addDraftRemark(input: {
    submissionId: string;
    versionNum: number;
    authorId: string;
    pageNumber: number;
    xNorm: number | null;
    yNorm: number | null;
    severity: RemarkSeverity;
    gostRule: string;
    text: string;
  }): Promise<Remark>;
  publishReturnPackage(input: {
    submissionId: string;
    authorId: string;
    resubmitDeadlineAt: string | null;
  }): Promise<SubmissionBundle>;
  getRemarkById(remarkId: string): Promise<Remark | null>;
  closeRemark(remarkId: string, actorId: string): Promise<Remark | null>;
  approveInSystem(submissionId: string, actorId: string): Promise<SubmissionBundle>;

  // Audit
  addAuditLog(input: {
    actorId: string;
    actorName: string;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
  }): Promise<AuditLog>;
  listAuditLogs(limit?: number): Promise<AuditLog[]>;

}

export class PostgresRepository implements IRepository {
  readonly mode = 'postgresql' as const;
  readonly persistsAcrossRestart = true;
  private pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async runMigrations() {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('normocontrol_migrations'))");
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
      const dir = path.resolve(process.cwd(), 'db/migrations');
      for (const name of fs.readdirSync(dir).filter((file) => /^\d+_.*\.sql$/.test(file)).sort()) {
        const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
        if (existing.rowCount) continue;
        await client.query('BEGIN');
        try {
          await client.query(fs.readFileSync(path.join(dir, name), 'utf-8'));
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('normocontrol_migrations'))");
      client.release();
    }
  }

  async healthCheck() {
    try {
      await this.pool.query('SELECT 1');
      return { ok: true, dbReady: true };
    } catch {
      return { ok: false, dbReady: false };
    }
  }

  private mapUser(r: Record<string, unknown>): UserRecord {
    return {
      id: String(r.id),
      email: String(r.email),
      passwordHash: String(r.password_hash),
      fullName: String(r.full_name),
      shortName: String(r.short_name),
      role: r.role as UserRecord['role'],
      groupId: r.group_id ? String(r.group_id) : null,
      departmentId: r.department_id ? String(r.department_id) : null,
      active: Boolean(r.active),
    };
  }

  async findUserByEmail(email: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email]
    );
    return rows[0] ? this.mapUser(rows[0]) : null;
  }

  async findUserById(id: string) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    return rows[0] ? this.mapUser(rows[0]) : null;
  }

  async toPublicUser(user: UserRecord): Promise<PublicUser> {
    let groupName: string | null = null;
    if (user.groupId) {
      const { rows } = await this.pool.query(
        'SELECT name FROM study_groups WHERE id = $1 LIMIT 1',
        [user.groupId]
      );
      groupName = rows[0]?.name ? String(rows[0].name) : null;
    }
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      shortName: user.shortName,
      role: user.role,
      groupId: user.groupId,
      groupName,
      departmentId: user.departmentId,
      active: user.active,
    };
  }

  async createSession(tokenHash: string, userId: string, expiresAt: string) {
    await this.pool.query(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, userId, expiresAt]
    );
  }

  async getSessionUser(tokenHash: string) {
    const { rows } = await this.pool.query(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.active = TRUE
       LIMIT 1`,
      [tokenHash]
    );
    return rows[0] ? this.mapUser(rows[0]) : null;
  }

  async deleteSession(tokenHash: string) {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  async changeUserPassword(userId: string, newPassword: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, hashPassword(newPassword)]);
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listFaculties() {
    const { rows } = await this.pool.query('SELECT id, name, code FROM faculties ORDER BY name');
    return rows;
  }

  async listDepartments() {
    const { rows } = await this.pool.query(
      'SELECT id, faculty_id AS "facultyId", name, code FROM departments ORDER BY name'
    );
    return rows;
  }

  async listGroups() {
    const { rows } = await this.pool.query(
      'SELECT id, department_id AS "departmentId", name, year_label AS "yearLabel" FROM study_groups ORDER BY name'
    );
    return rows;
  }

  async listUsers() {
    const { rows } = await this.pool.query('SELECT * FROM users ORDER BY role, full_name');
    return Promise.all(rows.map((r) => this.toPublicUser(this.mapUser(r))));
  }

  async listTeacherAssignments() {
    const { rows } = await this.pool.query(
      'SELECT id, teacher_id AS "teacherId", group_id AS "groupId", discipline, active FROM teacher_assignments ORDER BY created_at'
    );
    return rows;
  }

  async createFaculty(input: { name: string; code: string }) {
    const { rows } = await this.pool.query('INSERT INTO faculties (id, name, code) VALUES ($1,$2,$3) RETURNING id, name, code', [`fac-${crypto.randomUUID()}`, input.name, input.code]);
    return rows[0] as Faculty;
  }

  async createDepartment(input: { facultyId: string; name: string; code: string }) {
    const { rows } = await this.pool.query('INSERT INTO departments (id, faculty_id, name, code) VALUES ($1,$2,$3,$4) RETURNING id, faculty_id AS "facultyId", name, code', [`dep-${crypto.randomUUID()}`, input.facultyId, input.name, input.code]);
    return rows[0] as Department;
  }

  async createGroup(input: { departmentId: string; name: string; yearLabel: string }) {
    const id = `grp-${Date.now()}`;
    const { rows } = await this.pool.query(
      'INSERT INTO study_groups (id, department_id, name, year_label) VALUES ($1, $2, $3, $4) RETURNING id, department_id AS "departmentId", name, year_label AS "yearLabel"',
      [id, input.departmentId, input.name.trim(), input.yearLabel.trim() || '2023–2024']
    );
    return rows[0];
  }

  async createUser(input: {
    email: string;
    password: string;
    fullName: string;
    shortName: string;
    role: 'student' | 'teacher' | 'admin';
    groupId: string | null;
    departmentId: string | null;
  }) {
    const id = `usr-${Date.now()}`;
    const { rows } = await this.pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, short_name, role, group_id, department_id, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING *`,
      [
        id,
        input.email.trim().toLowerCase(),
        hashPassword(input.password),
        input.fullName.trim(),
        input.shortName.trim() || input.fullName.trim(),
        input.role,
        input.groupId,
        input.departmentId,
      ]
    );
    return this.toPublicUser(this.mapUser(rows[0]));
  }

  async toggleUserActive(userId: string, active: boolean) {
    const { rows } = await this.pool.query(
      'UPDATE users SET active = $2 WHERE id = $1 RETURNING *',
      [userId, active]
    );
    return rows[0] ? this.toPublicUser(this.mapUser(rows[0])) : null;
  }

  async upsertTeacherAssignment(input: {
    teacherId: string;
    groupId: string;
    discipline: string;
    active: boolean;
  }) {
    const id = `ta-${Date.now()}`;
    const { rows } = await this.pool.query(
      `INSERT INTO teacher_assignments (id, teacher_id, group_id, discipline, active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (teacher_id, group_id, discipline)
       DO UPDATE SET active = EXCLUDED.active
       RETURNING id, teacher_id AS "teacherId", group_id AS "groupId", discipline, active`,
      [id, input.teacherId, input.groupId, input.discipline, input.active]
    );
    return rows[0];
  }

  async toggleTeacherAssignment(id: string, active: boolean) {
    const { rows } = await this.pool.query(
      'UPDATE teacher_assignments SET active = $2 WHERE id = $1 RETURNING id, teacher_id AS "teacherId", group_id AS "groupId", discipline, active',
      [id, active]
    );
    return rows[0] || null;
  }

  async isTeacherAssignedToGroup(teacherId: string, groupId: string) {
    const { rows } = await this.pool.query(
      'SELECT 1 FROM teacher_assignments WHERE teacher_id = $1 AND group_id = $2 AND active = TRUE LIMIT 1',
      [teacherId, groupId]
    );
    return rows.length > 0;
  }

  async listSpacesForUser(user: UserRecord) {
    let spaceRows;
    if (user.role === 'student') {
      spaceRows = (
        await this.pool.query(
          `SELECT id, teacher_id AS "teacherId", group_id AS "groupId", title, discipline, pinned_announcement AS "pinnedAnnouncement", created_at AS "createdAt"
           FROM spaces WHERE group_id = $1 ORDER BY created_at DESC`,
          [user.groupId]
        )
      ).rows;
    } else if (user.role === 'teacher') {
      spaceRows = (
        await this.pool.query(
          `SELECT s.id, s.teacher_id AS "teacherId", s.group_id AS "groupId", s.title, s.discipline, s.pinned_announcement AS "pinnedAnnouncement", s.created_at AS "createdAt"
           FROM spaces s
           JOIN teacher_assignments ta ON ta.group_id = s.group_id AND ta.teacher_id = $1 AND ta.active = TRUE
           WHERE s.teacher_id = $1
           ORDER BY s.created_at DESC`,
          [user.id]
        )
      ).rows;
    } else {
      spaceRows = (
        await this.pool.query(
          `SELECT id, teacher_id AS "teacherId", group_id AS "groupId", title, discipline, pinned_announcement AS "pinnedAnnouncement", created_at AS "createdAt"
           FROM spaces ORDER BY created_at DESC`
        )
      ).rows;
    }
    const ids = spaceRows.map((s) => s.id);
    if (ids.length === 0) return { spaces: spaceRows, materials: [] };
    const matRows = (
      await this.pool.query(
        `SELECT id, space_id AS "spaceId", title, description, url_or_note AS "urlOrNote", created_at AS "createdAt"
         FROM space_materials WHERE space_id = ANY($1) ORDER BY created_at DESC`,
        [ids]
      )
    ).rows;
    return { spaces: spaceRows, materials: matRows };
  }

  async createSpace(input: {
    teacherId: string;
    groupId: string;
    title: string;
    discipline: string;
    pinnedAnnouncement: string;
  }) {
    const id = `spc-${Date.now()}`;
    const { rows } = await this.pool.query(
      `INSERT INTO spaces (id, teacher_id, group_id, title, discipline, pinned_announcement)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, teacher_id AS "teacherId", group_id AS "groupId", title, discipline, pinned_announcement AS "pinnedAnnouncement", created_at AS "createdAt"`,
      [id, input.teacherId, input.groupId, input.title, input.discipline, input.pinnedAnnouncement]
    );
    return rows[0];
  }

  async updateSpaceAnnouncement(spaceId: string, announcement: string) {
    const { rows } = await this.pool.query(
      `UPDATE spaces SET pinned_announcement = $2 WHERE id = $1
       RETURNING id, teacher_id AS "teacherId", group_id AS "groupId", title, discipline, pinned_announcement AS "pinnedAnnouncement", created_at AS "createdAt"`,
      [spaceId, announcement]
    );
    return rows[0] || null;
  }

  async addSpaceMaterial(input: {
    spaceId: string;
    title: string;
    description: string;
    urlOrNote: string;
  }) {
    const id = `mat-${Date.now()}`;
    const { rows } = await this.pool.query(
      `INSERT INTO space_materials (id, space_id, title, description, url_or_note)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, space_id AS "spaceId", title, description, url_or_note AS "urlOrNote", created_at AS "createdAt"`,
      [id, input.spaceId, input.title, input.description, input.urlOrNote]
    );
    return rows[0];
  }

  private mapAssignment(r: Record<string, unknown>): Assignment {
    return {
      id: String(r.id),
      spaceId: String(r.space_id),
      groupId: String(r.group_id),
      teacherId: String(r.teacher_id),
      code: String(r.code),
      workType: r.work_type as WorkType,
      title: String(r.title),
      instructions: String(r.instructions),
      templateVersion: String(r.template_version),
      deadlineAt: new Date(String(r.deadline_at)).toISOString(),
      resubmitDeadlineAt: r.resubmit_deadline_at
        ? new Date(String(r.resubmit_deadline_at)).toISOString()
        : null,
      latePolicy: r.late_policy as LatePolicy,
      expectedFeedbackDate: r.expected_feedback_date
        ? new Date(String(r.expected_feedback_date)).toISOString()
        : null,
      createdAt: new Date(String(r.created_at)).toISOString(),
    };
  }

  async listAssignmentsForUser(user: UserRecord) {
    if (user.role === 'student') {
      const { rows } = await this.pool.query(
        'SELECT * FROM assignments WHERE group_id = $1 ORDER BY deadline_at ASC',
        [user.groupId]
      );
      return rows.map((r) => this.mapAssignment(r));
    }
    if (user.role === 'teacher') {
      const { rows } = await this.pool.query(
        `SELECT a.* FROM assignments a
         JOIN teacher_assignments ta ON ta.group_id = a.group_id AND ta.teacher_id = $1 AND ta.active = TRUE
         WHERE a.teacher_id = $1
         ORDER BY a.deadline_at ASC`,
        [user.id]
      );
      return rows.map((r) => this.mapAssignment(r));
    }
    const { rows } = await this.pool.query('SELECT * FROM assignments ORDER BY deadline_at ASC');
    return rows.map((r) => this.mapAssignment(r));
  }

  async getAssignmentById(id: string) {
    const { rows } = await this.pool.query('SELECT * FROM assignments WHERE id = $1 LIMIT 1', [id]);
    return rows[0] ? this.mapAssignment(rows[0]) : null;
  }

  async createAssignment(input: {
    spaceId: string;
    groupId: string;
    teacherId: string;
    code: string;
    workType: WorkType;
    title: string;
    instructions: string;
    templateVersion: string;
    deadlineAt: string;
    latePolicy: LatePolicy;
    expectedFeedbackDate: string | null;
  }) {
    const id = `asg-${Date.now()}`;
    const { rows } = await this.pool.query(
      `INSERT INTO assignments (id, space_id, group_id, teacher_id, code, work_type, title, instructions, template_version, deadline_at, late_policy, expected_feedback_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        id,
        input.spaceId,
        input.groupId,
        input.teacherId,
        input.code,
        input.workType,
        input.title,
        input.instructions,
        input.templateVersion,
        input.deadlineAt,
        input.latePolicy,
        input.expectedFeedbackDate,
      ]
    );
    return this.mapAssignment(rows[0]);
  }

  private mapSubmission(r: Record<string, unknown>): Submission {
    return {
      id: String(r.id),
      assignmentId: String(r.assignment_id),
      studentId: String(r.student_id),
      groupId: String(r.group_id),
      status: r.status as Submission['status'],
      currentVersionNum: Number(r.current_version_num),
      isLate: Boolean(r.is_late),
      claimedBy: r.claimed_by ? String(r.claimed_by) : null,
      claimedAt: r.claimed_at ? new Date(String(r.claimed_at)).toISOString() : null,
      createdAt: new Date(String(r.created_at)).toISOString(),
      updatedAt: new Date(String(r.updated_at)).toISOString(),
    };
  }

  private mapVersion(r: Record<string, unknown>): SubmissionVersion {
    return {
      id: String(r.id),
      submissionId: String(r.submission_id),
      versionNum: Number(r.version_num),
      idempotencyKey: String(r.idempotency_key),
      sourceKind: r.source_kind as SubmissionVersion['sourceKind'],
      fileName: String(r.file_name),
      mimeType: String(r.mime_type),
      fileSize: Number(r.file_size),
      storageKey: r.storage_key ? String(r.storage_key) : null,
      sha256Hex: String(r.sha256_hex),
      snapshot: (r.snapshot_json as LabReportSnapshot) || null,
      submittedAt: new Date(String(r.submitted_at)).toISOString(),
      isLate: Boolean(r.is_late),
    };
  }

  async getSubmissionBundle(submissionId: string): Promise<SubmissionBundle | null> {
    const subRes = await this.pool.query('SELECT * FROM submissions WHERE id = $1 LIMIT 1', [
      submissionId,
    ]);
    if (!subRes.rows[0]) return null;
    const submission = this.mapSubmission(subRes.rows[0]);
    const assignment = (await this.getAssignmentById(submission.assignmentId))!;
    const studentRec = (await this.findUserById(submission.studentId))!;
    const student = await this.toPublicUser(studentRec);
    const grpRes = await this.pool.query('SELECT name FROM study_groups WHERE id = $1', [
      submission.groupId,
    ]);
    const groupName = grpRes.rows[0]?.name ? String(grpRes.rows[0].name) : '—';

    const verRes = await this.pool.query(
      'SELECT * FROM submission_versions WHERE submission_id = $1 ORDER BY version_num ASC',
      [submissionId]
    );
    const versions = verRes.rows.map((r) => this.mapVersion(r));

    const rcpRes = await this.pool.query(
      `SELECT r.*, v.version_num FROM receipts r
       JOIN submission_versions v ON v.id = r.version_id
       WHERE r.submission_id = $1 ORDER BY v.version_num DESC`,
      [submissionId]
    );
    const receipts: Receipt[] = rcpRes.rows.map((r) => ({
      id: String(r.id),
      receiptNumber: String(r.receipt_number),
      submissionId: String(r.submission_id),
      versionId: String(r.version_id),
      versionNum: Number(r.version_num),
      studentId: String(r.student_id),
      sha256Hex: String(r.sha256_hex),
      issuedAt: new Date(String(r.issued_at)).toISOString(),
      timezoneLabel: String(r.timezone_label),
    }));

    const pkgRes = await this.pool.query(
      'SELECT * FROM remark_packages WHERE submission_id = $1 ORDER BY created_at ASC',
      [submissionId]
    );
    const remRes = await this.pool.query(
      'SELECT * FROM remarks WHERE submission_id = $1 ORDER BY page_number ASC',
      [submissionId]
    );
    const packages: RemarkPackage[] = pkgRes.rows.map((p) => ({
      id: String(p.id),
      submissionId: String(p.submission_id),
      versionNum: Number(p.version_num),
      authorId: String(p.author_id),
      status: p.status as RemarkPackage['status'],
      createdAt: new Date(String(p.created_at)).toISOString(),
      publishedAt: p.published_at ? new Date(String(p.published_at)).toISOString() : null,
      remarks: remRes.rows
        .filter((r) => String(r.package_id) === String(p.id))
        .map((r) => ({
          id: String(r.id),
          packageId: String(r.package_id),
          submissionId: String(r.submission_id),
          versionNum: Number(r.version_num),
          pageNumber: Number(r.page_number),
          xNorm: r.x_norm !== null ? Number(r.x_norm) : null,
          yNorm: r.y_norm !== null ? Number(r.y_norm) : null,
          severity: r.severity as RemarkSeverity,
          gostRule: String(r.gost_rule),
          text: String(r.text),
          status: r.status as Remark['status'],
          studentReply: String(r.student_reply || ''),
          repliedAt: r.replied_at ? new Date(String(r.replied_at)).toISOString() : null,
          closedAt: r.closed_at ? new Date(String(r.closed_at)).toISOString() : null,
        })),
    }));

    return { submission, assignment, student, groupName, versions, receipts, packages };
  }

  async getStudentDraft(studentId: string, assignmentId: string): Promise<StudentDraft | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM student_drafts WHERE student_id = $1 AND assignment_id = $2',
      [studentId, assignmentId]
    );
    if (!rows[0]) return null;
    return {
      snapshot: rows[0].snapshot_json as LabReportSnapshot,
      replies: rows[0].replies_json as Record<string, string>,
      mode: rows[0].mode as 'builder' | 'upload',
      idempotencyKey: String(rows[0].idempotency_key),
      updatedAt: new Date(String(rows[0].updated_at)).toISOString(),
    };
  }

  async saveStudentDraft(studentId: string, assignmentId: string, draft: Omit<StudentDraft, 'updatedAt'>): Promise<StudentDraft> {
    const { rows } = await this.pool.query(
      `INSERT INTO student_drafts (student_id, assignment_id, snapshot_json, replies_json, mode, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (student_id, assignment_id) DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json,
       replies_json = EXCLUDED.replies_json, mode = EXCLUDED.mode,
       idempotency_key = EXCLUDED.idempotency_key, updated_at = NOW()
       RETURNING updated_at`,
      [studentId, assignmentId, JSON.stringify(draft.snapshot), JSON.stringify(draft.replies), draft.mode, draft.idempotencyKey]
    );
    return { ...draft, updatedAt: new Date(String(rows[0].updated_at)).toISOString() };
  }

  async deleteStudentDraft(studentId: string, assignmentId: string) {
    await this.pool.query('DELETE FROM student_drafts WHERE student_id = $1 AND assignment_id = $2', [studentId, assignmentId]);
  }

  async listStudentSubmissions(studentId: string) {
    const { rows } = await this.pool.query(
      'SELECT id FROM submissions WHERE student_id = $1 ORDER BY updated_at DESC',
      [studentId]
    );
    const bundles: SubmissionBundle[] = [];
    for (const r of rows) {
      const b = await this.getSubmissionBundle(String(r.id));
      if (b) bundles.push(b);
    }
    return bundles;
  }

  async listTeacherQueue(teacherId: string): Promise<QueueRowView[]> {
    const { rows } = await this.pool.query(
      `SELECT s.id FROM submissions s
       JOIN teacher_assignments ta ON ta.group_id = s.group_id AND ta.teacher_id = $1 AND ta.active = TRUE
       JOIN assignments a ON a.id = s.assignment_id AND a.teacher_id = $1
       ORDER BY s.created_at ASC`,
      [teacherId]
    );
    const out: QueueRowView[] = [];
    for (const r of rows) {
      const b = await this.getSubmissionBundle(String(r.id));
      if (!b) continue;
      let openMandatoryCount = 0;
      let openRecommendedCount = 0;
      for (const p of b.packages) {
        for (const rem of p.remarks) {
          if (rem.status !== 'closed') {
            if (rem.severity === 'mandatory') openMandatoryCount++;
            else openRecommendedCount++;
          }
        }
      }
      const waitHours = Math.max(
        0,
        (Date.now() - new Date(b.submission.updatedAt).getTime()) / 3600000
      );
      out.push({
        submission: b.submission,
        assignment: b.assignment,
        student: b.student,
        groupName: b.groupName,
        latestVersion: b.versions[b.versions.length - 1] || null,
        openMandatoryCount,
        openRecommendedCount,
        waitHours,
      });
    }
    return out;
  }

  async claimNextQueueSubmission(teacherId: string): Promise<QueueRowView | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT s.id FROM submissions s
         JOIN teacher_assignments ta ON ta.group_id = s.group_id AND ta.teacher_id = $1 AND ta.active = TRUE
         JOIN assignments a ON a.id = s.assignment_id AND a.teacher_id = $1
         WHERE s.status IN ('submitted', 'resubmitted') AND (s.claimed_by IS NULL OR s.claimed_by = $1)
         ORDER BY s.created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [teacherId]
      );
      if (!rows[0]) {
        await client.query('COMMIT');
        return null;
      }
      const subId = String(rows[0].id);
      await client.query(
        `UPDATE submissions SET claimed_by = $2, claimed_at = NOW(), status = 'in_review' WHERE id = $1`,
        [subId, teacherId]
      );
      await client.query('COMMIT');
      const queue = await this.listTeacherQueue(teacherId);
      return queue.find((q) => q.submission.id === subId) || null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getSubmissionVersion(submissionId: string, versionId: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM submission_versions WHERE submission_id = $1 AND id = $2 LIMIT 1',
      [submissionId, versionId]
    );
    return rows[0] ? this.mapVersion(rows[0]) : null;
  }

  async submitVersionAtomic(input: SubmitVersionInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [input.assignmentId, input.studentId]);
      const asgRes = await client.query('SELECT * FROM assignments WHERE id = $1 LIMIT 1', [
        input.assignmentId,
      ]);
      if (!asgRes.rows[0]) throw new Error('Assignment not found');
      const asg = this.mapAssignment(asgRes.rows[0]);

      const subRes = await client.query(
        'SELECT * FROM submissions WHERE assignment_id = $1 AND student_id = $2 FOR UPDATE',
        [input.assignmentId, input.studentId]
      );
      let sub: Submission | null = subRes.rows[0] ? this.mapSubmission(subRes.rows[0]) : null;

      if (sub) {
        const dupRes = await client.query(
          'SELECT * FROM submission_versions WHERE submission_id = $1 AND idempotency_key = $2 LIMIT 1',
          [sub.id, input.idempotencyKey]
        );
        if (dupRes.rows[0]) {
          const ver = this.mapVersion(dupRes.rows[0]);
          if (ver.sha256Hex !== input.sha256Hex) throw new Error('IDEMPOTENCY_CONFLICT');
          const rcpRes = await client.query(
            'SELECT * FROM receipts WHERE version_id = $1 LIMIT 1',
            [ver.id]
          );
          await client.query('COMMIT');
          const r = rcpRes.rows[0];
          const bundle = (await this.getSubmissionBundle(sub.id))!;
          return {
            bundle,
            receipt: {
              id: String(r.id),
              receiptNumber: String(r.receipt_number),
              submissionId: String(r.submission_id),
              versionId: String(r.version_id),
              versionNum: ver.versionNum,
              studentId: String(r.student_id),
              sha256Hex: String(r.sha256_hex),
              issuedAt: new Date(String(r.issued_at)).toISOString(),
              timezoneLabel: String(r.timezone_label),
            },
            deduplicated: true,
          };
        }
      }

      const isLateFirst = !sub && Date.now() > new Date(asg.deadlineAt).getTime();
      if (!sub) {
        if (isLateFirst && asg.latePolicy === 'block_after_deadline') {
          throw new Error('DEADLINE_BLOCKED');
        }
        const subId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const ins = await client.query(
          `INSERT INTO submissions (id, assignment_id, student_id, group_id, status, current_version_num, is_late)
           VALUES ($1,$2,$3,$4,'submitted',1,$5) RETURNING *`,
          [subId, input.assignmentId, input.studentId, asg.groupId, isLateFirst]
        );
        sub = this.mapSubmission(ins.rows[0]);
      } else {
        if (sub.status !== 'revision_needed') throw new Error('RESUBMISSION_NOT_ALLOWED');
        if (asg.resubmitDeadlineAt && Date.now() > new Date(asg.resubmitDeadlineAt).getTime()) throw new Error('DEADLINE_BLOCKED');
        const nextVer = sub.currentVersionNum + 1;
        const upd = await client.query(
          `UPDATE submissions SET current_version_num = $2, status = 'resubmitted', claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [sub.id, nextVer]
        );
        sub = this.mapSubmission(upd.rows[0]);

        if (input.replies && input.replies.length > 0) {
          for (const rep of input.replies) {
            if (!rep.replyText.trim()) continue;
            await client.query(
              `UPDATE remarks SET student_reply = $2, replied_at = NOW(),
               status = CASE WHEN status = 'open' THEN 'answered' ELSE status END
               WHERE id = $1 AND submission_id = $3`,
              [rep.remarkId, rep.replyText.trim(), sub.id]
            );
          }
        }
      }

      const verId = `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await client.query(
        `INSERT INTO submission_versions (id, submission_id, version_num, idempotency_key, source_kind, file_name, mime_type, file_size, storage_key, sha256_hex, snapshot_json, is_late)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          verId,
          sub.id,
          sub.currentVersionNum,
          input.idempotencyKey,
          input.sourceKind,
          input.fileName,
          input.mimeType,
          input.fileSize,
          input.storageKey,
          input.sha256Hex,
          input.snapshot ? JSON.stringify(input.snapshot) : null,
          sub.isLate,
        ]
      );

      const receiptNum = `#НК-${new Date().getUTCFullYear()}-${crypto.randomUUID()}`;
      const rcpId = `rcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const rcpIns = await client.query(
        `INSERT INTO receipts (id, receipt_number, submission_id, version_id, student_id, sha256_hex)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [rcpId, receiptNum, sub.id, verId, input.studentId, input.sha256Hex]
      );
      await client.query(
        `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id)
         VALUES ($1,$2,$3,'submission',$4)`,
        [`aud-${crypto.randomUUID()}`, input.studentId, `Сдана версия v${sub.currentVersionNum}`, sub.id]
      );

      await client.query('COMMIT');
      const bundle = (await this.getSubmissionBundle(sub.id))!;
      const r = rcpIns.rows[0];
      return {
        bundle,
        receipt: {
          id: String(r.id),
          receiptNumber: String(r.receipt_number),
          submissionId: String(r.submission_id),
          versionId: String(r.version_id),
          versionNum: sub.currentVersionNum,
          studentId: String(r.student_id),
          sha256Hex: String(r.sha256_hex),
          issuedAt: new Date(String(r.issued_at)).toISOString(),
          timezoneLabel: String(r.timezone_label),
        },
        deduplicated: false,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async addDraftRemark(input: {
    submissionId: string;
    versionNum: number;
    authorId: string;
    pageNumber: number;
    xNorm: number | null;
    yNorm: number | null;
    severity: RemarkSeverity;
    gostRule: string;
    text: string;
  }) {
    const client = await this.pool.connect();
    try {
    await client.query('BEGIN');
    const subRes = await client.query('SELECT current_version_num, status FROM submissions WHERE id = $1 FOR UPDATE', [input.submissionId]);
    const sub = subRes.rows[0];
    if (!sub || Number(sub.current_version_num) !== input.versionNum || !['submitted', 'resubmitted', 'in_review'].includes(String(sub.status))) {
      throw new Error('VERSION_CONFLICT');
    }
    let pkgId: string;
    const pkgRes = await client.query(
      `SELECT id FROM remark_packages WHERE submission_id = $1 AND version_num = $2 AND status = 'draft' LIMIT 1`,
      [input.submissionId, input.versionNum]
    );
    if (pkgRes.rows[0]) {
      pkgId = String(pkgRes.rows[0].id);
    } else {
      pkgId = `pkg-${crypto.randomUUID()}`;
      await client.query(
        `INSERT INTO remark_packages (id, submission_id, version_num, author_id, status) VALUES ($1,$2,$3,$4,'draft')`,
        [pkgId, input.submissionId, input.versionNum, input.authorId]
      );
    }

    const remId = `rem-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const { rows } = await client.query(
      `INSERT INTO remarks (id, package_id, submission_id, version_num, page_number, x_norm, y_norm, severity, gost_rule, text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        remId,
        pkgId,
        input.submissionId,
        input.versionNum,
        input.pageNumber,
        input.xNorm,
        input.yNorm,
        input.severity,
        input.gostRule,
        input.text,
      ]
    );
    await client.query('COMMIT');
    const r = rows[0];
    return {
      id: String(r.id),
      packageId: String(r.package_id),
      submissionId: String(r.submission_id),
      versionNum: Number(r.version_num),
      pageNumber: Number(r.page_number),
      xNorm: r.x_norm !== null ? Number(r.x_norm) : null,
      yNorm: r.y_norm !== null ? Number(r.y_norm) : null,
      severity: r.severity as RemarkSeverity,
      gostRule: String(r.gost_rule),
      text: String(r.text),
      status: r.status as Remark['status'],
      studentReply: '',
      repliedAt: null,
      closedAt: null,
    };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async publishReturnPackage(input: {
    submissionId: string;
    authorId: string;
    resubmitDeadlineAt: string | null;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const subRes = await client.query('SELECT * FROM submissions WHERE id = $1 FOR UPDATE', [
        input.submissionId,
      ]);
      if (!subRes.rows[0]) throw new Error('Submission not found');
      const sub = this.mapSubmission(subRes.rows[0]);
      if (!['submitted', 'resubmitted', 'in_review'].includes(sub.status)) throw new Error('VERSION_CONFLICT');

      const pkgRes = await client.query(
        `SELECT p.id, COUNT(r.id)::int AS cnt FROM remark_packages p
         LEFT JOIN remarks r ON r.package_id = p.id
         WHERE p.submission_id = $1 AND p.version_num = $2 AND p.status = 'draft'
         GROUP BY p.id LIMIT 1`,
        [input.submissionId, sub.currentVersionNum]
      );
      if (!pkgRes.rows[0] || Number(pkgRes.rows[0].cnt) === 0) {
        throw new Error('NO_DRAFT_REMARKS');
      }

      await client.query(
        `UPDATE remark_packages SET status = 'published', published_at = NOW() WHERE id = $1`,
        [pkgRes.rows[0].id]
      );
      await client.query(
        `UPDATE submissions SET status = 'revision_needed', updated_at = NOW() WHERE id = $1`,
        [input.submissionId]
      );
      if (input.resubmitDeadlineAt) {
        await client.query(
          `UPDATE assignments SET resubmit_deadline_at = $2 WHERE id = $1`,
          [sub.assignmentId, input.resubmitDeadlineAt]
        );
      }
      await client.query(
        `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details_json)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [`aud-${crypto.randomUUID()}`, input.authorId, `Работа возвращена на доработку (пакет замечаний к v${sub.currentVersionNum})`, 'submission', input.submissionId, JSON.stringify({ resubmitDeadlineAt: input.resubmitDeadlineAt })]
      );
      await client.query('COMMIT');
      return (await this.getSubmissionBundle(input.submissionId))!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getRemarkById(remarkId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM remarks WHERE id = $1 LIMIT 1`,
      [remarkId]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: String(r.id),
      packageId: String(r.package_id),
      submissionId: String(r.submission_id),
      versionNum: Number(r.version_num),
      pageNumber: Number(r.page_number),
      xNorm: r.x_norm !== null ? Number(r.x_norm) : null,
      yNorm: r.y_norm !== null ? Number(r.y_norm) : null,
      severity: r.severity as RemarkSeverity,
      gostRule: String(r.gost_rule),
      text: String(r.text),
      status: r.status as Remark['status'],
      studentReply: String(r.student_reply || ''),
      repliedAt: r.replied_at ? new Date(String(r.replied_at)).toISOString() : null,
      closedAt: r.closed_at ? new Date(String(r.closed_at)).toISOString() : null,
    };
  }

  async closeRemark(remarkId: string, _actorId: string) {
    const { rows } = await this.pool.query(
      `UPDATE remarks SET status = 'closed', closed_at = NOW() WHERE id = $1 RETURNING *`,
      [remarkId]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: String(r.id),
      packageId: String(r.package_id),
      submissionId: String(r.submission_id),
      versionNum: Number(r.version_num),
      pageNumber: Number(r.page_number),
      xNorm: r.x_norm !== null ? Number(r.x_norm) : null,
      yNorm: r.y_norm !== null ? Number(r.y_norm) : null,
      severity: r.severity as RemarkSeverity,
      gostRule: String(r.gost_rule),
      text: String(r.text),
      status: r.status as Remark['status'],
      studentReply: String(r.student_reply || ''),
      repliedAt: r.replied_at ? new Date(String(r.replied_at)).toISOString() : null,
      closedAt: r.closed_at ? new Date(String(r.closed_at)).toISOString() : null,
    };
  }

  async approveInSystem(submissionId: string, actorId: string) {
    const client = await this.pool.connect();
    try {
    await client.query('BEGIN');
    const subRes = await client.query('SELECT status, current_version_num FROM submissions WHERE id = $1 FOR UPDATE', [submissionId]);
    if (!subRes.rows[0] || !['submitted', 'resubmitted', 'in_review'].includes(String(subRes.rows[0].status))) throw new Error('VERSION_CONFLICT');
    const openRes = await client.query(
      `SELECT r.id FROM remarks r
       JOIN remark_packages p ON p.id = r.package_id
       WHERE r.submission_id = $1 AND p.status = 'published' AND r.severity = 'mandatory' AND r.status <> 'closed'
       LIMIT 1`,
      [submissionId]
    );
    if (openRes.rows.length > 0) {
      throw new Error('OPEN_MANDATORY_REMARKS');
    }
    await client.query(
      `UPDATE submissions SET status = 'approved_in_system', updated_at = NOW() WHERE id = $1`,
      [submissionId]
    );
    await client.query(
      `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details_json)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [`aud-${crypto.randomUUID()}`, actorId, `Статус установлен: Согласовано в системе (v${subRes.rows[0].current_version_num})`, 'submission', submissionId, '{}']
    );
    await client.query('COMMIT');
    return (await this.getSubmissionBundle(submissionId))!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async addAuditLog(input: {
    actorId: string;
    actorName: string;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
  }) {
    const id = `aud-${crypto.randomUUID()}`;
    const { rows } = await this.pool.query(
      `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details_json)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, input.actorId, input.action, input.entityType, input.entityId, JSON.stringify(input.details || {})]
    );
    return {
      id: String(rows[0].id),
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      details: input.details || {},
      createdAt: new Date(String(rows[0].created_at)).toISOString(),
    };
  }

  async listAuditLogs(limit = 50) {
    const { rows } = await this.pool.query(
      `SELECT a.*, u.short_name FROM audit_logs a
       JOIN users u ON u.id = a.actor_id
       ORDER BY a.created_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      id: String(r.id),
      actorId: String(r.actor_id),
      actorName: String(r.short_name),
      action: String(r.action),
      entityType: String(r.entity_type),
      entityId: String(r.entity_id),
      details: (r.details_json as Record<string, unknown>) || {},
      createdAt: new Date(String(r.created_at)).toISOString(),
    }));
  }


}
