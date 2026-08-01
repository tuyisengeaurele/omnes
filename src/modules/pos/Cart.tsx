import { useTranslation } from 'react-i18next';
import type { Product } from '@shared/ipc';
import styles from './Cart.module.css';

export interface CartLine {
  product: Product;
  quantity: number;
}

interface CartProps {
  lines: CartLine[];
  onQuantityChange: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
}

export function Cart({ lines, onQuantityChange, onRemove }: CartProps) {
  const { t } = useTranslation();
  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);

  return (
    <div className={styles.cart}>
      <h2 className={styles.title}>{t('pos.cart')}</h2>
      {lines.length === 0 ? (
        <p className={styles.empty}>{t('pos.emptyCart')}</p>
      ) : (
        <ul className={styles.list}>
          {lines.map((line) => (
            <li key={line.product.id} className={styles.item}>
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>{line.product.name}</span>
                <span className={styles.itemPrice}>{line.product.price.toLocaleString()} RWF</span>
              </div>
              <div className={styles.itemControls}>
                <input
                  type="number"
                  min={1}
                  max={line.product.stockQuantity}
                  value={line.quantity}
                  onChange={(event) =>
                    onQuantityChange(line.product.id, Number(event.target.value))
                  }
                  className={styles.quantityInput}
                />
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => onRemove(line.product.id)}
                  aria-label={t('pos.remove')}
                >
                  &times;
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.total}>
        <span>{t('pos.total')}</span>
        <span>{total.toLocaleString()} RWF</span>
      </div>
    </div>
  );
}
