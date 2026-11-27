import React, { useState } from 'react';
import { UILang } from '../types';
import { downloadGostTemplateDocx } from '../utils/exportDoc';

interface StandardsViewProps {
  lang: UILang;
  onShowToast: (text: string, tone?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const StandardsView: React.FC<StandardsViewProps> = ({ lang, onShowToast }) => {
  const [citType, setCitType] = useState<'book' | 'doi' | 'web'>('web');
  const [citAuthor, setCitAuthor] = useState('Омарова Г. К.');
  const [citTitle, setCitTitle] = useState('Модули автоматизации нормоконтроля в вузах');
  const [citSource, setCitSource] = useState(
    'https://www.gov.kz/memleket/entities/mti'
  );
  const [citDate, setCitDate] = useState('12.04.2024');

  const generatedCitation =
    citType === 'web'
      ? `${citAuthor} ${citTitle} [Электронный ресурс]. — URL: ${citSource} (дата обращения: ${citDate}).`
      : citType === 'doi'
      ? `${citAuthor} ${citTitle} // IEEE Access. — 2024. — DOI: ${citSource}.`
      : `${citAuthor} ${citTitle}. — Шымкент: ЮКУ им. М. Ауэзова, 2024. — 148 с.`;

  return (
    <div className="flex flex-col w-full gap-6">
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary text-on-primary flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[28px]">menu_book</span>
          </div>
          <div>
            <h1 className="font-display text-[20px] font-bold text-primary">
              {lang === 'kz'
                ? 'МЕМСТ 7.32-2017 және ҚР СТ 1048-2002 нормативтері'
                : 'Нормативы ГОСТ 7.32-2017 и СТ РК 1048-2002'}
            </h1>
            <p className="text-[13px] text-on-surface-variant mt-0.5">
              Эталонные требования кафедры ИС ЮКУ им. М. Ауэзова (Шымкент)
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            downloadGostTemplateDocx();
            onShowToast('Эталонный шаблон СТ РК 1048-2002 скачан (.doc)', 'success');
          }}
          className="px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-container text-on-primary text-[13px] font-semibold flex items-center gap-2 cursor-pointer shrink-0"
        >
          <span className="material-symbols-outlined text-[18px]">download</span>
          <span>Скачать эталонный шаблон</span>
        </button>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Interactive A4 Page Margin Diagram */}
        <section className="xl:col-span-5 bg-surface-container-lowest rounded-xl p-6 shadow-sm flex flex-col gap-4">
          <h2 className="font-display text-[16px] font-bold text-on-surface">
            Геометрия листа А4 по ГОСТ 7.32
          </h2>
          <div className="bg-surface-container rounded-xl p-6 flex items-center justify-center">
            <div className="w-60 aspect-[1/1.414] bg-white rounded shadow-md relative p-4 flex flex-col justify-between text-black">
              <div className="text-center text-[10px] font-mono text-secondary font-semibold">
                ↑ Верхнее: 20 мм
              </div>
              <div className="flex-1 my-2 border border-dashed border-primary/40 flex items-center justify-center p-3 text-center">
                <div className="space-y-1.5 text-[11px] text-on-surface-variant">
                  <div className="font-bold text-primary">Область текста</div>
                  <div>Times New Roman 14 pt</div>
                  <div>Интервал: 1.5</div>
                  <div>Абзац: 1.25 см</div>
                </div>
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono text-primary font-semibold">
                <span>← Левое: 30 мм</span>
                <span>Правое: 10 мм →</span>
              </div>
              <div className="text-center text-[10px] font-mono text-secondary font-semibold mt-1">
                ↓ Нижнее: 20 мм · Номер стр.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-[12px]">
            {[
              ['Подрисуночные надписи', '12 pt, по центру, без точки'],
              ['Таблицы', '12 pt, заголовок над таблицей'],
              ['Листинги кода', 'Courier New 10 pt, интервал 1.0'],
              ['Заголовки разделов', 'Прописные, полужирный, без точки'],
            ].map(([k, v]) => (
              <div key={k} className="p-3 rounded-lg bg-surface-container-low">
                <span className="text-[11px] text-on-surface-variant block">{k}</span>
                <span className="font-semibold text-on-surface">{v}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Interactive Citation Formatter & Rules */}
        <section className="xl:col-span-7 flex flex-col gap-6">
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-display text-[16px] font-bold text-on-surface">
                Генератор библиографической ссылки (ГОСТ 7.1-2003)
              </h2>
              <div className="inline-flex p-0.5 bg-surface-container rounded-lg">
                {[
                  { id: 'web' as const, label: 'Веб-ресурс' },
                  { id: 'doi' as const, label: 'Статья DOI' },
                  { id: 'book' as const, label: 'Книга' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setCitType(opt.id)}
                    className={`px-3 py-1 rounded-md text-[12px] font-semibold cursor-pointer ${
                      citType === opt.id
                        ? 'bg-surface-container-lowest text-primary shadow-xs'
                        : 'text-on-surface-variant'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
              <input
                type="text"
                value={citAuthor}
                onChange={(e) => setCitAuthor(e.target.value)}
                placeholder="Автор(ы)"
                className="px-3 py-2 rounded-lg bg-surface-container-low text-on-surface focus:outline-none"
              />
              <input
                type="text"
                value={citTitle}
                onChange={(e) => setCitTitle(e.target.value)}
                placeholder="Название работы или ресурса"
                className="px-3 py-2 rounded-lg bg-surface-container-low text-on-surface focus:outline-none"
              />
              <input
                type="text"
                value={citSource}
                onChange={(e) => setCitSource(e.target.value)}
                placeholder={citType === 'doi' ? 'DOI идентификатор' : 'URL или издательство'}
                className="px-3 py-2 rounded-lg bg-surface-container-low text-on-surface focus:outline-none"
              />
              <input
                type="text"
                value={citDate}
                onChange={(e) => setCitDate(e.target.value)}
                placeholder="Дата обращения (ДД.ММ.ГГГГ)"
                className="px-3 py-2 rounded-lg bg-surface-container-low text-on-surface focus:outline-none"
              />
            </div>

            <div className="p-3.5 rounded-xl bg-surface-container-low flex items-center justify-between gap-3">
              <p className="text-[13px] font-mono text-on-surface break-words">
                {generatedCitation}
              </p>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(generatedCitation);
                  onShowToast('Ссылка скопирована по стандарту ГОСТ', 'success');
                }}
                className="px-3 py-2 rounded-lg bg-primary text-on-primary text-[12px] font-semibold shrink-0 cursor-pointer"
              >
                Копировать
              </button>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm flex flex-col gap-3">
            <h2 className="font-display text-[16px] font-bold text-on-surface">
              Частые причины возврата на доработку
            </h2>
            <div className="space-y-2.5 text-[13px]">
              {[
                [
                  'СТ РК 1048-2002 § 5.3',
                  'Подрисуночная подпись набрана 14 pt вместо 12 pt или завершается точкой.',
                ],
                [
                  'ГОСТ 7.32-2017 п. 5.12',
                  'У веб-ресурсов отсутствует дата обращения в формате «(дата обращения: ДД.ММ.ГГГГ)».',
                ],
                [
                  'ГОСТ 7.32-2017 п. 6.7',
                  'При переносе таблицы на следующую страницу не добавлен заголовок «Продолжение таблицы X.X».',
                ],
              ].map(([rule, desc]) => (
                <div
                  key={rule}
                  className="p-3 rounded-lg bg-surface-container-low flex items-start justify-between gap-3"
                >
                  <div>
                    <span className="text-[11px] font-mono font-semibold text-primary">
                      {rule}
                    </span>
                    <p className="text-on-surface mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
