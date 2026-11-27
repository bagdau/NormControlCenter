import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../server/app';
import { generateLabDocxBuffer, generateLabPdfBuffer } from '../server/docGenerator';
import { FIXTURE_PASSWORD, FixtureRepository } from './fixture-repository';
import { LabReportSnapshot } from '../server/types';
import { computeSha256 } from '../server/security';

let server: http.Server;
let baseUrl: string;
let tempUploadDir: string;
let repo: FixtureRepository;
type AuthSession = { cookie: string; csrfToken: string };

async function jsonReq(
  route: string,
  opts: { method?: string; token?: AuthSession; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (opts.token) {
    headers.Cookie = opts.token.cookie;
    if (opts.method && opts.method !== 'GET') headers['X-CSRF-Token'] = opts.token.csrfToken;
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${route}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, headers: res.headers };
}

async function loginAs(email: string): Promise<AuthSession> {
  const res = await jsonReq('/api/auth/login', {
    method: 'POST',
    body: { email, password: FIXTURE_PASSWORD },
  });
  assert.equal(res.status, 200, `Login failed for ${email}: ${JSON.stringify(res.json)}`);
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'Login did not set a session cookie');
  return { cookie, csrfToken: String(res.json.csrfToken) };
}

function makeSampleSnapshot(title = 'Лабораторная работа с Ә Ғ Қ Ң Ө Ұ Ү І'): LabReportSnapshot {
  return {
    templateVersion: 'v1.0-fixture',
    docLang: 'Қазақша',
    university: 'Учебный портал (Тест)',
    department: 'Кафедра ИС',
    discipline: 'Проектирование ИС',
    labNumber: '1',
    title,
    studentName: 'Смаилов Арман Ерланович',
    studentGroup: 'ИС-21-2',
    teacherName: 'доц. Омарова Г. К.',
    cityYear: 'Шымкент, 2024',
    goal: 'Проверка оформления и казахских символов: Ә, Ғ, Қ, Ң, Ө, Ұ, Ү, І.',
    tools: 'Node.js 22, TypeScript, pdfkit, docx',
    procedure: 'Выполнена генерация документа и проверка полей 30/10/20/20 мм.',
    result: 'Получен корректный бинарный файл.',
    conclusion: 'Тест пройден.',
    sources: ['ГОСТ 7.32-2017. — М., 2017.'],
    formatting: {
      version: 'v1.0-fixture',
      pageSize: 'A4',
      marginsMm: { top: 20, right: 10, bottom: 20, left: 30 },
      fontFamily: 'Times New Roman',
      fontSizePt: 14,
      lineSpacing: 1.5,
      firstLineIndentCm: 1.25,
      hangingIndentCm: 1.0,
      showFrame: true,
      showPageNumbers: true,
    },
  };
}

before(async () => {
  tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncc-test-uploads-'));
  repo = new FixtureRepository();
  const app = createApp(repo, {
    uploadDir: tempUploadDir,
    sessionSecret: 'test-secret-key-for-automated-suite',
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tempUploadDir, { recursive: true, force: true });
});

test('01 & 02: Strict group isolation for students and teachers', async () => {
  const s1Token = await loginAs('smailov@normocontrol.local'); // ИС-21-2
  const s2Token = await loginAs('kasymova@normocontrol.local'); // ВТ-20
  const t1Token = await loginAs('omarova@normocontrol.local'); // ИС-21-2, ИС-21-1
  const t2Token = await loginAs('zhumabaev@normocontrol.local'); // ВТ-20

  // Student 1 cannot submit to Student 2's assignment (asg-pr-vt20)
  const crossSubmit = await jsonReq('/api/assignments/asg-pr-vt20/submit', {
    method: 'POST',
    token: s1Token,
    body: { idempotencyKey: 'cross-group-1', snapshot: makeSampleSnapshot() },
  });
  assert.equal(crossSubmit.status, 403);

  // Student 1 cannot inspect Student 2's submission (sub-fixture-2)
  const s1ReadS2 = await jsonReq('/api/submissions/sub-fixture-2', { token: s1Token });
  assert.equal(s1ReadS2.status, 403);

  // Student 2 cannot inspect Student 1's submission (sub-fixture-1)
  const s2ReadS1 = await jsonReq('/api/submissions/sub-fixture-1', { token: s2Token });
  assert.equal(s2ReadS1.status, 403);

  // Teacher 1 cannot inspect ВТ-20 submission (sub-fixture-2)
  const t1ReadS2 = await jsonReq('/api/submissions/sub-fixture-2', { token: t1Token });
  assert.equal(t1ReadS2.status, 403);

  // Teacher 2 cannot inspect ИС-21-2 submission (sub-fixture-1)
  const t2ReadS1 = await jsonReq('/api/submissions/sub-fixture-1', { token: t2Token });
  assert.equal(t2ReadS1.status, 403);
});

test('Student draft survives reads and is isolated by student', async () => {
  const owner = await loginAs('smailov@normocontrol.local');
  const other = await loginAs('kasymova@normocontrol.local');
  const assignments = await jsonReq('/api/assignments', { token: owner });
  const assignmentId = String((assignments.json.assignments as Array<{ id: string }>)[0].id);
  const draft = { snapshot: makeSampleSnapshot('Черновик сохранён'), replies: {}, mode: 'builder', idempotencyKey: 'idem-draft-test-123' };
  const saved = await jsonReq(`/api/assignments/${assignmentId}/draft`, { method: 'PUT', token: owner, body: draft });
  assert.equal(saved.status, 200);
  const loaded = await jsonReq(`/api/assignments/${assignmentId}/draft`, { token: owner });
  assert.equal((loaded.json.draft as { snapshot: { title: string } }).snapshot.title, 'Черновик сохранён');
  const forbidden = await jsonReq(`/api/assignments/${assignmentId}/draft`, { token: other });
  assert.equal(forbidden.status, 404);
});

test('Cookie session requires CSRF token and is revoked on logout', async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'smailov@normocontrol.local', password: FIXTURE_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const body = await login.json();
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('ncc_session='));
  if (!cookie) throw new Error('Missing session cookie');
  assert.match(login.headers.get('set-cookie') || '', /HttpOnly/);
  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  const rejected = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(rejected.status, 403);
  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': body.csrfToken } });
  assert.equal(logout.status, 200);
  const after = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(after.status, 401);
});

test('Password change revokes existing sessions', async () => {
  await repo.createUser({ email: 'password-change@test.local', password: 'InitialPassword2026!', fullName: 'Password Test', shortName: 'P. Test', role: 'teacher', groupId: null, departmentId: null });
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'password-change@test.local', password: 'InitialPassword2026!' }) });
  assert.equal(login.status, 200);
  const body = await login.json();
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const change = await fetch(`${baseUrl}/api/auth/change-password`, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': body.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: 'InitialPassword2026!', newPassword: 'NewSecurePassword2026!' }) });
  assert.equal(change.status, 200);
  const oldSession = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(oldSession.status, 401);
  const newLogin = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'password-change@test.local', password: 'NewSecurePassword2026!' }) });
  assert.equal(newLogin.status, 200);
});

test('03: Admin is blocked (403) from reading or downloading student submissions', async () => {
  const adminToken = await loginAs('admin@normocontrol.local');

  const bundleRes = await jsonReq('/api/submissions/sub-fixture-1', { token: adminToken });
  assert.equal(bundleRes.status, 403);

  const dlRes = await fetch(
    `${baseUrl}/api/submissions/sub-fixture-1/versions/ver-fixture-1-v1/download`,
    { headers: { Cookie: adminToken.cookie } }
  );
  assert.equal(dlRes.status, 403);

  const remarkRes = await jsonReq('/api/submissions/sub-fixture-1/remarks/draft', {
    method: 'POST',
    token: adminToken,
    body: { pageNumber: 1, severity: 'mandatory', gostRule: 'ГОСТ', text: 'test' },
  });
  assert.equal(remarkRes.status, 403);
});

test('04: Revoking teacher assignment immediately denies access on the next request', async () => {
  const adminToken = await loginAs('admin@normocontrol.local');
  const t2Token = await loginAs('zhumabaev@normocontrol.local'); // assigned via ta-3 to grp-vt-20

  const beforeRevoke = await jsonReq('/api/submissions/sub-fixture-2', { token: t2Token });
  assert.equal(beforeRevoke.status, 200);

  // Admin revokes ta-3
  const revokeRes = await jsonReq('/api/admin/teacher-assignments/ta-3', {
    method: 'PATCH',
    token: adminToken,
    body: { active: false },
  });
  assert.equal(revokeRes.status, 200);

  // Very next request from Teacher 2 fails with 403
  const afterRevoke = await jsonReq('/api/submissions/sub-fixture-2', { token: t2Token });
  assert.equal(afterRevoke.status, 403);

  // Restore ta-3 for cleanliness
  await jsonReq('/api/admin/teacher-assignments/ta-3', {
    method: 'PATCH',
    token: adminToken,
    body: { active: true },
  });
});

test('05 & 06: Idempotency deduplication and rejected invalid upload creates no receipt', async () => {
  const s1Token = await loginAs('smailov@normocontrol.local');

  // Invalid upload (not a real PDF signature)
  const badForm = new FormData();
  badForm.append('idempotencyKey', 'bad-pdf-key');
  badForm.append('file', new Blob(['NOT_A_REAL_PDF'], { type: 'application/pdf' }), 'fake.pdf');

  const badUploadRes = await fetch(`${baseUrl}/api/assignments/asg-lab-1/submit`, {
    method: 'POST',
    headers: { Cookie: s1Token.cookie, 'X-CSRF-Token': s1Token.csrfToken },
    body: badForm,
  });
  assert.equal(badUploadRes.status, 400);

  // Verify no submission exists yet for asg-lab-1
  const mineBefore = await jsonReq('/api/submissions/mine', { token: s1Token });
  const existingLab1 = (mineBefore.json.submissions as { assignment: { id: string } }[]).find(
    (b) => b.assignment.id === 'asg-lab-1'
  );
  assert.equal(existingLab1, undefined);

  // Valid submission with idempotencyKey
  const key = 'idem-lab1-first-submit';
  const firstSubmit = await jsonReq('/api/assignments/asg-lab-1/submit', {
    method: 'POST',
    token: s1Token,
    body: { idempotencyKey: key, snapshot: makeSampleSnapshot('Версия 1 с Ә Ғ Қ') },
  });
  assert.equal(firstSubmit.status, 201);
  assert.equal(firstSubmit.json.deduplicated, false);
  const receipt1 = (firstSubmit.json.receipt as { receiptNumber: string; versionNum: number });
  assert.equal(receipt1.versionNum, 1);

  // Repeat exact same request with same idempotencyKey -> deduplicated, same receipt, still v1
  const dupSubmit = await jsonReq('/api/assignments/asg-lab-1/submit', {
    method: 'POST',
    token: s1Token,
    body: { idempotencyKey: key, snapshot: makeSampleSnapshot('Версия 1 с Ә Ғ Қ') },
  });
  assert.equal(dupSubmit.status, 200);
  assert.equal(dupSubmit.json.deduplicated, true);
  const receiptDup = (dupSubmit.json.receipt as { receiptNumber: string; versionNum: number });
  assert.equal(receiptDup.receiptNumber, receipt1.receiptNumber);
  assert.equal(receiptDup.versionNum, 1);

  const conflictingRepeat = await jsonReq('/api/assignments/asg-lab-1/submit', {
    method: 'POST', token: s1Token,
    body: { idempotencyKey: key, snapshot: makeSampleSnapshot('Другое содержимое') },
  });
  assert.equal(conflictingRepeat.status, 409);

  const prematureV2 = await jsonReq('/api/assignments/asg-lab-1/submit', {
    method: 'POST', token: s1Token,
    body: { idempotencyKey: 'premature-v2', snapshot: makeSampleSnapshot('Без возврата') },
  });
  assert.equal(prematureV2.status, 409);

  const bundle = firstSubmit.json.bundle as { submission: { id: string }; versions: { id: string }[] };
  const fileResponse = await fetch(`${baseUrl}/api/submissions/${bundle.submission.id}/versions/${bundle.versions[0].id}/download`, {
    headers: { Cookie: s1Token.cookie },
  });
  assert.equal(fileResponse.status, 200);
  const storedBytes = Buffer.from(await fileResponse.arrayBuffer());
  assert.equal(computeSha256(storedBytes), (firstSubmit.json.receipt as { sha256Hex: string }).sha256Hex);
});

test('Teacher assigned to same group cannot inspect another teacher assignment', async () => {
  const secondTeacher = await repo.findUserByEmail('zhumabaev@normocontrol.local');
  assert.ok(secondTeacher);
  await repo.upsertTeacherAssignment({ teacherId: secondTeacher.id, groupId: 'grp-is-21-2', discipline: 'Проверка ACL', active: true });
  const token = await loginAs('zhumabaev@normocontrol.local');
  const read = await jsonReq('/api/submissions/sub-fixture-1', { token });
  assert.equal(read.status, 403);
  const queue = await jsonReq('/api/submissions/queue', { token });
  assert.equal(queue.status, 200);
  assert.equal((queue.json.queue as { submission: { id: string } }[]).some((r) => r.submission.id === 'sub-fixture-1'), false);
});

test('07, 08, 09, 10: Draft remarks hidden, v1 immutable, separate resubmitDeadlineAt, mandatory close gate', async () => {
  const s1Token = await loginAs('smailov@normocontrol.local');
  const t1Token = await loginAs('omarova@normocontrol.local');

  // Find Smailov's submission on asg-lab-1
  const mine = await jsonReq('/api/submissions/mine', { token: s1Token });
  const labSub = (
    mine.json.submissions as {
      submission: { id: string };
      assignment: { id: string; deadlineAt: string };
    }[]
  ).find((b) => b.assignment.id === 'asg-lab-1')!;
  const subId = labSub.submission.id;
  const originalDeadline = labSub.assignment.deadlineAt;

  // Teacher adds a draft remark with pin coordinates on v1
  const draftRes = await jsonReq(`/api/submissions/${subId}/remarks/draft`, {
    method: 'POST',
    token: t1Token,
    body: {
      versionNum: 1,
      pageNumber: 2,
      xNorm: 0.45,
      yNorm: 0.35,
      severity: 'mandatory',
      gostRule: 'ГОСТ 7.32-2017 п. 6.1',
      text: 'Исправьте интервал и выступ списка.',
    },
  });
  assert.equal(draftRes.status, 201);
  const remarkId = (draftRes.json.remark as { id: string }).id;

  // Student MUST NOT see draft remarks before publish
  const studentViewBeforePublish = await jsonReq(`/api/submissions/${subId}`, { token: s1Token });
  const pkgsBefore = studentViewBeforePublish.json.bundle as { packages: unknown[] };
  assert.equal(pkgsBefore.packages.length, 0);

  // Teacher publishes package and sets separate resubmitDeadlineAt
  const customResubmitDeadline = '2026-12-20T18:00:00.000Z';
  const pubRes = await jsonReq(`/api/submissions/${subId}/return`, {
    method: 'POST',
    token: t1Token,
    body: { resubmitDeadlineAt: customResubmitDeadline },
  });
  assert.equal(pubRes.status, 200);
  const pubBundle = pubRes.json.bundle as {
    assignment: { deadlineAt: string; resubmitDeadlineAt: string };
    packages: { status: string; remarks: { id: string }[] }[];
  };
  assert.equal(pubBundle.assignment.deadlineAt, originalDeadline);
  assert.equal(pubBundle.assignment.resubmitDeadlineAt, customResubmitDeadline);

  // Student now sees published remark
  const studentViewAfterPublish = await jsonReq(`/api/submissions/${subId}`, { token: s1Token });
  const pkgsAfter = (studentViewAfterPublish.json.bundle as { packages: { remarks: unknown[] }[] }).packages;
  assert.equal(pkgsAfter.length, 1);
  assert.equal(pkgsAfter[0].remarks.length, 1);

  // Student submits v2 with reply; v1 stays immutable & pins stay ONLY on v1
  const v2Res = await jsonReq('/api/assignments/asg-lab-1/submit', {
    method: 'POST',
    token: s1Token,
    body: {
      idempotencyKey: 'idem-lab1-v2',
      snapshot: makeSampleSnapshot('Исправленная v2'),
      replies: [{ remarkId, replyText: 'Интервал и список исправлены.' }],
    },
  });
  assert.equal(v2Res.status, 201);
  const v2Bundle = v2Res.json.bundle as {
    versions: { versionNum: number; snapshot: { title: string } }[];
    packages: { versionNum: number }[];
  };
  assert.equal(v2Bundle.versions.length, 2);
  assert.equal(v2Bundle.versions[0].versionNum, 1);
  assert.equal(v2Bundle.versions[0].snapshot.title, 'Версия 1 с Ә Ғ Қ');
  assert.equal(v2Bundle.versions[1].versionNum, 2);
  assert.equal(v2Bundle.versions[1].snapshot.title, 'Исправленная v2');
  // No pins auto-copied to v2
  assert.equal(v2Bundle.packages.filter((p) => p.versionNum === 2).length, 0);

  // Approval MUST fail while mandatory remark is unclosed
  const blockedApprove = await jsonReq(`/api/submissions/${subId}/approve`, {
    method: 'POST',
    token: t1Token,
  });
  assert.equal(blockedApprove.status, 400);

  // Teacher closes remark -> now approval succeeds
  const closeRes = await jsonReq(`/api/remarks/${remarkId}/close`, {
    method: 'POST',
    token: t1Token,
  });
  assert.equal(closeRes.status, 200);

  const okApprove = await jsonReq(`/api/submissions/${subId}/approve`, {
    method: 'POST',
    token: t1Token,
  });
  assert.equal(okApprove.status, 200);
  const approvedSub = (okApprove.json.bundle as { submission: { status: string } }).submission;
  assert.equal(approvedSub.status, 'approved_in_system');
});

test('11: 40 fixture submissions queue sort order, counts, and filters', async () => {
  await repo.addQueueFixtures(40);
  const t1Token = await loginAs('omarova@normocontrol.local');

  const qAll = await jsonReq('/api/submissions/queue', { token: t1Token });
  assert.equal(qAll.status, 200);
  const rows = qAll.json.queue as {
    submission: { createdAt: string; groupId: string; status: string };
  }[];
  assert.ok(rows.length >= 40, `Expected >= 40 queue rows, got ${rows.length}`);

  // Verify oldest-first ascending createdAt sort
  for (let i = 1; i < rows.length; i++) {
    const prevT = new Date(rows[i - 1].submission.createdAt).getTime();
    const curT = new Date(rows[i].submission.createdAt).getTime();
    assert.ok(prevT <= curT, 'Queue must be sorted oldest-first by default');
  }

  // Filter by grp-is-21-1
  const qFiltered = await jsonReq('/api/submissions/queue?groupId=grp-is-21-1', {
    token: t1Token,
  });
  const filteredRows = qFiltered.json.queue as { submission: { groupId: string } }[];
  assert.equal(filteredRows.length, 20);
  assert.ok(filteredRows.every((r) => r.submission.groupId === 'grp-is-21-1'));
});

test('12: Real binary DOCX and PDF generation with Kazakh letters Ә Ғ Қ Ң Ө Ұ Ү І', async () => {
  const snap = makeSampleSnapshot('Қазақша Ә Ғ Қ Ң Ө Ұ Ү І тесті');
  const docxBuf = await generateLabDocxBuffer(snap);
  assert.ok(docxBuf.length > 1000);
  // OOXML ZIP magic bytes PK\x03\x04
  assert.equal(docxBuf[0], 0x50);
  assert.equal(docxBuf[1], 0x4b);
  assert.equal(docxBuf[2], 0x03);
  assert.equal(docxBuf[3], 0x04);

  const pdfBuf = await generateLabPdfBuffer(snap);
  assert.ok(pdfBuf.length > 1000);
  assert.equal(pdfBuf.subarray(0, 5).toString('ascii'), '%PDF-');
});
