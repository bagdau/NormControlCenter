// Run only against an isolated, seeded local PostgreSQL instance.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const base = process.env.SMOKE_BASE_URL;
if (!base || !/^http:\/\/localhost:\d+$/.test(base)) throw new Error('Set SMOKE_BASE_URL to a localhost URL');
const password = 'DemoNormo2024!';

async function request(route, token, method = 'GET', body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { status: response.status, data };
}

async function login(email) {
  const result = await request('/api/auth/login', null, 'POST', { email, password });
  assert.equal(result.status, 200, `${email}: ${JSON.stringify(result.data)}`);
  return result.data.token;
}

let health;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    health = await request('/api/health');
    if (health.data.ok) break;
  } catch { /* container may still be starting */ }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
assert.ok(health, 'Application became available');
assert.equal(health.data.mode, 'postgresql');
assert.equal(health.data.dbReady, true);
if (process.env.SMOKE_VERIFY_SUBMISSION_ID) {
  const student = await login('smailov@normocontrol.local');
  const persisted = await request(`/api/submissions/${encodeURIComponent(process.env.SMOKE_VERIFY_SUBMISSION_ID)}`, student);
  assert.equal(persisted.status, 200);
  assert.equal(persisted.data.bundle.submission.status, 'approved_in_system');
  assert.equal(persisted.data.bundle.versions.length, 2);
  assert.equal(persisted.data.bundle.receipts.length, 2);
  console.log(JSON.stringify({ result: 'PASS_AFTER_RESTART', submissionId: process.env.SMOKE_VERIFY_SUBMISSION_ID }));
} else {
const teacher = await login('omarova@normocontrol.local');
const student = await login('smailov@normocontrol.local');
const spaces = await request('/api/spaces', teacher);
const space = spaces.data.spaces.find((s) => s.groupId === 'grp-is-21-2');
assert.ok(space, 'Seeded teacher space for ИС-21-2');
const nonce = crypto.randomUUID();
const assignment = await request('/api/assignments', teacher, 'POST', {
  spaceId: space.id, groupId: space.groupId, code: `SMOKE-${nonce.slice(0, 8)}`,
  workType: 'Лабораторная', title: 'Синтетическая проверка PostgreSQL',
  deadlineAt: new Date(Date.now() + 86400000).toISOString(), latePolicy: 'block_after_deadline',
});
assert.equal(assignment.status, 201, JSON.stringify(assignment.data));
const assignmentId = assignment.data.assignment.id;
const snapshot = {
  templateVersion: 'v1.0-demo', docLang: 'Қазақша', university: 'Тестовый вуз', department: 'Кафедра ИС',
  discipline: 'Тестирование', labNumber: '1', title: 'Тест Ә Ғ Қ Ң Ө Ұ Ү І',
  studentName: 'Синтетический студент', studentGroup: 'ИС-21-2', teacherName: 'Синтетический преподаватель',
  cityYear: 'Шымкент, 2026', goal: 'Проверить сохранение версии', tools: 'Node.js',
  procedure: 'Сдать работу', result: 'Квитанция', conclusion: 'Проверено', sources: ['Синтетический источник'],
  formatting: { version: 'v1.0-demo', isDemoDefaults: true, pageSize: 'A4', marginsMm: { top: 20, right: 10, bottom: 20, left: 30 }, fontFamily: 'Times New Roman', fontSizePt: 14, lineSpacing: 1.5, firstLineIndentCm: 1.25, hangingIndentCm: 1, showFrame: false, showPageNumbers: true },
};
const key = `smoke-${nonce}`;
const v1 = await request(`/api/assignments/${assignmentId}/submit`, student, 'POST', { idempotencyKey: key, snapshot });
assert.equal(v1.status, 201, JSON.stringify(v1.data));
const subId = v1.data.bundle.submission.id;
const duplicate = await request(`/api/assignments/${assignmentId}/submit`, student, 'POST', { idempotencyKey: key, snapshot });
assert.equal(duplicate.status, 200);
assert.equal(duplicate.data.receipt.id, v1.data.receipt.id);
const conflict = await request(`/api/assignments/${assignmentId}/submit`, student, 'POST', { idempotencyKey: key, snapshot: { ...snapshot, title: 'Иное содержимое' } });
assert.equal(conflict.status, 409);
const versionId = v1.data.bundle.versions[0].id;
const file = await fetch(`${base}/api/submissions/${subId}/versions/${versionId}/download`, { headers: { Authorization: `Bearer ${student}` } });
assert.equal(file.status, 200);
const digest = crypto.createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');
assert.equal(digest, v1.data.receipt.sha256Hex);
const teacherRead = await request(`/api/submissions/${subId}`, teacher);
assert.equal(teacherRead.status, 200);
const remark = await request(`/api/submissions/${subId}/remarks/draft`, teacher, 'POST', {
  versionNum: 1, pageNumber: 1, severity: 'mandatory', text: 'Синтетическое замечание', gostRule: 'TEST',
});
assert.equal(remark.status, 201, JSON.stringify(remark.data));
const returned = await request(`/api/submissions/${subId}/return`, teacher, 'POST', { resubmitDeadlineAt: new Date(Date.now() + 86400000).toISOString() });
assert.equal(returned.status, 200, JSON.stringify(returned.data));
const v2 = await request(`/api/assignments/${assignmentId}/submit`, student, 'POST', {
  idempotencyKey: `smoke-v2-${nonce}`, snapshot: { ...snapshot, title: 'Исправленная версия' },
  replies: [{ remarkId: remark.data.remark.id, replyText: 'Исправлено' }],
});
assert.equal(v2.status, 201, JSON.stringify(v2.data));
assert.equal(v2.data.bundle.versions.length, 2);
const blocked = await request(`/api/submissions/${subId}/approve`, teacher, 'POST');
assert.equal(blocked.status, 400);
const closed = await request(`/api/remarks/${remark.data.remark.id}/close`, teacher, 'POST');
assert.equal(closed.status, 200);
const approved = await request(`/api/submissions/${subId}/approve`, teacher, 'POST');
assert.equal(approved.status, 200, JSON.stringify(approved.data));
assert.equal(approved.data.bundle.submission.status, 'approved_in_system');
const concurrentAssignment = await request('/api/assignments', teacher, 'POST', {
  spaceId: space.id, groupId: space.groupId, code: `RACE-${nonce.slice(0, 8)}`,
  workType: 'Лабораторная', title: 'Синтетическая параллельная сдача',
  deadlineAt: new Date(Date.now() + 86400000).toISOString(), latePolicy: 'block_after_deadline',
});
assert.equal(concurrentAssignment.status, 201);
const raceId = concurrentAssignment.data.assignment.id;
const raceBody = { idempotencyKey: `race-${nonce}`, snapshot };
const raced = await Promise.all([
  request(`/api/assignments/${raceId}/submit`, student, 'POST', raceBody),
  request(`/api/assignments/${raceId}/submit`, student, 'POST', raceBody),
]);
assert.deepEqual(raced.map((r) => r.status).sort(), [200, 201]);
assert.equal(raced[0].data.receipt.id, raced[1].data.receipt.id);
assert.equal(raced[0].data.bundle.versions.length, 1);
console.log(JSON.stringify({ result: 'PASS', submissionId: subId, assignmentId, v1: v1.data.receipt.id, v2: v2.data.receipt.id }));
}
