import { useTranslation } from 'react-i18next';
import styles from './Dashboard.module.css';

export function Dashboard() {
  const { t } = useTranslation();

  return (
    <div className={styles.empty}>
      <p>{t('shell.comingSoon')}</p>
    </div>
  );
}
