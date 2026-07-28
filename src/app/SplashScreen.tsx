import { useTranslation } from 'react-i18next';
import logo from '@branding/logo-transparent.png';
import styles from './SplashScreen.module.css';

export function SplashScreen() {
  const { t } = useTranslation();

  return (
    <div className={styles.splash}>
      <img src={logo} alt="OMNES" className={styles.logo} />
      <p className={styles.status}>{t('shell.loading')}</p>
    </div>
  );
}
