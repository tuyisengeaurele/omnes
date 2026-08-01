import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product } from '@shared/ipc';
import { ProductForm } from './ProductForm';
import styles from './ProductsPage.module.css';

export function ProductsPage() {
  const { t } = useTranslation();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchProducts = async () => {
    const list = await window.omnes?.listProducts(true);
    setProducts(list ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listProducts(true)
      .then((list) => {
        if (!cancelled) {
          setProducts(list);
          setIsLoading(false);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to list products', error);
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleActive = async (product: Product) => {
    setBusyId(product.id);
    await window.omnes?.setProductActive(product.id, !product.isActive);
    setBusyId(null);
    await fetchProducts();
  };

  const handleSaved = () => {
    setIsAdding(false);
    setEditingProduct(null);
    void fetchProducts();
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingProduct(null);
  };

  if (isAdding || editingProduct) {
    return (
      <ProductForm
        product={editingProduct ?? undefined}
        onSaved={handleSaved}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>{t('modules.inventory')}</h1>
        <button type="button" onClick={() => setIsAdding(true)}>
          {t('inventory.addProduct')}
        </button>
      </div>
      {isLoading ? (
        <p>{t('inventory.loading')}</p>
      ) : products.length === 0 ? (
        <p className={styles.empty}>{t('inventory.noProducts')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('inventory.name')}</th>
              <th>{t('inventory.sku')}</th>
              <th>{t('inventory.category')}</th>
              <th>{t('inventory.price')}</th>
              <th>{t('inventory.stockQuantity')}</th>
              <th>{t('inventory.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} data-active={product.isActive}>
                <td>{product.name}</td>
                <td>{product.sku}</td>
                <td>{product.category}</td>
                <td>{product.price.toLocaleString()}</td>
                <td>{product.stockQuantity}</td>
                <td>{product.isActive ? t('inventory.active') : t('inventory.inactive')}</td>
                <td className={styles.rowActions}>
                  <button type="button" onClick={() => setEditingProduct(product)}>
                    {t('inventory.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleActive(product)}
                    disabled={busyId === product.id}
                  >
                    {product.isActive ? t('inventory.deactivate') : t('inventory.reactivate')}
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
