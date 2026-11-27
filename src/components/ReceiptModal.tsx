import React from 'react';
import { ReceiptDTO, UILang } from '../types';
import { formatAlmatyDateTime } from '../api/client';

interface ReceiptModalProps {
  receipt: ReceiptDTO | null;
  studentName?: string;
  groupName?: string;
  assignmentTitle?: string;
  lang: UILang;
  onClose: () => void;
  onGoToSubmissions?: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  receipt,
  studentName,
  groupName,
  assignmentTitle,
  lang,
  onClose,
  onGoToSubmissions,
}) => {
  if (!receipt) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/55 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-container-lowest w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-outline-variant/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-primary text-on-primary px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="material-symbols-outlined text-[24px] shrink-0">verified</span>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-on-primary-container font-semibold">
                {lang === 'kz' ? 'Электрондық түбіртек' : 'Подтверждение сохранения на сервере'}
              </p>
              <h2 id="receipt-dialog-title" className="font-display font-bold text-[17px] truncate">
                Квитанция {receipt.receiptNumber} · v{receipt.versionNum}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно"
            className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center cursor-pointer"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-3 text-[13px]">
          {assignmentTitle && (
            <div className="bg-surface-container-low rounded-lg p-3">
              <p className="text-[11px] uppercase text-on-surface-variant font-semibold">Задание</p>
              <p className="font-semibold text-on-surface mt-0.5">{assignmentTitle}</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-surface-container-low rounded-lg p-3">
              <p className="text-[11px] uppercase text-on-surface-variant font-semibold">Студент / Группа</p>
              <p className="font-medium mt-0.5">{studentName || '—'}</p>
              {groupName && <p className="text-[12px] text-secondary font-mono">{groupName}</p>}
            </div>
            <div className="bg-surface-container-low rounded-lg p-3">
              <p className="text-[11px] uppercase text-on-surface-variant font-semibold">Время фиксации</p>
              <p className="font-medium mt-0.5">{formatAlmatyDateTime(receipt.issuedAt)}</p>
              <p className="text-[11px] font-mono text-on-surface-variant">{receipt.timezoneLabel}</p>
            </div>
          </div>

          <div className="bg-surface-container-low rounded-lg p-3">
            <p className="text-[11px] uppercase text-on-surface-variant font-semibold">
              Неизменяемая контрольная сумма версии (SHA-256)
            </p>
            <p className="font-mono text-[11px] text-primary break-all mt-1">
              {receipt.sha256Hex}
            </p>
          </div>

          <p className="text-[12px] text-on-surface-variant">
            Квитанция выдаётся только после записи версии на сервере. Повторная отправка с тем же ключом не создаёт дубль сдачи.
          </p>
        </div>

        <div className="px-5 py-4 bg-surface-container-low flex flex-wrap justify-end gap-2">
          {onGoToSubmissions && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onGoToSubmissions();
              }}
              className="px-4 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface font-semibold text-[13px] cursor-pointer"
            >
              К реестру сдач
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-primary text-on-primary font-semibold text-[13px] cursor-pointer"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
};
