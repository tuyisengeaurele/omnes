import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product } from '@shared/ipc';
import styles from './ProductSearch.module.css';

interface ProductSearchProps {
  onSelect: (product: Product) => void;
}

export function ProductSearch({ onSelect }: ProductSearchProps) {
  const { t } = useTranslation();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listProducts()
      .then((list) => {
        if (!cancelled) setProducts(list);
      })
      .catch((error: unknown) => {
        console.error('Failed to list products', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const results = normalizedQuery
    ? products.filter(
        (product) =>
          product.name.toLowerCase().includes(normalizedQuery) ||
          product.sku.toLowerCase().includes(normalizedQuery) ||
          (product.barcode?.toLowerCase().includes(normalizedQuery) ?? false),
      )
    : products;

  return (
    <div className={styles.search}>
      <input
        type="text"
        className={styles.input}
        placeholder={t('pos.searchPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />
      <ul className={styles.results}>
        {results.map((product) => (
          <li key={product.id}>
            <button
              type="button"
              className={styles.resultItem}
              onClick={() => onSelect(product)}
              disabled={product.stockQuantity <= 0}
            >
              <span className={styles.resultName}>{product.name}</span>
              <span className={styles.resultMeta}>
                {product.sku} · {product.price.toLocaleString()} RWF · {t('pos.stock')}:{' '}
                {product.stockQuantity}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
