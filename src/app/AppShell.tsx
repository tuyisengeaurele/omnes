import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../lib/store/uiStore';
import styles from './AppShell.module.css';

const MODULE_NAV = [
  { key: 'modules.core', enabled: true },
  { key: 'modules.pos', enabled: false },
  { key: 'modules.inventory', enabled: false },
  { key: 'modules.crm', enabled: false },
  { key: 'modules.reports', enabled: false },
  { key: 'modules.admin', enabled: false },
] as const;

export function AppShell() {
  const { t } = useTranslation();
  const [version, setVersion] = useState('');
  const isSidebarCollapsed = useUiStore((state) => state.isSidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  useEffect(() => {
    let cancelled = false;
    window.omnes?.getAppVersion().then((value) => {
      if (!cancelled) setVersion(value);
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
                <span className={styles.navItem} data-disabled={!item.enabled}>
                  {t(item.key)}
                </span>
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
