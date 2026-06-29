import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, setAccessToken } from '@/lib/axios';
import type { AuthUser } from '@/types';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const restoreSession = useCallback(async () => {
    const refreshToken = localStorage.getItem('omnes_refresh');
    if (!refreshToken) { setIsLoading(false); return; }
    try {
      const res = await api.post('/auth/refresh', { refreshToken });
      const { accessToken, refreshToken: newRefresh } = res.data.data as { accessToken: string; refreshToken: string };
      setAccessToken(accessToken);
      localStorage.setItem('omnes_refresh', newRefresh);
      const meRes = await api.get('/auth/me');
      setUser(meRes.data.data as AuthUser);
    } catch {
      localStorage.removeItem('omnes_refresh');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void restoreSession(); }, [restoreSession]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    const { accessToken, refreshToken, user: userData } = res.data.data as { accessToken: string; refreshToken: string; user: AuthUser };
    setAccessToken(accessToken);
    localStorage.setItem('omnes_refresh', refreshToken);
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem('omnes_refresh');
    try { await api.post('/auth/logout', { refreshToken }); } catch { /* ignore */ }
    setAccessToken(null);
    localStorage.removeItem('omnes_refresh');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
