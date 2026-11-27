import React, { useEffect, useState } from 'react';
import { api, ApiError, formatAlmatyDateTime } from '../api/client';
import {
  AuditLogDTO,
  DepartmentDTO,
  FacultyDTO,
  PublicUserDTO,
  RoleNavTab,
  StudyGroupDTO,
  TeacherAssignmentDTO,
  UserRole,
} from '../types';

interface AdminWorkspaceProps {
  activeTab: RoleNavTab;
  onShowToast: (text: string, tone?: 'success' | 'info' | 'warning' | 'error') => void;
  onAuthError: (err: unknown) => void;
}

export const AdminWorkspace: React.FC<AdminWorkspaceProps> = ({
  activeTab,
  onShowToast,
  onAuthError,
}) => {
  const [loading, setLoading] = useState(true);
  const [faculties, setFaculties] = useState<FacultyDTO[]>([]);
  const [departments, setDepartments] = useState<DepartmentDTO[]>([]);
  const [groups, setGroups] = useState<StudyGroupDTO[]>([]);
  const [users, setUsers] = useState<PublicUserDTO[]>([]);
  const [assignments, setAssignments] = useState<TeacherAssignmentDTO[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogDTO[]>([]);
  const [forbiddenTestResult, setForbiddenTestResult] = useState<string | null>(null);

  // Forms
  const [groupName, setGroupName] = useState('');
  const [groupYear, setGroupYear] = useState('2023–2024');
  const [userEmail, setUserEmail] = useState('');
  const [userFullName, setUserFullName] = useState('');
  const [userRole, setUserRole] = useState<UserRole>('student');
  const [userGroupId, setUserGroupId] = useState('grp-is-21-2');
  const [userPassword, setUserPassword] = useState('');

  const [taTeacherId, setTaTeacherId] = useState('usr-teacher-1');
  const [taGroupId, setTaGroupId] = useState('grp-vt-20');
  const [taDiscipline, setTaDiscipline] = useState('Нормоконтроль документации');

  const loadData = async () => {
    setLoading(true);
    try {
      const [ov, aud] = await Promise.all([api.getAdminOverview(), api.getAuditLogs()]);
      setFaculties(ov.faculties);
      setDepartments(ov.departments);
      setGroups(ov.groups);
      setUsers(ov.users);
      setAssignments(ov.teacherAssignments);
      setAuditLogs(aud.logs);
    } catch (err) {
      onAuthError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;
    try {
      await api.createGroup({
        departmentId: departments[0]?.id || 'dep-is',
        name: groupName.trim(),
        yearLabel: groupYear.trim(),
      });
      setGroupName('');
      onShowToast('Учебная группа создана.', 'success');
      await loadData();
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Ошибка создания группы', 'error');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createUser({
        email: userEmail.trim(),
        password: userPassword,
        fullName: userFullName.trim(),
        shortName: userFullName.trim(),
        role: userRole,
        groupId: userRole === 'student' ? userGroupId : null,
        departmentId: departments[0]?.id || 'dep-is',
      });
      setUserEmail('');
      setUserFullName('');
      setUserPassword('');
      onShowToast('Учётная запись создана.', 'success');
      await loadData();
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Ошибка создания пользователя', 'error');
    }
  };

  const handleToggleUser = async (u: PublicUserDTO) => {
    try {
      await api.toggleUserActive(u.id, !u.active);
      onShowToast(
        `${u.email}: ${!u.active ? 'активирован' : 'отключён'}.`,
        'info'
      );
      await loadData();
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Ошибка обновления', 'error');
    }
  };

  const handleAssignTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.upsertTeacherAssignment({
        teacherId: taTeacherId,
        groupId: taGroupId,
        discipline: taDiscipline.trim(),
        active: true,
      });
      onShowToast('Назначение преподавателя сохранено.', 'success');
      await loadData();
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Ошибка назначения', 'error');
    }
  };

  const handleToggleAssignment = async (ta: TeacherAssignmentDTO) => {
    try {
      await api.toggleTeacherAssignment(ta.id, !ta.active);
      onShowToast(
        !ta.active
          ? 'Назначение восстановлено.'
          : 'Назначение отозвано — доступ преподавателя к группе заблокирован.',
        'warning'
      );
      await loadData();
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Ошибка переключения', 'error');
    }
  };

  const handleVerifyAdminDocRestriction = async () => {
    try {
      await api.getSubmissionBundle('sub-demo-1');
      setForbiddenTestResult('ОШИБКА: сервер неожиданно выдал документ администратору.');
    } catch (err) {
      setForbiddenTestResult(err instanceof ApiError && err.status === 403
        ? 'Подтверждено: сервер запретил чтение работы (HTTP 403).'
        : `Проверка не выполнена: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`);
    }
  };

  if (loading) {
    return (
      <div className="bg-surface-container-lowest rounded-xl p-8 text-center text-[14px] text-on-surface-variant">
        Загрузка структуры и ролевой матрицы...
      </div>
    );
  }

  const teachers = users.filter((u) => u.role === 'teacher');

  return (
    <div className="flex flex-col gap-6">
      {/* Privacy boundary banner */}
      <div className="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="material-symbols-outlined text-primary mt-0.5">shield_lock</span>
          <div className="text-[13px] min-w-0">
            <p className="font-semibold text-on-surface">
              Контур администратора: структура, учётные записи и назначения
            </p>
            <p className="text-on-surface-variant text-[12px]">
              Администратор не может открывать, просматривать или скачивать файлы студенческих работ (строгая изоляция HTTP 403 на сервере).
            </p>
            {forbiddenTestResult && (
              <p className="text-[12px] font-mono text-secondary mt-1">{forbiddenTestResult}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleVerifyAdminDocRestriction}
          className="px-3 py-1.5 rounded-lg bg-surface-container-low border border-outline-variant text-[12px] font-semibold cursor-pointer shrink-0"
        >
          Проверить запрет на документы (403)
        </button>
      </div>

      {activeTab === 'admin_structure' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/50 flex flex-col gap-4">
            <h2 className="font-display font-bold text-[17px]">Факультет, кафедра и учебные группы</h2>
            <div className="space-y-2 text-[13px]">
              {faculties.map((f) => (
                <div key={f.id} className="bg-surface-container-low rounded-lg p-3">
                  <p className="font-bold text-primary">
                    {f.code} · {f.name}
                  </p>
                  {departments
                    .filter((d) => d.facultyId === f.id)
                    .map((d) => (
                      <p key={d.id} className="text-[12px] text-on-surface-variant mt-1">
                        Кафедра: {d.name} ({d.code})
                      </p>
                    ))}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="rounded-lg border border-outline-variant/50 p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="font-mono font-bold text-[14px] text-primary">{g.name}</p>
                    <p className="text-[12px] text-on-surface-variant">{g.yearLabel}</p>
                  </div>
                  <span className="text-[11px] font-mono text-on-surface-variant">
                    {users.filter((u) => u.groupId === g.id).length} студ.
                  </span>
                </div>
              ))}
            </div>
          </div>

          <form
            onSubmit={handleCreateGroup}
            className="lg:col-span-5 bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/50 flex flex-col gap-4"
          >
            <h3 className="font-display font-bold text-[16px]">Добавить учебную группу</h3>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Код группы</span>
              <input
                type="password"
                required
                minLength={12}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Например: ИС-22-1"
                className="rounded-lg border border-outline-variant px-3 py-2 text-[14px]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Учебный год</span>
              <input
                type="text"
                value={groupYear}
                onChange={(e) => setGroupYear(e.target.value)}
                className="rounded-lg border border-outline-variant px-3 py-2 text-[14px]"
              />
            </label>
            <button
              type="submit"
              className="bg-primary text-on-primary font-semibold py-2 px-4 rounded-lg cursor-pointer"
            >
              Создать группу
            </button>
          </form>
        </div>
      )}

      {activeTab === 'admin_accounts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/50 flex flex-col gap-3">
            <h2 className="font-display font-bold text-[17px]">Учётные записи пользователей</h2>
            <div className="divide-y divide-outline-variant/40">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="py-3 flex flex-wrap items-center justify-between gap-2 text-[13px]"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-on-surface break-words">
                      {u.fullName}{' '}
                      <span className="text-[11px] font-mono text-primary">[{u.role}]</span>
                    </p>
                    <p className="text-[12px] font-mono text-on-surface-variant break-all">
                      {u.email} {u.groupName ? `· Группа ${u.groupName}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleUser(u)}
                    className={`px-3 py-1 rounded-lg text-[12px] font-semibold cursor-pointer ${
                      u.active
                        ? 'bg-secondary-fixed text-on-secondary-fixed'
                        : 'bg-error-container text-on-error-container'
                    }`}
                  >
                    {u.active ? 'Активен (откл.)' : 'Отключён (вкл.)'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <form
            onSubmit={handleCreateUser}
            className="lg:col-span-5 bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/50 flex flex-col gap-3"
          >
            <h3 className="font-display font-bold text-[16px]">Создать учётную запись</h3>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>ФИО полностью</span>
              <input
                type="text"
                required
                value={userFullName}
                onChange={(e) => setUserFullName(e.target.value)}
                placeholder="Серикбаев Данияр"
                className="rounded-lg border border-outline-variant px-3 py-2 text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Email</span>
              <input
                type="email"
                required
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="user@normocontrol.local"
                className="rounded-lg border border-outline-variant px-3 py-2 text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Роль</span>
              <select
                value={userRole}
                onChange={(e) => setUserRole(e.target.value as UserRole)}
                className="rounded-lg border border-outline-variant px-3 py-2 text-[13px] bg-white"
              >
                <option value="student">Студент</option>
                <option value="teacher">Преподаватель</option>
                <option value="admin">Администратор</option>
              </select>
            </label>
            {userRole === 'student' && (
              <label className="flex flex-col gap-1 text-[13px] font-medium">
                <span>Учебная группа</span>
                <select
                  value={userGroupId}
                  onChange={(e) => setUserGroupId(e.target.value)}
                  className="rounded-lg border border-outline-variant px-3 py-2 text-[13px] bg-white"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Начальный пароль</span>
              <input
                type="text"
                required
                value={userPassword}
                onChange={(e) => setUserPassword(e.target.value)}
                className="rounded-lg border border-outline-variant px-3 py-2 text-[13px] font-mono"
              />
            </label>
            <button
              type="submit"
              className="bg-primary text-on-primary font-semibold py-2 px-4 rounded-lg cursor-pointer mt-1"
            >
              Создать пользователя
            </button>
          </form>
        </div>
      )}

      {activeTab === 'admin_assignments' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/50 flex flex-col gap-4">
            <h2 className="font-display font-bold text-[17px]">
              Назначения преподавателей на группы
            </h2>
            <div className="divide-y divide-outline-variant/40">
              {assignments.map((ta) => {
                const t = users.find((u) => u.id === ta.teacherId);
                const g = groups.find((x) => x.id === ta.groupId);
                return (
                  <div
                    key={ta.id}
                    className="py-3 flex flex-wrap items-center justify-between gap-2 text-[13px]"
                  >
                    <div>
                      <p className="font-semibold">
                        {t?.fullName || ta.teacherId} →{' '}
                        <span className="font-mono text-primary">{g?.name || ta.groupId}</span>
                      </p>
                      <p className="text-[12px] text-on-surface-variant">{ta.discipline}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleAssignment(ta)}
                      className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer ${
                        ta.active
                          ? 'bg-secondary text-on-secondary'
                          : 'bg-error-container text-on-error-container'
                      }`}
                    >
                      {ta.active ? 'Активно (Отозвать)' : 'Отозвано (Восстановить)'}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Recent Audit trail */}
            <div className="mt-2 pt-4 border-t border-outline-variant/40">
              <h3 className="text-[13px] font-bold uppercase text-on-surface-variant mb-2">
                Журнал административных и учебных событий
              </h3>
              <div className="space-y-1.5 max-h-56 overflow-y-auto text-[12px]">
                {auditLogs.slice(0, 12).map((log) => (
                  <div
                    key={log.id}
                    className="bg-surface-container-low rounded px-3 py-2 flex flex-wrap justify-between gap-2"
                  >
                    <span>
                      <strong className="text-primary">{log.actorName}</strong>: {log.action}
                    </span>
                    <span className="font-mono text-[11px] text-on-surface-variant">
                      {formatAlmatyDateTime(log.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <form
            onSubmit={handleAssignTeacher}
            className="lg:col-span-5 bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/50 flex flex-col gap-3"
          >
            <h3 className="font-display font-bold text-[16px]">Назначить преподавателя на группу</h3>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Преподаватель</span>
              <select
                value={taTeacherId}
                onChange={(e) => setTaTeacherId(e.target.value)}
                className="rounded-lg border border-outline-variant px-3 py-2 text-[13px] bg-white"
              >
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Группа</span>
              <select
                value={taGroupId}
                onChange={(e) => setTaGroupId(e.target.value)}
                className="rounded-lg border border-outline-variant px-3 py-2 text-[13px] bg-white"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Дисциплина</span>
              <input
                type="text"
                required
                value={taDiscipline}
                onChange={(e) => setTaDiscipline(e.target.value)}
                className="rounded-lg border border-outline-variant px-3 py-2 text-[13px]"
              />
            </label>
            <button
              type="submit"
              className="bg-primary text-on-primary font-semibold py-2 px-4 rounded-lg cursor-pointer mt-1"
            >
              Назначить доступ
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
