import React, { useState } from 'react';
import { HealthInfoDTO, UILang } from '../types';

interface LoginViewProps {
  lang: UILang;
  onToggleLang: (lang: UILang) => void;
  health: HealthInfoDTO | null;
  onLogin: (email: string, password: string) => Promise<void>;
  sessionExpiredMessage: string | null;
  networkError: string | null;
}

export const LoginView: React.FC<LoginViewProps> = ({ lang, onToggleLang, health, onLogin, sessionExpiredMessage, networkError }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onLogin(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось войти.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-surface text-on-surface flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-surface-container-lowest rounded-[28px] border border-outline-variant/50 shadow-[0_24px_80px_rgba(24,32,51,0.09)] p-6 sm:p-9 flex flex-col gap-7">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3 items-center min-w-0">
            <span className="w-11 h-11 rounded-2xl bg-primary text-on-primary flex items-center justify-center material-symbols-outlined shadow-sm shrink-0">verified_user</span>
            <div className="min-w-0"><h1 className="font-display text-[17px] sm:text-[20px] font-semibold text-on-surface break-words">НормКонтрольЦентр</h1><p className="text-[12px] text-on-surface-variant">Сдача и проверка учебных работ</p></div>
          </div>
          <div className="flex gap-1" aria-label="Язык интерфейса">
            <button type="button" onClick={() => onToggleLang('ru')} aria-pressed={lang === 'ru'} className={`min-h-10 min-w-11 px-2 py-1 rounded-xl border text-[11px] font-semibold ${lang === 'ru' ? 'bg-primary-fixed border-primary-fixed text-primary' : 'border-outline-variant text-on-surface-variant'}`}>РУС</button>
            <button type="button" onClick={() => onToggleLang('kz')} aria-pressed={lang === 'kz'} className={`min-h-10 min-w-11 px-2 py-1 rounded-xl border text-[11px] font-semibold ${lang === 'kz' ? 'bg-primary-fixed border-primary-fixed text-primary' : 'border-outline-variant text-on-surface-variant'}`}>ҚАЗ</button>
          </div>
        </header>
        {(sessionExpiredMessage || networkError || error || (health && !health.dbReady)) && (
          <div role="alert" className="bg-error-container text-on-error-container rounded-lg px-3 py-2 text-[13px]">
            {error || sessionExpiredMessage || networkError || 'База данных недоступна. Повторите попытку позже.'}
          </div>
        )}
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h2 className="font-display font-semibold text-[22px] tracking-tight">{lang === 'kz' ? 'Жүйеге кіру' : 'Вход в систему'}</h2>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Логин или email
            <input type="text" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Логин или email" className="rounded-xl border border-outline-variant px-3.5 py-2.5 bg-surface-container-low" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">{lang === 'kz' ? 'Құпиясөз' : 'Пароль'}
            <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="rounded-xl border border-outline-variant px-3.5 py-2.5 bg-surface-container-low" />
          </label>
          <button type="submit" disabled={submitting || health?.dbReady === false} className="bg-primary text-on-primary rounded-xl min-h-12 px-4 py-2.5 font-semibold shadow-sm disabled:opacity-50">{submitting ? 'Проверка…' : lang === 'kz' ? 'Кіру' : 'Войти'}</button>
        </form>
        <p className="text-[12px] text-on-surface-variant">Учётную запись выдаёт администратор организации. Если пароль забыт, обратитесь к администратору сервера.</p>
      </div>
    </main>
  );
};
