import { useTranslation } from 'react-i18next';
import { BackupPanel } from './BackupPanel';
import styles from './AdminPage.module.css';

export function AdminPage() {
  const { t } = useTranslation();

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('modules.admin')}</h1>
      <BackupPanel />
    </div>
  );
}
