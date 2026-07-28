import { useEffect, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
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

  return (
    <ErrorBoundary>
      <AnimatePresence mode="wait">
        {!isReady ? (
          <motion.div key="splash" exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <SplashScreen />
          </motion.div>
        ) : (
          <motion.div
            key="shell"
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
        )}
      </AnimatePresence>
    </ErrorBoundary>
  );
}
