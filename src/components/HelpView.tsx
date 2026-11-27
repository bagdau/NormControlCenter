import React, { useState } from 'react';
import { UILang } from '../types';

interface HelpViewProps {
  lang: UILang;
  onShowToast: (text: string, tone?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const HelpView: React.FC<HelpViewProps> = ({ lang, onShowToast }) => {
  const [question, setQuestion] = useState('');
  const [sentMessages, setSentMessages] = useState<
    { id: string; text: string; time: string }[]
  >([]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setSentMessages((prev) => [
      {
        id: `msg-${Date.now()}`,
        text: question.trim(),
        time: 'Только что · Шымкент (UTC+5)',
      },
      ...prev,
    ]);
    setQuestion('');
    onShowToast('Обращение отправлено нормоконтролеру доц. Омаровой Г. К.', 'success');
  };

  return (
    <div className="flex flex-col w-full gap-6">
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary-container text-on-primary flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[28px]">account_balance</span>
          </div>
          <div>
            <h1 className="font-display text-[20px] font-bold text-primary">
              {lang === 'kz'
                ? 'Кафедра анықтамасы және регламент'
                : 'Справка и регламент кафедры'}
            </h1>
            <p className="text-[13px] text-on-surface-variant mt-0.5">
              Южно-Казахстанский университет им. М. Ауэзова · г. Шымкент, пр. Тауке хана, 5
            </p>
          </div>
        </div>
        <span className="px-3 py-1.5 rounded-full bg-secondary-container text-on-secondary-container text-[12px] font-semibold self-start md:self-center">
          SLA проверки: ≤ 48 ч
        </span>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm space-y-3">
            <h2 className="font-display text-[16px] font-bold text-on-surface">
              Регламент прохождения нормоконтроля
            </h2>
            {[
              [
                '1. Первичная подача (v1)',
                'Студент загружает PDF/DOCX или формирует документ в Онлайн-конструкторе. Сервер фиксирует время UTC+5 и выдает квитанцию.',
              ],
              [
                '2. Авто-пречекинг и аудит (до 48 ч)',
                'Система проверяет поля (30/10/20/20 мм) и шрифты, после чего нормоконтролер кафедры проводит предметную проверку.',
              ],
              [
                '3. Устранение замечаний (v2 / v3)',
                'При наличии правок студент получает детальный чек-лист со страницами и пунктами ГОСТ и загружает исправленную версию.',
              ],
              [
                '4. Выдача листа согласования с ЭЦП',
                'После закрытия всех замечаний документ получает QR-штамп кафедры и допускается к защите.',
              ],
            ].map(([title, body]) => (
              <div key={title} className="p-3.5 rounded-xl bg-surface-container-low">
                <div className="text-[13px] font-bold text-primary">{title}</div>
                <p className="text-[13px] text-on-surface-variant mt-1 leading-relaxed">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-4">
          <form
            onSubmit={handleSend}
            className="bg-surface-container-lowest rounded-xl p-6 shadow-sm flex flex-col gap-3"
          >
            <h2 className="font-display text-[16px] font-bold text-on-surface">
              Вопрос нормоконтролеру
            </h2>
            <p className="text-[12px] text-on-surface-variant">
              Получатель: доц. Омарова Гульнар Касымовна (Кафедра ИС, ауд. 314Г)
            </p>
            <textarea
              rows={4}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Опишите вопрос по оформлению титульного листа, таблиц или библиографии..."
              className="w-full p-3 rounded-xl bg-surface-container-low text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-[13px] font-semibold cursor-pointer"
            >
              Отправить обращение
            </button>

            {sentMessages.length > 0 && (
              <div className="pt-2 space-y-2">
                {sentMessages.map((m) => (
                  <div
                    key={m.id}
                    className="p-3 rounded-lg bg-secondary-container/40 text-[12px] text-on-surface"
                  >
                    <div className="text-[11px] text-secondary font-semibold">
                      Отправлено · {m.time}
                    </div>
                    <p className="mt-0.5">{m.text}</p>
                  </div>
                ))}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};
