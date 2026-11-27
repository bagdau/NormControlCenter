import React, { useState } from 'react';
import { HealthInfoDTO, PublicUserDTO, UILang } from '../types';

interface LoginViewProps {
  lang: UILang;
  onToggleLang: (lang: UILang) => void;
  health: HealthInfoDTO | null;
  demoAccounts: PublicUserDTO[];
  demoDefaultPassword: string;
  onLogin: (email: string, password: string) => Promise<void>;
  sessionExpiredMessage: string | null;
  networkError: string | null;
}

const ROLE_LABELS: Record<'student' | 'teacher' | 'admin', { ru: string; kz: string }> = {
  student: { ru: 'Студент', kz: 'Студент' },
  teacher: { ru: 'Преподаватель', kz: 'Оқытушы' },
  admin: { ru: 'Администратор', kz: 'Әкімші' },
};

export const LoginView: React.FC<LoginViewProps> = ({
  lang,
  onToggleLang,
  health,
  demoAccounts,
  demoDefaultPassword,
  onLogin,
  sessionExpiredMessage,
  networkError,
}) => {
  const [email, setEmail] = useState('smailov@normocontrol.local');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await onLogin(email, password);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка входа в систему.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemoQuickSignIn = async (acct: PublicUserDTO) => {
    setErrorMsg(null);
    setEmail(acct.email);
    setPassword(demoDefaultPassword);
    setSubmitting(true);
    try {
      await onLogin(acct.email, demoDefaultPassword);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка демо-входа.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface text-on-surface flex flex-col justify-between p-4 sm:p-6">
      <div className="max-w-5xl w-full mx-auto flex flex-col gap-6 my-auto">
        {/* Top bar */}
        <header className="flex flex-wrap items-center justify-between gap-3 bg-surface-container-lowest rounded-xl px-4 py-3 shadow-sm border border-outline-variant/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-primary text-on-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined">verified_user</span>
            </div>
            <div className="min-w-0">
              <h1 className="font-display font-bold text-[17px] text-primary leading-tight truncate">
                {lang === 'kz' ? 'НормБақылауОрталығы' : 'НормКонтрольЦентр'}
              </h1>
              <p className="text-[12px] text-on-surface-variant truncate">
                {lang === 'kz'
                  ? 'Құжаттарды тапсыру, ескертулер және келісу · Алматы/Шымкент (UTC+5)'
                  : 'Первая сдача, замечания, правки и согласование онлайн · Шымкент (UTC+5)'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onToggleLang('ru')}
              className={`px-2.5 py-1 rounded text-[12px] font-semibold cursor-pointer ${
                lang === 'ru'
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-low text-on-surface-variant'
              }`}
            >
              РУС
            </button>
            <button
              type="button"
              onClick={() => onToggleLang('kz')}
              className={`px-2.5 py-1 rounded text-[12px] font-semibold cursor-pointer ${
                lang === 'kz'
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-low text-on-surface-variant'
              }`}
            >
              ҚАЗ
            </button>
          </div>
        </header>

        {/* System state notices */}
        {health?.demoBanner && (
          <div
            role="status"
            className="bg-tertiary-fixed text-on-tertiary-fixed rounded-xl px-4 py-3 text-[13px] flex items-start gap-3 border border-tertiary/20"
          >
            <span className="material-symbols-outlined text-[20px] shrink-0 mt-0.5">
              science
            </span>
            <div>
              <p className="font-semibold">{health.demoBanner}</p>
              <p className="text-[12px] opacity-90 mt-0.5">
                Дополнение к действующему учебному процессу: не заменяет Платонус и не выставляет официальных оценок/ЭЦП (используется статус «Согласовано в системе»).
              </p>
            </div>
          </div>
        )}

        {sessionExpiredMessage && (
          <div
            role="alert"
            className="bg-error-container text-on-error-container rounded-xl px-4 py-3 text-[13px] font-medium flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[20px]">lock_clock</span>
            <span>{sessionExpiredMessage}</span>
          </div>
        )}

        {networkError && (
          <div
            role="alert"
            className="bg-error-container text-on-error-container rounded-xl px-4 py-3 text-[13px] font-medium flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[20px]">wifi_off</span>
            <span>{networkError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Real Server Login Form */}
          <form
            onSubmit={handleSubmit}
            className="lg:col-span-5 bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/40 flex flex-col gap-4"
          >
            <div>
              <h2 className="font-display font-bold text-[19px] text-on-surface">
                {lang === 'kz' ? 'Жүйеге кіру' : 'Вход в рабочее пространство'}
              </h2>
              <p className="text-[13px] text-on-surface-variant mt-1">
                {lang === 'kz'
                  ? 'Серверлік аутентификация (Bearer сессия).'
                  : 'Проверка логина, пароля и роли на сервере.'}
              </p>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="bg-error-container text-on-error-container rounded-lg px-3 py-2 text-[12px] font-medium"
              >
                {errorMsg}
              </div>
            )}

            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              <span>Email / Логин</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@normocontrol.local"
                className="w-full rounded-lg border border-outline-variant px-3 py-2 text-[14px] bg-surface-bright"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              <span>{lang === 'kz' ? 'Құпиясөз' : 'Пароль'}</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full rounded-lg border border-outline-variant px-3 py-2 text-[14px] bg-surface-bright"
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary text-on-primary font-semibold py-2.5 px-4 rounded-lg hover:bg-primary-container transition-colors disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">login</span>
              <span>
                {submitting
                  ? lang === 'kz'
                    ? 'Тексерілуде...'
                    : 'Проверка учётных данных...'
                  : lang === 'kz'
                  ? 'Кіру'
                  : 'Войти в систему'}
              </span>
            </button>
          </form>

          {/* Isolated Preview Demo Accounts */}
          <div className="lg:col-span-7 bg-surface-container-low rounded-xl p-6 border border-outline-variant/50 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-display font-bold text-[16px] text-primary">
                  {lang === 'kz'
                    ? 'Алдын ала қарау · Синтетикалық демо-кіру'
                    : 'Предпросмотр · Быстрый вход (синтетические роли)'}
                </h2>
                <p className="text-[12px] text-on-surface-variant mt-1">
                  Отправляет реальный запрос <code className="font-mono">POST /api/auth/login</code> с паролем демо-стенда. Показано только в режиме предпросмотра для проверки ролей и изоляции групп.
                </p>
              </div>
            </div>

            {demoAccounts.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-lg p-4 text-[13px] text-on-surface-variant">
                Демо-учётки предпросмотра отключены или загружаются. Используйте стандартную форму входа.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {demoAccounts.map((acct) => (
                  <button
                    key={acct.id}
                    type="button"
                    disabled={submitting || !acct.active}
                    onClick={() => handleDemoQuickSignIn(acct)}
                    className="text-left bg-surface-container-lowest hover:bg-surface-bright border border-outline-variant/60 hover:border-primary rounded-xl p-3.5 transition-colors cursor-pointer flex flex-col gap-1 disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-primary bg-primary-fixed px-2 py-0.5 rounded">
                        {lang === 'kz'
                          ? ROLE_LABELS[acct.role].kz
                          : ROLE_LABELS[acct.role].ru}
                      </span>
                      {acct.groupName && (
                        <span className="text-[11px] font-mono font-semibold text-secondary bg-secondary-fixed/60 px-2 py-0.5 rounded">
                          {acct.groupName}
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-[14px] text-on-surface mt-1 break-words">
                      {acct.fullName}
                    </p>
                    <p className="font-mono text-[11px] text-on-surface-variant break-all">
                      {acct.email}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="max-w-5xl w-full mx-auto pt-6 text-[12px] text-on-surface-variant flex flex-wrap justify-between gap-2">
        <span>НормКонтрольЦентр · Синтетический контур предпросмотра (без персональных данных и ПДн реальных студентов)</span>
        <span className="font-mono">Asia/Almaty (UTC+5)</span>
      </footer>
    </div>
  );
};
