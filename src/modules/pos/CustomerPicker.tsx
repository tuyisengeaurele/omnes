import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Customer } from '@shared/ipc';
import styles from './CustomerPicker.module.css';

interface CustomerPickerProps {
  selected: Customer | null;
  onSelect: (customer: Customer | null) => void;
}

export function CustomerPicker({ selected, onSelect }: CustomerPickerProps) {
  const { t } = useTranslation();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listCustomers()
      .then((list) => {
        if (!cancelled) setCustomers(list);
      })
      .catch((error: unknown) => {
        console.error('Failed to list customers', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (selected) {
    return (
      <div className={styles.picker}>
        <span className={styles.selected}>{selected.name}</span>
        <button type="button" onClick={() => onSelect(null)}>
          {t('pos.walkIn')}
        </button>
      </div>
    );
  }

  const normalizedQuery = query.trim().toLowerCase();
  const results = normalizedQuery
    ? customers.filter(
        (customer) =>
          customer.name.toLowerCase().includes(normalizedQuery) ||
          (customer.phone?.toLowerCase().includes(normalizedQuery) ?? false),
      )
    : [];

  return (
    <div className={styles.picker}>
      <input
        type="text"
        className={styles.input}
        placeholder={t('pos.searchCustomer')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                className={styles.resultItem}
                onClick={() => onSelect(customer)}
              >
                <span>{customer.name}</span>
                {customer.phone && <span className={styles.resultMeta}>{customer.phone}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
