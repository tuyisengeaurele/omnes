import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ManagedUser, Role } from '@shared/ipc';
import { AddUserForm } from './AddUserForm';
import styles from './UsersPanel.module.css';

export function UsersPanel() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fetchUsers = async () => {
    const list = await window.omnes?.listUsers();
    setUsers(list ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listUsers()
      .then((list) => {
        if (!cancelled) {
          setUsers(list);
          setIsLoading(false);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to list users', error);
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRoleChange = async (id: string, role: Role) => {
    setBusyId(id);
    const result = await window.omnes?.setUserRole(id, role);
    setBusyId(null);
    setStatusMessage(result?.message ?? null);
    await fetchUsers();
  };

  const handleToggleActive = async (user: ManagedUser) => {
    setBusyId(user.id);
    const result = await window.omnes?.setUserActive(user.id, !user.isActive);
    setBusyId(null);
    setStatusMessage(result?.message ?? null);
    await fetchUsers();
  };

  const handleResetPassword = async (id: string) => {
    setBusyId(id);
    const result = await window.omnes?.resetUserPassword(id, newPassword);
    setBusyId(null);
    setStatusMessage(result?.message ?? null);
    if (result?.success) {
      setResettingId(null);
      setNewPassword('');
    }
  };

  const handleSaved = () => {
    setIsAdding(false);
    void fetchUsers();
  };

  if (isAdding) {
    return <AddUserForm onSaved={handleSaved} onCancel={() => setIsAdding(false)} />;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <h2 className={styles.title}>{t('users.title')}</h2>
        <button type="button" onClick={() => setIsAdding(true)}>
          {t('users.addUser')}
        </button>
      </div>
      {statusMessage && <p className={styles.status}>{statusMessage}</p>}
      {isLoading ? (
        <p>{t('users.loading')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('users.username')}</th>
              <th>{t('users.role')}</th>
              <th>{t('users.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} data-active={user.isActive}>
                <td>{user.username}</td>
                <td>
                  <select
                    value={user.role}
                    onChange={(event) => void handleRoleChange(user.id, event.target.value as Role)}
                    disabled={busyId === user.id}
                  >
                    <option value="ADMIN">{t('users.roleAdmin')}</option>
                    <option value="MANAGER">{t('users.roleManager')}</option>
                    <option value="CASHIER">{t('users.roleCashier')}</option>
                  </select>
                </td>
                <td>{user.isActive ? t('users.active') : t('users.inactive')}</td>
                <td className={styles.rowActions}>
                  <button
                    type="button"
                    onClick={() => void handleToggleActive(user)}
                    disabled={busyId === user.id}
                  >
                    {user.isActive ? t('users.deactivate') : t('users.reactivate')}
                  </button>
                  {resettingId === user.id ? (
                    <span className={styles.resetInline}>
                      <input
                        type="password"
                        placeholder={t('users.newPassword')}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => void handleResetPassword(user.id)}
                        disabled={newPassword.length < 8 || busyId === user.id}
                      >
                        {t('users.confirmReset')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResettingId(null);
                          setNewPassword('');
                        }}
                      >
                        {t('users.cancel')}
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setResettingId(user.id)}>
                      {t('users.resetPassword')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
