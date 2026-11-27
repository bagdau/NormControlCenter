import React, { useEffect, useState } from 'react';
import {
  api,
  formatAlmatyDateTime,
  formatBytes,
} from '../api/client';
import {
  AssignmentDTO,
  LabReportSnapshotDTO,
  PublicUserDTO,
  ReceiptDTO,
  RoleNavTab,
  SpaceDTO,
  SpaceMaterialDTO,
  SubmissionBundleDTO,
  SubmissionVersionDTO,
  UILang,
} from '../types';
import { DocumentPinViewer } from './DocumentPinViewer';

interface StudentWorkspaceProps {
  lang: UILang;
  user: PublicUserDTO;
  activeTab: RoleNavTab;
  onNavigateTab: (tab: RoleNavTab) => void;
  onOpenReceipt: (receipt: ReceiptDTO, bundle: SubmissionBundleDTO) => void;
  onShowToast: (text: string, tone?: 'success' | 'info' | 'warning' | 'error') => void;
  onAuthError: (err: unknown) => void;
}

function createInitialSnapshot(
  user: PublicUserDTO,
  assignment?: AssignmentDTO
): LabReportSnapshotDTO {
  return {
    templateVersion: 'v1.0-demo',
    docLang: 'Русский',
    university: '',
    department: '',
    discipline: assignment?.title || '',
    labNumber: '',
    title: assignment?.title || '',
    studentName: user.fullName,
    studentGroup: user.groupName || '',
    teacherName: '',
    cityYear: String(new Date().getFullYear()),
    goal: '',
    tools: '',
    procedure: '',
    result: '',
    conclusion: '',
    sources: [],
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
}

function getStatusText(status: SubmissionBundleDTO['submission']['status']): string {
  switch (status) {
    case 'submitted':
      return 'Сдано (ожидает проверки)';
    case 'in_review':
      return 'На проверке у преподавателя';
    case 'revision_needed':
      return 'Нужно исправить';
    case 'resubmitted':
      return 'Пересдано (ожидает перепроверки)';
    case 'approved_in_system':
      return 'Согласовано в системе';
  }
}

export const StudentWorkspace: React.FC<StudentWorkspaceProps> = ({
  user,
  activeTab,
  onNavigateTab,
  onOpenReceipt,
  onShowToast,
  onAuthError,
}) => {
  const [loading, setLoading] = useState(true);
  const [spaces, setSpaces] = useState<SpaceDTO[]>([]);
  const [materials, setMaterials] = useState<SpaceMaterialDTO[]>([]);
  const [assignments, setAssignments] = useState<AssignmentDTO[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionBundleDTO[]>([]);

  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>('');
  const [submitMode, setSubmitMode] = useState<'builder' | 'upload'>('builder');
  const [snapshot, setSnapshot] = useState<LabReportSnapshotDTO>(() =>
    createInitialSnapshot(user)
  );
  const [sourcesText, setSourcesText] = useState<string>(() =>
    createInitialSnapshot(user).sources.join('\n')
  );

  // Upload state with P03 draft & idempotency key persistence
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [simulateFailure, setSimulateFailure] = useState<boolean>(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(
    () => `idem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  const [submitting, setSubmitting] = useState(false);

  // Revision / Submissions viewer state
  const [activeSubId, setActiveSubId] = useState<string>('');
  const [viewerVersionNum, setViewerVersionNum] = useState<number>(1);
  const [viewerPage, setViewerPage] = useState<number>(1);
  const [repliesMap, setRepliesMap] = useState<Record<string, string>>({});
  const [draftReadyId, setDraftReadyId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');

  const loadData = async () => {
    setLoading(true);
    try {
      const [sp, asg, mine] = await Promise.all([
        api.getSpaces(),
        api.getAssignments(),
        api.getMySubmissions(),
      ]);
      setSpaces(sp.spaces);
      setMaterials(sp.materials);
      setAssignments(asg.assignments);
      setSubmissions(mine.submissions);

      if (!selectedAssignmentId && asg.assignments[0]) {
        const first = asg.assignments[0];
        setSelectedAssignmentId(first.id);
        const initSnap = createInitialSnapshot(user, first);
        setSnapshot(initSnap);
        setSourcesText(initSnap.sources.join('\n'));
      }

      if (mine.submissions.length > 0 && !activeSubId) {
        const rev =
          mine.submissions.find((b) => b.submission.status === 'revision_needed') ||
          mine.submissions[0];
        setActiveSubId(rev.submission.id);
        setViewerVersionNum(rev.submission.currentVersionNum);
      }
    } catch (err) {
      onAuthError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  useEffect(() => {
    if (!selectedAssignmentId) return;
    let cancelled = false;
    setDraftReadyId(null);
    setDraftStatus('loading');
    api.getStudentDraft(selectedAssignmentId).then(({ draft }) => {
      if (cancelled) return;
      if (draft) {
        setSnapshot(draft.snapshot);
        setSourcesText(draft.snapshot.sources.join('\n'));
        setRepliesMap(draft.replies);
        setSubmitMode(draft.mode);
        setIdempotencyKey(draft.idempotencyKey);
      }
      setDraftReadyId(selectedAssignmentId);
      setDraftStatus('saved');
    }).catch((err) => { if (!cancelled) onAuthError(err); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssignmentId, user.id]);

  useEffect(() => {
    if (!selectedAssignmentId || draftReadyId !== selectedAssignmentId || submitting) return;
    let cancelled = false;
    setDraftStatus('saving');
    const timer = window.setTimeout(() => {
      void api.saveStudentDraft(selectedAssignmentId, {
        snapshot: { ...snapshot, sources: sourcesText.split('\n').map((item) => item.trim()).filter(Boolean) },
        replies: repliesMap,
        mode: submitMode,
        idempotencyKey,
      }).then(() => { if (!cancelled) setDraftStatus('saved'); }).catch((err) => {
        if (!cancelled) {
          setDraftStatus('error');
          onAuthError(err);
        }
      });
    }, 700);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssignmentId, draftReadyId, snapshot, sourcesText, repliesMap, submitMode, idempotencyKey, submitting]);

  const selectedAssignment =
    assignments.find((a) => a.id === selectedAssignmentId) || assignments[0];

  const handleSelectAssignment = (asg: AssignmentDTO) => {
    setDraftReadyId(null);
    setSelectedAssignmentId(asg.id);
    setUploadError(null);
    setUploadProgress(0);
    setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    setSnapshot((prev) => ({
      ...prev,
      discipline: asg.title,
      title: asg.title,
    }));
  };

  const buildCurrentSnapshot = (): LabReportSnapshotDTO => ({
    ...snapshot,
    sources: sourcesText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  });

  const handleExportDocx = async () => {
    try {
      await api.exportLabDocx(buildCurrentSnapshot());
      onShowToast('Файл .DOCX сформирован и скачан.', 'success');
    } catch (err) {
      onAuthError(err);
      onShowToast(err instanceof Error ? err.message : 'Ошибка выгрузки DOCX', 'error');
    }
  };

  const handleExportPdf = async () => {
    try {
      await api.exportLabPdf(buildCurrentSnapshot());
      onShowToast('Файл .PDF сформирован и скачан.', 'success');
    } catch (err) {
      onAuthError(err);
      onShowToast(err instanceof Error ? err.message : 'Ошибка выгрузки PDF', 'error');
    }
  };

  const collectRepliesForSubmission = (assignmentId: string) => {
    const existing = submissions.find((s) => s.assignment.id === assignmentId);
    if (!existing) return [];
    const replies: { remarkId: string; replyText: string }[] = [];
    for (const pkg of existing.packages) {
      for (const rem of pkg.remarks) {
        const text = (repliesMap[rem.id] || '').trim();
        if (text) replies.push({ remarkId: rem.id, replyText: text });
      }
    }
    return replies;
  };

  const handleSubmitBuilder = async (targetAssignmentId?: string) => {
    const asgId = targetAssignmentId || selectedAssignment?.id;
    if (!asgId) return;
    if (selectedAssignment?.id !== asgId) {
      setUploadError('Сначала откройте нужное задание и проверьте поля шаблона.');
      return;
    }
    setSubmitting(true);
    setUploadError(null);
    try {
      const res = await api.submitBuilderSnapshot(asgId, {
        idempotencyKey,
        snapshot: buildCurrentSnapshot(),
        replies: collectRepliesForSubmission(asgId),
      });
      setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
      setActiveSubId(res.bundle.submission.id);
      setViewerVersionNum(res.bundle.submission.currentVersionNum);
      onOpenReceipt(res.receipt, res.bundle);
      void loadData();
      onShowToast(
        res.deduplicated
          ? 'Повторный запрос распознан: возвращена исходная квитанция без дубля.'
          : `Версия v${res.receipt.versionNum} сохранена на сервере.`,
        'success'
      );
    } catch (err) {
      onAuthError(err);
      const msg = err instanceof Error ? err.message : 'Ошибка отправки шаблона.';
      setUploadError(msg);
      onShowToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitFile = async (targetAssignmentId?: string) => {
    const asgId = targetAssignmentId || selectedAssignment?.id;
    if (!asgId || !selectedFile) {
      setUploadError('Выберите файл .PDF или .DOCX (до 25 МБ).');
      return;
    }
    setSubmitting(true);
    setUploadError(null);
    setUploadProgress(5);
    try {
      const res = await api.submitFileWithProgress(asgId, {
        file: selectedFile,
        idempotencyKey,
        replies: collectRepliesForSubmission(asgId),
        simulateFailure,
        onProgress: setUploadProgress,
      });
      setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
      setSelectedFile(null);
      setUploadProgress(0);
      setActiveSubId(res.bundle.submission.id);
      setViewerVersionNum(res.bundle.submission.currentVersionNum);
      onOpenReceipt(res.receipt, res.bundle);
      void loadData();
      onShowToast(`Файл принят сервером: ${res.receipt.receiptNumber}`, 'success');
    } catch (err) {
      onAuthError(err);
      const msg =
        err instanceof Error
          ? err.message
          : 'Сбой сети при отправке файла. Проверьте статус сдачи перед повтором.';
      setUploadError(msg);
      onShowToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadVersion = async (subId: string, ver: SubmissionVersionDTO) => {
    try {
      await api.downloadSubmissionVersion(subId, ver.id, ver.fileName);
    } catch (err) {
      onAuthError(err);
      onShowToast(err instanceof Error ? err.message : 'Ошибка скачивания версии', 'error');
    }
  };

  if (loading) {
    return (
      <div className="bg-surface-container-lowest rounded-xl p-8 text-center text-[14px] text-on-surface-variant">
        Загрузка заданий и сдач студента...
      </div>
    );
  }

  const revisionSubmissions = submissions.filter(
    (b) => b.submission.status === 'revision_needed' || b.packages.length > 0
  );
  const activeBundle =
    submissions.find((b) => b.submission.id === activeSubId) || submissions[0] || null;

  return (
    <div className="flex flex-col gap-6">
      {/* TAB 1: ЗАДАНИЯ + КОНСТРУКТОР ЛАБОРАТОРНОЙ + ЗАГРУЗКА ФАЙЛА */}
      {activeTab === 'student_assignments' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Assignment list */}
          <div className="lg:col-span-4 flex flex-col gap-3">
            <div className="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/50">
              <h2 className="font-display font-bold text-[16px]">
                Задания группы {user.groupName}
              </h2>
              <p className="text-[12px] text-on-surface-variant mt-1">
                Время отображается в часовом поясе <span className="font-mono">Asia/Almaty (UTC+5)</span>.
              </p>
            </div>

            {assignments.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-xl p-6 text-center text-[13px] text-on-surface-variant border border-outline-variant/40">
                Для вашей группы пока нет активных заданий.
              </div>
            ) : (
              assignments.map((asg) => {
                const sub = submissions.find((s) => s.assignment.id === asg.id);
                const isSelected = selectedAssignment?.id === asg.id;
                const isPastOriginal = Date.now() > new Date(asg.deadlineAt).getTime();

                return (
                  <button
                    key={asg.id}
                    type="button"
                    onClick={() => handleSelectAssignment(asg)}
                    className={`text-left rounded-xl p-4 border transition-colors cursor-pointer flex flex-col gap-2 ${
                      isSelected
                        ? 'bg-primary-fixed/40 border-primary'
                        : 'bg-surface-container-lowest border-outline-variant/50 hover:border-primary/60'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase text-primary font-mono">
                        {asg.code} · {asg.workType}
                      </span>
                      {sub ? (
                        <span className="text-[11px] font-semibold text-secondary">
                          v{sub.submission.currentVersionNum} · {getStatusText(sub.submission.status)}
                        </span>
                      ) : isPastOriginal ? (
                        <span className="text-[11px] font-semibold text-error">
                          Просрочено
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-on-surface-variant">
                          Не сдано
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-[14px] text-on-surface break-words">
                      {asg.title}
                    </p>
                    <div className="text-[12px] text-on-surface-variant space-y-0.5">
                      <p>Исходный срок: {formatAlmatyDateTime(asg.deadlineAt)}</p>
                      {asg.resubmitDeadlineAt && (
                        <p className="text-tertiary font-medium">
                          Срок пересдачи: {formatAlmatyDateTime(asg.resubmitDeadlineAt)}
                        </p>
                      )}
                      {asg.expectedFeedbackDate && (
                        <p className="text-secondary">
                          Ожидаемая обратная связь: {formatAlmatyDateTime(asg.expectedFeedbackDate)}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Active Assignment Submission Panel */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            {selectedAssignment ? (
              <>
                <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/50 flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span className="text-[11px] font-mono font-bold uppercase text-primary">
                        {selectedAssignment.code} · {selectedAssignment.workType} · Шаблон{' '}
                        {selectedAssignment.templateVersion}
                      </span>
                      <h3 className="font-display font-bold text-[18px] text-on-surface mt-1">
                        {selectedAssignment.title}
                      </h3>
                    </div>
                    <div className="text-right text-[12px]">
                      <p className="font-semibold">
                        Срок: {formatAlmatyDateTime(selectedAssignment.deadlineAt)}
                      </p>
                      <p className="text-on-surface-variant">
                        {selectedAssignment.latePolicy === 'block_after_deadline'
                          ? 'После срока сдача закрыта'
                          : 'После срока сдачу можно отправить с пометкой опоздания'}
                      </p>
                    </div>
                  </div>
                  <p className="text-[13px] text-on-surface-variant">
                    {selectedAssignment.instructions}
                  </p>
                  <p className={`text-[12px] ${draftStatus === 'error' ? 'text-error' : 'text-on-surface-variant'}`} role="status">
                    {draftStatus === 'loading' ? 'Загрузка черновика…' : draftStatus === 'saving' ? 'Сохранение черновика…' : draftStatus === 'error' ? 'Черновик не сохранился. Проверьте соединение.' : 'Черновик сохранён на сервере.'}
                  </p>

                  {/* Mode Switcher */}
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-outline-variant/40">
                    <button
                      type="button"
                      onClick={() => setSubmitMode('builder')}
                      className={`px-3 py-2 rounded-lg text-[13px] font-semibold cursor-pointer ${
                        submitMode === 'builder'
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-container-low text-on-surface'
                      }`}
                    >
                      Конструктор отчёта ({snapshot.formatting.version})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubmitMode('upload')}
                      className={`px-3 py-2 rounded-lg text-[13px] font-semibold cursor-pointer ${
                        submitMode === 'upload'
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-container-low text-on-surface'
                      }`}
                    >
                      Загрузить файл PDF / DOCX
                    </button>
                  </div>
                </div>

                {uploadError && (
                  <div
                    role="alert"
                    className="bg-error-container text-on-error-container rounded-xl p-4 text-[13px] flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined">cloud_off</span>
                      <span>{uploadError}</span>
                    </div>
                    {submitMode === 'upload' && selectedFile && (
                      <button
                        type="button"
                        onClick={() => {
                          setSimulateFailure(false);
                          handleSubmitFile(selectedAssignment.id);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-error text-on-error font-semibold text-[12px] cursor-pointer"
                      >
                        Повторить отправку (тот же ключ)
                      </button>
                    )}
                  </div>
                )}

                {submitMode === 'upload' ? (
                  <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/50 flex flex-col gap-4">
                    <div>
                      <h4 className="font-display font-bold text-[15px]">
                        Загрузка готового файла (.PDF или .DOCX, до 25 МБ)
                      </h4>
                      <p className="text-[12px] text-on-surface-variant mt-1">
                        Сервер проверяет сигнатуру файла (<code className="font-mono">%PDF-</code> или{' '}
                        <code className="font-mono">DOCX ZIP</code>) и выдаёт квитанцию только после сохранения.
                      </p>
                    </div>

                    <label className="border-2 border-dashed border-outline-variant rounded-xl p-5 flex flex-col items-center gap-2 cursor-pointer hover:border-primary bg-surface-container-low/40">
                      <span className="material-symbols-outlined text-[32px] text-primary">
                        upload_file
                      </span>
                      <span className="text-[13px] font-semibold text-center">
                        {selectedFile
                          ? `${selectedFile.name} (${formatBytes(selectedFile.size)})`
                          : 'Выберите .PDF или .DOCX файл с устройства'}
                      </span>
                      <input
                        type="file"
                        accept=".pdf,.docx"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          setSelectedFile(f);
                          setUploadError(null);
                          setUploadProgress(0);
                          setIdempotencyKey(
                            `idem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
                          );
                        }}
                      />
                    </label>

                    {uploadProgress > 0 && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[12px] font-mono">
                          <span>Загрузка на сервер...</span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <div className="w-full h-2.5 bg-surface-container-low rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <label className="flex items-center gap-2 text-[12px] text-on-surface-variant cursor-pointer">
                      <input
                        type="checkbox"
                        checked={simulateFailure}
                        onChange={(e) => setSimulateFailure(e.target.checked)}
                      />
                      <span>
                        Смоделировать обрыв сети при отправке (проверка сохранения черновика и отсутствия ложной квитанции)
                      </span>
                    </label>

                    <div className="flex flex-wrap justify-between items-center gap-2 pt-2">
                      <span className="text-[11px] font-mono text-on-surface-variant">
                        Ключ идемпотентности: {idempotencyKey}
                      </span>
                      <button
                        type="button"
                        disabled={submitting || !selectedFile}
                        onClick={() => handleSubmitFile(selectedAssignment.id)}
                        className="px-4 py-2.5 rounded-lg bg-primary text-on-primary font-semibold text-[13px] disabled:opacity-50 cursor-pointer"
                      >
                        {submitting ? 'Отправка на сервер...' : 'Отправить файл на проверку'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/50 flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-container-low rounded-lg p-3">
                      <div className="text-[12px]">
                        <p className="font-bold text-primary">
                          Шаблон лабораторной работы · {snapshot.formatting.version} (демонстрационные параметры)
                        </p>
                        <p className="text-on-surface-variant">
                          Поля А4: Л {snapshot.formatting.marginsMm.left} / П{' '}
                          {snapshot.formatting.marginsMm.right} / В{' '}
                          {snapshot.formatting.marginsMm.top} / Н{' '}
                          {snapshot.formatting.marginsMm.bottom} мм · {snapshot.formatting.fontSizePt} pt · интервал{' '}
                          {snapshot.formatting.lineSpacing} · абзац {snapshot.formatting.firstLineIndentCm} см
                        </p>
                      </div>
                      <span className="text-[11px] font-mono text-secondary">
                        Оформляет текст студента (без генерации ИИ)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
                      <label className="flex flex-col gap-1 font-medium">
                        <span>Вуз / Контур</span>
                        <input
                          type="text"
                          value={snapshot.university}
                          onChange={(e) =>
                            setSnapshot({ ...snapshot, university: e.target.value })
                          }
                          className="rounded-lg border border-outline-variant px-3 py-2"
                        />
                      </label>
                      <label className="flex flex-col gap-1 font-medium">
                        <span>Кафедра</span>
                        <input
                          type="text"
                          value={snapshot.department}
                          onChange={(e) =>
                            setSnapshot({ ...snapshot, department: e.target.value })
                          }
                          className="rounded-lg border border-outline-variant px-3 py-2"
                        />
                      </label>
                      <label className="flex flex-col gap-1 font-medium">
                        <span>Дисциплина</span>
                        <input
                          type="text"
                          value={snapshot.discipline}
                          onChange={(e) =>
                            setSnapshot({ ...snapshot, discipline: e.target.value })
                          }
                          className="rounded-lg border border-outline-variant px-3 py-2"
                        />
                      </label>
                      <label className="flex flex-col gap-1 font-medium">
                        <span>Номер ЛР и Город/Год</span>
                        <div className="grid grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={snapshot.labNumber}
                            onChange={(e) =>
                              setSnapshot({ ...snapshot, labNumber: e.target.value })
                            }
                            placeholder="1"
                            className="rounded-lg border border-outline-variant px-2 py-2"
                          />
                          <input
                            type="text"
                            value={snapshot.cityYear}
                            onChange={(e) =>
                              setSnapshot({ ...snapshot, cityYear: e.target.value })
                            }
                            className="col-span-2 rounded-lg border border-outline-variant px-3 py-2"
                          />
                        </div>
                      </label>
                      <label className="sm:col-span-2 flex flex-col gap-1 font-medium">
                        <span>Тема работы</span>
                        <input
                          type="text"
                          value={snapshot.title}
                          onChange={(e) =>
                            setSnapshot({ ...snapshot, title: e.target.value })
                          }
                          className="rounded-lg border border-outline-variant px-3 py-2"
                        />
                      </label>
                      <label className="sm:col-span-2 flex flex-col gap-1 font-medium">
                        <span>1. Цель работы</span>
                        <textarea
                          rows={2}
                          value={snapshot.goal}
                          onChange={(e) =>
                            setSnapshot({ ...snapshot, goal: e.target.value })
                          }
                          className="rounded-lg border border-outline-variant px-3 py-2"
                        />
                      </label>
                      <label className="sm:col-span-2 flex flex-col gap-1 font-medium">
                        <span>2. Инструменты и среда</span>
                        <textarea
                          rows={2}
                          value={snapshot.tools}
                          onChange={(e) =>
                            setSnapshot({ ...snapshot, tools: e.target.value })
                          }
                          className="rounded-lg border border-outline-variant px-3 py-2"
                        />
                      </label>
                      <label className="sm:col-span-2 flex flex-col gap-1 font-medium">
                        <span>3. Ход работы (поддержка Ә, Ғ, Қ, Ң, Ө, Ұ, Ү, І)</span>
                        <textarea
                          rows={3}
                          value={snapshot.procedure}
                          onChange={(e) =>
                            setSnapshot({ ...snapshot, procedure: e.target.value })
                          }
                          className="rounded-lg border border-outline-variant px-3 py-2"
                        />
                      </label>
                      <label className="sm:col-span-2 flex flex-col gap-1 font-medium">
                        <span>4. Результат</span>
                        <textarea
                          rows={2}
                          value={snapshot.result}
                          onChange={(e) =>
                            setSnapshot({ ...snapshot, result: e.target.value })
                          }
                          className="rounded-lg border border-outline-variant px-3 py-2"
                        />
                      </label>
                      <label className="sm:col-span-2 flex flex-col gap-1 font-medium">
                        <span>5. Вывод</span>
                        <textarea
                          rows={2}
                          value={snapshot.conclusion}
                          onChange={(e) =>
                            setSnapshot({ ...snapshot, conclusion: e.target.value })
                          }
                          className="rounded-lg border border-outline-variant px-3 py-2"
                        />
                      </label>
                      <label className="sm:col-span-2 flex flex-col gap-1 font-medium">
                        <span>Список источников (по строке на источник)</span>
                        <textarea
                          rows={3}
                          value={sourcesText}
                          onChange={(e) => setSourcesText(e.target.value)}
                          className="rounded-lg border border-outline-variant px-3 py-2 font-mono text-[12px]"
                        />
                      </label>
                    </div>

                    {/* Formatting profile toggles */}
                    <div className="bg-surface-container-low rounded-lg p-3 flex flex-wrap items-center gap-4 text-[12px]">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={snapshot.formatting.showFrame}
                          onChange={(e) =>
                            setSnapshot({
                              ...snapshot,
                              formatting: {
                                ...snapshot.formatting,
                                showFrame: e.target.checked,
                              },
                            })
                          }
                        />
                        <span>Рамка ГОСТ</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={snapshot.formatting.showPageNumbers}
                          onChange={(e) =>
                            setSnapshot({
                              ...snapshot,
                              formatting: {
                                ...snapshot.formatting,
                                showPageNumbers: e.target.checked,
                              },
                            })
                          }
                        />
                        <span>Нумерация страниц</span>
                      </label>
                      <label className="flex items-center gap-1.5">
                        <span>Левое поле (мм):</span>
                        <input
                          type="number"
                          min={10}
                          max={40}
                          value={snapshot.formatting.marginsMm.left}
                          onChange={(e) =>
                            setSnapshot({
                              ...snapshot,
                              formatting: {
                                ...snapshot.formatting,
                                marginsMm: {
                                  ...snapshot.formatting.marginsMm,
                                  left: Number(e.target.value) || 30,
                                },
                              },
                            })
                          }
                          className="w-16 rounded border border-outline-variant px-2 py-1 bg-white font-mono"
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-outline-variant/40">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleExportDocx}
                          className="px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant text-[13px] font-semibold cursor-pointer flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[17px]">description</span>
                          <span>Скачать .DOCX</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleExportPdf}
                          className="px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant text-[13px] font-semibold cursor-pointer flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[17px]">picture_as_pdf</span>
                          <span>Скачать .PDF</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleSubmitBuilder(selectedAssignment.id)}
                        className="px-4 py-2.5 rounded-lg bg-primary text-on-primary font-semibold text-[13px] cursor-pointer disabled:opacity-50"
                      >
                        {submitting ? 'Сохранение...' : 'Сдать шаблон на проверку'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* TAB 2: МОИ СДАЧИ И КВИТАНЦИИ */}
      {activeTab === 'student_submissions' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-5 flex flex-col gap-3">
            <h2 className="font-display font-bold text-[17px]">
              Мои сдачи, версии и квитанции
            </h2>
            {submissions.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-xl p-6 text-[13px] text-on-surface-variant border border-outline-variant/50">
                Вы ещё не отправляли работы. Перейдите во вкладку «Задания», чтобы сдать первую версию.
              </div>
            ) : (
              submissions.map((bundle) => (
                <div
                  key={bundle.submission.id}
                  onClick={() => {
                    setActiveSubId(bundle.submission.id);
                    setViewerVersionNum(bundle.submission.currentVersionNum);
                    setViewerPage(1);
                  }}
                  className={`rounded-xl p-4 border cursor-pointer transition-colors flex flex-col gap-2 ${
                    activeBundle?.submission.id === bundle.submission.id
                      ? 'bg-primary-fixed/35 border-primary'
                      : 'bg-surface-container-lowest border-outline-variant/50'
                  }`}
                >
                  <div className="flex flex-wrap justify-between gap-2 text-[12px]">
                    <span className="font-mono font-bold text-primary">
                      {bundle.assignment.code} · v{bundle.submission.currentVersionNum}
                    </span>
                    <span className="font-semibold text-secondary">
                      {getStatusText(bundle.submission.status)}
                    </span>
                  </div>
                  <p className="font-semibold text-[14px]">{bundle.assignment.title}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {bundle.receipts.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenReceipt(r, bundle);
                        }}
                        className="px-2.5 py-1 rounded bg-surface-container-low border border-outline-variant/60 font-mono text-[11px] font-semibold cursor-pointer hover:border-primary"
                      >
                        Квитанция {r.receiptNumber} (v{r.versionNum})
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="lg:col-span-7">
            {activeBundle ? (
              <DocumentPinViewer
                submissionId={activeBundle.submission.id}
                versions={activeBundle.versions}
                packages={activeBundle.packages}
                selectedVersionNum={viewerVersionNum}
                onSelectVersionNum={setViewerVersionNum}
                selectedPage={viewerPage}
                onSelectPage={setViewerPage}
                onDownloadVersion={(ver) => handleDownloadVersion(activeBundle.submission.id, ver)}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* TAB 3: НУЖНО ИСПРАВИТЬ И ПЕРЕСДАЧА v2 */}
      {activeTab === 'student_revisions' && (
        <div className="flex flex-col gap-5">
          {revisionSubmissions.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-xl p-8 text-center text-[14px] text-on-surface-variant border border-outline-variant/50">
              Замечаний к исправлению сейчас нет.
            </div>
          ) : (
            (() => {
              const target =
                revisionSubmissions.find((b) => b.submission.id === activeSubId) ||
                revisionSubmissions[0];
              const publishedRemarks = target.packages.flatMap((p) => p.remarks);

              return (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  <div className="lg:col-span-7">
                    <DocumentPinViewer
                      submissionId={target.submission.id}
                      versions={target.versions}
                      packages={target.packages}
                      selectedVersionNum={viewerVersionNum}
                      onSelectVersionNum={setViewerVersionNum}
                      selectedPage={viewerPage}
                      onSelectPage={setViewerPage}
                      onDownloadVersion={(ver) => handleDownloadVersion(target.submission.id, ver)}
                    />
                  </div>

                  <div className="lg:col-span-5 bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/50 flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-mono font-bold text-primary">
                          {target.assignment.code} · Текущая версия v{target.submission.currentVersionNum}
                        </p>
                        <h3 className="font-display font-bold text-[16px]">
                          Опубликованные замечания ({publishedRemarks.length})
                        </h3>
                      </div>
                      {revisionSubmissions.length > 1 && (
                        <select
                          value={target.submission.id}
                          onChange={(e) => {
                            const found = revisionSubmissions.find(
                              (x) => x.submission.id === e.target.value
                            );
                            if (found) {
                              setActiveSubId(found.submission.id);
                              setViewerVersionNum(found.submission.currentVersionNum);
                            }
                          }}
                          className="rounded-lg border border-outline-variant px-2 py-1 text-[12px] bg-white"
                        >
                          {revisionSubmissions.map((r) => (
                            <option key={r.submission.id} value={r.submission.id}>
                              {r.assignment.code}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {target.assignment.resubmitDeadlineAt && (
                      <div className="bg-tertiary-fixed/60 text-on-tertiary-fixed rounded-lg px-3 py-2 text-[12px]">
                        Срок доработки: {formatAlmatyDateTime(target.assignment.resubmitDeadlineAt)} (исходный срок:{' '}
                        {formatAlmatyDateTime(target.assignment.deadlineAt)})
                      </div>
                    )}

                    <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                      {publishedRemarks.map((rem) => (
                        <div
                          key={rem.id}
                          className="rounded-lg border border-outline-variant/60 p-3 text-[13px] flex flex-col gap-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
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
                                ? 'Есть ответ'
                                : 'Открыто'}
                            </span>
                          </div>
                          <p className="text-on-surface">{rem.text}</p>
                          {rem.studentReply && (
                            <p className="text-[12px] bg-surface-container-low rounded px-2.5 py-1.5 text-secondary">
                              Ваш прошлый ответ: {rem.studentReply}
                            </p>
                          )}
                          {rem.status !== 'closed' && (
                            <input
                              type="text"
                              value={repliesMap[rem.id] || ''}
                              onChange={(e) =>
                                setRepliesMap((prev) => ({
                                  ...prev,
                                  [rem.id]: e.target.value,
                                }))
                              }
                              placeholder="Комментарий: что исправлено в новой версии..."
                              className="rounded border border-outline-variant px-2.5 py-1.5 text-[12px]"
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="pt-3 border-t border-outline-variant/40 flex flex-col gap-2">
                      <p className="text-[12px] text-on-surface-variant">
                        При пересдаче создаётся новая версия v{target.submission.currentVersionNum + 1}. Версия v1 остаётся неизменной в истории.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => {
                            handleSelectAssignment(target.assignment);
                            setSubmitMode('builder');
                            onNavigateTab('student_assignments');
                          }}
                          className="flex-1 bg-primary text-on-primary font-semibold py-2 px-3 rounded-lg text-[13px] cursor-pointer disabled:opacity-50"
                        >
                          Открыть шаблон для v{target.submission.currentVersionNum + 1}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleSelectAssignment(target.assignment);
                            setSubmitMode('upload');
                            onNavigateTab('student_assignments');
                          }}
                          className="px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant text-[12px] font-semibold cursor-pointer"
                        >
                          Загрузить файл v{target.submission.currentVersionNum + 1}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* TAB 4: ПРОСТРАНСТВО ГРУППЫ */}
      {activeTab === 'student_spaces' && (
        <div className="flex flex-col gap-4">
          {spaces.map((sp) => (
            <div
              key={sp.id}
              className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/50 flex flex-col gap-4"
            >
              <div>
                <span className="text-[11px] font-mono font-bold uppercase text-primary">
                  {sp.discipline}
                </span>
                <h2 className="font-display font-bold text-[18px] mt-0.5">{sp.title}</h2>
              </div>

              <div className="bg-primary-fixed/40 rounded-xl p-4 border border-primary/20">
                <p className="text-[11px] font-bold uppercase text-primary flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">push_pin</span>
                  <span>Закреплённое объявление преподавателя</span>
                </p>
                <p className="text-[13px] text-on-surface mt-1">{sp.pinnedAnnouncement}</p>
              </div>

              <div>
                <h3 className="text-[13px] font-bold uppercase text-on-surface-variant mb-2">
                  Материалы и памятки
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {materials
                    .filter((m) => m.spaceId === sp.id)
                    .map((mat) => (
                      <div
                        key={mat.id}
                        className="rounded-lg border border-outline-variant/50 p-3 text-[13px]"
                      >
                        <p className="font-semibold text-on-surface">{mat.title}</p>
                        <p className="text-[12px] text-on-surface-variant mt-1">
                          {mat.description}
                        </p>
                        <p className="text-[12px] font-mono text-primary mt-1">{mat.urlOrNote}</p>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
