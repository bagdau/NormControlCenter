import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { computeSha256, hashPassword } from '../server/security';
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
} from '../server/types';

import { IRepository, SubmissionBundle, QueueRowView, SubmitVersionInput, StudentDraft } from '../server/repositories/repository';

export const FIXTURE_PASSWORD = 'FixtureNormo2024!';

export function createFixtureData() {
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

  const defaultHash = hashPassword(FIXTURE_PASSWORD);
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
      title: 'Памятка по ГОСТ 7.32-2017 и СТ РК 1048-2002 (Тест)',
      description: 'Основные поля, шрифты, оформление таблиц и рисунков.',
      urlOrNote: 'Шаблон версии v1.0-fixture доступен в конструкторе лабораторной.',
      createdAt: '2026-11-20T09:10:00+05:00',
    },
    {
      id: 'mat-2',
      spaceId: 'spc-vt-20',
      title: 'Требования к отчёту по практике (Тест)',
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
      templateVersion: 'v1.0-fixture',
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
      templateVersion: 'v1.0-fixture',
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
      templateVersion: 'v1.0-fixture',
      deadlineAt: new Date(now - 52 * 3600 * 1000).toISOString(),
      resubmitDeadlineAt: null,
      latePolicy: 'allow_late',
      expectedFeedbackDate: null,
      createdAt: new Date(now - 10 * 24 * 3600 * 1000).toISOString(),
    },
  ];

  // Seed one submission already returned for revision (for Student 1 on asg-kp-db)
  // and one overdue submission for Student 2 (grp-vt-20)
  const sub1Id = 'sub-fixture-1';
  const ver1Id = 'ver-fixture-1-v1';
  const sampleSha1 = computeSha256(Buffer.from('fixture-smailov-kp-v1'));

  const sub2Id = 'sub-fixture-2';
  const ver2Id = 'ver-fixture-2-v1';
  const sampleSha2 = computeSha256(Buffer.from('fixture-kasymova-pr-v1'));

  const sampleSnapshot: LabReportSnapshot = {
    templateVersion: 'v1.0-fixture',
    docLang: 'Русский',
    university: 'Учебный портал кафедры ИС (Тест-контур)',
    department: 'Кафедра «Информационные системы и программная инженерия»',
    discipline: 'Базы данных в распределённых системах',
    labNumber: '1',
    title: 'Проектирование и верификация распределённых транзакций',
    studentName: 'Смаилов Арман Ерланович',
    studentGroup: 'ИС-21-2',
    teacherName: 'доц. Омарова Г. К.',
    cityYear: 'Шымкент, 2024',
    goal: 'Изучить принципы проектирования распределённых транзакций и оформить отчёт в соответствии с заданными параметрами.',
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
      version: 'v1.0-fixture',
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
      id: 'rcp-fixture-1',
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
      id: 'rcp-fixture-2',
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
      id: 'pkg-fixture-1',
      submissionId: sub1Id,
      versionNum: 1,
      authorId: 'usr-teacher-1',
      status: 'published',
      createdAt: new Date(now - 13 * 3600 * 1000).toISOString(),
      publishedAt: new Date(now - 12 * 3600 * 1000).toISOString(),
      remarks: [
        {
          id: 'rem-fixture-1',
          packageId: 'pkg-fixture-1',
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
          id: 'rem-fixture-2',
          packageId: 'pkg-fixture-1',
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
          id: 'rem-fixture-3',
          packageId: 'pkg-fixture-1',
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

export class FixtureRepository implements IRepository {
  readonly mode = 'test-in-memory' as const;
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
  private studentDrafts = new Map<string, StudentDraft>();
  private receiptSeq = 8842;

  constructor() {
    const seed = createFixtureData();
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

  async getStudentDraft(studentId: string, assignmentId: string) {
    return this.studentDrafts.get(`${studentId}:${assignmentId}`) || null;
  }

  async saveStudentDraft(studentId: string, assignmentId: string, draft: Omit<StudentDraft, 'updatedAt'>) {
    const saved = { ...draft, updatedAt: new Date().toISOString() };
    this.studentDrafts.set(`${studentId}:${assignmentId}`, saved);
    return saved;
  }

  async deleteStudentDraft(studentId: string, assignmentId: string) {
    this.studentDrafts.delete(`${studentId}:${assignmentId}`);
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

  async changeUserPassword(userId: string, newPassword: string) {
    const user = this.users.find((item) => item.id === userId);
    if (!user) throw new Error('User not found');
    user.passwordHash = hashPassword(newPassword);
    for (const [hash, session] of this.sessions) if (session.userId === userId) this.sessions.delete(hash);
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

  async createFaculty(input: { name: string; code: string }) {
    if (this.faculties.some((f) => f.code === input.code)) throw new Error('DUPLICATE_CODE');
    const faculty: Faculty = { id: `fac-${crypto.randomUUID()}`, name: input.name, code: input.code };
    this.faculties.push(faculty);
    return faculty;
  }

  async createDepartment(input: { facultyId: string; name: string; code: string }) {
    if (!this.faculties.some((f) => f.id === input.facultyId)) throw new Error('FACULTY_NOT_FOUND');
    if (this.departments.some((d) => d.code === input.code)) throw new Error('DUPLICATE_CODE');
    const department: Department = { id: `dep-${crypto.randomUUID()}`, ...input };
    this.departments.push(department);
    return department;
  }

  async createGroup(input: { departmentId: string; name: string; yearLabel: string }) {
    if (!this.departments.some((d) => d.id === input.departmentId)) throw new Error('DEPARTMENT_NOT_FOUND');
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

  async addQueueFixtures(count = 40): Promise<number> {
    const defaultHash = hashPassword(FIXTURE_PASSWORD);
    const baseTime = Date.now() - 100 * 3600 * 1000;
    let added = 0;

    for (let i = 1; i <= count; i++) {
      const studentId = `usr-batch-${i}`;
      const email = `batch.student.${i}@normocontrol.local`;
      const existing = this.users.find((u) => u.id === studentId);
      if (!existing) {
        this.users.push({
          id: studentId,
          email,
          passwordHash: defaultHash,
          fullName: `Студент №${String(i).padStart(2, '0')}`,
          shortName: `Студент №${i}`,
          role: 'student',
          groupId: i % 2 === 0 ? 'grp-is-21-1' : 'grp-is-21-2',
          departmentId: 'dep-is',
          active: true,
        });
      }

      const subId = `sub-batch-${i}`;
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

      const verId = `ver-batch-${i}`;
      const sha = computeSha256(Buffer.from(`batch-${i}`));
      this.versions.push({
        id: verId,
        submissionId: subId,
        versionNum: status === 'resubmitted' ? 2 : 1,
        idempotencyKey: `batch-key-${i}`,
        sourceKind: 'builder_snapshot',
        fileName: `Batch_Lab1_${i}.pdf`,
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
        id: `rcp-batch-${i}`,
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
