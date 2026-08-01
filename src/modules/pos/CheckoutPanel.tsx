import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaymentMethod, Sale } from '@shared/ipc';
import type { CartLine } from './Cart';
import styles from './CheckoutPanel.module.css';

interface CheckoutPanelProps {
  lines: CartLine[];
  onCompleted: (sale: Sale) => void;
}

export function CheckoutPanel({ lines, onCompleted }: CheckoutPanelProps) {
  const { t } = useTranslation();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [amountTendered, setAmountTendered] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const tenderedValue = Number(amountTendered);
  const change = paymentMethod === 'CASH' && tenderedValue > total ? tenderedValue - total : 0;
  const canCheckout =
    lines.length > 0 &&
    (paymentMethod === 'MOBILE_MONEY' || (amountTendered !== '' && tenderedValue >= total));

  const handleCheckout = async () => {
    setError(null);
    setIsSubmitting(true);
    const result = await window.omnes?.createSale({
      items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
      paymentMethod,
      amountTendered: paymentMethod === 'CASH' ? tenderedValue : null,
    });
    setIsSubmitting(false);

    if (result?.success && result.sale) {
      setAmountTendered('');
      onCompleted(result.sale);
    } else {
      setError(result?.message ?? t('pos.checkoutError'));
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.methodToggle}>
        <button
          type="button"
          className={styles.methodButton}
          data-active={paymentMethod === 'CASH'}
          onClick={() => setPaymentMethod('CASH')}
        >
          {t('pos.cash')}
        </button>
        <button
          type="button"
          className={styles.methodButton}
          data-active={paymentMethod === 'MOBILE_MONEY'}
          onClick={() => setPaymentMethod('MOBILE_MONEY')}
        >
          {t('pos.mobileMoney')}
        </button>
      </div>
      {paymentMethod === 'CASH' && (
        <label className={styles.field}>
          <span>{t('pos.amountTendered')}</span>
          <input
            type="number"
            min={0}
            value={amountTendered}
            onChange={(event) => setAmountTendered(event.target.value)}
          />
        </label>
      )}
      {paymentMethod === 'CASH' && change > 0 && (
        <p className={styles.change}>
          {t('pos.change')}: {change.toLocaleString()} RWF
        </p>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <button
        type="button"
        className={styles.checkoutButton}
        onClick={() => void handleCheckout()}
        disabled={!canCheckout || isSubmitting}
      >
        {isSubmitting ? t('pos.processing') : t('pos.checkout')}
      </button>
    </div>
  );
}
