import { useTranslation } from 'react-i18next';
import type { Sale } from '@shared/ipc';
import styles from './ReceiptView.module.css';

interface ReceiptViewProps {
  sale: Sale;
  onDone: () => void;
}

export function ReceiptView({ sale, onDone }: ReceiptViewProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.wrapper}>
      <div className={styles.receipt}>
        <h1 className={styles.brand}>{t('app.name')}</h1>
        <p className={styles.timestamp}>{new Date(sale.createdAt).toLocaleString()}</p>
        {sale.cashierUsername && (
          <p className={styles.cashier}>
            {t('pos.cashier')}: {sale.cashierUsername}
          </p>
        )}
        {sale.customerName && (
          <p className={styles.cashier}>
            {t('pos.customer')}: {sale.customerName}
          </p>
        )}
        <ul className={styles.items}>
          {sale.items.map((item) => (
            <li key={item.id} className={styles.item}>
              <span>
                {item.quantity} × {item.productName}
              </span>
              <span>{(item.unitPrice * item.quantity).toLocaleString()} RWF</span>
            </li>
          ))}
        </ul>
        <div className={styles.total}>
          <span>{t('pos.total')}</span>
          <span>{sale.total.toLocaleString()} RWF</span>
        </div>
        {sale.paymentMethod === 'CASH' && (
          <>
            <div className={styles.row}>
              <span>{t('pos.amountTendered')}</span>
              <span>{sale.amountTendered?.toLocaleString()} RWF</span>
            </div>
            <div className={styles.row}>
              <span>{t('pos.change')}</span>
              <span>{sale.changeGiven?.toLocaleString()} RWF</span>
            </div>
          </>
        )}
        {sale.paymentMethod === 'MOBILE_MONEY' && (
          <p className={styles.row}>{t('pos.mobileMoney')}</p>
        )}
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={() => window.print()}>
          {t('pos.print')}
        </button>
        <button type="button" onClick={onDone}>
          {t('pos.close')}
        </button>
      </div>
    </div>
  );
}
