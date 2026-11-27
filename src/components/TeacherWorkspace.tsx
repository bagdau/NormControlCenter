import React, { useEffect, useState } from 'react';
import { api, formatAlmatyDateTime } from '../api/client';
import {
  AssignmentDTO,
  LatePolicy,
  PublicUserDTO,
  QueueRowDTO,
  RemarkSeverity,
  RoleNavTab,
  SpaceDTO,
  SpaceMaterialDTO,
  StudyGroupDTO,
  SubmissionBundleDTO,
  SubmissionVersionDTO,
  WorkType,
} from '../types';
import { DocumentPinViewer } from './DocumentPinViewer';

interface TeacherWorkspaceProps {
  user: PublicUserDTO;
  activeTab: RoleNavTab;
  onNavigateTab: (tab: RoleNavTab) => void;
  onShowToast: (text: string, tone?: 'success' | 'info' | 'warning' | 'error') => void;
  onAuthError: (err: unknown) => void;
}

const STATUS_TEXT: Record<string, string> = {
  submitted: 'Первая сдача',
  in_review: 'На проверке',
  revision_needed: 'Возвращено на доработку',
  resubmitted: 'Повторная сдача (v2+)',
  approved_in_system: 'Согласовано в системе',
};

export const TeacherWorkspace: React.FC<TeacherWorkspaceProps> = ({
  activeTab,
  onNavigateTab,
  onShowToast,
  onAuthError,
}) => {
  const [loading, setLoading] = useState(true);
  const [spaces, setSpaces] = useState<SpaceDTO[]>([]);
  const [materials, setMaterials] = useState<SpaceMaterialDTO[]>([]);
  const [groups, setGroups] = useState<StudyGroupDTO[]>([]);
  const [assignments, setAssignments] = useState<AssignmentDTO[]>([]);
  const [queue, setQueue] = useState<QueueRowDTO[]>([]);

  // Filters
  const [filterGroup, setFilterGroup] = useState('all');
  const [filterAssignment, setFilterAssignment] = useState('all');
  const [filterWorkType, setFilterWorkType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterMinWait, setFilterMinWait] = useState('0');
  const [searchText, setSearchText] = useState('');

  // Review state
  const [activeBundle, setActiveBundle] = useState<SubmissionBundleDTO | null>(null);
  const [viewerVersionNum, setViewerVersionNum] = useState<number>(1);
  const [viewerPage, setViewerPage] = useState<number>(1);
  const [pendingPin, setPendingPin] = useState<{
    pageNumber: number;
    xNorm: number;
    yNorm: number;
  } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  // Draft remark form
  const [remSeverity, setRemSeverity] = useState<RemarkSeverity>('mandatory');
  const [remGostRule, setRemGostRule] = useState('ГОСТ 7.32-2017 п. 6.1');
  const [remText, setRemText] = useState('');
  const [resubmitDateLocal, setResubmitDateLocal] = useState('');

  // Space & Assignment Creation
  const [newAnnouncement, setNewAnnouncement] = useState<Record<string, string>>({});
  const [matTitle, setMatTitle] = useState('');
  const [matDesc, setMatDesc] = useState('');
  const [matNote, setMatNote] = useState('');

  const [asgCode, setAsgCode] = useState('ЛР-02-ИС');
  const [asgWorkType, setAsgWorkType] = useState<WorkType>('Лабораторная');
  const [asgTitle, setAsgTitle] = useState('');
  const [asgInstructions, setAsgInstructions] = useState('');
  const [asgGroupId, setAsgGroupId] = useState('');
  const [asgDeadlineLocal, setAsgDeadlineLocal] = useState('');
  const [asgLatePolicy, setAsgLatePolicy] = useState<LatePolicy>('allow_late');
  const [asgExpectedFeedback, setAsgExpectedFeedback] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [sp, asg, q] = await Promise.all([
        api.getSpaces(),
        api.getAssignments(),
        api.getQueue({
          groupId: filterGroup,
          assignmentId: filterAssignment,
          workType: filterWorkType,
          status: filterStatus,
          minWaitHours: Number(filterMinWait || 0),
          search: searchText,
        }),
      ]);
      setSpaces(sp.spaces);
      setMaterials(sp.materials);
      setGroups(sp.groups);
      setAssignments(asg.assignments);
      setQueue(q.queue);
      if (!asgGroupId && sp.groups[0]) {
        setAsgGroupId(sp.groups[0].id);
      }
      const annMap: Record<string, string> = {};
      sp.spaces.forEach((s) => {
        annMap[s.id] = s.pinnedAnnouncement;
      });
      setNewAnnouncement(annMap);
    } catch (err) {
      onAuthError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterGroup, filterAssignment, filterWorkType, filterStatus, filterMinWait]);

  const openSubmissionInReview = async (submissionId: string) => {
    try {
      const res = await api.getSubmissionBundle(submissionId);
      setActiveBundle(res.bundle);
      setViewerVersionNum(res.bundle.submission.currentVersionNum);
      setViewerPage(1);
      setPendingPin(null);
      onNavigateTab('teacher_review');
    } catch (err) {
      onAuthError(err);
      onShowToast(err instanceof Error ? err.message : 'Ошибка открытия работы', 'error');
    }
  };

  const handleClaimNext = async () => {
    try {
      const res = await api.claimNextSubmission();
      onShowToast(
        `Взята работа ${res.row.assignment.code} (${res.row.student.shortName})`,
        'success'
      );
      await loadAll();
      await openSubmissionInReview(res.row.submission.id);
    } catch (err) {
      onAuthError(err);
      onShowToast(err instanceof Error ? err.message : 'Нет свободных работ', 'warning');
    }
  };

  const handleAddDraftRemark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBundle || !remText.trim()) return;
    try {
      await api.addDraftRemark(activeBundle.submission.id, {
        versionNum: viewerVersionNum,
        pageNumber: pendingPin?.pageNumber || viewerPage,
        xNorm: pendingPin?.xNorm ?? null,
        yNorm: pendingPin?.yNorm ?? null,
        severity: remSeverity,
        gostRule: remGostRule.trim() || 'ГОСТ 7.32-2017',
        text: remText.trim(),
      });
      setRemText('');
      setPendingPin(null);
      const updated = await api.getSubmissionBundle(activeBundle.submission.id);
      setActiveBundle(updated.bundle);
      onShowToast('Замечание добавлено в скрытый черновик пакета.', 'success');
    } catch (err) {
      onAuthError(err);
      onShowToast(err instanceof Error ? err.message : 'Ошибка добавления', 'error');
    }
  };

  const handlePublishReturn = async () => {
    if (!activeBundle) return;
    try {
      const isoResubmit = resubmitDateLocal
        ? new Date(resubmitDateLocal).toISOString()
        : null;
      const res = await api.publishReturnPackage(activeBundle.submission.id, isoResubmit);
      setActiveBundle(res.bundle);
      await loadAll();
      onShowToast('Пакет замечаний опубликован, работа возвращена студенту.', 'success');
    } catch (err) {
      onAuthError(err);
      onShowToast(err instanceof Error ? err.message : 'Ошибка возврата', 'error');
    }
  };

  const handleCloseRemark = async (remarkId: string) => {
    if (!activeBundle) return;
    try {
      await api.closeRemark(remarkId);
      const res = await api.getSubmissionBundle(activeBundle.submission.id);
      setActiveBundle(res.bundle);
      await loadAll();
      onShowToast('Пункт замечания закрыт.', 'success');
    } catch (err) {
      onAuthError(err);
      onShowToast(err instanceof Error ? err.message : 'Ошибка закрытия', 'error');
    }
  };

  const handleApproveInSystem = async () => {
    if (!activeBundle) return;
    try {
      const res = await api.approveSubmission(activeBundle.submission.id);
      setActiveBundle(res.bundle);
      await loadAll();
      onShowToast('Работа переведена в статус «Согласовано в системе».', 'success');
    } catch (err) {
      onAuthError(err);
      onShowToast(err instanceof Error ? err.message : 'Ошибка согласования', 'error');
    }
  };

  const handleSaveAnnouncement = async (spaceId: string) => {
    try {
      await api.updateSpaceAnnouncement(spaceId, newAnnouncement[spaceId] || '');
      onShowToast('Закреплённое объявление обновлено.', 'success');
      await loadAll();
    } catch (err) {
      onAuthError(err);
      onShowToast(err instanceof Error ? err.message : 'Ошибка сохранения', 'error');
    }
  };

  const handleAddMaterial = async (spaceId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!matTitle.trim()) return;
    try {
      await api.addSpaceMaterial(spaceId, {
        title: matTitle.trim(),
        description: matDesc.trim(),
        urlOrNote: matNote.trim(),
      });
      setMatTitle('');
      setMatDesc('');
      setMatNote('');
      onShowToast('Материал добавлен в пространство.', 'success');
      await loadAll();
    } catch (err) {
      onAuthError(err);
      onShowToast(err instanceof Error ? err.message : 'Ошибка добавления материала', 'error');
    }
  };

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetSpace = spaces.find((s) => s.groupId === asgGroupId) || spaces[0];
    if (!targetSpace || !asgTitle.trim() || !asgDeadlineLocal) {
      onShowToast('Укажите группу, название задания и дедлайн.', 'warning');
      return;
    }
    try {
      await api.createAssignment({
        spaceId: targetSpace.id,
        groupId: asgGroupId || targetSpace.groupId,
        code: asgCode.trim(),
        workType: asgWorkType,
        title: asgTitle.trim(),
        instructions: asgInstructions.trim(),
        deadlineAt: new Date(asgDeadlineLocal).toISOString(),
        latePolicy: asgLatePolicy,
        expectedFeedbackDate: asgExpectedFeedback
          ? new Date(asgExpectedFeedback).toISOString()
          : null,
      });
      setAsgTitle('');
      setAsgInstructions('');
      onShowToast('Задание создано и открыто для группы.', 'success');
      await loadAll();
    } catch (err) {
      onAuthError(err);
      onShowToast(err instanceof Error ? err.message : 'Ошибка создания задания', 'error');
    }
  };

  const handleDownloadVersion = async (subId: string, ver: SubmissionVersionDTO) => {
    try {
      await api.downloadSubmissionVersion(subId, ver.id, ver.fileName);
    } catch (err) {
      onAuthError(err);
      onShowToast(err instanceof Error ? err.message : 'Ошибка скачивания', 'error');
    }
  };

  if (loading && spaces.length === 0 && queue.length === 0) {
    return (
      <div className="bg-surface-container-lowest rounded-xl p-8 text-center text-[14px] text-on-surface-variant">
        Загрузка рабочего места преподавателя...
      </div>
    );
  }

  // Remarks panel component shared between desktop side-by-side & mobile/tablet-portrait drawer
  const renderReviewRemarksPanel = () => {
    if (!activeBundle) return null;
    const draftPkg = activeBundle.packages.find(
      (p) => p.status === 'draft' && p.versionNum === viewerVersionNum
    );
    const publishedPkgs = activeBundle.packages.filter((p) => p.status === 'published');
    const openMandatoryExists = publishedPkgs.some((p) =>
      p.remarks.some((r) => r.severity === 'mandatory' && r.status !== 'closed')
    );

    return (
      <div className="flex flex-col gap-4">
        <div className="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/50 flex flex-col gap-2">
          <div className="flex flex-wrap justify-between gap-2 text-[12px]">
            <span className="font-mono font-bold text-primary">
              {activeBundle.assignment.code} · {activeBundle.groupName}
            </span>
            <span className="font-semibold text-secondary">
              {STATUS_TEXT[activeBundle.submission.status] || activeBundle.submission.status}
            </span>
          </div>
          <h3 className="font-display font-bold text-[15px]">{activeBundle.student.fullName}</h3>
          <p className="text-[12px] text-on-surface-variant">
            Исходный срок: {formatAlmatyDateTime(activeBundle.assignment.deadlineAt)}
            {activeBundle.assignment.resubmitDeadlineAt
              ? ` · Пересдача: ${formatAlmatyDateTime(activeBundle.assignment.resubmitDeadlineAt)}`
              : ''}
          </p>
        </div>

        {/* Draft remarks form */}
        <form
          onSubmit={handleAddDraftRemark}
          className="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/50 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-display font-bold text-[14px] text-tertiary">
              Добавить замечание в черновик (v{viewerVersionNum})
            </h4>
            {pendingPin && (
              <span className="text-[11px] font-mono bg-tertiary-fixed px-2 py-0.5 rounded">
                Пин: стр. {pendingPin.pageNumber} ({Math.round(pendingPin.xNorm * 100)}%,{' '}
                {Math.round(pendingPin.yNorm * 100)}%)
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <select
              value={remSeverity}
              onChange={(e) => setRemSeverity(e.target.value as RemarkSeverity)}
              className="rounded-lg border border-outline-variant px-2.5 py-1.5 bg-white"
            >
              <option value="mandatory">Обязательное</option>
              <option value="recommended">Рекомендация</option>
            </select>
            <input
              type="text"
              value={remGostRule}
              onChange={(e) => setRemGostRule(e.target.value)}
              placeholder="ГОСТ / пункт"
              className="rounded-lg border border-outline-variant px-2.5 py-1.5"
            />
          </div>

          <textarea
            rows={2}
            required
            value={remText}
            onChange={(e) => setRemText(e.target.value)}
            placeholder={`Опишите правку для страницы ${pendingPin?.pageNumber || viewerPage}...`}
            className="rounded-lg border border-outline-variant px-3 py-2 text-[13px]"
          />

          <button
            type="submit"
            className="bg-tertiary text-on-tertiary font-semibold py-2 px-3 rounded-lg text-[13px] cursor-pointer"
          >
            В черновик пакета (скрыто от студента)
          </button>
        </form>

        {/* Current Hidden Draft Batch */}
        {draftPkg && draftPkg.remarks.length > 0 && (
          <div className="bg-tertiary-fixed/40 rounded-xl p-4 border border-tertiary/30 flex flex-col gap-2">
            <p className="text-[12px] font-bold text-tertiary uppercase">
              Черновик пакета ({draftPkg.remarks.length} п.) — студент ещё не видит
            </p>
            {draftPkg.remarks.map((r) => (
              <div key={r.id} className="bg-white rounded-lg p-2.5 text-[12px] border border-tertiary/20">
                <p className="font-mono text-[11px] text-tertiary">
                  Стр. {r.pageNumber} · {r.severity === 'mandatory' ? 'Обязательное' : 'Рекомендация'} ·{' '}
                  {r.gostRule}
                </p>
                <p className="mt-0.5">{r.text}</p>
              </div>
            ))}

            <div className="pt-2 flex flex-col gap-2">
              <label className="text-[12px] font-medium flex flex-col gap-1">
                <span>Срок пересдачи (не перезаписывает исходный срок):</span>
                <input
                  type="datetime-local"
                  value={resubmitDateLocal}
                  onChange={(e) => setResubmitDateLocal(e.target.value)}
                  className="rounded-lg border border-outline-variant px-2.5 py-1.5 bg-white text-[12px]"
                />
              </label>
              <button
                type="button"
                onClick={handlePublishReturn}
                className="bg-error text-on-error font-semibold py-2 px-3 rounded-lg text-[13px] cursor-pointer"
              >
                Вернуть на доработку (опубликовать пакет)
              </button>
            </div>
          </div>
        )}

        {/* Published Remarks across versions */}
        <div className="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/50 flex flex-col gap-3">
          <h4 className="font-display font-bold text-[14px]">
            Опубликованные замечания и ответы студента
          </h4>
          {publishedPkgs.length === 0 ? (
            <p className="text-[12px] text-on-surface-variant">
              Опубликованных пакетов замечаний пока нет.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {publishedPkgs.flatMap((p) =>
                p.remarks.map((rem) => (
                  <div
                    key={rem.id}
                    className="rounded-lg border border-outline-variant/50 p-3 text-[12px] flex flex-col gap-1.5"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setViewerVersionNum(rem.versionNum);
                          setViewerPage(rem.pageNumber);
                        }}
                        className="font-mono font-bold text-primary underline cursor-pointer"
                      >
                        v{rem.versionNum} · Стр. {rem.pageNumber} · {rem.gostRule}
                      </button>
                      <span
                        className={`font-semibold ${
                          rem.status === 'closed'
                            ? 'text-secondary'
                            : rem.severity === 'mandatory'
                            ? 'text-error'
                            : 'text-on-surface-variant'
                        }`}
                      >
                        {rem.severity === 'mandatory' ? 'Обязательное' : 'Рекомендация'} ·{' '}
                        {rem.status === 'closed'
                          ? 'Закрыто'
                          : rem.status === 'answered'
                          ? 'Студент ответил'
                          : 'Открыто'}
                      </span>
                    </div>
                    <p>{rem.text}</p>
                    {rem.studentReply && (
                      <p className="bg-surface-container-low rounded px-2.5 py-1.5 text-secondary">
                        Ответ студента: {rem.studentReply}
                      </p>
                    )}
                    {rem.status !== 'closed' && (
                      <button
                        type="button"
                        onClick={() => handleCloseRemark(rem.id)}
                        className="self-end px-2.5 py-1 rounded bg-secondary text-on-secondary text-[11px] font-semibold cursor-pointer"
                      >
                        Закрыть пункт
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Final Approval Gate */}
          <div className="pt-3 border-t border-outline-variant/40 flex flex-col gap-2">
            {openMandatoryExists && (
              <p className="text-[12px] text-error font-medium">
                Кнопка «Согласовано в системе» заблокирована: закройте все обязательные замечания.
              </p>
            )}
            <button
              type="button"
              disabled={
                openMandatoryExists ||
                activeBundle.submission.status === 'approved_in_system'
              }
              onClick={handleApproveInSystem}
              className="bg-secondary text-on-secondary font-semibold py-2.5 px-4 rounded-lg text-[13px] disabled:opacity-45 cursor-pointer"
            >
              {activeBundle.submission.status === 'approved_in_system'
                ? 'Согласовано в системе (зафиксировано)'
                : 'Согласовано в системе'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {/* TAB 1: ОЧЕРЕДЬ */}
      {activeTab === 'teacher_queue' && (
        <div className="flex flex-col gap-4">
          <div className="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/50 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-bold text-[18px]">
                Очередь проверки (от старых к новым)
              </h2>
              <p className="text-[12px] text-on-surface-variant">
                Показано работ: {queue.length}. Видны только группы с активным назначением.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClaimNext}
              className="bg-primary text-on-primary font-semibold px-4 py-2 rounded-lg text-[13px] cursor-pointer flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">assignment_ind</span>
              <span>Взять следующую</span>
            </button>
          </div>

          {/* Filter Bar */}
          <div className="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 text-[12px]">
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') loadAll();
              }}
              placeholder="Поиск студента или кода..."
              className="rounded-lg border border-outline-variant px-3 py-2"
            />
            <select
              value={filterGroup}
              onChange={(e) => setFilterGroup(e.target.value)}
              className="rounded-lg border border-outline-variant px-2.5 py-2 bg-white"
            >
              <option value="all">Все группы</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              value={filterAssignment}
              onChange={(e) => setFilterAssignment(e.target.value)}
              className="rounded-lg border border-outline-variant px-2.5 py-2 bg-white"
            >
              <option value="all">Все задания</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code}
                </option>
              ))}
            </select>
            <select
              value={filterWorkType}
              onChange={(e) => setFilterWorkType(e.target.value)}
              className="rounded-lg border border-outline-variant px-2.5 py-2 bg-white"
            >
              <option value="all">Все типы работ</option>
              <option value="Лабораторная">Лабораторная</option>
              <option value="Курсовая">Курсовая</option>
              <option value="Практическая">Практическая</option>
              <option value="Дипломная">Дипломная</option>
              <option value="СРС">СРС</option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border border-outline-variant px-2.5 py-2 bg-white"
            >
              <option value="all">Все статусы</option>
              <option value="submitted">Первая сдача</option>
              <option value="resubmitted">Повторная сдача</option>
              <option value="in_review">На проверке</option>
              <option value="revision_needed">На доработке</option>
              <option value="approved_in_system">Согласовано в системе</option>
            </select>
            <select
              value={filterMinWait}
              onChange={(e) => setFilterMinWait(e.target.value)}
              className="rounded-lg border border-outline-variant px-2.5 py-2 bg-white"
            >
              <option value="0">Любой возраст</option>
              <option value="24">Ожидает ≥ 24 ч</option>
              <option value="48">Ожидает ≥ 48 ч</option>
            </select>
          </div>

          {queue.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-xl p-8 text-center text-[14px] text-on-surface-variant border border-outline-variant/50">
              Очередь пуста по заданным фильтрам.
            </div>
          ) : (
            <div className="space-y-3">
              {queue.map((row) => {
                const isResubmission = row.submission.currentVersionNum > 1;
                return (
                  <div
                    key={row.submission.id}
                    className="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/50 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-mono font-bold text-primary">
                          {row.assignment.code} · {row.groupName}
                        </span>
                        <span className="font-semibold text-on-surface-variant">
                          {row.assignment.workType}
                        </span>
                        {isResubmission && (
                          <span className="bg-tertiary text-on-tertiary font-bold px-2 py-0.5 rounded">
                            Повторная v{row.submission.currentVersionNum}
                          </span>
                        )}
                        {row.submission.isLate && (
                          <span className="bg-error-container text-on-error-container font-semibold px-2 py-0.5 rounded">
                            После срока
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-[15px] text-on-surface break-words">
                        {row.student.fullName} — {row.assignment.title}
                      </p>
                      <p className="text-[12px] text-on-surface-variant">
                        Этап: <strong>{STATUS_TEXT[row.submission.status]}</strong> · Возраст:{' '}
                        {Math.round(row.waitHours)} ч · Открытых обязательных: {row.openMandatoryCount}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => openSubmissionInReview(row.submission.id)}
                      className="px-4 py-2 rounded-lg bg-primary text-on-primary text-[13px] font-semibold cursor-pointer shrink-0"
                    >
                      Открыть проверку
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ПРОВЕРКА (Landscape Side-by-Side on lg: >= 1024px, Portrait/Mobile Drawer < 1024px) */}
      {activeTab === 'teacher_review' && (
        <div className="flex flex-col gap-4">
          {!activeBundle ? (
            <div className="bg-surface-container-lowest rounded-xl p-8 text-center flex flex-col items-center gap-3 border border-outline-variant/50">
              <p className="text-[14px] text-on-surface-variant">
                Выберите работу из очереди проверки или нажмите «Взять следующую».
              </p>
              <button
                type="button"
                onClick={() => onNavigateTab('teacher_queue')}
                className="px-4 py-2 rounded-lg bg-primary text-on-primary text-[13px] font-semibold cursor-pointer"
              >
                Перейти к очереди
              </button>
            </div>
          ) : (
            <>
              {/* Tablet portrait / mobile Drawer toggle bar */}
              <div className="lg:hidden bg-surface-container-lowest rounded-xl p-3 border border-outline-variant/50 flex items-center justify-between gap-2">
                <div className="text-[13px] font-semibold truncate">
                  {activeBundle.student.shortName} · v{viewerVersionNum}
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen((v) => !v)}
                  className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[12px] font-semibold cursor-pointer"
                >
                  {drawerOpen ? 'Скрыть панель замечаний' : 'Замечания и решение'}
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-7 min-w-0">
                  <DocumentPinViewer
                    submissionId={activeBundle.submission.id}
                    versions={activeBundle.versions}
                    packages={activeBundle.packages}
                    selectedVersionNum={viewerVersionNum}
                    onSelectVersionNum={(v) => {
                      setViewerVersionNum(v);
                      setPendingPin(null);
                    }}
                    selectedPage={viewerPage}
                    onSelectPage={setViewerPage}
                    onDownloadVersion={(ver) =>
                      handleDownloadVersion(activeBundle.submission.id, ver)
                    }
                    canPlacePin={true}
                    onPlacePin={(coords) => {
                      setPendingPin(coords);
                      setDrawerOpen(true);
                    }}
                    pendingPin={pendingPin}
                  />
                </div>

                {/* Desktop & Landscape Tablet (1024px+): Always side-by-side */}
                <div className="hidden lg:block lg:col-span-5">
                  {renderReviewRemarksPanel()}
                </div>

                {/* Portrait Tablet (768x1024) & Mobile Drawer */}
                {drawerOpen && (
                  <div className="lg:hidden fixed inset-0 z-50 bg-on-surface/50 flex justify-end">
                    <div className="w-full max-w-md bg-surface h-full overflow-y-auto p-4 shadow-2xl flex flex-col gap-3">
                      <div className="flex items-center justify-between border-b border-outline-variant/40 pb-2">
                        <span className="font-display font-bold text-[15px]">
                          Лист замечаний и согласование
                        </span>
                        <button
                          type="button"
                          onClick={() => setDrawerOpen(false)}
                          className="px-2.5 py-1 rounded bg-surface-container-low text-[12px] font-semibold cursor-pointer"
                        >
                          Закрыть
                        </button>
                      </div>
                      {renderReviewRemarksPanel()}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: ЗАКРЫТЫЕ ПРОСТРАНСТВА И ЗАДАНИЯ ПРЕПОДАВАТЕЛЯ */}
      {activeTab === 'teacher_spaces' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 flex flex-col gap-5">
            {spaces.map((sp) => (
              <div
                key={sp.id}
                className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/50 flex flex-col gap-4"
              >
                <div>
                  <span className="text-[11px] font-mono font-bold text-primary">
                    {sp.discipline}
                  </span>
                  <h2 className="font-display font-bold text-[17px]">{sp.title}</h2>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-semibold text-on-surface-variant">
                    Закреплённое объявление на доске
                  </label>
                  <textarea
                    rows={2}
                    value={newAnnouncement[sp.id] || ''}
                    onChange={(e) =>
                      setNewAnnouncement((prev) => ({
                        ...prev,
                        [sp.id]: e.target.value,
                      }))
                    }
                    className="rounded-lg border border-outline-variant px-3 py-2 text-[13px]"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveAnnouncement(sp.id)}
                    className="self-start px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[12px] font-semibold cursor-pointer"
                  >
                    Обновить объявление
                  </button>
                </div>

                <div className="pt-3 border-t border-outline-variant/40 flex flex-col gap-2">
                  <h3 className="text-[13px] font-bold">Материалы пространства</h3>
                  {materials
                    .filter((m) => m.spaceId === sp.id)
                    .map((m) => (
                      <div
                        key={m.id}
                        className="bg-surface-container-low rounded-lg p-3 text-[12px]"
                      >
                        <p className="font-semibold">{m.title}</p>
                        <p className="text-on-surface-variant">{m.description}</p>
                        <p className="font-mono text-primary mt-0.5">{m.urlOrNote}</p>
                      </div>
                    ))}

                  <form
                    onSubmit={(e) => handleAddMaterial(sp.id, e)}
                    className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2"
                  >
                    <input
                      type="text"
                      required
                      value={matTitle}
                      onChange={(e) => setMatTitle(e.target.value)}
                      placeholder="Название материала"
                      className="rounded-lg border border-outline-variant px-2.5 py-1.5 text-[12px]"
                    />
                    <input
                      type="text"
                      value={matDesc}
                      onChange={(e) => setMatDesc(e.target.value)}
                      placeholder="Краткое описание"
                      className="rounded-lg border border-outline-variant px-2.5 py-1.5 text-[12px]"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-secondary text-on-secondary px-3 py-1.5 text-[12px] font-semibold cursor-pointer"
                    >
                      Добавить материал
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>

          {/* Create Assignment Form */}
          <form
            onSubmit={handleCreateAssignment}
            className="lg:col-span-5 bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/50 flex flex-col gap-3"
          >
            <h3 className="font-display font-bold text-[16px]">Создать новое задание для группы</h3>
            <div className="grid grid-cols-2 gap-2 text-[13px]">
              <label className="flex flex-col gap-1 font-medium">
                <span>Код</span>
                <input
                  type="text"
                  required
                  value={asgCode}
                  onChange={(e) => setAsgCode(e.target.value)}
                  className="rounded-lg border border-outline-variant px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 font-medium">
                <span>Тип работы</span>
                <select
                  value={asgWorkType}
                  onChange={(e) => setAsgWorkType(e.target.value as WorkType)}
                  className="rounded-lg border border-outline-variant px-2.5 py-2 bg-white"
                >
                  <option value="Лабораторная">Лабораторная</option>
                  <option value="Курсовая">Курсовая</option>
                  <option value="Практическая">Практическая</option>
                  <option value="СРС">СРС</option>
                  <option value="Дипломная">Дипломная</option>
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Группа (из ваших назначений)</span>
              <select
                value={asgGroupId}
                onChange={(e) => setAsgGroupId(e.target.value)}
                className="rounded-lg border border-outline-variant px-3 py-2 bg-white"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Название задания</span>
              <input
                type="text"
                required
                value={asgTitle}
                onChange={(e) => setAsgTitle(e.target.value)}
                placeholder="Лабораторная №2: Тестирование API"
                className="rounded-lg border border-outline-variant px-3 py-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Инструкция</span>
              <textarea
                rows={2}
                value={asgInstructions}
                onChange={(e) => setAsgInstructions(e.target.value)}
                className="rounded-lg border border-outline-variant px-3 py-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Дедлайн (Asia/Almaty)</span>
              <input
                type="datetime-local"
                required
                value={asgDeadlineLocal}
                onChange={(e) => setAsgDeadlineLocal(e.target.value)}
                className="rounded-lg border border-outline-variant px-3 py-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Политика после срока</span>
              <select
                value={asgLatePolicy}
                onChange={(e) => setAsgLatePolicy(e.target.value as LatePolicy)}
                className="rounded-lg border border-outline-variant px-3 py-2 bg-white"
              >
                <option value="allow_late">Разрешить с отметкой «После срока»</option>
                <option value="block_after_deadline">Закрыть сдачу после срока</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[13px] font-medium">
              <span>Ожидаемая дата обратной связи (необязательно)</span>
              <input
                type="datetime-local"
                value={asgExpectedFeedback}
                onChange={(e) => setAsgExpectedFeedback(e.target.value)}
                className="rounded-lg border border-outline-variant px-3 py-2"
              />
            </label>

            <button
              type="submit"
              className="bg-primary text-on-primary font-semibold py-2.5 px-4 rounded-lg cursor-pointer mt-1"
            >
              Опубликовать задание группе
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
