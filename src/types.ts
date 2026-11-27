export type UserRole = 'student' | 'teacher' | 'admin';

export type UILang = 'ru' | 'kz';

export type DocumentLang = 'Русский' | 'Қазақша' | 'English';

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

export type RoleNavTab =
  // Student tabs
  | 'student_assignments'
  | 'student_submissions'
  | 'student_revisions'
  | 'student_spaces'
  // Teacher tabs
  | 'teacher_spaces'
  | 'teacher_queue'
  | 'teacher_review'
  // Admin tabs
  | 'admin_structure'
  | 'admin_accounts'
  | 'admin_assignments'
  // Shared reference
  | 'standards'
  | 'help';

export interface FacultyDTO {
  id: string;
  name: string;
  code: string;
}

export interface DepartmentDTO {
  id: string;
  facultyId: string;
  name: string;
  code: string;
}

export interface StudyGroupDTO {
  id: string;
  departmentId: string;
  name: string;
  yearLabel: string;
}

export interface PublicUserDTO {
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

export interface TeacherAssignmentDTO {
  id: string;
  teacherId: string;
  groupId: string;
  discipline: string;
  active: boolean;
}

export interface SpaceDTO {
  id: string;
  teacherId: string;
  groupId: string;
  title: string;
  discipline: string;
  pinnedAnnouncement: string;
  createdAt: string;
}

export interface SpaceMaterialDTO {
  id: string;
  spaceId: string;
  title: string;
  description: string;
  urlOrNote: string;
  createdAt: string;
}

export interface AssignmentDTO {
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

export interface TemplateFormattingConfigDTO {
  version: string;
  isDemoDefaults: boolean;
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

export interface LabReportSnapshotDTO {
  templateVersion: string;
  docLang: DocumentLang;
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
  formatting: TemplateFormattingConfigDTO;
}

export interface SubmissionVersionDTO {
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
  snapshot: LabReportSnapshotDTO | null;
  submittedAt: string;
  isLate: boolean;
}

export interface ReceiptDTO {
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

export interface RemarkDTO {
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

export interface RemarkPackageDTO {
  id: string;
  submissionId: string;
  versionNum: number;
  authorId: string;
  status: PackageStatus;
  createdAt: string;
  publishedAt: string | null;
  remarks: RemarkDTO[];
}

export interface SubmissionDTO {
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

export interface SubmissionBundleDTO {
  submission: SubmissionDTO;
  assignment: AssignmentDTO;
  student: PublicUserDTO;
  groupName: string;
  versions: SubmissionVersionDTO[];
  receipts: ReceiptDTO[];
  packages: RemarkPackageDTO[];
}

export interface QueueRowDTO {
  submission: SubmissionDTO;
  assignment: AssignmentDTO;
  student: PublicUserDTO;
  groupName: string;
  latestVersion: SubmissionVersionDTO | null;
  openMandatoryCount: number;
  openRecommendedCount: number;
  waitHours: number;
}

export interface AuditLogDTO {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface HealthInfoDTO {
  ok: boolean;
  dbReady: boolean;
  mode: 'demo-in-memory' | 'postgresql';
  persistsAcrossRestart: boolean;
  demoBanner: string | null;
  allowDemoPreviewAccounts: boolean;
}

export interface ToastMessage {
  id: string;
  text: string;
  tone: 'success' | 'info' | 'warning' | 'error';
}
