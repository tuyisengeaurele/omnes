import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Customer } from '@shared/ipc';
import { CustomerForm } from './CustomerForm';
import { CustomerDetail } from './CustomerDetail';
import styles from './CustomersPage.module.css';

export function CustomersPage() {
  const { t } = useTranslation();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchCustomers = async () => {
    const list = await window.omnes?.listCustomers(true);
    setCustomers(list ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listCustomers(true)
      .then((list) => {
        if (!cancelled) {
          setCustomers(list);
          setIsLoading(false);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to list customers', error);
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleActive = async (customer: Customer) => {
    setBusyId(customer.id);
    await window.omnes?.setCustomerActive(customer.id, !customer.isActive);
    setBusyId(null);
    await fetchCustomers();
  };

  const handleSaved = () => {
    setIsAdding(false);
    setEditingCustomer(null);
    void fetchCustomers();
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingCustomer(null);
  };

  if (viewingCustomer) {
    return <CustomerDetail customer={viewingCustomer} onBack={() => setViewingCustomer(null)} />;
  }

  if (isAdding || editingCustomer) {
    return (
      <CustomerForm
        customer={editingCustomer ?? undefined}
        onSaved={handleSaved}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>{t('modules.crm')}</h1>
        <button type="button" onClick={() => setIsAdding(true)}>
          {t('crm.addCustomer')}
        </button>
      </div>
      {isLoading ? (
        <p>{t('crm.loading')}</p>
      ) : customers.length === 0 ? (
        <p className={styles.empty}>{t('crm.noCustomers')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('crm.name')}</th>
              <th>{t('crm.phone')}</th>
              <th>{t('crm.email')}</th>
              <th>{t('crm.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id} data-active={customer.isActive}>
                <td>
                  <button
                    type="button"
                    className={styles.nameButton}
                    onClick={() => setViewingCustomer(customer)}
                  >
                    {customer.name}
                  </button>
                </td>
                <td>{customer.phone ?? ''}</td>
                <td>{customer.email ?? ''}</td>
                <td>{customer.isActive ? t('crm.active') : t('crm.inactive')}</td>
                <td className={styles.rowActions}>
                  <button type="button" onClick={() => setEditingCustomer(customer)}>
                    {t('crm.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleActive(customer)}
                    disabled={busyId === customer.id}
                  >
                    {customer.isActive ? t('crm.deactivate') : t('crm.reactivate')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
