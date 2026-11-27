import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ForbiddenError,
  NetworkOfflineError,
  SessionExpiredError,
  api,
  formatAlmatyShortTime,
  setCsrfToken,
} from './api/client';
import { LoginView } from './components/LoginView';
import { ReceiptModal } from './components/ReceiptModal';
import {
  HealthInfoDTO,
  PublicUserDTO,
  ReceiptDTO,
  RoleNavTab,
  SubmissionBundleDTO,
  ToastMessage,
  UILang,
  UserRole,
} from './types';

const AdminWorkspace = lazy(() => import('./components/AdminWorkspace').then((module) => ({ default: module.AdminWorkspace })));
const HelpView = lazy(() => import('./components/HelpView').then((module) => ({ default: module.HelpView })));
const StandardsView = lazy(() => import('./components/StandardsView').then((module) => ({ default: module.StandardsView })));
const StudentWorkspace = lazy(() => import('./components/StudentWorkspace').then((module) => ({ default: module.StudentWorkspace })));
const TeacherWorkspace = lazy(() => import('./components/TeacherWorkspace').then((module) => ({ default: module.TeacherWorkspace })));

interface NavTabItem {
  id: RoleNavTab;
  labelRu: string;
  labelKz: string;
  icon: string;
}

const ROLE_TABS: Record<UserRole, NavTabItem[]> = {
  student: [
    { id: 'student_assignments', labelRu: 'Задания', labelKz: 'Тапсырмалар', icon: 'assignment' },
    { id: 'student_submissions', labelRu: 'Мои сдачи', labelKz: 'Өткізулерім', icon: 'receipt_long' },
    { id: 'student_revisions', labelRu: 'Нужно исправить', labelKz: 'Түзету қажет', icon: 'rule' },
    { id: 'student_spaces', labelRu: 'Пространство', labelKz: 'Кеңістік', icon: 'forum' },
    { id: 'standards', labelRu: 'ГОСТ', labelKz: 'МЕМСТ', icon: 'menu_book' },
    { id: 'help', labelRu: 'Справка', labelKz: 'Анықтама', icon: 'help' },
  ],
  teacher: [
    { id: 'teacher_queue', labelRu: 'Очередь', labelKz: 'Кезек', icon: 'view_list' },
    { id: 'teacher_review', labelRu: 'Проверка', labelKz: 'Тексеру', icon: 'fact_check' },
    { id: 'teacher_spaces', labelRu: 'Пространство', labelKz: 'Кеңістік', icon: 'dashboard' },
    { id: 'standards', labelRu: 'ГОСТ', labelKz: 'МЕМСТ', icon: 'menu_book' },
    { id: 'help', labelRu: 'Справка', labelKz: 'Анықтама', icon: 'help' },
  ],
  admin: [
    { id: 'admin_structure', labelRu: 'Структура', labelKz: 'Құрылым', icon: 'account_tree' },
    { id: 'admin_accounts', labelRu: 'Учётные записи', labelKz: 'Есептік жазбалар', icon: 'group' },
    { id: 'admin_assignments', labelRu: 'Назначения', labelKz: 'Тағайындаулар', icon: 'assignment_ind' },
    { id: 'help', labelRu: 'Справка', labelKz: 'Анықтама', icon: 'help' },
  ],
};

const DEFAULT_TAB_BY_ROLE: Record<UserRole, RoleNavTab> = {
  student: 'student_assignments',
  teacher: 'teacher_queue',
  admin: 'admin_structure',
};

export default function App() {
  const [lang, setLang] = useState<UILang>('ru');
  const [health, setHealth] = useState<HealthInfoDTO | null>(null);
  const [user, setUser] = useState<PublicUserDTO | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<RoleNavTab>('student_assignments');

  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [activeReceiptState, setActiveReceiptState] = useState<{
    receipt: ReceiptDTO;
    bundle: SubmissionBundleDTO;
  } | null>(null);
  const [shymkentTimeShort, setShymkentTimeShort] = useState(() => formatAlmatyShortTime());
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileMoreTouchY = useRef<number | null>(null);
  const passwordDialogRef = useRef<HTMLFormElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!changePasswordOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    passwordInputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChangePasswordOpen(false);
      if (event.key !== 'Tab' || !passwordDialogRef.current) return;
      const focusable = Array.from(passwordDialogRef.current.querySelectorAll<HTMLElement>('input, button:not(:disabled)'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previouslyFocused?.focus(); };
  }, [changePasswordOpen]);

  useEffect(() => {
    const timer = setInterval(() => {
      setShymkentTimeShort(formatAlmatyShortTime());
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onOffline = () =>
      setNetworkError('Потеряно подключение к сети. Открытые поля доступны до обновления страницы. Проверьте статус сдачи после восстановления связи.');
    const onOnline = () => setNetworkError(null);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    api.getMe().then((session) => {
      setUser(session.user);
      setActiveTab(DEFAULT_TAB_BY_ROLE[session.user.role]);
    }).catch((err) => {
      if (!(err instanceof SessionExpiredError)) setNetworkError('Не удалось проверить сессию. Проверьте подключение.');
    }).finally(() => setAuthChecking(false));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const h = await api.getHealth();
        setHealth(h);
      } catch {
        setNetworkError('Сервер API недоступен. Проверьте подключение.');
      }
    })();
  }, []);

  const showToast = (
    text: string,
    tone: 'success' | 'info' | 'warning' | 'error' = 'info'
  ) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-2), { id, text, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const handleAuthError = (err: unknown) => {
    if (err instanceof SessionExpiredError) {
      setCsrfToken(null);
      setUser(null);
      setSessionExpiredMessage(err.message);
      return;
    }
    if (err instanceof ForbiddenError) {
      showToast(err.message, 'error');
      return;
    }
    if (err instanceof NetworkOfflineError) {
      setNetworkError(err.message);
      return;
    }
  };

  const handleLogin = async (email: string, password: string) => {
    setSessionExpiredMessage(null);
    setNetworkError(null);
    const res = await api.login(email, password);
    setUser(res.user);
    setActiveTab(DEFAULT_TAB_BY_ROLE[res.user.role]);
    showToast(`Вход выполнен: ${res.user.shortName}`, 'success');
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    setActiveReceiptState(null);
  };

  const handleChangePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await api.changePassword(currentPassword, newPassword);
      setCsrfToken(null);
      setUser(null);
      setChangePasswordOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setSessionExpiredMessage('Пароль изменён. Войдите заново.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Не удалось изменить пароль.', 'error');
    }
  };

  if (authChecking) return <div className="min-h-screen flex items-center justify-center gap-3 text-on-surface-variant" role="status"><span className="material-symbols-outlined animate-spin">progress_activity</span>Проверка сессии…</div>;

  if (!user) {
    return (
      <LoginView
        lang={lang}
        onToggleLang={setLang}
        health={health}
        onLogin={handleLogin}
        sessionExpiredMessage={sessionExpiredMessage}
        networkError={networkError}
      />
    );
  }

  const tabs = ROLE_TABS[user.role];
  const mobilePrimaryTabs = tabs.length > 4 ? tabs.slice(0, 4) : tabs;
  const mobileMoreTabs = tabs.length > 4 ? tabs.slice(4) : [];
  const activeTabTitle = tabs.find((tab) => tab.id === activeTab);

  return (
    <div className="app-shell min-h-screen bg-surface text-on-surface flex flex-col lg:flex-row">
      <a href="#main-content" className="skip-link">{lang === 'kz' ? 'Мазмұнға өту' : 'Перейти к содержанию'}</a>
      {/* Desktop Left Sidebar (>= 1024px) */}
      <aside className="app-sidebar hidden lg:flex lg:w-72 lg:shrink-0 lg:flex-col bg-surface-container-lowest border-r border-outline-variant/50 px-4 py-6 justify-between">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3 px-2 pt-1">
            <div className="w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center shrink-0 shadow-sm">
              <span className="material-symbols-outlined text-[20px]">verified_user</span>
            </div>
            <div className="min-w-0">
              <p className="font-display font-semibold text-[15px] text-on-surface leading-tight truncate">
                {lang === 'kz' ? 'НормБақылауОрталығы' : 'НормКонтрольЦентр'}
              </p>
              <p className="text-[11px] text-on-surface-variant truncate">Учебные работы</p>
            </div>
          </div>

          <nav aria-label="Основная навигация" className="flex flex-col gap-1 mt-3">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className={`app-nav-item w-full flex items-center gap-3 px-3 py-3 rounded-xl text-[13px] font-semibold transition-colors cursor-pointer text-left ${
                  activeTab === tab.id
                    ? 'bg-primary-fixed text-primary'
                    : 'text-on-surface hover:bg-surface-container-low'
                }`}
              >
                <span className="material-symbols-outlined text-[19px] shrink-0">{tab.icon}</span>
                <span className="truncate">{lang === 'kz' ? tab.labelKz : tab.labelRu}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-3 border-t border-outline-variant/40 pt-4">
          <div className="bg-surface-container-low rounded-2xl p-3.5 text-[12px]">
            <p className="font-bold text-on-surface truncate">{user.shortName}</p>
            <p className="text-on-surface-variant font-mono text-[11px] truncate">
              {user.role} {user.groupName ? `· ${user.groupName}` : ''}
            </p>
          </div>
          <button type="button" onClick={() => setChangePasswordOpen(true)} className="w-full min-h-11 py-2 px-3 rounded-xl border border-outline-variant text-[12px] font-semibold cursor-pointer">Сменить пароль</button>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full min-h-11 py-2 px-3 rounded-xl border border-outline-variant text-[12px] font-semibold hover:bg-error-container hover:text-on-error-container transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            <span>{lang === 'kz' ? 'Шығу' : 'Выйти'}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col pb-24 lg:pb-6">
        {/* Top Utility Header */}
        <header className="app-topbar bg-surface-container-lowest border-b border-outline-variant/40 px-4 sm:px-7 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="lg:hidden font-display font-semibold text-[15px] text-on-surface">
              {lang === 'kz' ? 'НормБақылау' : 'НормКонтроль'}
            </span>
            <span className="hidden sm:inline text-[12px] text-on-surface-variant">
              {user.fullName} {user.groupName ? `(${user.groupName})` : ''}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-on-surface-variant hidden sm:inline">
              UTC+5 · {shymkentTimeShort}
            </span>
            <div className="flex rounded-xl overflow-hidden border border-outline-variant/60" role="group" aria-label="Язык интерфейса">
              <button
                type="button"
                onClick={() => setLang('ru')}
                aria-pressed={lang === 'ru'}
                className={`min-w-11 min-h-10 px-2 py-1 text-[11px] font-bold cursor-pointer ${
                  lang === 'ru' ? 'bg-primary text-on-primary' : 'bg-white text-on-surface-variant'
                }`}
              >
                РУС
              </button>
              <button
                type="button"
                onClick={() => setLang('kz')}
                aria-pressed={lang === 'kz'}
                className={`min-w-11 min-h-10 px-2 py-1 text-[11px] font-bold cursor-pointer ${
                  lang === 'kz' ? 'bg-primary text-on-primary' : 'bg-white text-on-surface-variant'
                }`}
              >
                ҚАЗ
              </button>
            </div>
            <button
              type="button"
              onClick={() => setChangePasswordOpen(true)}
              className="lg:hidden min-h-10 px-2.5 py-1 rounded-xl border border-outline-variant text-[11px] font-semibold cursor-pointer"
            >
              Пароль
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="lg:hidden min-h-10 px-2.5 py-1 rounded-xl border border-outline-variant text-[11px] font-semibold cursor-pointer"
            >
              Выход
            </button>
          </div>
        </header>

        {/* System Status / Network Banners */}
        <div className="px-4 sm:px-6 pt-4 flex flex-col gap-2">

          {networkError && (
            <div
              role="alert"
              className="bg-error-container text-on-error-container rounded-lg px-3 py-2 text-[12px] flex flex-wrap items-center justify-between gap-2"
            >
              <span>{networkError}</span>
              <button
                type="button"
                onClick={() => setNetworkError(null)}
                className="font-semibold underline cursor-pointer"
              >
                Скрыть
              </button>
            </div>
          )}
        </div>

        {/* Active Role View */}
        <main id="main-content" tabIndex={-1} className="p-4 sm:p-7 lg:p-8 max-w-7xl w-full mx-auto flex-1 min-w-0">
          <div className="app-page-heading mb-6">
            <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-on-surface-variant mb-1">{user.role === 'student' ? (lang === 'kz' ? 'Студент' : 'Студент') : user.role === 'teacher' ? (lang === 'kz' ? 'Оқытушы' : 'Преподаватель') : (lang === 'kz' ? 'Әкімші' : 'Администратор')}</p>
            <h1 className="font-display font-semibold text-[25px] sm:text-[30px] leading-tight tracking-tight">{activeTabTitle ? (lang === 'kz' ? activeTabTitle.labelKz : activeTabTitle.labelRu) : ''}</h1>
          </div>
          <Suspense fallback={<div role="status" className="rounded-2xl bg-surface-container-lowest border border-outline-variant px-5 py-6 text-on-surface-variant">Загрузка раздела…</div>}>
          {user.role === 'student' &&
            activeTab !== 'standards' &&
            activeTab !== 'help' && (
              <StudentWorkspace
                lang={lang}
                user={user}
                activeTab={activeTab}
                onNavigateTab={setActiveTab}
                onOpenReceipt={(receipt, bundle) =>
                  setActiveReceiptState({ receipt, bundle })
                }
                onShowToast={showToast}
                onAuthError={handleAuthError}
              />
            )}

          {user.role === 'teacher' &&
            activeTab !== 'standards' &&
            activeTab !== 'help' && (
              <TeacherWorkspace
                user={user}
                activeTab={activeTab}
                onNavigateTab={setActiveTab}
                onShowToast={showToast}
                onAuthError={handleAuthError}
              />
            )}

          {user.role === 'admin' &&
            activeTab !== 'help' && (
              <AdminWorkspace
                activeTab={activeTab}
                onShowToast={showToast}
                onAuthError={handleAuthError}
              />
            )}

          {activeTab === 'standards' && (
            <StandardsView lang={lang} onShowToast={showToast} />
          )}

          {activeTab === 'help' && <HelpView lang={lang} />}
          </Suspense>
        </main>
      </div>

      {/* Tablet & Mobile Bottom Navigation (< 1024px) */}
      {mobileMoreOpen && mobileMoreTabs.length > 0 && (
        <div className="mobile-more-panel lg:hidden" role="group" aria-label={lang === 'kz' ? 'Қосымша бөлімдер' : 'Другие разделы'}
          onTouchStart={(event) => { mobileMoreTouchY.current = event.touches[0].clientY; }}
          onTouchEnd={(event) => { const start = mobileMoreTouchY.current; mobileMoreTouchY.current = null; if (start !== null && event.changedTouches[0].clientY - start > 70) setMobileMoreOpen(false); }}
        >
          {mobileMoreTabs.map((tab) => (
            <button key={tab.id} type="button" onClick={() => { setActiveTab(tab.id); setMobileMoreOpen(false); }} aria-current={activeTab === tab.id ? 'page' : undefined} className={`mobile-more-item ${activeTab === tab.id ? 'is-active' : ''}`}>
              <span className="material-symbols-outlined" aria-hidden="true">{tab.icon}</span>
              {lang === 'kz' ? tab.labelKz : tab.labelRu}
            </button>
          ))}
        </div>
      )}
      <nav
        aria-label="Мобильная навигация"
        className="app-mobile-nav lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-container-lowest border-t border-outline-variant/60 flex items-center justify-around px-1 py-1.5 pb-safe"
      >
        {mobilePrimaryTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => { setActiveTab(tab.id); setMobileMoreOpen(false); }}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={`flex flex-col items-center justify-center min-w-0 min-h-14 flex-1 py-1 rounded-xl text-[10px] font-semibold cursor-pointer ${
              activeTab === tab.id ? 'text-primary bg-primary-fixed/40' : 'text-on-surface-variant'
            }`}
          >
            <span className="material-symbols-outlined text-[19px]">{tab.icon}</span>
            <span className="truncate max-w-full px-1">
              {lang === 'kz' ? tab.labelKz : tab.labelRu}
            </span>
          </button>
        ))}
        {mobileMoreTabs.length > 0 && <button type="button" onClick={() => setMobileMoreOpen((open) => !open)} aria-expanded={mobileMoreOpen} aria-label={lang === 'kz' ? 'Қосымша бөлімдер' : 'Другие разделы'} className={`flex flex-col items-center justify-center min-w-0 min-h-14 flex-1 py-1 rounded-xl text-[10px] font-semibold cursor-pointer ${mobileMoreOpen || mobileMoreTabs.some((tab) => tab.id === activeTab) ? 'text-primary bg-primary-fixed/70' : 'text-on-surface-variant'}`}><span className="material-symbols-outlined text-[19px]">more_horiz</span><span>{lang === 'kz' ? 'Тағы' : 'Ещё'}</span></button>}
      </nav>

      {/* Receipt Modal */}
      {changePasswordOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="presentation">
          <form ref={passwordDialogRef} onSubmit={handleChangePassword} role="dialog" aria-modal="true" aria-label="Смена пароля" className="bg-surface-container-lowest rounded-2xl p-5 w-full max-w-sm flex flex-col gap-3 shadow-2xl">
            <h2 className="font-display font-bold text-[18px]">Сменить пароль</h2>
            <label className="text-[13px]">Текущий пароль<input ref={passwordInputRef} type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-outline-variant px-3 py-2" /></label>
            <label className="text-[13px]">Новый пароль (не менее 16 символов)<input type="password" autoComplete="new-password" minLength={16} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-outline-variant px-3 py-2" /></label>
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setChangePasswordOpen(false)} className="px-3 py-2 rounded-lg border border-outline-variant">Отмена</button><button type="submit" className="px-3 py-2 rounded-lg bg-primary text-on-primary">Сохранить</button></div>
          </form>
        </div>
      )}
      <ReceiptModal
        receipt={activeReceiptState?.receipt || null}
        studentName={activeReceiptState?.bundle.student.fullName}
        groupName={activeReceiptState?.bundle.groupName}
        assignmentTitle={activeReceiptState?.bundle.assignment.title}
        lang={lang}
        onClose={() => setActiveReceiptState(null)}
        onGoToSubmissions={
          user.role === 'student'
            ? () => setActiveTab('student_submissions')
            : undefined
        }
      />

      {/* Toast Notifications */}
      <div className="fixed bottom-20 lg:bottom-6 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto px-4 py-3 rounded-xl shadow-lg text-[13px] font-medium flex items-center gap-2 ${
              toast.tone === 'error'
                ? 'bg-error text-on-error'
                : toast.tone === 'warning'
                ? 'bg-inverse-surface text-inverse-on-surface'
                : toast.tone === 'success'
                ? 'bg-secondary text-on-secondary'
                : 'bg-primary text-on-primary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px] shrink-0">
              {toast.tone === 'error'
                ? 'error'
                : toast.tone === 'warning'
                ? 'warning'
                : toast.tone === 'success'
                ? 'check_circle'
                : 'info'}
            </span>
            <span>{toast.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
