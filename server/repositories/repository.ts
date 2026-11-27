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

export interface IRepository {
  readonly mode: 'demo-in-memory' | 'postgresql';
  readonly persistsAcrossRestart: boolean;

  healthCheck(): Promise<{ ok: boolean; dbReady: boolean }>;

  // Auth & Sessions
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  toPublicUser(user: UserRecord): Promise<PublicUser>;
  createSession(tokenHash: string, userId: string, expiresAt: string): Promise<void>;
  getSessionUser(tokenHash: string): Promise<UserRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;

  // Structure & Admin
  listFaculties(): Promise<Faculty[]>;
  listDepartments(): Promise<Department[]>;
  listGroups(): Promise<StudyGroup[]>;
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

  // Synthetic 40-row test helper
  seedSyntheticQueueBatch(count: number): Promise<number>;
}

export const DEMO_PASSWORD_DEFAULT = 'DemoNormo2024!';

export function createDemoSeedData() {
  const faculties: Faculty[] = [
    { id: 'fac-it', name: 'Высшая школа информационных технологий и энергетики', code: 'ВШИТиЭ' },
  ];
  const departments: Department[] = [
    {
      id: 'dep-is',
      facultyId: 'fac-it',
      name: 'Кафедра «Информационные системы и программная инженерия»',
      code: 'ИС',
    },
  ];
  const groups: StudyGroup[] = [
    { id: 'grp-is-21-2', departmentId: 'dep-is', name: 'ИС-21-2', yearLabel: '2023–2024' },
    { id: 'grp-vt-20', departmentId: 'dep-is', name: 'ВТ-20', yearLabel: '2023–2024' },
    { id: 'grp-is-21-1', departmentId: 'dep-is', name: 'ИС-21-1', yearLabel: '2023–2024' },
  ];

  const defaultHash = hashPassword(DEMO_PASSWORD_DEFAULT);
  const users: UserRecord[] = [
    {
      id: 'usr-admin',
      email: 'admin@normocontrol.local',
      passwordHash: defaultHash,
      fullName: 'Сарсенов Асхат Болатович',
      shortName: 'А. Сарсенов',
      role: 'admin',
      groupId: null,
      departmentId: 'dep-is',
      active: true,
    },
    {
      id: 'usr-teacher-1',
      email: 'omarova@normocontrol.local',
      passwordHash: defaultHash,
      fullName: 'Омарова Гульнар Касымовна',
      shortName: 'доц. Омарова Г. К.',
      role: 'teacher',
      groupId: null,
      departmentId: 'dep-is',
      active: true,
    },
    {
      id: 'usr-teacher-2',
      email: 'zhumabaev@normocontrol.local',
      passwordHash: defaultHash,
      fullName: 'Жумабаев Болат Нурланович',
      shortName: 'ст. преп. Жумабаев Б. Н.',
      role: 'teacher',
      groupId: null,
      departmentId: 'dep-is',
      active: true,
    },
    {
      id: 'usr-student-1',
      email: 'smailov@normocontrol.local',
      passwordHash: defaultHash,
      fullName: 'Смаилов Арман Ерланович',
      shortName: 'А. Смаилов',
      role: 'student',
      groupId: 'grp-is-21-2',
      departmentId: 'dep-is',
      active: true,
    },
    {
      id: 'usr-student-2',
      email: 'kasymova@normocontrol.local',
      passwordHash: defaultHash,
      fullName: 'Касымова Алуа Маратовна',
      shortName: 'А. Касымова',
      role: 'student',
      groupId: 'grp-vt-20',
      departmentId: 'dep-is',
      active: true,
    },
  ];

  const teacherAssignments: TeacherAssignment[] = [
    {
      id: 'ta-1',
      teacherId: 'usr-teacher-1',
      groupId: 'grp-is-21-2',
      discipline: 'Проектирование информационных систем',
      active: true,
    },
    {
      id: 'ta-2',
      teacherId: 'usr-teacher-1',
      groupId: 'grp-is-21-1',
      discipline: 'Проектирование информационных систем',
      active: true,
    },
    {
      id: 'ta-3',
      teacherId: 'usr-teacher-2',
      groupId: 'grp-vt-20',
      discipline: 'Технологическая практика и СРС',
      active: true,
    },
  ];

  const spaces: Space[] = [
    {
      id: 'spc-is-21-2',
      teacherId: 'usr-teacher-1',
      groupId: 'grp-is-21-2',
      title: 'Пространство группы ИС-21-2 · Нормоконтроль',
      discipline: 'Проектирование информационных систем',
      pinnedAnnouncement:
        'Перед отправкой на проверку проверьте поля (30/10/20/20 мм), абзацный отступ 1.25 см и казахские/русские подписи рисунков без точки в конце.',
      createdAt: '2026-11-20T09:00:00+05:00',
    },
    {
      id: 'spc-vt-20',
      teacherId: 'usr-teacher-2',
      groupId: 'grp-vt-20',
      title: 'Пространство группы ВТ-20 · Практика и ГОСТ',
      discipline: 'Технологическая практика и СРС',
      pinnedAnnouncement:
        'Напоминание: все отчёты принимаются только в карточке задания. Мессенджер используется исключительно для организационных вопросов.',
      createdAt: '2026-11-19T10:00:00+05:00',
    },
  ];

  const spaceMaterials: SpaceMaterial[] = [
    {
      id: 'mat-1',
      spaceId: 'spc-is-21-2',
      title: 'Памятка по ГОСТ 7.32-2017 и СТ РК 1048-2002 (Демо)',
      description: 'Основные поля, шрифты, оформление таблиц и рисунков.',
      urlOrNote: 'Шаблон версии v1.0-demo доступен в конструкторе лабораторной.',
      createdAt: '2026-11-20T09:10:00+05:00',
    },
    {
      id: 'mat-2',
      spaceId: 'spc-vt-20',
      title: 'Требования к отчёту по практике (Демо)',
      description: 'Структура дневника и список источников с датой обращения.',
      urlOrNote: 'Минимум 15 источников, 14 pt.',
      createdAt: '2026-11-19T10:15:00+05:00',
    },
  ];

  const now = Date.now();
  const assignments: Assignment[] = [
    {
      id: 'asg-lab-1',
      spaceId: 'spc-is-21-2',
      groupId: 'grp-is-21-2',
      teacherId: 'usr-teacher-1',
      code: 'ЛР-01-ИС',
      workType: 'Лабораторная',
      title: 'Лабораторная работа №1: Проектирование модуля нормоконтроля документации',
      instructions:
        'Заполните шаблон лабораторной работы или прикрепите готовый PDF/DOCX до 25 МБ. Обязательны казахский/русский титул и список источников.',
      templateVersion: 'v1.0-demo',
      deadlineAt: new Date(now + 4 * 24 * 3600 * 1000).toISOString(),
      resubmitDeadlineAt: null,
      latePolicy: 'allow_late',
      expectedFeedbackDate: new Date(now + 6 * 24 * 3600 * 1000).toISOString(),
      createdAt: new Date(now - 5 * 24 * 3600 * 1000).toISOString(),
    },
    {
      id: 'asg-kp-db',
      spaceId: 'spc-is-21-2',
      groupId: 'grp-is-21-2',
      teacherId: 'usr-teacher-1',
      code: 'КП-02-БД',
      workType: 'Курсовая',
      title: 'Курсовая работа: Базы данных в распределённых системах',
      instructions:
        'Соблюдайте требования ГОСТ 7.32-2017. Объём 35–45 страниц. Поздние сдачи помечаются как отправленные после срока.',
      templateVersion: 'v1.0-demo',
      deadlineAt: new Date(now + 8 * 3600 * 1000).toISOString(),
      resubmitDeadlineAt: new Date(now + 2 * 24 * 3600 * 1000).toISOString(),
      latePolicy: 'allow_late',
      expectedFeedbackDate: null,
      createdAt: new Date(now - 7 * 24 * 3600 * 1000).toISOString(),
    },
    {
      id: 'asg-pr-vt20',
      spaceId: 'spc-vt-20',
      groupId: 'grp-vt-20',
      teacherId: 'usr-teacher-2',
      code: 'ПР-01-ВТ',
      workType: 'Практическая',
      title: 'Практическая работа №1: Спецификация ТОО «Шымкент-Софт»',
      instructions: 'Прикрепите отчёт в формате PDF с таблицами и библиографией.',
      templateVersion: 'v1.0-demo',
      deadlineAt: new Date(now - 52 * 3600 * 1000).toISOString(),
      resubmitDeadlineAt: null,
      latePolicy: 'allow_late',
      expectedFeedbackDate: null,
      createdAt: new Date(now - 10 * 24 * 3600 * 1000).toISOString(),
    },
  ];

  // Seed one submission already returned for revision (for Student 1 on asg-kp-db)
  // and one overdue submission for Student 2 (grp-vt-20)
  const sub1Id = 'sub-demo-1';
  const ver1Id = 'ver-demo-1-v1';
  const sampleSha1 = computeSha256(Buffer.from('demo-smailov-kp-v1'));

  const sub2Id = 'sub-demo-2';
  const ver2Id = 'ver-demo-2-v1';
  const sampleSha2 = computeSha256(Buffer.from('demo-kasymova-pr-v1'));

  const sampleSnapshot: LabReportSnapshot = {
    templateVersion: 'v1.0-demo',
    docLang: 'Русский',
    university: 'Учебный портал кафедры ИС (Демо-контур)',
    department: 'Кафедра «Информационные системы и программная инженерия»',
    discipline: 'Базы данных в распределённых системах',
    labNumber: '1',
    title: 'Проектирование и верификация распределённых транзакций',
    studentName: 'Смаилов Арман Ерланович',
    studentGroup: 'ИС-21-2',
    teacherName: 'доц. Омарова Г. К.',
    cityYear: 'Шымкент, 2024',
    goal: 'Изучить принципы проектирования распределённых транзакций и оформить отчёт в соответствии с демонстрационным профилем ГОСТ 7.32-2017.',
    tools: 'PostgreSQL 16, Node.js 22, TypeScript, Docker Compose.',
    procedure:
      'В ходе работы выполнена настройка схемы базы данных, проверены поля 30/10/20/20 мм, межстрочный интервал 1.5 и поддержка казахских символов: Ә, Ғ, Қ, Ң, Ө, Ұ, Ү, І.',
    result:
      'Получена воспроизводимая схема таблиц и подтверждена атомарность записи версии документа и электронной квитанции.',
    conclusion:
      'Электронный процесс сдачи и проверки сокращает потребность в повторной печати черновиков между итерациями.',
    sources: [
      'ГОСТ 7.32-2017. Отчёт о научно-исследовательской работе. — М., 2017.',
      'СТ РК 1048-2002. Единая система программной документации. — Астана, 2002.',
    ],
    formatting: {
      version: 'v1.0-demo',
      isDemoDefaults: true,
      pageSize: 'A4',
      marginsMm: { top: 20, right: 10, bottom: 20, left: 30 },
      fontFamily: 'Times New Roman',
      fontSizePt: 14,
      lineSpacing: 1.5,
      firstLineIndentCm: 1.25,
      hangingIndentCm: 1.0,
      showFrame: false,
      showPageNumbers: true,
    },
  };

  const submissions: Submission[] = [
    {
      id: sub1Id,
      assignmentId: 'asg-kp-db',
      studentId: 'usr-student-1',
      groupId: 'grp-is-21-2',
      status: 'revision_needed',
      currentVersionNum: 1,
      isLate: false,
      claimedBy: 'usr-teacher-1',
      claimedAt: new Date(now - 14 * 3600 * 1000).toISOString(),
      createdAt: new Date(now - 26 * 3600 * 1000).toISOString(),
      updatedAt: new Date(now - 12 * 3600 * 1000).toISOString(),
    },
    {
      id: sub2Id,
      assignmentId: 'asg-pr-vt20',
      studentId: 'usr-student-2',
      groupId: 'grp-vt-20',
      status: 'submitted',
      currentVersionNum: 1,
      isLate: true,
      claimedBy: null,
      claimedAt: null,
      createdAt: new Date(now - 50 * 3600 * 1000).toISOString(),
      updatedAt: new Date(now - 50 * 3600 * 1000).toISOString(),
    },
  ];

  const versions: SubmissionVersion[] = [
    {
      id: ver1Id,
      submissionId: sub1Id,
      versionNum: 1,
      idempotencyKey: 'seed-sub1-v1',
      sourceKind: 'builder_snapshot',
      fileName: 'Smailov_KP_BD_v1.pdf',
      mimeType: 'application/pdf',
      fileSize: 48240,
      storageKey: null,
      sha256Hex: sampleSha1,
      snapshot: sampleSnapshot,
      submittedAt: new Date(now - 26 * 3600 * 1000).toISOString(),
      isLate: false,
    },
    {
      id: ver2Id,
      submissionId: sub2Id,
      versionNum: 1,
      idempotencyKey: 'seed-sub2-v1',
      sourceKind: 'builder_snapshot',
      fileName: 'Kasymova_Practice_v1.pdf',
      mimeType: 'application/pdf',
      fileSize: 64100,
      storageKey: null,
      sha256Hex: sampleSha2,
      snapshot: {
        ...sampleSnapshot,
        title: 'Практика в ТОО «Шымкент-Софт»',
        studentName: 'Касымова Алуа Маратовна',
        studentGroup: 'ВТ-20',
        teacherName: 'ст. преп. Жумабаев Б. Н.',
      },
      submittedAt: new Date(now - 50 * 3600 * 1000).toISOString(),
      isLate: true,
    },
  ];

  const receipts: Receipt[] = [
    {
      id: 'rcp-demo-1',
      receiptNumber: '#НК-2024-8841',
      submissionId: sub1Id,
      versionId: ver1Id,
      versionNum: 1,
      studentId: 'usr-student-1',
      sha256Hex: sampleSha1,
      issuedAt: new Date(now - 26 * 3600 * 1000).toISOString(),
      timezoneLabel: 'Asia/Almaty (UTC+5)',
    },
    {
      id: 'rcp-demo-2',
      receiptNumber: '#НК-2024-8840',
      submissionId: sub2Id,
      versionId: ver2Id,
      versionNum: 1,
      studentId: 'usr-student-2',
      sha256Hex: sampleSha2,
      issuedAt: new Date(now - 50 * 3600 * 1000).toISOString(),
      timezoneLabel: 'Asia/Almaty (UTC+5)',
    },
  ];

  const remarkPackages: RemarkPackage[] = [
    {
      id: 'pkg-demo-1',
      submissionId: sub1Id,
      versionNum: 1,
      authorId: 'usr-teacher-1',
      status: 'published',
      createdAt: new Date(now - 13 * 3600 * 1000).toISOString(),
      publishedAt: new Date(now - 12 * 3600 * 1000).toISOString(),
      remarks: [
        {
          id: 'rem-demo-1',
          packageId: 'pkg-demo-1',
          submissionId: sub1Id,
          versionNum: 1,
          pageNumber: 2,
          xNorm: 0.34,
          yNorm: 0.28,
          severity: 'mandatory',
          gostRule: 'ГОСТ 7.32-2017 п. 6.1',
          text: 'Исправить межстрочный интервал на 1.5 и проверить красную строку 1.25 см в разделе «Ход работы».',
          status: 'open',
          studentReply: '',
          repliedAt: null,
          closedAt: null,
        },
        {
          id: 'rem-demo-2',
          packageId: 'pkg-demo-1',
          submissionId: sub1Id,
          versionNum: 1,
          pageNumber: 2,
          xNorm: 0.65,
          yNorm: 0.56,
          severity: 'mandatory',
          gostRule: 'ГОСТ 7.32-2017 п. 5.12',
          text: 'Добавить дату обращения для веб-источника в списке литературы.',
          status: 'open',
          studentReply: '',
          repliedAt: null,
          closedAt: null,
        },
        {
          id: 'rem-demo-3',
          packageId: 'pkg-demo-1',
          submissionId: sub1Id,
          versionNum: 1,
          pageNumber: 1,
          xNorm: 0.5,
          yNorm: 0.42,
          severity: 'recommended',
          gostRule: 'Рекомендация кафедры',
          text: 'Рекомендуется уточнить формулировку темы с указанием СУБД PostgreSQL.',
          status: 'open',
          studentReply: '',
          repliedAt: null,
          closedAt: null,
        },
      ],
    },
  ];

  const auditLogs: AuditLog[] = [
    {
      id: 'aud-1',
      actorId: 'usr-teacher-1',
      actorName: 'доц. Омарова Г. К.',
      action: 'Опубликован пакет замечаний (2 обязательных, 1 рекомендация) к v1',
      entityType: 'submission',
      entityId: sub1Id,
      details: { versionNum: 1 },
      createdAt: new Date(now - 12 * 3600 * 1000).toISOString(),
    },
  ];

  return {
    faculties,
    departments,
    groups,
    users,
    teacherAssignments,
    spaces,
    spaceMaterials,
    assignments,
    submissions,
    versions,
    receipts,
    remarkPackages,
    auditLogs,
  };
}

export class DemoRepository implements IRepository {
  readonly mode = 'demo-in-memory' as const;
  readonly persistsAcrossRestart = false;

  private faculties: Faculty[];
  private departments: Department[];
  private groups: StudyGroup[];
  private users: UserRecord[];
  private teacherAssignments: TeacherAssignment[];
  private spaces: Space[];
  private spaceMaterials: SpaceMaterial[];
  private assignments: Assignment[];
  private submissions: Submission[];
  private versions: SubmissionVersion[];
  private receipts: Receipt[];
  private remarkPackages: RemarkPackage[];
  private auditLogs: AuditLog[];
  private sessions = new Map<string, { userId: string; expiresAt: string }>();
  private receiptSeq = 8842;

  constructor() {
    const seed = createDemoSeedData();
    this.faculties = seed.faculties;
    this.departments = seed.departments;
    this.groups = seed.groups;
    this.users = seed.users;
    this.teacherAssignments = seed.teacherAssignments;
    this.spaces = seed.spaces;
    this.spaceMaterials = seed.spaceMaterials;
    this.assignments = seed.assignments;
    this.submissions = seed.submissions;
    this.versions = seed.versions;
    this.receipts = seed.receipts;
    this.remarkPackages = seed.remarkPackages;
    this.auditLogs = seed.auditLogs;
  }

  async healthCheck() {
    return { ok: true, dbReady: true };
  }

  async findUserByEmail(email: string) {
    return (
      this.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null
    );
  }

  async findUserById(id: string) {
    return this.users.find((u) => u.id === id) || null;
  }

  async toPublicUser(user: UserRecord): Promise<PublicUser> {
    const group = this.groups.find((g) => g.id === user.groupId);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      shortName: user.shortName,
      role: user.role,
      groupId: user.groupId,
      groupName: group ? group.name : null,
      departmentId: user.departmentId,
      active: user.active,
    };
  }

  async createSession(tokenHash: string, userId: string, expiresAt: string) {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }

  async getSessionUser(tokenHash: string): Promise<UserRecord | null> {
    const sess = this.sessions.get(tokenHash);
    if (!sess) return null;
    if (new Date(sess.expiresAt).getTime() <= Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    const user = this.users.find((u) => u.id === sess.userId);
    if (!user || !user.active) return null;
    return user;
  }

  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }

  async listFaculties() {
    return [...this.faculties];
  }
  async listDepartments() {
    return [...this.departments];
  }
  async listGroups() {
    return [...this.groups];
  }
  async listUsers() {
    return Promise.all(this.users.map((u) => this.toPublicUser(u)));
  }
  async listTeacherAssignments() {
    return [...this.teacherAssignments];
  }

  async createGroup(input: { departmentId: string; name: string; yearLabel: string }) {
    const grp: StudyGroup = {
      id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      departmentId: input.departmentId,
      name: input.name.trim(),
      yearLabel: input.yearLabel.trim() || '2023–2024',
    };
    this.groups.push(grp);
    return grp;
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
    const rec: UserRecord = {
      id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      email: input.email.trim().toLowerCase(),
      passwordHash: hashPassword(input.password),
      fullName: input.fullName.trim(),
      shortName: input.shortName.trim() || input.fullName.trim(),
      role: input.role,
      groupId: input.groupId,
      departmentId: input.departmentId,
      active: true,
    };
    this.users.push(rec);
    return this.toPublicUser(rec);
  }

  async toggleUserActive(userId: string, active: boolean) {
    const u = this.users.find((x) => x.id === userId);
    if (!u) return null;
    u.active = active;
    return this.toPublicUser(u);
  }

  async upsertTeacherAssignment(input: {
    teacherId: string;
    groupId: string;
    discipline: string;
    active: boolean;
  }) {
    const existing = this.teacherAssignments.find(
      (ta) =>
        ta.teacherId === input.teacherId &&
        ta.groupId === input.groupId &&
        ta.discipline === input.discipline
    );
    if (existing) {
      existing.active = input.active;
      return existing;
    }
    const created: TeacherAssignment = {
      id: `ta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      teacherId: input.teacherId,
      groupId: input.groupId,
      discipline: input.discipline,
      active: input.active,
    };
    this.teacherAssignments.push(created);
    return created;
  }

  async toggleTeacherAssignment(id: string, active: boolean) {
    const ta = this.teacherAssignments.find((x) => x.id === id);
    if (!ta) return null;
    ta.active = active;
    return ta;
  }

  async isTeacherAssignedToGroup(teacherId: string, groupId: string) {
    return this.teacherAssignments.some(
      (ta) => ta.teacherId === teacherId && ta.groupId === groupId && ta.active
    );
  }

  async listSpacesForUser(user: UserRecord) {
    let allowedGroupIds = new Set<string>();
    if (user.role === 'student' && user.groupId) {
      allowedGroupIds.add(user.groupId);
    } else if (user.role === 'teacher') {
      for (const ta of this.teacherAssignments) {
        if (ta.teacherId === user.id && ta.active) allowedGroupIds.add(ta.groupId);
      }
    } else if (user.role === 'admin') {
      // Admin sees structure/spaces metadata, never student documents
      for (const g of this.groups) allowedGroupIds.add(g.id);
    }
    const spaces = this.spaces.filter((s) => allowedGroupIds.has(s.groupId));
    const spaceIds = new Set(spaces.map((s) => s.id));
    const materials = this.spaceMaterials.filter((m) => spaceIds.has(m.spaceId));
    return { spaces, materials };
  }

  async createSpace(input: {
    teacherId: string;
    groupId: string;
    title: string;
    discipline: string;
    pinnedAnnouncement: string;
  }) {
    const space: Space = {
      id: `spc-${Date.now()}`,
      teacherId: input.teacherId,
      groupId: input.groupId,
      title: input.title,
      discipline: input.discipline,
      pinnedAnnouncement: input.pinnedAnnouncement,
      createdAt: new Date().toISOString(),
    };
    this.spaces.push(space);
    return space;
  }

  async updateSpaceAnnouncement(spaceId: string, announcement: string) {
    const s = this.spaces.find((x) => x.id === spaceId);
    if (!s) return null;
    s.pinnedAnnouncement = announcement;
    return s;
  }

  async addSpaceMaterial(input: {
    spaceId: string;
    title: string;
    description: string;
    urlOrNote: string;
  }) {
    const mat: SpaceMaterial = {
      id: `mat-${Date.now()}`,
      spaceId: input.spaceId,
      title: input.title,
      description: input.description,
      urlOrNote: input.urlOrNote,
      createdAt: new Date().toISOString(),
    };
    this.spaceMaterials.push(mat);
    return mat;
  }

  async listAssignmentsForUser(user: UserRecord) {
    if (user.role === 'student') {
      return this.assignments.filter((a) => a.groupId === user.groupId);
    }
    if (user.role === 'teacher') {
      const groupIds = new Set(
        this.teacherAssignments
          .filter((ta) => ta.teacherId === user.id && ta.active)
          .map((ta) => ta.groupId)
      );
      return this.assignments.filter((a) => a.teacherId === user.id && groupIds.has(a.groupId));
    }
    return [...this.assignments];
  }

  async getAssignmentById(id: string) {
    return this.assignments.find((a) => a.id === id) || null;
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
    const asg: Assignment = {
      id: `asg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      spaceId: input.spaceId,
      groupId: input.groupId,
      teacherId: input.teacherId,
      code: input.code,
      workType: input.workType,
      title: input.title,
      instructions: input.instructions,
      templateVersion: input.templateVersion,
      deadlineAt: input.deadlineAt,
      resubmitDeadlineAt: null,
      latePolicy: input.latePolicy,
      expectedFeedbackDate: input.expectedFeedbackDate,
      createdAt: new Date().toISOString(),
    };
    this.assignments.push(asg);
    return asg;
  }

  private async buildBundle(sub: Submission): Promise<SubmissionBundle> {
    const assignment = this.assignments.find((a) => a.id === sub.assignmentId)!;
    const studentRec = this.users.find((u) => u.id === sub.studentId)!;
    const student = await this.toPublicUser(studentRec);
    const groupName =
      this.groups.find((g) => g.id === sub.groupId)?.name || '—';
    const versions = this.versions
      .filter((v) => v.submissionId === sub.id)
      .sort((a, b) => a.versionNum - b.versionNum);
    const receipts = this.receipts
      .filter((r) => r.submissionId === sub.id)
      .sort((a, b) => b.versionNum - a.versionNum);
    const packages = this.remarkPackages
      .filter((p) => p.submissionId === sub.id)
      .map((p) => ({ ...p, remarks: [...p.remarks] }));
    return {
      submission: { ...sub },
      assignment: { ...assignment },
      student,
      groupName,
      versions,
      receipts,
      packages,
    };
  }

  async listStudentSubmissions(studentId: string) {
    const subs = this.submissions
      .filter((s) => s.studentId === studentId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return Promise.all(subs.map((s) => this.buildBundle(s)));
  }

  async listTeacherQueue(teacherId: string): Promise<QueueRowView[]> {
    const activeGroups = new Set(
      this.teacherAssignments
        .filter((ta) => ta.teacherId === teacherId && ta.active)
        .map((ta) => ta.groupId)
    );
    const subs = this.submissions
      .filter((s) => activeGroups.has(s.groupId) && this.assignments.some((a) => a.id === s.assignmentId && a.teacherId === teacherId))
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

    const rows: QueueRowView[] = [];
    for (const sub of subs) {
      const assignment = this.assignments.find((a) => a.id === sub.assignmentId)!;
      const studentRec = this.users.find((u) => u.id === sub.studentId)!;
      const student = await this.toPublicUser(studentRec);
      const groupName =
        this.groups.find((g) => g.id === sub.groupId)?.name || '—';
      const subVersions = this.versions
        .filter((v) => v.submissionId === sub.id)
        .sort((a, b) => b.versionNum - a.versionNum);
      const latestVersion = subVersions[0] || null;

      let openMandatoryCount = 0;
      let openRecommendedCount = 0;
      for (const pkg of this.remarkPackages) {
        if (pkg.submissionId === sub.id) {
          for (const rem of pkg.remarks) {
            if (rem.status !== 'closed') {
              if (rem.severity === 'mandatory') openMandatoryCount++;
              else openRecommendedCount++;
            }
          }
        }
      }

      const waitHours = Math.max(
        0,
        (Date.now() - new Date(sub.updatedAt).getTime()) / 3600000
      );
      rows.push({
        submission: { ...sub },
        assignment: { ...assignment },
        student,
        groupName,
        latestVersion,
        openMandatoryCount,
        openRecommendedCount,
        waitHours,
      });
    }
    return rows;
  }

  async claimNextQueueSubmission(teacherId: string): Promise<QueueRowView | null> {
    const rows = await this.listTeacherQueue(teacherId);
    const candidate = rows.find(
      (r) =>
        (r.submission.status === 'submitted' || r.submission.status === 'resubmitted') &&
        (!r.submission.claimedBy || r.submission.claimedBy === teacherId)
    );
    if (!candidate) return null;
    const real = this.submissions.find((s) => s.id === candidate.submission.id);
    if (!real) return null;
    real.claimedBy = teacherId;
    real.claimedAt = new Date().toISOString();
    real.status = 'in_review';
    const updatedRows = await this.listTeacherQueue(teacherId);
    return updatedRows.find((r) => r.submission.id === real.id) || null;
  }

  async getSubmissionBundle(submissionId: string) {
    const sub = this.submissions.find((s) => s.id === submissionId);
    if (!sub) return null;
    return this.buildBundle(sub);
  }

  async getSubmissionVersion(submissionId: string, versionId: string) {
    return (
      this.versions.find(
        (v) => v.submissionId === submissionId && v.id === versionId
      ) || null
    );
  }

  async submitVersionAtomic(input: SubmitVersionInput) {
    const assignment = this.assignments.find((a) => a.id === input.assignmentId);
    if (!assignment) {
      throw new Error('Assignment not found');
    }

    let sub = this.submissions.find(
      (s) => s.assignmentId === input.assignmentId && s.studentId === input.studentId
    );

    // Idempotency deduplication check
    if (sub) {
      const existingVer = this.versions.find(
        (v) => v.submissionId === sub!.id && v.idempotencyKey === input.idempotencyKey
      );
      if (existingVer) {
        if (existingVer.sha256Hex !== input.sha256Hex) throw new Error('IDEMPOTENCY_CONFLICT');
        const existingReceipt = this.receipts.find(
          (r) => r.versionId === existingVer.id
        )!;
        return {
          bundle: await this.buildBundle(sub),
          receipt: existingReceipt,
          deduplicated: true,
        };
      }
    }

    const nowIso = new Date().toISOString();
    const isLateFirst =
      !sub && Date.now() > new Date(assignment.deadlineAt).getTime();

    if (!sub) {
      if (isLateFirst && assignment.latePolicy === 'block_after_deadline') {
        throw new Error('DEADLINE_BLOCKED');
      }
      sub = {
        id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        assignmentId: input.assignmentId,
        studentId: input.studentId,
        groupId: assignment.groupId,
        status: 'submitted',
        currentVersionNum: 1,
        isLate: isLateFirst,
        claimedBy: null,
        claimedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.submissions.push(sub);
    } else {
      if (sub.status !== 'revision_needed') throw new Error('RESUBMISSION_NOT_ALLOWED');
      if (assignment.resubmitDeadlineAt && Date.now() > new Date(assignment.resubmitDeadlineAt).getTime()) throw new Error('DEADLINE_BLOCKED');
      const nextVer = sub.currentVersionNum + 1;
      sub.currentVersionNum = nextVer;
      sub.status = 'resubmitted';
      sub.claimedBy = null;
      sub.claimedAt = null;
      sub.updatedAt = nowIso;

      // Apply student replies to previous remark items (do NOT mutate v1 snapshot/pins!)
      if (input.replies && input.replies.length > 0) {
        for (const pkg of this.remarkPackages) {
          if (pkg.submissionId === sub.id && pkg.status === 'published') {
            for (const rem of pkg.remarks) {
              const found = input.replies.find((r) => r.remarkId === rem.id);
              if (found && found.replyText.trim()) {
                rem.studentReply = found.replyText.trim();
                rem.repliedAt = nowIso;
                if (rem.status === 'open') rem.status = 'answered';
              }
            }
          }
        }
      }
    }

    const version: SubmissionVersion = {
      id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      submissionId: sub.id,
      versionNum: sub.currentVersionNum,
      idempotencyKey: input.idempotencyKey,
      sourceKind: input.sourceKind,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      storageKey: input.storageKey,
      sha256Hex: input.sha256Hex,
      snapshot: input.snapshot,
      submittedAt: nowIso,
      isLate: sub.isLate,
    };
    this.versions.push(version);

    this.receiptSeq += 1;
    const receipt: Receipt = {
      id: `rcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      receiptNumber: `#НК-2024-${this.receiptSeq}`,
      submissionId: sub.id,
      versionId: version.id,
      versionNum: version.versionNum,
      studentId: input.studentId,
      sha256Hex: input.sha256Hex,
      issuedAt: nowIso,
      timezoneLabel: 'Asia/Almaty (UTC+5)',
    };
    this.receipts.push(receipt);
    await this.addAuditLog({
      actorId: input.studentId, actorName: '', action: `Сдана версия v${version.versionNum}`,
      entityType: 'submission', entityId: sub.id,
    });

    return {
      bundle: await this.buildBundle(sub),
      receipt,
      deduplicated: false,
    };
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
    const sub = this.submissions.find((s) => s.id === input.submissionId);
    if (!sub || sub.currentVersionNum !== input.versionNum || !['submitted', 'resubmitted', 'in_review'].includes(sub.status)) {
      throw new Error('VERSION_CONFLICT');
    }
    let pkg = this.remarkPackages.find(
      (p) =>
        p.submissionId === input.submissionId &&
        p.versionNum === input.versionNum &&
        p.status === 'draft'
    );
    if (!pkg) {
      pkg = {
        id: `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        submissionId: input.submissionId,
        versionNum: input.versionNum,
        authorId: input.authorId,
        status: 'draft',
        createdAt: new Date().toISOString(),
        publishedAt: null,
        remarks: [],
      };
      this.remarkPackages.push(pkg);
    }

    const rem: Remark = {
      id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      packageId: pkg.id,
      submissionId: input.submissionId,
      versionNum: input.versionNum,
      pageNumber: input.pageNumber,
      xNorm: input.xNorm,
      yNorm: input.yNorm,
      severity: input.severity,
      gostRule: input.gostRule,
      text: input.text,
      status: 'open',
      studentReply: '',
      repliedAt: null,
      closedAt: null,
    };
    pkg.remarks.push(rem);
    return rem;
  }

  async publishReturnPackage(input: {
    submissionId: string;
    authorId: string;
    resubmitDeadlineAt: string | null;
  }) {
    const sub = this.submissions.find((s) => s.id === input.submissionId);
    if (!sub) throw new Error('Submission not found');
    if (!['submitted', 'resubmitted', 'in_review'].includes(sub.status)) throw new Error('VERSION_CONFLICT');

    const draftPkg = this.remarkPackages.find(
      (p) =>
        p.submissionId === input.submissionId &&
        p.versionNum === sub.currentVersionNum &&
        p.status === 'draft'
    );
    if (!draftPkg || draftPkg.remarks.length === 0) {
      throw new Error('NO_DRAFT_REMARKS');
    }

    const nowIso = new Date().toISOString();
    draftPkg.status = 'published';
    draftPkg.publishedAt = nowIso;

    sub.status = 'revision_needed';
    sub.updatedAt = nowIso;

    // Store resubmitDeadlineAt separately without overwriting original assignment.deadlineAt!
    if (input.resubmitDeadlineAt) {
      const asg = this.assignments.find((a) => a.id === sub.assignmentId);
      if (asg) {
        asg.resubmitDeadlineAt = input.resubmitDeadlineAt;
      }
    }

    return this.buildBundle(sub);
  }

  async getRemarkById(remarkId: string) {
    for (const pkg of this.remarkPackages) {
      const rem = pkg.remarks.find((r) => r.id === remarkId);
      if (rem) return { ...rem };
    }
    return null;
  }

  async closeRemark(remarkId: string, _actorId: string) {
    for (const pkg of this.remarkPackages) {
      const rem = pkg.remarks.find((r) => r.id === remarkId);
      if (rem) {
        rem.status = 'closed';
        rem.closedAt = new Date().toISOString();
        return rem;
      }
    }
    return null;
  }

  async approveInSystem(submissionId: string, _actorId: string) {
    const sub = this.submissions.find((s) => s.id === submissionId);
    if (!sub) throw new Error('Submission not found');
    if (!['submitted', 'resubmitted', 'in_review'].includes(sub.status)) throw new Error('VERSION_CONFLICT');

    // Block approval if ANY published mandatory remark is still open/answered
    for (const pkg of this.remarkPackages) {
      if (pkg.submissionId === submissionId && pkg.status === 'published') {
        const unclosed = pkg.remarks.find(
          (r) => r.severity === 'mandatory' && r.status !== 'closed'
        );
        if (unclosed) {
          throw new Error('OPEN_MANDATORY_REMARKS');
        }
      }
    }

    sub.status = 'approved_in_system';
    sub.updatedAt = new Date().toISOString();
    return this.buildBundle(sub);
  }

  async addAuditLog(input: {
    actorId: string;
    actorName: string;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
  }) {
    const entry: AuditLog = {
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      details: input.details || {},
      createdAt: new Date().toISOString(),
    };
    this.auditLogs.unshift(entry);
    return entry;
  }

  async listAuditLogs(limit = 50) {
    return this.auditLogs.slice(0, limit);
  }

  async seedSyntheticQueueBatch(count = 40): Promise<number> {
    const defaultHash = hashPassword(DEMO_PASSWORD_DEFAULT);
    const baseTime = Date.now() - 100 * 3600 * 1000;
    let added = 0;

    for (let i = 1; i <= count; i++) {
      const studentId = `usr-synth-${i}`;
      const email = `synth.student.${i}@normocontrol.local`;
      const existing = this.users.find((u) => u.id === studentId);
      if (!existing) {
        this.users.push({
          id: studentId,
          email,
          passwordHash: defaultHash,
          fullName: `Студент Тестовый №${String(i).padStart(2, '0')}`,
          shortName: `Студент №${i}`,
          role: 'student',
          groupId: i % 2 === 0 ? 'grp-is-21-1' : 'grp-is-21-2',
          departmentId: 'dep-is',
          active: true,
        });
      }

      const subId = `sub-synth-${i}`;
      if (this.submissions.some((s) => s.id === subId)) continue;

      const createdAt = new Date(baseTime + i * 3600 * 1000).toISOString();
      const status =
        i % 5 === 0
          ? 'approved_in_system'
          : i % 4 === 0
          ? 'revision_needed'
          : i % 3 === 0
          ? 'resubmitted'
          : 'submitted';

      const groupId = i % 2 === 0 ? 'grp-is-21-1' : 'grp-is-21-2';
      this.submissions.push({
        id: subId,
        assignmentId: 'asg-lab-1',
        studentId,
        groupId,
        status,
        currentVersionNum: status === 'resubmitted' ? 2 : 1,
        isLate: i % 7 === 0,
        claimedBy: null,
        claimedAt: null,
        createdAt,
        updatedAt: createdAt,
      });

      const verId = `ver-synth-${i}`;
      const sha = computeSha256(Buffer.from(`synth-${i}`));
      this.versions.push({
        id: verId,
        submissionId: subId,
        versionNum: status === 'resubmitted' ? 2 : 1,
        idempotencyKey: `synth-key-${i}`,
        sourceKind: 'builder_snapshot',
        fileName: `Synth_Lab1_${i}.pdf`,
        mimeType: 'application/pdf',
        fileSize: 24000 + i * 100,
        storageKey: null,
        sha256Hex: sha,
        snapshot: null,
        submittedAt: createdAt,
        isLate: i % 7 === 0,
      });

      this.receiptSeq += 1;
      this.receipts.push({
        id: `rcp-synth-${i}`,
        receiptNumber: `#НК-2024-${this.receiptSeq}`,
        submissionId: subId,
        versionId: verId,
        versionNum: status === 'resubmitted' ? 2 : 1,
        studentId,
        sha256Hex: sha,
        issuedAt: createdAt,
        timezoneLabel: 'Asia/Almaty (UTC+5)',
      });
      added++;
    }
    return added;
  }
}

export class PostgresRepository implements IRepository {
  readonly mode = 'postgresql' as const;
  readonly persistsAcrossRestart = true;
  private pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async runMigrations() {
    const sqlPath = path.resolve(process.cwd(), 'db/migrations/001_init.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    await this.pool.query(sql);
  }

  async seedIfEmpty() {
    const { rows } = await this.pool.query('SELECT COUNT(*)::int AS cnt FROM users');
    if ((rows[0]?.cnt ?? 0) > 0) return;

    const seed = createDemoSeedData();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const f of seed.faculties) {
        await client.query(
          'INSERT INTO faculties (id, name, code) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [f.id, f.name, f.code]
        );
      }
      for (const d of seed.departments) {
        await client.query(
          'INSERT INTO departments (id, faculty_id, name, code) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [d.id, d.facultyId, d.name, d.code]
        );
      }
      for (const g of seed.groups) {
        await client.query(
          'INSERT INTO study_groups (id, department_id, name, year_label) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [g.id, g.departmentId, g.name, g.yearLabel]
        );
      }
      for (const u of seed.users) {
        await client.query(
          `INSERT INTO users (id, email, password_hash, full_name, short_name, role, group_id, department_id, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
          [u.id, u.email, u.passwordHash, u.fullName, u.shortName, u.role, u.groupId, u.departmentId, u.active]
        );
      }
      for (const ta of seed.teacherAssignments) {
        await client.query(
          `INSERT INTO teacher_assignments (id, teacher_id, group_id, discipline, active)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [ta.id, ta.teacherId, ta.groupId, ta.discipline, ta.active]
        );
      }
      for (const s of seed.spaces) {
        await client.query(
          `INSERT INTO spaces (id, teacher_id, group_id, title, discipline, pinned_announcement, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [s.id, s.teacherId, s.groupId, s.title, s.discipline, s.pinnedAnnouncement, s.createdAt]
        );
      }
      for (const m of seed.spaceMaterials) {
        await client.query(
          `INSERT INTO space_materials (id, space_id, title, description, url_or_note, created_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [m.id, m.spaceId, m.title, m.description, m.urlOrNote, m.createdAt]
        );
      }
      for (const a of seed.assignments) {
        await client.query(
          `INSERT INTO assignments (id, space_id, group_id, teacher_id, code, work_type, title, instructions, template_version, deadline_at, resubmit_deadline_at, late_policy, expected_feedback_date, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
          [
            a.id,
            a.spaceId,
            a.groupId,
            a.teacherId,
            a.code,
            a.workType,
            a.title,
            a.instructions,
            a.templateVersion,
            a.deadlineAt,
            a.resubmitDeadlineAt,
            a.latePolicy,
            a.expectedFeedbackDate,
            a.createdAt,
          ]
        );
      }
      for (const sub of seed.submissions) {
        await client.query(
          `INSERT INTO submissions (id, assignment_id, student_id, group_id, status, current_version_num, is_late, claimed_by, claimed_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
          [
            sub.id,
            sub.assignmentId,
            sub.studentId,
            sub.groupId,
            sub.status,
            sub.currentVersionNum,
            sub.isLate,
            sub.claimedBy,
            sub.claimedAt,
            sub.createdAt,
            sub.updatedAt,
          ]
        );
      }
      for (const v of seed.versions) {
        await client.query(
          `INSERT INTO submission_versions (id, submission_id, version_num, idempotency_key, source_kind, file_name, mime_type, file_size, storage_key, sha256_hex, snapshot_json, submitted_at, is_late)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
          [
            v.id,
            v.submissionId,
            v.versionNum,
            v.idempotencyKey,
            v.sourceKind,
            v.fileName,
            v.mimeType,
            v.fileSize,
            v.storageKey,
            v.sha256Hex,
            v.snapshot ? JSON.stringify(v.snapshot) : null,
            v.submittedAt,
            v.isLate,
          ]
        );
      }
      for (const r of seed.receipts) {
        await client.query(
          `INSERT INTO receipts (id, receipt_number, submission_id, version_id, student_id, sha256_hex, issued_at, timezone_label)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [r.id, r.receiptNumber, r.submissionId, r.versionId, r.studentId, r.sha256Hex, r.issuedAt, r.timezoneLabel]
        );
      }
      for (const p of seed.remarkPackages) {
        await client.query(
          `INSERT INTO remark_packages (id, submission_id, version_num, author_id, status, created_at, published_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [p.id, p.submissionId, p.versionNum, p.authorId, p.status, p.createdAt, p.publishedAt]
        );
        for (const rem of p.remarks) {
          await client.query(
            `INSERT INTO remarks (id, package_id, submission_id, version_num, page_number, x_norm, y_norm, severity, gost_rule, text, status, student_reply, replied_at, closed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
            [
              rem.id,
              rem.packageId,
              rem.submissionId,
              rem.versionNum,
              rem.pageNumber,
              rem.xNorm,
              rem.yNorm,
              rem.severity,
              rem.gostRule,
              rem.text,
              rem.status,
              rem.studentReply,
              rem.repliedAt,
              rem.closedAt,
            ]
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
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

  async approveInSystem(submissionId: string, _actorId: string) {
    const client = await this.pool.connect();
    try {
    await client.query('BEGIN');
    const subRes = await client.query('SELECT status FROM submissions WHERE id = $1 FOR UPDATE', [submissionId]);
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
    const id = `aud-${Date.now()}`;
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

  async seedSyntheticQueueBatch(): Promise<number> {
    return 0;
  }
}
