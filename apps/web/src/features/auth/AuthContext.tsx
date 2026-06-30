import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { api, setAccessToken } from '@/lib/axios';
import type { AuthUser } from '@/types';

const BASE_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:3001/api';

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
    try {
      // Use plain axios (not the intercepted api instance) so a missing cookie
      // does not trigger the 401 interceptor and consume the auth rate limit.
      const res = await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true });
      const { accessToken } = (res.data as { data: { accessToken: string } }).data;
      setAccessToken(accessToken);
      const meRes = await api.get('/auth/me');
      setUser(meRes.data.data as AuthUser);
    } catch {
      // No stored session — user needs to log in
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void restoreSession(); }, [restoreSession]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    const { accessToken, user: userData } = res.data.data as { accessToken: string; user: AuthUser };
    setAccessToken(accessToken);
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setAccessToken(null);
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
