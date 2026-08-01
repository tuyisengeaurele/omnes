import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../lib/store/uiStore';
import { useAuthStore } from '../lib/store/authStore';
import { NotificationBell } from '../modules/core/NotificationBell';
import styles from './AppShell.module.css';

const MODULE_NAV = [
  { key: 'modules.core', path: '/', enabled: true },
  { key: 'modules.pos', path: '/pos', enabled: false },
  { key: 'modules.inventory', path: '/inventory', enabled: false },
  { key: 'modules.crm', path: '/crm', enabled: false },
  { key: 'modules.reports', path: '/reports', enabled: false },
  { key: 'modules.admin', path: '/admin', enabled: true },
] as const;

export function AppShell() {
  const { t } = useTranslation();
  const [version, setVersion] = useState('');
  const [isDatabaseConnected, setIsDatabaseConnected] = useState<boolean | null>(null);
  const [licenseTier, setLicenseTier] = useState<string | null>(null);
  const isSidebarCollapsed = useUiStore((state) => state.isSidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const session = useAuthStore((state) => state.session);
  const logout = useAuthStore((state) => state.logout);

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.getAppVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch((error: unknown) => {
        console.error('Failed to read app version', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.checkDatabaseHealth()
      .then((result) => {
        if (!cancelled) setIsDatabaseConnected(result.connected);
      })
      .catch((error: unknown) => {
        console.error('Failed to check database health', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.getLicenseInfo()
      .then((info) => {
        if (!cancelled) setLicenseTier(info.tier);
      })
      .catch((error: unknown) => {
        console.error('Failed to read license info', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.shell}>
      <header className={styles.titlebar}>
        <span className={styles.brand}>{t('app.name')}</span>
        {version && <span className={styles.version}>v{version}</span>}
        {isDatabaseConnected !== null && (
          <span className={styles.dbStatus} data-connected={isDatabaseConnected}>
            {t(isDatabaseConnected ? 'shell.databaseConnected' : 'shell.databaseOffline')}
          </span>
        )}
        {licenseTier && (
          <span className={styles.licenseTier}>
            {t('shell.license')}: {licenseTier}
          </span>
        )}
        <NotificationBell />
        {session && (
          <div className={styles.userControls}>
            <span className={styles.username}>{session.username}</span>
            <button
              type="button"
              className={styles.logoutButton}
              onClick={() => {
                void logout();
              }}
            >
              {t('auth.logout')}
            </button>
          </div>
        )}
      </header>
      <div className={styles.body}>
        <nav className={styles.sidebar} data-collapsed={isSidebarCollapsed} aria-label="Modules">
          <button
            type="button"
            className={styles.collapseButton}
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            {isSidebarCollapsed ? '»' : '«'}
          </button>
          <ul>
            {MODULE_NAV.map((item) => (
              <li key={item.key}>
                {item.enabled ? (
                  <Link to={item.path} className={styles.navItem}>
                    {t(item.key)}
                  </Link>
                ) : (
                  <span className={styles.navItem} data-disabled="true">
                    {t(item.key)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
