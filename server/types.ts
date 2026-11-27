export type UserRole = 'student' | 'teacher' | 'admin';

export type WorkType =
  | 'Лабораторная'
  | 'Курсовая'
  | 'Дипломная'
  | 'Практическая'
  | 'СРС';

export type LatePolicy = 'allow_late' | 'block_after_deadline';

export type SubmissionStatus =
  | 'submitted'
  | 'in_review'
  | 'revision_needed'
  | 'resubmitted'
  | 'approved_in_system';

export type RemarkSeverity = 'mandatory' | 'recommended';
export type RemarkStatus = 'open' | 'answered' | 'closed';
export type PackageStatus = 'draft' | 'published';

export interface Faculty {
  id: string;
  name: string;
  code: string;
}

export interface Department {
  id: string;
  facultyId: string;
  name: string;
  code: string;
}

export interface StudyGroup {
  id: string;
  departmentId: string;
  name: string;
  yearLabel: string;
}

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  shortName: string;
  role: UserRole;
  groupId: string | null;
  departmentId: string | null;
  active: boolean;
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  shortName: string;
  role: UserRole;
  groupId: string | null;
  groupName: string | null;
  departmentId: string | null;
  active: boolean;
}

export interface TeacherAssignment {
  id: string;
  teacherId: string;
  groupId: string;
  discipline: string;
  active: boolean;
}

export interface Space {
  id: string;
  teacherId: string;
  groupId: string;
  title: string;
  discipline: string;
  pinnedAnnouncement: string;
  createdAt: string;
}

export interface SpaceMaterial {
  id: string;
  spaceId: string;
  title: string;
  description: string;
  urlOrNote: string;
  createdAt: string;
}

export interface Assignment {
  id: string;
  spaceId: string;
  groupId: string;
  teacherId: string;
  code: string;
  workType: WorkType;
  title: string;
  instructions: string;
  templateVersion: string;
  deadlineAt: string;
  resubmitDeadlineAt: string | null;
  latePolicy: LatePolicy;
  expectedFeedbackDate: string | null;
  createdAt: string;
}

export interface TemplateFormattingConfig {
  version: string;
  pageSize: 'A4';
  marginsMm: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  fontFamily: string;
  fontSizePt: number;
  lineSpacing: number;
  firstLineIndentCm: number;
  hangingIndentCm: number;
  showFrame: boolean;
  showPageNumbers: boolean;
}

export interface LabReportSnapshot {
  templateVersion: string;
  docLang: 'Русский' | 'Қазақша' | 'English';
  university: string;
  department: string;
  discipline: string;
  labNumber: string;
  title: string;
  studentName: string;
  studentGroup: string;
  teacherName: string;
  cityYear: string;
  goal: string;
  tools: string;
  procedure: string;
  result: string;
  conclusion: string;
  sources: string[];
  formatting: TemplateFormattingConfig;
}

export interface SubmissionVersion {
  id: string;
  submissionId: string;
  versionNum: number;
  idempotencyKey: string;
  sourceKind: 'upload' | 'builder_snapshot';
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string | null;
  sha256Hex: string;
  snapshot: LabReportSnapshot | null;
  submittedAt: string;
  isLate: boolean;
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  submissionId: string;
  versionId: string;
  versionNum: number;
  studentId: string;
  sha256Hex: string;
  issuedAt: string;
  timezoneLabel: string;
}

export interface Remark {
  id: string;
  packageId: string;
  submissionId: string;
  versionNum: number;
  pageNumber: number;
  xNorm: number | null;
  yNorm: number | null;
  severity: RemarkSeverity;
  gostRule: string;
  text: string;
  status: RemarkStatus;
  studentReply: string;
  repliedAt: string | null;
  closedAt: string | null;
}

export interface RemarkPackage {
  id: string;
  submissionId: string;
  versionNum: number;
  authorId: string;
  status: PackageStatus;
  createdAt: string;
  publishedAt: string | null;
  remarks: Remark[];
}

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  groupId: string;
  status: SubmissionStatus;
  currentVersionNum: number;
  isLate: boolean;
  claimedBy: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
}
