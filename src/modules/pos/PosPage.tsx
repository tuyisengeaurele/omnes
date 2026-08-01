import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product, Sale } from '@shared/ipc';
import { ProductSearch } from './ProductSearch';
import { Cart, type CartLine } from './Cart';
import { CheckoutPanel } from './CheckoutPanel';
import { ReceiptView } from './ReceiptView';
import { SaleHistory } from './SaleHistory';
import styles from './PosPage.module.css';

export function PosPage() {
  const { t } = useTranslation();
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [viewingSale, setViewingSale] = useState<Sale | null>(null);

  const handleAddProduct = (product: Product) => {
    setCartLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...current, { product, quantity: 1 }];
    });
  };

  const handleQuantityChange = (productId: string, quantity: number) => {
    setCartLines((current) =>
      quantity <= 0
        ? current.filter((line) => line.product.id !== productId)
        : current.map((line) => (line.product.id === productId ? { ...line, quantity } : line)),
    );
  };

  const handleRemove = (productId: string) => {
    setCartLines((current) => current.filter((line) => line.product.id !== productId));
  };

  const handleSaleCompleted = (sale: Sale) => {
    setCartLines([]);
    setCompletedSale(sale);
  };

  if (completedSale) {
    return <ReceiptView sale={completedSale} onDone={() => setCompletedSale(null)} />;
  }

  if (viewingSale) {
    return <ReceiptView sale={viewingSale} onDone={() => setViewingSale(null)} />;
  }

  return (
    <div className={styles.page}>
      <div className={styles.mainColumn}>
        <h1 className={styles.title}>{t('modules.pos')}</h1>
        <ProductSearch onSelect={handleAddProduct} />
        <SaleHistory onOpenSale={setViewingSale} />
      </div>
      <div className={styles.cartColumn}>
        <Cart lines={cartLines} onQuantityChange={handleQuantityChange} onRemove={handleRemove} />
        <CheckoutPanel lines={cartLines} onCompleted={handleSaleCompleted} />
      </div>
    </div>
  );
}
