import { useTranslation } from 'react-i18next';
import type { NotificationRecord } from '@shared/ipc';
import styles from './NotificationPanel.module.css';

interface NotificationPanelProps {
  notifications: NotificationRecord[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClear: (id: string) => void;
  onClearAll: () => void;
}

export function NotificationPanel({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onClear,
  onClearAll,
}: NotificationPanelProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>{t('notifications.title')}</span>
        <div className={styles.headerActions}>
          <button type="button" onClick={onMarkAllRead}>
            {t('notifications.markAllRead')}
          </button>
          <button type="button" onClick={onClearAll}>
            {t('notifications.clearAll')}
          </button>
        </div>
      </div>
      {notifications.length === 0 ? (
        <p className={styles.empty}>{t('notifications.empty')}</p>
      ) : (
        <ul className={styles.list}>
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={styles.item}
              data-severity={notification.severity}
              data-read={notification.read}
            >
              <button
                type="button"
                className={styles.itemMain}
                onClick={() => onMarkRead(notification.id)}
              >
                <span className={styles.itemTitle}>{notification.title}</span>
                <span className={styles.itemMessage}>{notification.message}</span>
                <span className={styles.itemTime}>
                  {new Date(notification.createdAt).toLocaleString()}
                </span>
              </button>
              <button
                type="button"
                className={styles.clearButton}
                onClick={() => onClear(notification.id)}
                aria-label={t('notifications.clear')}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
