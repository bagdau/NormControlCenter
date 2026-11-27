import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { generateLabDocxBuffer, generateLabPdfBuffer } from './docGenerator';
import {
  DEMO_PASSWORD_DEFAULT,
  IRepository,
  SubmissionBundle,
} from './repositories/repository';
import {
  MAX_UPLOAD_BYTES,
  computeSha256,
  generateSessionToken,
  hashSessionToken,
  hashPassword,
  safeStoragePath,
  validateUploadedFile,
  verifyPassword,
} from './security';
import { LabReportSnapshot, UserRecord } from './types';

export interface AppOptions {
  uploadDir: string;
  sessionSecret: string;
  allowDemoPreviewAccounts?: boolean;
  allowBearerAuth?: boolean;
}

interface AuthedRequest extends Request {
  authUser?: UserRecord;
  authTokenHash?: string;
}

function stripDraftPackagesForStudent(bundle: SubmissionBundle): SubmissionBundle {
  return {
    ...bundle,
    packages: bundle.packages.filter((p) => p.status === 'published'),
  };
}

function parseBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

function parseSessionCookie(req: Request): string | null {
  const value = req.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('ncc_session='))?.slice('ncc_session='.length);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function csrfForSession(tokenHash: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`csrf:${tokenHash}`).digest('hex');
}

export function createApp(repo: IRepository, options: AppOptions) {
  const app = express();
  app.set('trust proxy', 1);
  fs.mkdirSync(options.uploadDir, { recursive: true });
  const loginFailures = new Map<string, { count: number; until: number }>();
  const invalidPasswordHash = hashPassword(crypto.randomBytes(24).toString('hex'));

  app.use(express.json({ limit: '4mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  // Security headers for API responses
  app.use('/api', (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Health & runtime mode endpoint (no secrets exposed)
  app.get('/api/health', async (_req, res) => {
    const hc = await repo.healthCheck();
    res.status(hc.ok && hc.dbReady ? 200 : 503).json({
      ok: hc.ok,
      dbReady: hc.dbReady,
      mode: repo.mode,
      persistsAcrossRestart: repo.persistsAcrossRestart,
      demoBanner:
        repo.mode === 'demo-in-memory'
          ? 'Демо-режим (в памяти сервера): данные сбрасываются при перезапуске. Для постоянного хранения запустите PostgreSQL.'
          : null,
      allowDemoPreviewAccounts: Boolean(options.allowDemoPreviewAccounts),
    });
  });

  // Preview demo accounts list (ONLY exposed when demo preview mode is explicitly enabled)
  app.get('/api/auth/demo-accounts', async (_req, res) => {
    if (!options.allowDemoPreviewAccounts) {
      return res.status(404).json({ error: 'Demo preview accounts disabled' });
    }
    const users = await repo.listUsers();
    const previewUsers = users.filter((u) => !u.email.startsWith('synth.student.'));
    res.json({
      demoOnlyWarning:
        'Изолированный режим предпросмотра с синтетическими учётными записями. Не является обходом серверной проверки подлинности.',
      defaultPassword: DEMO_PASSWORD_DEFAULT,
      accounts: previewUsers,
    });
  });

  // Auth routes
  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Укажите email и пароль.' });
    }

    const limitKey = req.ip || 'unknown';
    const attempt = loginFailures.get(limitKey);
    if (attempt && attempt.count >= 5 && attempt.until > Date.now()) {
      return res.status(429).json({ code: 'LOGIN_RATE_LIMIT', error: 'Слишком много попыток входа. Повторите через 15 минут.' });
    }
    const user = await repo.findUserByEmail(email);
    const validPassword = verifyPassword(password, user?.passwordHash || invalidPasswordHash);
    if (!user || !user.active || !validPassword) {
      loginFailures.set(limitKey, { count: (attempt?.until && attempt.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 15 * 60_000 });
      return res.status(401).json({ error: 'Неверный логин, пароль или учётная запись отключена.' });
    }
    loginFailures.delete(limitKey);

    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken, options.sessionSecret);
    const expiresAt = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
    await repo.createSession(tokenHash, user.id, expiresAt);

    const publicUser = await repo.toPublicUser(user);
    const secure = req.secure || process.env.APP_URL?.startsWith('https://');
    res.setHeader('Set-Cookie', `ncc_session=${rawToken}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=43200${secure ? '; Secure' : ''}`);
    return res.json({ ...(options.allowBearerAuth ? { token: rawToken } : {}), csrfToken: csrfForSession(tokenHash, options.sessionSecret), expiresAt, user: publicUser });
  });

  const requireAuth = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const cookieToken = parseSessionCookie(req);
    const token = cookieToken || (options.allowBearerAuth ? parseBearerToken(req) : null);
    if (!token) {
      return res.status(401).json({
        code: 'SESSION_EXPIRED',
        error: 'Требуется вход в систему или сессия истекла.',
      });
    }
    const tokenHash = hashSessionToken(token, options.sessionSecret);
    const user = await repo.getSessionUser(tokenHash);
    if (!user) {
      return res.status(401).json({
        code: 'SESSION_EXPIRED',
        error: 'Сессия недействительна или истекла.',
      });
    }
    req.authUser = user;
    req.authTokenHash = tokenHash;
    if (cookieToken && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const expected = csrfForSession(tokenHash, options.sessionSecret);
      const supplied = req.get('X-CSRF-Token') || '';
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
        return res.status(403).json({ code: 'CSRF_REJECTED', error: 'Защитный токен запроса недействителен.' });
      }
    }
    next();
  };

  app.post('/api/auth/logout', requireAuth, async (req: AuthedRequest, res) => {
    if (req.authTokenHash) {
      await repo.deleteSession(req.authTokenHash);
    }
    res.setHeader('Set-Cookie', 'ncc_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthedRequest, res) => {
    const publicUser = await repo.toPublicUser(req.authUser!);
    res.json({ user: publicUser, csrfToken: csrfForSession(req.authTokenHash!, options.sessionSecret) });
  });

  app.post('/api/auth/change-password', requireAuth, async (req: AuthedRequest, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!verifyPassword(currentPassword, req.authUser!.passwordHash)) return res.status(403).json({ error: 'Текущий пароль неверен.' });
    if (newPassword.length < 16 || newPassword.length > 256 || newPassword === currentPassword) return res.status(400).json({ error: 'Новый пароль должен отличаться и содержать 16–256 символов.' });
    await repo.changeUserPassword(req.authUser!.id, newPassword);
    res.setHeader('Set-Cookie', 'ncc_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');
    res.json({ ok: true, message: 'Пароль изменён. Войдите заново.' });
  });

  // Authorization helpers for submission resources
  async function authorizeSubmissionAccess(
    user: UserRecord,
    bundle: SubmissionBundle
  ): Promise<{ allowed: boolean; statusCode: number; reason?: string }> {
    // Admin is STRICTLY forbidden from reading student submissions/documents
    if (user.role === 'admin') {
      return {
        allowed: false,
        statusCode: 403,
        reason: 'Администратор не имеет доступа к содержимому и файлам студенческих работ.',
      };
    }
    if (user.role === 'student') {
      if (bundle.submission.studentId !== user.id || user.groupId !== bundle.submission.groupId) {
        return {
          allowed: false,
          statusCode: 403,
          reason: 'Доступ запрещён: чужая работа.',
        };
      }
      return { allowed: true, statusCode: 200 };
    }
    if (user.role === 'teacher') {
      if (bundle.assignment.teacherId !== user.id) {
        return { allowed: false, statusCode: 403, reason: 'Доступ запрещён: задание другого преподавателя.' };
      }
      const assigned = await repo.isTeacherAssignedToGroup(user.id, bundle.submission.groupId);
      if (!assigned) {
        return {
          allowed: false,
          statusCode: 403,
          reason: 'Доступ запрещён: вы не назначены на эту учебную группу (или назначение отозвано).',
        };
      }
      return { allowed: true, statusCode: 200 };
    }
    return { allowed: false, statusCode: 403, reason: 'Доступ запрещён.' };
  }

  // ==================== ADMIN ROUTES ====================
  const requireAdmin = (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (req.authUser?.role !== 'admin') {
      return res.status(403).json({ error: 'Доступ разрешён только администратору.' });
    }
    next();
  };

  app.get('/api/admin/overview', requireAuth, requireAdmin, async (_req, res) => {
    const [faculties, departments, groups, users, teacherAssignments] = await Promise.all([
      repo.listFaculties(),
      repo.listDepartments(),
      repo.listGroups(),
      repo.listUsers(),
      repo.listTeacherAssignments(),
    ]);
    res.json({
      faculties,
      departments,
      groups,
      users: users.filter((u) => !u.email.startsWith('synth.student.')),
      teacherAssignments,
    });
  });

  app.post('/api/admin/faculties', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const name = String(req.body?.name || '').trim();
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!name || !code) return res.status(400).json({ error: 'Укажите название и код факультета.' });
    try {
      const faculty = await repo.createFaculty({ name, code });
      res.status(201).json({ faculty });
    } catch { res.status(409).json({ error: 'Код факультета уже существует.' }); }
  });

  app.post('/api/admin/departments', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const facultyId = String(req.body?.facultyId || '').trim();
    const name = String(req.body?.name || '').trim();
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!facultyId || !name || !code) return res.status(400).json({ error: 'Выберите факультет, название и код кафедры.' });
    if (!(await repo.listFaculties()).some((faculty) => faculty.id === facultyId)) return res.status(404).json({ error: 'Факультет не найден.' });
    try {
      const department = await repo.createDepartment({ facultyId, name, code });
      res.status(201).json({ department });
    } catch { res.status(409).json({ error: 'Код кафедры уже существует.' }); }
  });

  app.post('/api/admin/groups', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const departmentId = String(req.body?.departmentId || '').trim();
    const name = String(req.body?.name || '').trim();
    const yearLabel = String(req.body?.yearLabel || '2023–2024').trim();
    if (!name || !departmentId) {
      return res.status(400).json({ error: 'Выберите кафедру и укажите название группы.' });
    }
    if (!(await repo.listDepartments()).some((department) => department.id === departmentId)) return res.status(404).json({ error: 'Кафедра не найдена.' });
    const group = await repo.createGroup({ departmentId, name, yearLabel });
    await repo.addAuditLog({
      actorId: req.authUser!.id,
      actorName: req.authUser!.shortName,
      action: `Создана учебная группа ${group.name}`,
      entityType: 'group',
      entityId: group.id,
    });
    res.status(201).json({ group });
  });

  app.post('/api/admin/users', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const fullName = String(req.body?.fullName || '').trim();
    const shortName = String(req.body?.shortName || '').trim();
    const role = req.body?.role as 'student' | 'teacher' | 'admin';
    const groupId = req.body?.groupId ? String(req.body.groupId) : null;
    let departmentId = req.body?.departmentId ? String(req.body.departmentId) : null;

    if (!email || !fullName || !['student', 'teacher'].includes(role)) {
      return res.status(400).json({ error: 'Проверьте email, ФИО и роль пользователя.' });
    }
    if (password.length < 12) return res.status(400).json({ error: 'Укажите начальный пароль длиной не менее 12 символов.' });
    if (role === 'student' && !groupId) {
      return res.status(400).json({ error: 'Для студента необходимо выбрать группу.' });
    }
    if (role === 'student') {
      const group = (await repo.listGroups()).find((item) => item.id === groupId);
      if (!group) return res.status(404).json({ error: 'Группа не найдена.' });
      departmentId = group.departmentId;
    }
    const existing = await repo.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Пользователь с таким email уже существует.' });
    }
    const user = await repo.createUser({
      email,
      password,
      fullName,
      shortName: shortName || fullName,
      role,
      groupId: role === 'student' ? groupId : null,
      departmentId,
    });
    await repo.addAuditLog({
      actorId: req.authUser!.id,
      actorName: req.authUser!.shortName,
      action: `Создана учётная запись ${user.email} (${user.role})`,
      entityType: 'user',
      entityId: user.id,
    });
    res.status(201).json({ user });
  });

  app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const active = Boolean(req.body?.active);
    const target = await repo.findUserById(req.params.id);
    if (target?.role === 'admin') return res.status(403).json({ error: 'Учётную запись администратора нельзя отключить через реестр.' });
    const updated = await repo.toggleUserActive(req.params.id, active);
    if (!updated) {
      return res.status(404).json({ error: 'Пользователь не найден.' });
    }
    await repo.addAuditLog({
      actorId: req.authUser!.id,
      actorName: req.authUser!.shortName,
      action: `${active ? 'Активирована' : 'Отключена'} учётная запись ${updated.email}`,
      entityType: 'user',
      entityId: updated.id,
    });
    res.json({ user: updated });
  });

  app.post(
    '/api/admin/teacher-assignments',
    requireAuth,
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const teacherId = String(req.body?.teacherId || '').trim();
      const groupId = String(req.body?.groupId || '').trim();
      const discipline = String(req.body?.discipline || '').trim();
      const active = req.body?.active === undefined ? true : Boolean(req.body.active);
      if (!teacherId || !groupId || !discipline) {
        return res.status(400).json({ error: 'Выберите преподавателя, группу и дисциплину.' });
      }
      const teacher = await repo.findUserById(teacherId);
      if (!teacher || teacher.role !== 'teacher' || !teacher.active) return res.status(400).json({ error: 'Выберите активного преподавателя.' });
      if (!(await repo.listGroups()).some((group) => group.id === groupId)) return res.status(404).json({ error: 'Группа не найдена.' });
      const assignment = await repo.upsertTeacherAssignment({
        teacherId,
        groupId,
        discipline,
        active,
      });
      await repo.addAuditLog({
        actorId: req.authUser!.id,
        actorName: req.authUser!.shortName,
        action: `Назначение преподавателя на группу (${discipline})`,
        entityType: 'teacher_assignment',
        entityId: assignment.id,
        details: { teacherId, groupId, active },
      });
      res.status(201).json({ assignment });
    }
  );

  app.patch(
    '/api/admin/teacher-assignments/:id',
    requireAuth,
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const active = Boolean(req.body?.active);
      const updated = await repo.toggleTeacherAssignment(req.params.id, active);
      if (!updated) {
        return res.status(404).json({ error: 'Назначение не найдено.' });
      }
      await repo.addAuditLog({
        actorId: req.authUser!.id,
        actorName: req.authUser!.shortName,
        action: `${active ? 'Возобновлено' : 'Отозвано'} назначение преподавателя на группу`,
        entityType: 'teacher_assignment',
        entityId: updated.id,
        details: { teacherId: updated.teacherId, groupId: updated.groupId, active },
      });
      res.json({ assignment: updated });
    }
  );

  app.get('/api/assignments/:id/draft', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const assignment = await repo.getAssignmentById(req.params.id);
    if (user.role !== 'student' || !assignment || assignment.groupId !== user.groupId) return res.status(404).json({ error: 'Задание не найдено.' });
    res.json({ draft: await repo.getStudentDraft(user.id, assignment.id) });
  });

  app.put('/api/assignments/:id/draft', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const assignment = await repo.getAssignmentById(req.params.id);
    if (user.role !== 'student' || !assignment || assignment.groupId !== user.groupId) return res.status(404).json({ error: 'Задание не найдено.' });
    const snapshot = req.body?.snapshot as LabReportSnapshot | undefined;
    const replies = req.body?.replies;
    const mode = req.body?.mode;
    const idempotencyKey = String(req.body?.idempotencyKey || '');
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.sources) || !snapshot.formatting ||
        !replies || typeof replies !== 'object' || Array.isArray(replies) || !['builder', 'upload'].includes(mode) ||
        idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return res.status(400).json({ error: 'Некорректный черновик.' });
    }
    const draft = await repo.saveStudentDraft(user.id, assignment.id, { snapshot, replies, mode, idempotencyKey });
    res.json({ draft });
  });

  app.delete('/api/assignments/:id/draft', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const assignment = await repo.getAssignmentById(req.params.id);
    if (user.role !== 'student' || !assignment || assignment.groupId !== user.groupId) return res.status(404).json({ error: 'Задание не найдено.' });
    await repo.deleteStudentDraft(user.id, assignment.id);
    res.json({ ok: true });
  });

  // ==================== SPACES & ASSIGNMENTS ====================
  app.get('/api/spaces', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const [data, groups, teacherAssignments] = await Promise.all([
      repo.listSpacesForUser(user),
      repo.listGroups(),
      repo.listTeacherAssignments(),
    ]);
    const myAssignedGroups =
      user.role === 'teacher'
        ? groups.filter((g) =>
            teacherAssignments.some(
              (ta) => ta.teacherId === user.id && ta.groupId === g.id && ta.active
            )
          )
        : groups.filter((g) => g.id === user.groupId);
    res.json({
      spaces: data.spaces,
      materials: data.materials,
      groups: myAssignedGroups,
    });
  });

  app.post('/api/spaces', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role !== 'teacher') {
      return res.status(403).json({ error: 'Создавать пространства может только преподаватель.' });
    }
    const groupId = String(req.body?.groupId || '').trim();
    const title = String(req.body?.title || '').trim();
    const discipline = String(req.body?.discipline || '').trim();
    const pinnedAnnouncement = String(req.body?.pinnedAnnouncement || '').trim();
    if (!groupId || !title || !discipline) {
      return res.status(400).json({ error: 'Заполните группу, название и дисциплину.' });
    }
    const assigned = await repo.isTeacherAssignedToGroup(user.id, groupId);
    if (!assigned) {
      return res.status(403).json({ error: 'Вы не назначены на выбранную группу.' });
    }
    const space = await repo.createSpace({
      teacherId: user.id,
      groupId,
      title,
      discipline,
      pinnedAnnouncement,
    });
    await repo.addAuditLog({
      actorId: user.id,
      actorName: user.shortName,
      action: `Создано пространство «${space.title}»`,
      entityType: 'space',
      entityId: space.id,
    });
    res.status(201).json({ space });
  });

  app.patch('/api/spaces/:id/announcement', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role !== 'teacher') {
      return res.status(403).json({ error: 'Редактировать объявление может только преподаватель.' });
    }
    const { spaces } = await repo.listSpacesForUser(user);
    const target = spaces.find((s) => s.id === req.params.id);
    if (!target) {
      return res.status(403).json({ error: 'Нет доступа к этому пространству.' });
    }
    const announcement = String(req.body?.pinnedAnnouncement || '').trim();
    const updated = await repo.updateSpaceAnnouncement(target.id, announcement);
    res.json({ space: updated });
  });

  app.post('/api/spaces/:id/materials', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role !== 'teacher') {
      return res.status(403).json({ error: 'Добавлять материалы может только преподаватель.' });
    }
    const { spaces } = await repo.listSpacesForUser(user);
    const target = spaces.find((s) => s.id === req.params.id);
    if (!target) {
      return res.status(403).json({ error: 'Нет доступа к этому пространству.' });
    }
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const urlOrNote = String(req.body?.urlOrNote || '').trim();
    if (!title) {
      return res.status(400).json({ error: 'Укажите заголовок материала.' });
    }
    const material = await repo.addSpaceMaterial({
      spaceId: target.id,
      title,
      description,
      urlOrNote,
    });
    res.status(201).json({ material });
  });

  app.get('/api/assignments', requireAuth, async (req: AuthedRequest, res) => {
    const assignments = await repo.listAssignmentsForUser(req.authUser!);
    res.json({ assignments });
  });

  app.post('/api/assignments', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role !== 'teacher') {
      return res.status(403).json({ error: 'Создавать задания может только преподаватель.' });
    }
    const spaceId = String(req.body?.spaceId || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    const code = String(req.body?.code || 'ЛР-НОВ').trim();
    const workType = req.body?.workType || 'Лабораторная';
    const title = String(req.body?.title || '').trim();
    const instructions = String(req.body?.instructions || '').trim();
    const deadlineAt = String(req.body?.deadlineAt || '').trim();
    const latePolicy =
      req.body?.latePolicy === 'block_after_deadline' ? 'block_after_deadline' : 'allow_late';
    const expectedFeedbackDate = req.body?.expectedFeedbackDate
      ? String(req.body.expectedFeedbackDate).trim()
      : null;

    if (!spaceId || !groupId || !title || !deadlineAt) {
      return res.status(400).json({ error: 'Заполните пространство, группу, название и срок.' });
    }

    const assigned = await repo.isTeacherAssignedToGroup(user.id, groupId);
    if (!assigned) {
      return res.status(403).json({ error: 'Доступ запрещён: нет активного назначения на группу.' });
    }
    const spaces = await repo.listSpacesForUser(user);
    if (!spaces.spaces.some((space) => space.id === spaceId && space.teacherId === user.id && space.groupId === groupId)) {
      return res.status(403).json({ error: 'Пространство не принадлежит вам или выбранной группе.' });
    }

    const assignment = await repo.createAssignment({
      spaceId,
      groupId,
      teacherId: user.id,
      code,
      workType,
      title,
      instructions: instructions || 'Приложите работу в формате PDF/DOCX или оформите через конструктор.',
      templateVersion: 'v1.0-demo',
      deadlineAt,
      latePolicy,
      expectedFeedbackDate,
    });

    await repo.addAuditLog({
      actorId: user.id,
      actorName: user.shortName,
      action: `Создано задание ${assignment.code}: ${assignment.title}`,
      entityType: 'assignment',
      entityId: assignment.id,
    });
    res.status(201).json({ assignment });
  });

  // ==================== SUBMISSIONS & QUEUE ====================
  app.get('/api/submissions/mine', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role !== 'student') {
      return res.status(403).json({ error: 'Раздел доступен только студентам.' });
    }
    const bundles = await repo.listStudentSubmissions(user.id);
    res.json({
      submissions: bundles.map(stripDraftPackagesForStudent),
    });
  });

  app.get('/api/submissions/queue', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role !== 'teacher') {
      return res.status(403).json({ error: 'Очередь проверки доступна только преподавателям.' });
    }
    let rows = await repo.listTeacherQueue(user.id);

    const groupFilter = String(req.query.groupId || '').trim();
    const assignmentFilter = String(req.query.assignmentId || '').trim();
    const workTypeFilter = String(req.query.workType || '').trim();
    const statusFilter = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const minWaitHours = Number(req.query.minWaitHours || 0);

    if (groupFilter && groupFilter !== 'all') {
      rows = rows.filter((r) => r.submission.groupId === groupFilter);
    }
    if (assignmentFilter && assignmentFilter !== 'all') {
      rows = rows.filter((r) => r.assignment.id === assignmentFilter);
    }
    if (workTypeFilter && workTypeFilter !== 'all') {
      rows = rows.filter((r) => r.assignment.workType === workTypeFilter);
    }
    if (statusFilter && statusFilter !== 'all') {
      rows = rows.filter((r) => r.submission.status === statusFilter);
    }
    if (minWaitHours > 0) {
      rows = rows.filter((r) => r.waitHours >= minWaitHours);
    }
    if (search) {
      rows = rows.filter(
        (r) =>
          r.student.fullName.toLowerCase().includes(search) ||
          r.assignment.title.toLowerCase().includes(search) ||
          r.assignment.code.toLowerCase().includes(search) ||
          r.groupName.toLowerCase().includes(search)
      );
    }

    res.json({ queue: rows });
  });

  app.post('/api/submissions/queue/claim-next', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role !== 'teacher') {
      return res.status(403).json({ error: 'Брать работу из очереди может только преподаватель.' });
    }
    const row = await repo.claimNextQueueSubmission(user.id);
    if (!row) {
      return res.status(404).json({ error: 'В очереди нет свободных работ на проверку.' });
    }
    await repo.addAuditLog({
      actorId: user.id,
      actorName: user.shortName,
      action: `Взята на проверку работа ${row.assignment.code} (${row.student.shortName})`,
      entityType: 'submission',
      entityId: row.submission.id,
    });
    res.json({ row });
  });

  app.get('/api/submissions/:id', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const bundle = await repo.getSubmissionBundle(req.params.id);
    if (!bundle) {
      return res.status(404).json({ error: 'Работа не найдена.' });
    }
    const authz = await authorizeSubmissionAccess(user, bundle);
    if (!authz.allowed) {
      return res.status(authz.statusCode).json({ error: authz.reason });
    }
    const safeBundle =
      user.role === 'student' ? stripDraftPackagesForStudent(bundle) : bundle;
    res.json({ bundle: safeBundle });
  });

  // Upload or Builder Snapshot Submission (atomic version + receipt + idempotency)
  app.post(
    '/api/assignments/:id/submit',
    requireAuth,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('multipart/form-data')) {
        upload.single('file')(req, res, (err: unknown) => {
          if (err) {
            const msg =
              err instanceof Error && err.message.includes('File too large')
                ? 'Размер файла превышает лимит 25 МБ.'
                : 'Ошибка загрузки файла. Попробуйте повторить отправку.';
            return res.status(400).json({ error: msg });
          }
          next();
        });
      } else {
        next();
      }
    },
    async (req: AuthedRequest, res: Response) => {
      const user = req.authUser!;
      if (user.role !== 'student') {
        return res.status(403).json({ error: 'Сдавать работы может только студент.' });
      }

      const assignment = await repo.getAssignmentById(req.params.id);
      if (!assignment) {
        return res.status(404).json({ error: 'Задание не найдено.' });
      }
      if (user.groupId !== assignment.groupId) {
        return res
          .status(403)
          .json({ error: 'Доступ запрещён: задание относится к другой учебной группе.' });
      }

      const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
      if (!idempotencyKey) {
        return res.status(400).json({ error: 'Отсутствует ключ идемпотентности.' });
      }

      let replies: { remarkId: string; replyText: string }[] = [];
      if (req.body?.replies) {
        try {
          replies =
            typeof req.body.replies === 'string'
              ? JSON.parse(req.body.replies)
              : req.body.replies;
        } catch {
          return res.status(400).json({ error: 'Некорректный формат ответов на замечания.' });
        }
      }

      let pendingStoragePath: string | null = null;
      try {
        if (req.file) {
          const validation = validateUploadedFile(req.file.originalname, req.file.buffer);
          if (!validation.ok) {
            return res.status(400).json({ error: validation.error });
          }

          const sha256Hex = computeSha256(req.file.buffer);
          const safeStorageKey = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${validation.ext}`;
          const targetPath = safeStoragePath(options.uploadDir, safeStorageKey);
          fs.writeFileSync(targetPath, req.file.buffer);
          pendingStoragePath = targetPath;

          let parsedSnapshot: LabReportSnapshot | null = null;
          if (req.body?.snapshot) {
            try {
              parsedSnapshot =
                typeof req.body.snapshot === 'string'
                  ? JSON.parse(req.body.snapshot)
                  : req.body.snapshot;
            } catch {
              parsedSnapshot = null;
            }
          }

          const result = await repo.submitVersionAtomic({
            assignmentId: assignment.id,
            studentId: user.id,
            idempotencyKey,
            sourceKind: 'upload',
            fileName: path.basename(req.file.originalname),
            mimeType: validation.mimeType,
            fileSize: req.file.buffer.length,
            storageKey: safeStorageKey,
            sha256Hex,
            snapshot: parsedSnapshot,
            replies,
          });
          pendingStoragePath = null;

          if (result.deduplicated && fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }

          return res.status(result.deduplicated ? 200 : 201).json({
            bundle: stripDraftPackagesForStudent(result.bundle),
            receipt: result.receipt,
            deduplicated: result.deduplicated,
          });
        }

        // Otherwise expect builder_snapshot JSON
        const snapshot = req.body?.snapshot as LabReportSnapshot | undefined;
        if (!snapshot || !snapshot.title || !snapshot.goal) {
          return res.status(400).json({
            error: 'Прикрепите файл (.PDF/.DOCX) или заполните обязательные поля шаблона.',
          });
        }

        const pdfBuffer = await generateLabPdfBuffer(snapshot);
        const sha256Hex = computeSha256(pdfBuffer);
        const fileName = `${assignment.code.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_')}_${user.shortName.replace(/\s+/g, '_')}.pdf`;
        const safeStorageKey = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.pdf`;
        pendingStoragePath = safeStoragePath(options.uploadDir, safeStorageKey);
        fs.writeFileSync(pendingStoragePath, pdfBuffer);

        const result = await repo.submitVersionAtomic({
          assignmentId: assignment.id,
          studentId: user.id,
          idempotencyKey,
          sourceKind: 'builder_snapshot',
          fileName,
          mimeType: 'application/pdf',
          fileSize: pdfBuffer.length,
          storageKey: safeStorageKey,
          sha256Hex,
          snapshot,
          replies,
        });
        if (result.deduplicated && pendingStoragePath) fs.unlinkSync(pendingStoragePath);
        pendingStoragePath = null;

        return res.status(result.deduplicated ? 200 : 201).json({
          bundle: stripDraftPackagesForStudent(result.bundle),
          receipt: result.receipt,
          deduplicated: result.deduplicated,
        });
      } catch (err) {
        if (pendingStoragePath && fs.existsSync(pendingStoragePath)) fs.unlinkSync(pendingStoragePath);
        if (err instanceof Error && err.message === 'IDEMPOTENCY_CONFLICT') {
          return res.status(409).json({ code: 'IDEMPOTENCY_CONFLICT', error: 'Этот ключ уже использован для другого содержимого.' });
        }
        if (err instanceof Error && err.message === 'RESUBMISSION_NOT_ALLOWED') {
          return res.status(409).json({ code: 'RESUBMISSION_NOT_ALLOWED', error: 'Повторная сдача возможна после опубликованного возврата на доработку.' });
        }
        if (err instanceof Error && err.message === 'DEADLINE_BLOCKED') {
          return res.status(400).json({
            error: 'Срок сдачи истёк, и преподаватель запретил отправку после дедлайна.',
          });
        }
        return res.status(500).json({
          error: 'Не удалось сохранить сдачу на сервере. Повторите попытку позже.',
        });
      }
    }
  );

  app.get(
    '/api/submissions/:id/versions/:versionId/download',
    requireAuth,
    async (req: AuthedRequest, res: Response) => {
      const user = req.authUser!;
      const bundle = await repo.getSubmissionBundle(req.params.id);
      if (!bundle) {
        return res.status(404).json({ error: 'Работа не найдена.' });
      }
      const authz = await authorizeSubmissionAccess(user, bundle);
      if (!authz.allowed) {
        return res.status(authz.statusCode).json({ error: authz.reason });
      }

      const ver = await repo.getSubmissionVersion(req.params.id, req.params.versionId);
      if (!ver) {
        return res.status(404).json({ error: 'Версия документа не найдена.' });
      }

      if (ver.storageKey) {
        const diskPath = safeStoragePath(options.uploadDir, ver.storageKey);
        if (!fs.existsSync(diskPath)) {
          return res.status(404).json({ error: 'Файл версии отсутствует на диске.' });
        }
        const safeName = encodeURIComponent(ver.fileName);
        res.setHeader('Content-Type', ver.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`);
        return res.sendFile(diskPath);
      }

      // Legacy seeded items have no stored bytes and cannot be presented as submitted files.
      return res.status(404).json({ error: 'Исходный файл этой версии отсутствует.' });
    }
  );

  // ==================== REVIEW & REMARKS ====================
  app.post('/api/submissions/:id/remarks/draft', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role !== 'teacher') {
      return res.status(403).json({ error: 'Добавлять замечания может только преподаватель.' });
    }
    const bundle = await repo.getSubmissionBundle(req.params.id);
    if (!bundle) {
      return res.status(404).json({ error: 'Работа не найдена.' });
    }
    const authz = await authorizeSubmissionAccess(user, bundle);
    if (!authz.allowed) {
      return res.status(authz.statusCode).json({ error: authz.reason });
    }

    const versionNum = Number(req.body?.versionNum || bundle.submission.currentVersionNum);
    const pageNumber = Math.max(1, Number(req.body?.pageNumber || 1));
    const xNorm =
      req.body?.xNorm !== null && req.body?.xNorm !== undefined
        ? Math.max(0, Math.min(1, Number(req.body.xNorm)))
        : null;
    const yNorm =
      req.body?.yNorm !== null && req.body?.yNorm !== undefined
        ? Math.max(0, Math.min(1, Number(req.body.yNorm)))
        : null;
    const severity = req.body?.severity === 'recommended' ? 'recommended' : 'mandatory';
    const gostRule = String(req.body?.gostRule || 'ГОСТ 7.32-2017').trim();
    const text = String(req.body?.text || '').trim();

    if (!text) {
      return res.status(400).json({ error: 'Введите текст замечания.' });
    }

    try {
    const remark = await repo.addDraftRemark({
      submissionId: bundle.submission.id,
      versionNum,
      authorId: user.id,
      pageNumber,
      xNorm,
      yNorm,
      severity,
      gostRule,
      text,
    });
    res.status(201).json({ remark });
    } catch (err) {
      if (err instanceof Error && err.message === 'VERSION_CONFLICT') return res.status(409).json({ code: 'VERSION_CONFLICT', error: 'Версия или статус работы изменились. Обновите страницу.' });
      res.status(500).json({ error: 'Не удалось сохранить замечание.' });
    }
  });

  app.post('/api/submissions/:id/return', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role !== 'teacher') {
      return res.status(403).json({ error: 'Публиковать пакет замечаний может только преподаватель.' });
    }
    const bundle = await repo.getSubmissionBundle(req.params.id);
    if (!bundle) {
      return res.status(404).json({ error: 'Работа не найдена.' });
    }
    const authz = await authorizeSubmissionAccess(user, bundle);
    if (!authz.allowed) {
      return res.status(authz.statusCode).json({ error: authz.reason });
    }

    const resubmitDeadlineAt = req.body?.resubmitDeadlineAt
      ? String(req.body.resubmitDeadlineAt).trim()
      : null;

    try {
      const updated = await repo.publishReturnPackage({
        submissionId: bundle.submission.id,
        authorId: user.id,
        resubmitDeadlineAt,
      });
      if (repo.mode === 'demo-in-memory') await repo.addAuditLog({
        actorId: user.id,
        actorName: user.shortName,
        action: `Работа возвращена на доработку (пакет замечаний к v${bundle.submission.currentVersionNum})`,
        entityType: 'submission',
        entityId: bundle.submission.id,
        details: { resubmitDeadlineAt },
      });
      res.json({ bundle: updated });
    } catch (err) {
      if (err instanceof Error && err.message === 'VERSION_CONFLICT') return res.status(409).json({ code: 'VERSION_CONFLICT', error: 'Версия или статус работы изменились. Обновите страницу.' });
      if (err instanceof Error && err.message === 'NO_DRAFT_REMARKS') {
        return res.status(400).json({
          error: 'Добавьте хотя бы одно замечание в черновик перед возвратом студенту.',
        });
      }
      res.status(500).json({ error: 'Ошибка публикации пакета замечаний.' });
    }
  });

  app.post('/api/remarks/:id/close', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role !== 'teacher') {
      return res.status(403).json({ error: 'Закрывать замечания может только преподаватель.' });
    }
    const existing = await repo.getRemarkById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Замечание не найдено.' });
    }
    const bundle = await repo.getSubmissionBundle(existing.submissionId);
    if (!bundle) {
      return res.status(404).json({ error: 'Работа не найдена.' });
    }
    const authz = await authorizeSubmissionAccess(user, bundle);
    if (!authz.allowed) {
      return res.status(authz.statusCode).json({ error: authz.reason });
    }

    const updated = await repo.closeRemark(req.params.id, user.id);
    await repo.addAuditLog({
      actorId: user.id,
      actorName: user.shortName,
      action: `Закрыто замечание (${existing.gostRule})`,
      entityType: 'remark',
      entityId: existing.id,
      details: { submissionId: existing.submissionId },
    });
    res.json({ remark: updated });
  });

  app.post('/api/submissions/:id/approve', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role !== 'teacher') {
      return res.status(403).json({ error: 'Согласовывать работу может только преподаватель.' });
    }
    const bundle = await repo.getSubmissionBundle(req.params.id);
    if (!bundle) {
      return res.status(404).json({ error: 'Работа не найдена.' });
    }
    const authz = await authorizeSubmissionAccess(user, bundle);
    if (!authz.allowed) {
      return res.status(authz.statusCode).json({ error: authz.reason });
    }

    try {
      const updated = await repo.approveInSystem(bundle.submission.id, user.id);
      if (repo.mode === 'demo-in-memory') await repo.addAuditLog({
        actorId: user.id,
        actorName: user.shortName,
        action: `Статус установлен: Согласовано в системе (v${bundle.submission.currentVersionNum})`,
        entityType: 'submission',
        entityId: bundle.submission.id,
      });
      res.json({ bundle: updated });
    } catch (err) {
      if (err instanceof Error && err.message === 'VERSION_CONFLICT') return res.status(409).json({ code: 'VERSION_CONFLICT', error: 'Версия или статус работы изменились. Обновите страницу.' });
      if (err instanceof Error && err.message === 'OPEN_MANDATORY_REMARKS') {
        return res.status(400).json({
          error:
            'Нельзя согласовать работу: есть незакрытые обязательные замечания.',
        });
      }
      res.status(500).json({ error: 'Ошибка согласования работы.' });
    }
  });

  // ==================== BUILDER DOCX & PDF EXPORTS ====================
  app.post('/api/builder/export-docx', requireAuth, async (req: AuthedRequest, res) => {
    const snapshot = req.body?.snapshot as LabReportSnapshot | undefined;
    if (!snapshot || !snapshot.title) {
      return res.status(400).json({ error: 'Заполните тему и поля лабораторной работы.' });
    }
    const buffer = await generateLabDocxBuffer(snapshot);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`Lab_${snapshot.labNumber || '1'}_NormControl.docx`)}`
    );
    res.send(buffer);
  });

  app.post('/api/builder/export-pdf', requireAuth, async (req: AuthedRequest, res) => {
    const snapshot = req.body?.snapshot as LabReportSnapshot | undefined;
    if (!snapshot || !snapshot.title) {
      return res.status(400).json({ error: 'Заполните тему и поля лабораторной работы.' });
    }
    const buffer = await generateLabPdfBuffer(snapshot);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`Lab_${snapshot.labNumber || '1'}_NormControl.pdf`)}`
    );
    res.send(buffer);
  });

  // ==================== AUDIT LOGS ====================
  app.get('/api/audit-logs', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role === 'student') {
      return res.status(403).json({ error: 'Журнал событий недоступен для студентов.' });
    }
    const logs = await repo.listAuditLogs(50);
    res.json({ logs });
  });

  return app;
}
