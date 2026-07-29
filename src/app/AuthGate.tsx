import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '../lib/store/authStore';
import { CreateFirstAdminScreen } from '../modules/core/CreateFirstAdminScreen';
import { LoginScreen } from '../modules/core/LoginScreen';
import { LockScreen } from '../modules/core/LockScreen';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const hasUsers = useAuthStore((state) => state.hasUsers);
  const session = useAuthStore((state) => state.session);
  const isInitializing = useAuthStore((state) => state.isInitializing);
  const initialize = useAuthStore((state) => state.initialize);
  const markLocked = useAuthStore((state) => state.markLocked);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => window.omnes?.onSessionLocked(() => markLocked()), [markLocked]);

  if (isInitializing) {
    return null;
  }

  if (!hasUsers) {
    return <CreateFirstAdminScreen />;
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (session.isLocked) {
    return <LockScreen />;
  }

  return <>{children}</>;
}
