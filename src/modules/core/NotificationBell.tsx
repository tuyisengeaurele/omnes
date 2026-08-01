import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NotificationRecord } from '@shared/ipc';
import { NotificationPanel } from './NotificationPanel';
import styles from './NotificationBell.module.css';

export function NotificationBell() {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listNotifications()
      .then((list) => {
        if (!cancelled) setNotifications(list);
      })
      .catch((error: unknown) => {
        console.error('Failed to list notifications', error);
      });

    const unsubscribe = window.omnes?.onNotificationCreated((notification) => {
      setNotifications((current) => [
        notification,
        ...current.filter((existing) => existing.id !== notification.id),
      ]);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const handleMarkRead = (id: string) => {
    void window.omnes?.markNotificationRead(id);
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification,
      ),
    );
  };

  const handleMarkAllRead = () => {
    void window.omnes?.markAllNotificationsRead();
    setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
  };

  const handleClear = (id: string) => {
    void window.omnes?.clearNotification(id);
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  };

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.bellButton}
        onClick={() => setIsPanelOpen((open) => !open)}
        aria-label={t('notifications.bellLabel')}
      >
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
      </button>
      {isPanelOpen && (
        <NotificationPanel
          notifications={notifications}
          onMarkRead={handleMarkRead}
          onMarkAllRead={handleMarkAllRead}
          onClear={handleClear}
        />
      )}
    </div>
  );
}
