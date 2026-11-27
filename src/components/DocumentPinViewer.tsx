import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api, formatAlmatyDateTime, formatBytes } from '../api/client';
import { RemarkDTO, RemarkPackageDTO, SubmissionVersionDTO } from '../types';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface DocumentPinViewerProps {
  submissionId: string;
  versions: SubmissionVersionDTO[];
  packages: RemarkPackageDTO[];
  selectedVersionNum: number;
  onSelectVersionNum: (v: number) => void;
  selectedPage: number;
  onSelectPage: (page: number) => void;
  onDownloadVersion: (version: SubmissionVersionDTO) => void;
  canPlacePin?: boolean;
  onPlacePin?: (coords: { pageNumber: number; xNorm: number; yNorm: number }) => void;
  pendingPin?: { pageNumber: number; xNorm: number; yNorm: number } | null;
}

export const DocumentPinViewer: React.FC<DocumentPinViewerProps> = ({
  submissionId, versions, packages, selectedVersionNum, onSelectVersionNum,
  selectedPage, onSelectPage, onDownloadVersion, canPlacePin = false, onPlacePin, pendingPin,
}) => {
  const [zoomPct, setZoomPct] = useState(100);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentVersion = versions.find((v) => v.versionNum === selectedVersionNum) || versions[versions.length - 1];
  const isPdf = currentVersion?.mimeType === 'application/pdf';

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setLoadError(null);
    if (!currentVersion || !isPdf) return;
    let loaded: pdfjs.PDFDocumentProxy | null = null;
    api.getSubmissionVersionBlob(submissionId, currentVersion.id)
      .then((blob) => blob.arrayBuffer())
      .then((bytes) => pdfjs.getDocument({ data: bytes }).promise)
      .then((doc) => {
        loaded = doc;
        if (cancelled) void doc.destroy();
        else setPdf(doc);
      })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Не удалось открыть PDF.'); });
    return () => { cancelled = true; if (loaded) void loaded.destroy(); };
  }, [submissionId, currentVersion?.id, isPdf]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: pdfjs.RenderTask | null = null;
    pdf.getPage(Math.min(selectedPage, pdf.numPages)).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale: zoomPct / 100 });
      const canvas = canvasRef.current;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) return;
      renderTask = page.render({ canvasContext: context, canvas, viewport });
      void renderTask.promise.catch((err) => {
        if (!cancelled && err?.name !== 'RenderingCancelledException') setLoadError('Не удалось отобразить страницу PDF.');
      });
    });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [pdf, selectedPage, zoomPct]);

  const totalPages = pdf?.numPages ?? 0;
  const remarks: (RemarkDTO & { pkgStatus: 'draft' | 'published' })[] = packages
    .filter((p) => p.versionNum === selectedVersionNum)
    .flatMap((p) => p.remarks.map((r) => ({ ...r, pkgStatus: p.status })));
  const pageRemarks = remarks.filter((r) => r.pageNumber === selectedPage);

  if (!currentVersion) return <div className="rounded-xl p-6 text-center">Версии документа отсутствуют.</div>;

  const placePin = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isPdf || !pdf || !canPlacePin || !onPlacePin) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPlacePin({
      pageNumber: selectedPage,
      xNorm: Number(Math.max(0.02, Math.min(0.98, (event.clientX - rect.left) / rect.width)).toFixed(3)),
      yNorm: Number(Math.max(0.02, Math.min(0.98, (event.clientY - rect.top) / rect.height)).toFixed(3)),
    });
  };

  return <div className="flex flex-col gap-3 min-w-0">
    <div className="bg-surface-container-lowest rounded-xl p-3 border border-outline-variant/50 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold uppercase text-on-surface-variant mr-1">Версия:</span>
        {versions.map((ver) => <button key={ver.id} type="button" onClick={() => { onSelectVersionNum(ver.versionNum); onSelectPage(1); }}
          className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold ${ver.versionNum === selectedVersionNum ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface'}`}>
          v{ver.versionNum} {ver.isLate ? '(поздняя)' : ''}
        </button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isPdf && <div className="flex items-center gap-1 bg-surface-container-low rounded-lg p-1">
          <button type="button" disabled={!pdf || selectedPage <= 1} onClick={() => onSelectPage(selectedPage - 1)} aria-label="Предыдущая страница" className="px-2 disabled:opacity-40">←</button>
          <span className="text-[12px] font-mono px-1">Стр. {selectedPage}/{totalPages || '…'}</span>
          <button type="button" disabled={!pdf || selectedPage >= totalPages} onClick={() => onSelectPage(selectedPage + 1)} aria-label="Следующая страница" className="px-2 disabled:opacity-40">→</button>
        </div>}
        {isPdf && [75, 100, 125].map((z) => <button key={z} type="button" onClick={() => setZoomPct(z)}
          className={`px-2 py-1 rounded text-[11px] font-mono ${zoomPct === z ? 'bg-primary text-on-primary' : 'bg-surface-container-low'}`}>{z}%</button>)}
        <button type="button" onClick={() => onDownloadVersion(currentVersion)} className="px-3 py-1.5 rounded-lg bg-secondary text-on-secondary text-[12px] font-semibold">Скачать файл</button>
      </div>
    </div>
    <div className="bg-surface-container-low rounded-lg px-3 py-2 text-[12px] break-words">
      <strong>{currentVersion.fileName}</strong> · {formatBytes(currentVersion.fileSize)} · {formatAlmatyDateTime(currentVersion.submittedAt)}
    </div>
    {isPdf ? <>
      {canPlacePin && <p className="text-[12px] text-primary">Нажмите на отображённый PDF, чтобы поставить метку. Для клавиатуры укажите номер страницы в форме замечания.</p>}
      {loadError && <p role="alert" className="text-error text-[13px]">{loadError} Скачайте файл для просмотра.</p>}
      {!pdf && !loadError && <p role="status" className="text-[13px]">Загрузка PDF…</p>}
      <div className="bg-surface-dim/50 rounded-xl p-3 overflow-auto border border-outline-variant/40">
        <div onClick={placePin} className={`relative mx-auto w-fit shadow-md ${pdf && canPlacePin ? 'cursor-crosshair' : ''}`}>
          <canvas ref={canvasRef} className="block max-w-none bg-white" aria-label={`Страница ${selectedPage} PDF документа`} />
          {pdf && pageRemarks.map((rem, idx) => rem.xNorm === null || rem.yNorm === null ? null :
            <span key={rem.id} title={rem.text} style={{ left: `${rem.xNorm * 100}%`, top: `${rem.yNorm * 100}%` }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 border-white pointer-events-none ${rem.status === 'closed' ? 'bg-secondary text-on-secondary' : rem.pkgStatus === 'draft' ? 'bg-tertiary text-on-tertiary' : 'bg-error text-on-error'}`}>{idx + 1}</span>)}
          {pdf && pendingPin?.pageNumber === selectedPage && <span style={{ left: `${pendingPin.xNorm * 100}%`, top: `${pendingPin.yNorm * 100}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center pointer-events-none">+</span>}
        </div>
      </div>
    </> : <div className="bg-surface-container-low rounded-xl p-5 text-[13px]">
      Предпросмотр DOCX недоступен. Скачайте исходный файл; замечание можно привязать к номеру страницы без координатной метки.
    </div>}
  </div>;
};
