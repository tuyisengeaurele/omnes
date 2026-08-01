import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Sale } from '@shared/ipc';
import styles from './SaleHistory.module.css';

interface SaleHistoryProps {
  onOpenSale: (sale: Sale) => void;
}

export function SaleHistory({ onOpenSale }: SaleHistoryProps) {
  const { t } = useTranslation();
  const [sales, setSales] = useState<Sale[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listSales()
      .then((list) => {
        if (!cancelled) setSales(list);
      })
      .catch((error: unknown) => {
        console.error('Failed to list sales', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (sales.length === 0) {
    return null;
  }

  return (
    <div className={styles.history}>
      <h2 className={styles.title}>{t('pos.recentSales')}</h2>
      <ul className={styles.list}>
        {sales.slice(0, 10).map((sale) => (
          <li key={sale.id}>
            <button type="button" className={styles.item} onClick={() => onOpenSale(sale)}>
              <span>{new Date(sale.createdAt).toLocaleString()}</span>
              <span>{sale.total.toLocaleString()} RWF</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
