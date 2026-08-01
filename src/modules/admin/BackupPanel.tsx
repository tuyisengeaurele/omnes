import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BackupRecord } from '@shared/ipc';
import styles from './BackupPanel.module.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupPanel() {
  const { t } = useTranslation();
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [confirmingRestoreId, setConfirmingRestoreId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const isOperationInProgress = isBackingUp || busyId !== null;

  const refreshBackups = async () => {
    const list = await window.omnes?.listBackups();
    setBackups(list ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listBackups()
      .then((list) => {
        if (!cancelled) {
          setBackups(list);
          setIsLoading(false);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to list backups', error);
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBackupNow = async () => {
    setIsBackingUp(true);
    setStatusMessage(null);
    const result = await window.omnes?.createBackup();
    setIsBackingUp(false);
    setStatusMessage(result?.message ?? null);
    await refreshBackups();
  };

  const handleVerify = async (id: string) => {
    setBusyId(id);
    const result = await window.omnes?.verifyBackup(id);
    setBusyId(null);
    setStatusMessage(result?.message ?? null);
    await refreshBackups();
  };

  const handleRestore = async (id: string) => {
    setBusyId(id);
    const result = await window.omnes?.restoreBackup(id);
    setBusyId(null);
    setConfirmingRestoreId(null);
    setConfirmText('');
    setStatusMessage(result?.message ?? null);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <button
          type="button"
          onClick={() => void handleBackupNow()}
          disabled={isOperationInProgress}
        >
          {isBackingUp ? t('backup.backingUp') : t('backup.backupNow')}
        </button>
      </div>
      {statusMessage && <p className={styles.status}>{statusMessage}</p>}
      {isLoading ? (
        <p>{t('backup.loading')}</p>
      ) : backups.length === 0 ? (
        <p className={styles.empty}>{t('backup.noBackups')}</p>
      ) : (
        <ul className={styles.list}>
          {backups.map((backup) => (
            <li key={backup.id} className={styles.item}>
              <div className={styles.itemInfo}>
                <span className={styles.filename}>{backup.filename}</span>
                <span className={styles.meta}>
                  {new Date(backup.createdAt).toLocaleString()} · {formatBytes(backup.sizeBytes)} ·{' '}
                  {backup.verified ? t('backup.verified') : t('backup.unverified')}
                  {backup.verifiedAt && ` (${new Date(backup.verifiedAt).toLocaleString()})`}
                </span>
              </div>
              <div className={styles.itemActions}>
                <button
                  type="button"
                  onClick={() => void window.omnes?.revealBackupInFolder(backup.id)}
                >
                  {t('backup.revealInFolder')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleVerify(backup.id)}
                  disabled={isOperationInProgress}
                >
                  {t('backup.verify')}
                </button>
                {confirmingRestoreId === backup.id ? (
                  <div className={styles.confirmRestore}>
                    <input
                      type="text"
                      value={confirmText}
                      onChange={(event) => setConfirmText(event.target.value)}
                      placeholder="RESTORE"
                    />
                    <button
                      type="button"
                      onClick={() => void handleRestore(backup.id)}
                      disabled={confirmText !== 'RESTORE' || isOperationInProgress}
                    >
                      {t('backup.confirmRestore')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingRestoreId(null);
                        setConfirmText('');
                      }}
                    >
                      {t('backup.cancel')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingRestoreId(backup.id)}
                    disabled={isOperationInProgress}
                  >
                    {t('backup.restore')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
