import {
  AssignmentDTO,
  AuditLogDTO,
  DepartmentDTO,
  FacultyDTO,
  HealthInfoDTO,
  LabReportSnapshotDTO,
  LatePolicy,
  PublicUserDTO,
  QueueRowDTO,
  ReceiptDTO,
  RemarkDTO,
  RemarkSeverity,
  SpaceDTO,
  SpaceMaterialDTO,
  StudyGroupDTO,
  SubmissionBundleDTO,
  TeacherAssignmentDTO,
  UserRole,
  WorkType,
} from '../types';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class SessionExpiredError extends ApiError {
  constructor(message = 'Сессия истекла. Выполните повторный вход.') {
    super(message, 401, 'SESSION_EXPIRED');
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Доступ запрещён (403).') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NetworkOfflineError extends ApiError {
  constructor(message = 'Нет связи с сервером. Проверьте сеть и повторите попытку.') {
    super(message, 0, 'NETWORK_OFFLINE');
  }
}

// Auth token kept strictly in JS memory (never in localStorage/sessionStorage)
let memoryToken: string | null = null;

export function setAuthToken(token: string | null) {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

export function formatAlmatyDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Asia/Almaty',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return d.toLocaleString('ru-RU');
  }
}

export function formatAlmatyShortTime(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Asia/Almaty',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toTimeString().slice(0, 5);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new NetworkOfflineError();
  }

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (res.status === 401) {
    throw new SessionExpiredError(
      String(data.error || 'Сессия истекла. Выполните повторный вход.')
    );
  }
  if (res.status === 403) {
    throw new ForbiddenError(String(data.error || 'Доступ запрещён.'));
  }
  if (!res.ok) {
    throw new ApiError(
      String(data.error || `Ошибка сервера (${res.status})`),
      res.status,
      data.code ? String(data.code) : undefined
    );
  }
  return data as T;
}

async function downloadBlob(path: string, init: RequestInit, fallbackFileName: string) {
  const headers = new Headers(init.headers || {});
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new NetworkOfflineError();
  }

  if (res.status === 401) throw new SessionExpiredError();
  if (res.status === 403) throw new ForbiddenError();
  if (!res.ok) {
    const errText = await res.text();
    let msg = `Ошибка выгрузки (${res.status})`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.error) msg = String(parsed.error);
    } catch {
      // ignore
    }
    throw new ApiError(msg, res.status);
  }

  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') || '';
  const match = disp.match(/filename\*=UTF-8''([^;]+)/i);
  const fileName = match ? decodeURIComponent(match[1]) : fallbackFileName;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const api = {
  getHealth(): Promise<HealthInfoDTO> {
    return apiRequest<HealthInfoDTO>('/api/health');
  },

  getDemoAccounts(): Promise<{
    demoOnlyWarning: string;
    defaultPassword: string;
    accounts: PublicUserDTO[];
  }> {
    return apiRequest('/api/auth/demo-accounts');
  },

  async login(email: string, password: string): Promise<{ token: string; user: PublicUserDTO }> {
    const res = await apiRequest<{ token: string; user: PublicUserDTO }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(res.token);
    return res;
  },

  async logout(): Promise<void> {
    try {
      if (memoryToken) {
        await apiRequest('/api/auth/logout', { method: 'POST' });
      }
    } finally {
      setAuthToken(null);
    }
  },

  getMe(): Promise<{ user: PublicUserDTO }> {
    return apiRequest('/api/auth/me');
  },

  // Admin
  getAdminOverview(): Promise<{
    faculties: FacultyDTO[];
    departments: DepartmentDTO[];
    groups: StudyGroupDTO[];
    users: PublicUserDTO[];
    teacherAssignments: TeacherAssignmentDTO[];
  }> {
    return apiRequest('/api/admin/overview');
  },

  createGroup(input: {
    departmentId: string;
    name: string;
    yearLabel: string;
  }): Promise<{ group: StudyGroupDTO }> {
    return apiRequest('/api/admin/groups', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  createUser(input: {
    email: string;
    password: string;
    fullName: string;
    shortName: string;
    role: UserRole;
    groupId: string | null;
    departmentId: string | null;
  }): Promise<{ user: PublicUserDTO }> {
    return apiRequest('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  toggleUserActive(id: string, active: boolean): Promise<{ user: PublicUserDTO }> {
    return apiRequest(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    });
  },

  upsertTeacherAssignment(input: {
    teacherId: string;
    groupId: string;
    discipline: string;
    active: boolean;
  }): Promise<{ assignment: TeacherAssignmentDTO }> {
    return apiRequest('/api/admin/teacher-assignments', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  toggleTeacherAssignment(id: string, active: boolean): Promise<{ assignment: TeacherAssignmentDTO }> {
    return apiRequest(`/api/admin/teacher-assignments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    });
  },

  // Spaces & Assignments
  getSpaces(): Promise<{
    spaces: SpaceDTO[];
    materials: SpaceMaterialDTO[];
    groups: StudyGroupDTO[];
  }> {
    return apiRequest('/api/spaces');
  },

  createSpace(input: {
    groupId: string;
    title: string;
    discipline: string;
    pinnedAnnouncement: string;
  }): Promise<{ space: SpaceDTO }> {
    return apiRequest('/api/spaces', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateSpaceAnnouncement(id: string, pinnedAnnouncement: string): Promise<{ space: SpaceDTO }> {
    return apiRequest(`/api/spaces/${encodeURIComponent(id)}/announcement`, {
      method: 'PATCH',
      body: JSON.stringify({ pinnedAnnouncement }),
    });
  },

  addSpaceMaterial(
    spaceId: string,
    input: { title: string; description: string; urlOrNote: string }
  ): Promise<{ material: SpaceMaterialDTO }> {
    return apiRequest(`/api/spaces/${encodeURIComponent(spaceId)}/materials`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  getAssignments(): Promise<{ assignments: AssignmentDTO[] }> {
    return apiRequest('/api/assignments');
  },

  createAssignment(input: {
    spaceId: string;
    groupId: string;
    code: string;
    workType: WorkType;
    title: string;
    instructions: string;
    deadlineAt: string;
    latePolicy: LatePolicy;
    expectedFeedbackDate: string | null;
  }): Promise<{ assignment: AssignmentDTO }> {
    return apiRequest('/api/assignments', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  // Submissions & Queue
  getMySubmissions(): Promise<{ submissions: SubmissionBundleDTO[] }> {
    return apiRequest('/api/submissions/mine');
  },

  getQueue(filters: {
    groupId?: string;
    assignmentId?: string;
    workType?: string;
    status?: string;
    search?: string;
    minWaitHours?: number;
  } = {}): Promise<{ queue: QueueRowDTO[] }> {
    const params = new URLSearchParams();
    if (filters.groupId) params.set('groupId', filters.groupId);
    if (filters.assignmentId) params.set('assignmentId', filters.assignmentId);
    if (filters.workType) params.set('workType', filters.workType);
    if (filters.status) params.set('status', filters.status);
    if (filters.search) params.set('search', filters.search);
    if (filters.minWaitHours) params.set('minWaitHours', String(filters.minWaitHours));
    const q = params.toString();
    return apiRequest(`/api/submissions/queue${q ? `?${q}` : ''}`);
  },

  claimNextSubmission(): Promise<{ row: QueueRowDTO }> {
    return apiRequest('/api/submissions/queue/claim-next', { method: 'POST' });
  },

  getSubmissionBundle(id: string): Promise<{ bundle: SubmissionBundleDTO }> {
    return apiRequest(`/api/submissions/${encodeURIComponent(id)}`);
  },

  submitBuilderSnapshot(
    assignmentId: string,
    input: {
      idempotencyKey: string;
      snapshot: LabReportSnapshotDTO;
      replies?: { remarkId: string; replyText: string }[];
    }
  ): Promise<{ bundle: SubmissionBundleDTO; receipt: ReceiptDTO; deduplicated: boolean }> {
    return apiRequest(`/api/assignments/${encodeURIComponent(assignmentId)}/submit`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  submitFileWithProgress(
    assignmentId: string,
    input: {
      file: File;
      idempotencyKey: string;
      replies?: { remarkId: string; replyText: string }[];
      simulateFailure?: boolean;
      onProgress?: (pct: number) => void;
    }
  ): Promise<{ bundle: SubmissionBundleDTO; receipt: ReceiptDTO; deduplicated: boolean }> {
    return new Promise((resolve, reject) => {
      if (input.simulateFailure) {
        let pct = 15;
        input.onProgress?.(pct);
        const timer = setInterval(() => {
          pct += 20;
          if (pct >= 55) {
            clearInterval(timer);
            input.onProgress?.(55);
            reject(
              new NetworkOfflineError(
                'Смоделированный сбой сети на 55% загрузки. Проверьте статус сдачи перед повтором.'
              )
            );
            return;
          }
          input.onProgress?.(pct);
        }, 120);
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/assignments/${encodeURIComponent(assignmentId)}/submit`);
      if (memoryToken) {
        xhr.setRequestHeader('Authorization', `Bearer ${memoryToken}`);
      }

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && evt.total > 0) {
          input.onProgress?.(Math.min(99, Math.round((evt.loaded / evt.total) * 100)));
        }
      };

      xhr.onerror = () => {
        reject(new NetworkOfflineError());
      };

      xhr.onload = () => {
        input.onProgress?.(100);
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(xhr.responseText || '{}');
        } catch {
          parsed = { error: xhr.responseText };
        }
        if (xhr.status === 401) {
          reject(new SessionExpiredError());
          return;
        }
        if (xhr.status === 403) {
          reject(new ForbiddenError(String(parsed.error || 'Доступ запрещён.')));
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new ApiError(String(parsed.error || 'Ошибка загрузки файла.'), xhr.status));
          return;
        }
        resolve(
          parsed as { bundle: SubmissionBundleDTO; receipt: ReceiptDTO; deduplicated: boolean }
        );
      };

      const form = new FormData();
      form.append('idempotencyKey', input.idempotencyKey);
      if (input.replies && input.replies.length > 0) {
        form.append('replies', JSON.stringify(input.replies));
      }
      form.append('file', input.file);
      xhr.send(form);
    });
  },

  downloadSubmissionVersion(submissionId: string, versionId: string, fileName: string) {
    return downloadBlob(
      `/api/submissions/${encodeURIComponent(submissionId)}/versions/${encodeURIComponent(versionId)}/download`,
      { method: 'GET' },
      fileName
    );
  },
  async getSubmissionVersionBlob(submissionId: string, versionId: string): Promise<Blob> {
    const headers = new Headers();
    if (memoryToken) headers.set('Authorization', `Bearer ${memoryToken}`);
    const res = await fetch(`/api/submissions/${encodeURIComponent(submissionId)}/versions/${encodeURIComponent(versionId)}/download`, { headers });
    if (res.status === 401) throw new SessionExpiredError();
    if (res.status === 403) throw new ForbiddenError();
    if (!res.ok) throw new ApiError(`Документ недоступен (${res.status})`, res.status);
    return res.blob();
  },

  // Review & Remarks
  addDraftRemark(
    submissionId: string,
    input: {
      versionNum: number;
      pageNumber: number;
      xNorm: number | null;
      yNorm: number | null;
      severity: RemarkSeverity;
      gostRule: string;
      text: string;
    }
  ): Promise<{ remark: RemarkDTO }> {
    return apiRequest(`/api/submissions/${encodeURIComponent(submissionId)}/remarks/draft`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  publishReturnPackage(
    submissionId: string,
    resubmitDeadlineAt: string | null
  ): Promise<{ bundle: SubmissionBundleDTO }> {
    return apiRequest(`/api/submissions/${encodeURIComponent(submissionId)}/return`, {
      method: 'POST',
      body: JSON.stringify({ resubmitDeadlineAt }),
    });
  },

  closeRemark(remarkId: string): Promise<{ remark: RemarkDTO }> {
    return apiRequest(`/api/remarks/${encodeURIComponent(remarkId)}/close`, {
      method: 'POST',
    });
  },

  approveSubmission(submissionId: string): Promise<{ bundle: SubmissionBundleDTO }> {
    return apiRequest(`/api/submissions/${encodeURIComponent(submissionId)}/approve`, {
      method: 'POST',
    });
  },

  // Builder DOCX & PDF export
  exportLabDocx(snapshot: LabReportSnapshotDTO) {
    return downloadBlob(
      '/api/builder/export-docx',
      { method: 'POST', body: JSON.stringify({ snapshot }) },
      `Lab_${snapshot.labNumber || '1'}_NormControl.docx`
    );
  },

  exportLabPdf(snapshot: LabReportSnapshotDTO) {
    return downloadBlob(
      '/api/builder/export-pdf',
      { method: 'POST', body: JSON.stringify({ snapshot }) },
      `Lab_${snapshot.labNumber || '1'}_NormControl.pdf`
    );
  },

  getAuditLogs(): Promise<{ logs: AuditLogDTO[] }> {
    return apiRequest('/api/audit-logs');
  },
};
