import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReportRange, SalesSummary, TopProduct } from '@shared/ipc';
import styles from './ReportsPage.module.css';

const RANGES: { value: ReportRange; labelKey: string }[] = [
  { value: 'TODAY', labelKey: 'reports.today' },
  { value: 'THIS_WEEK', labelKey: 'reports.thisWeek' },
  { value: 'THIS_MONTH', labelKey: 'reports.thisMonth' },
  { value: 'ALL_TIME', labelKey: 'reports.allTime' },
];

export function ReportsPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<ReportRange>('TODAY');
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([window.omnes?.getSalesSummary(range), window.omnes?.getTopProducts(range)])
      .then(([summaryResult, topProductsResult]) => {
        if (cancelled) return;
        setSummary(summaryResult ?? null);
        setTopProducts(topProductsResult ?? []);
        setError(null);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('reports.notAuthorized'));
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, t]);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>{t('reports.title')}</h1>
        <div className={styles.rangePicker}>
          {RANGES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === range ? styles.rangeActive : styles.rangeButton}
              onClick={() => setRange(option.value)}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {!error && isLoading && <p>{t('reports.loading')}</p>}

      {!error && !isLoading && summary && (
        <>
          <div className={styles.cards}>
            <div className={styles.card}>
              <span className={styles.cardLabel}>{t('reports.totalRevenue')}</span>
              <span className={styles.cardValue}>{summary.totalRevenue.toLocaleString()}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>{t('reports.transactions')}</span>
              <span className={styles.cardValue}>{summary.transactionCount}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>{t('reports.averageSale')}</span>
              <span className={styles.cardValue}>{summary.averageSale.toLocaleString()}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>{t('reports.cashVsMobileMoney')}</span>
              <span className={styles.cardValue}>
                {summary.cashTotal.toLocaleString()} / {summary.mobileMoneyTotal.toLocaleString()}
              </span>
            </div>
          </div>

          <h2 className={styles.subtitle}>{t('reports.topProducts')}</h2>
          {topProducts.length === 0 ? (
            <p className={styles.empty}>{t('reports.noSales')}</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('reports.product')}</th>
                  <th>{t('reports.quantitySold')}</th>
                  <th>{t('reports.revenue')}</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((product) => (
                  <tr key={product.productName}>
                    <td>{product.productName}</td>
                    <td>{product.quantitySold}</td>
                    <td>{product.revenue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
