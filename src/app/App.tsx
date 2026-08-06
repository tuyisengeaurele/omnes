import { useEffect, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { i18nReady } from '../lib/i18n';
import { SplashScreen } from './SplashScreen';
import { AppShell } from './AppShell';
import { AuthGate } from './AuthGate';
import { Dashboard } from '../modules/core/Dashboard';
import { AdminPage } from '../modules/admin/AdminPage';
import { ProductsPage } from '../modules/inventory/ProductsPage';
import { PosPage } from '../modules/pos/PosPage';
import { ReportsPage } from '../modules/reports/ReportsPage';

export function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    i18nReady
      .then(() => {
        if (!cancelled) setIsReady(true);
      })
      .catch((error: unknown) => {
        console.error('Failed to initialize i18n', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isReady) {
    return <SplashScreen />;
  }

  return (
    <ErrorBoundary>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
        style={{ height: '100%' }}
      >
        <AuthGate>
          <HashRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Dashboard />} />
                <Route path="admin" element={<AdminPage />} />
                <Route path="inventory" element={<ProductsPage />} />
                <Route path="pos" element={<PosPage />} />
                <Route path="reports" element={<ReportsPage />} />
              </Route>
            </Routes>
          </HashRouter>
        </AuthGate>
      </motion.div>
    </ErrorBoundary>
  );
}
