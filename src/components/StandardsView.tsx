import React, { useState } from 'react';
import { UILang } from '../types';
import { downloadEditableTemplateDocx } from '../utils/exportDoc';

interface StandardsViewProps {
  lang: UILang;
  onShowToast: (text: string, tone?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const StandardsView: React.FC<StandardsViewProps> = ({ lang, onShowToast }) => {
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      await downloadEditableTemplateDocx();
      onShowToast('Редактируемый шаблон DOCX скачан.', 'success');
    } catch (error) {
      onShowToast(error instanceof Error ? error.message : 'Не удалось скачать шаблон.', 'error');
    } finally {
      setDownloading(false);
    }
  };
  return (
    <section className="bg-surface-container-lowest rounded-xl p-5 sm:p-7 border border-outline-variant/50 max-w-3xl space-y-4">
      <h1 className="font-display text-[21px] font-bold text-primary">{lang === 'kz' ? 'Құжат үлгісі' : 'Шаблон документа'}</h1>
      <p className="text-[14px]">Скачайте редактируемый DOCX с полями для заполнения. Параметры оформления служат отправной точкой: требования к конкретной работе указывает преподаватель в задании.</p>
      <p className="text-[13px] text-on-surface-variant">Шаблон не является утверждённой методичкой кафедры и не подтверждает соответствие какому-либо стандарту автоматически.</p>
      <button type="button" disabled={downloading} onClick={download} className="bg-primary text-on-primary rounded-lg px-4 py-2.5 font-semibold disabled:opacity-50">{downloading ? 'Подготовка…' : 'Скачать DOCX'}</button>
    </section>
  );
};
