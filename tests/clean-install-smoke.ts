// Exercise the complete workflow against an isolated, initially empty PostgreSQL project.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const base = process.env.CLEAN_BASE_URL;
const adminEmail = process.env.CLEAN_ADMIN_EMAIL;
const adminPassword = process.env.CLEAN_ADMIN_PASSWORD;
if (!base || !/^http:\/\/localhost:\d+$/.test(base) || !adminEmail || !adminPassword) {
  throw new Error('Set CLEAN_BASE_URL to localhost and CLEAN_ADMIN_EMAIL/CLEAN_ADMIN_PASSWORD for an isolated project.');
}
const nonce = crypto.randomUUID().slice(0, 8);
type Auth = { cookie: string; csrfToken: string };

async function request(route: string, auth: Auth | null = null, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrfToken } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { status: response.status, data, headers: response.headers };
}
async function login(email: string, password: string): Promise<Auth> {
  const result = await request('/api/auth/login', null, 'POST', { email, password });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.token, undefined);
  const cookie = result.headers.get('set-cookie');
  assert.ok(cookie);
  return { cookie: cookie.split(';')[0], csrfToken: result.data.csrfToken };
}
async function created(route: string, auth: Auth, body: Record<string, unknown>, key: string) {
  const result = await request(route, auth, 'POST', body);
  assert.equal(result.status, 201, `${route}: ${JSON.stringify(result.data)}`);
  return result.data[key];
}

const health = await request('/api/health');
assert.equal(health.status, 200);
assert.equal(health.data.mode, 'postgresql');
const admin = await login(adminEmail, adminPassword);
const faculty = await created('/api/admin/faculties', admin, { name: `Faculty ${nonce}`, code: `F${nonce}` }, 'faculty');
const department = await created('/api/admin/departments', admin, { facultyId: faculty.id, name: `Department ${nonce}`, code: `D${nonce}` }, 'department');
const group = await created('/api/admin/groups', admin, { departmentId: department.id, name: `Group ${nonce}`, yearLabel: '2026–2027' }, 'group');
const teacherPassword = crypto.randomBytes(24).toString('base64url');
const studentPassword = crypto.randomBytes(24).toString('base64url');
const teacherEmail = `teacher-${nonce}@example.test`;
const studentEmail = `student-${nonce}@example.test`;
const teacher = await created('/api/admin/users', admin, { email: teacherEmail, password: teacherPassword, fullName: 'Test Teacher', role: 'teacher', departmentId: department.id }, 'user');
const student = await created('/api/admin/users', admin, { email: studentEmail, password: studentPassword, fullName: 'Test Student', role: 'student', groupId: group.id }, 'user');
await created('/api/admin/teacher-assignments', admin, { teacherId: teacher.id, groupId: group.id, discipline: 'Integration test' }, 'assignment');
const teacherAuth = await login(teacherEmail, teacherPassword);
const studentAuth = await login(studentEmail, studentPassword);
const space = await created('/api/spaces', teacherAuth, { groupId: group.id, title: 'Integration space', discipline: 'Integration test' }, 'space');
const assignment = await created('/api/assignments', teacherAuth, {
  spaceId: space.id, groupId: group.id, code: `QA-${nonce}`, workType: 'Лабораторная', title: 'Integration work',
  instructions: 'Submit a report', deadlineAt: new Date(Date.now() + 86400000).toISOString(), latePolicy: 'allow_late',
}, 'assignment');
assert.equal(assignment.templateVersion, 'editable-1');
const snapshot = {
  templateVersion: 'editable-1', docLang: 'Русский', university: 'Integration organization', department: 'Integration department', discipline: 'Integration test',
  labNumber: '1', title: 'Integration report', studentName: 'Test Student', studentGroup: group.name, teacherName: 'Test Teacher', cityYear: '2026',
  goal: 'Verify the workflow', tools: 'Node.js', procedure: 'Submit version one', result: 'Receipt', conclusion: 'Complete', sources: [],
  formatting: { version: 'editable-1', pageSize: 'A4', marginsMm: { top: 20, right: 10, bottom: 20, left: 30 }, fontFamily: 'Times New Roman', fontSizePt: 14, lineSpacing: 1.5, firstLineIndentCm: 1.25, hangingIndentCm: 1, showFrame: false, showPageNumbers: true },
};
const draft = await request(`/api/assignments/${assignment.id}/draft`, studentAuth, 'PUT', { snapshot, replies: {}, mode: 'builder', idempotencyKey: `draft-${nonce}` });
assert.equal(draft.status, 200);
const v1 = await request(`/api/assignments/${assignment.id}/submit`, studentAuth, 'POST', { idempotencyKey: `v1-${nonce}`, snapshot });
assert.equal(v1.status, 201, JSON.stringify(v1.data));
const submissionId = v1.data.bundle.submission.id;
const download = await fetch(`${base}/api/submissions/${submissionId}/versions/${v1.data.bundle.versions[0].id}/download`, { headers: { Cookie: studentAuth.cookie } });
assert.equal(download.status, 200);
assert.equal(crypto.createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'), v1.data.receipt.sha256Hex);
const adminDenied = await request(`/api/submissions/${submissionId}`, admin);
assert.equal(adminDenied.status, 403);
const remark = await created(`/api/submissions/${submissionId}/remarks/draft`, teacherAuth, { versionNum: 1, pageNumber: 1, severity: 'mandatory', gostRule: 'Assignment requirements', text: 'Revise the conclusion' }, 'remark');
const returned = await request(`/api/submissions/${submissionId}/return`, teacherAuth, 'POST', {});
assert.equal(returned.status, 200);
const v2 = await request(`/api/assignments/${assignment.id}/submit`, studentAuth, 'POST', { idempotencyKey: `v2-${nonce}`, snapshot: { ...snapshot, conclusion: 'Revised conclusion' }, replies: [{ remarkId: remark.id, replyText: 'Updated' }] });
assert.equal(v2.status, 201, JSON.stringify(v2.data));
assert.equal((await request(`/api/submissions/${submissionId}/approve`, teacherAuth, 'POST', {})).status, 400);
assert.equal((await request(`/api/remarks/${remark.id}/close`, teacherAuth, 'POST', {})).status, 200);
const approved = await request(`/api/submissions/${submissionId}/approve`, teacherAuth, 'POST', {});
assert.equal(approved.status, 200, JSON.stringify(approved.data));
assert.equal(approved.data.bundle.submission.status, 'approved_in_system');
console.log(JSON.stringify({ result: 'PASS_CLEAN_INSTALL', submissionId, versions: approved.data.bundle.versions.length, receipts: approved.data.bundle.receipts.length }));
