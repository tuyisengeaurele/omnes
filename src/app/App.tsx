import { useEffect, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { i18nReady } from '../lib/i18n';
import { SplashScreen } from './SplashScreen';
import { AppShell } from './AppShell';
import { Dashboard } from '../modules/core/Dashboard';

export function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    i18nReady.then(() => {
      if (!cancelled) setIsReady(true);
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
        <HashRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Dashboard />} />
            </Route>
          </Routes>
        </HashRouter>
      </motion.div>
    </ErrorBoundary>
  );
}
