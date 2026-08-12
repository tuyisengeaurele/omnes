import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Customer, Sale } from '@shared/ipc';
import styles from './CustomerDetail.module.css';

interface CustomerDetailProps {
  customer: Customer;
  onBack: () => void;
}

export function CustomerDetail({ customer, onBack }: CustomerDetailProps) {
  const { t } = useTranslation();
  const [sales, setSales] = useState<Sale[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listSales(customer.id)
      .then((list) => {
        if (!cancelled) {
          setSales(list);
          setIsLoading(false);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to list customer sales', error);
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customer.id]);

  return (
    <div className={styles.page}>
      <button type="button" className={styles.backButton} onClick={onBack}>
        {t('crm.back')}
      </button>
      <h1 className={styles.title}>{customer.name}</h1>
      {customer.phone && <p className={styles.meta}>{customer.phone}</p>}
      {customer.email && <p className={styles.meta}>{customer.email}</p>}
      {customer.notes && <p className={styles.meta}>{customer.notes}</p>}

      <h2 className={styles.subtitle}>{t('crm.purchaseHistory')}</h2>
      {isLoading ? (
        <p>{t('crm.loading')}</p>
      ) : sales.length === 0 ? (
        <p className={styles.empty}>{t('crm.noPurchases')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('crm.date')}</th>
              <th>{t('pos.total')}</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => (
              <tr key={sale.id}>
                <td>{new Date(sale.createdAt).toLocaleString()}</td>
                <td>{sale.total.toLocaleString()} RWF</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
