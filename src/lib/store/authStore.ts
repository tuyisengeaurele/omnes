import { create } from 'zustand';
import type { AppApi, Session } from '@shared/ipc';

function getApi(): AppApi {
  if (!window.omnes) {
    throw new Error('window.omnes is not available — the preload script did not load');
  }
  return window.omnes;
}

interface AuthState {
  session: Session | null;
  hasUsers: boolean | null;
  isInitializing: boolean;
  error: string | null;
  lastUsername: string | null;
  initialize: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  createFirstAdmin: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  markLocked: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  hasUsers: null,
  isInitializing: true,
  error: null,
  lastUsername: null,

  initialize: async () => {
    const [hasUsersResult, session, lastUsername] = await Promise.all([
      getApi().hasUsers(),
      getApi().getSession(),
      getApi().getLastUsername(),
    ]);
    set({ hasUsers: hasUsersResult, session, lastUsername, isInitializing: false });
  },

  login: async (username, password) => {
    set({ error: null });
    try {
      const session = await getApi().login(username, password);
      set({ session, hasUsers: true });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Login failed' });
      throw error;
    }
  },

  createFirstAdmin: async (username, password) => {
    set({ error: null });
    try {
      const session = await getApi().createFirstAdmin(username, password);
      set({ session, hasUsers: true });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not create account' });
      throw error;
    }
  },

  logout: async () => {
    await getApi().logout();
    set({ session: null });
  },

  unlock: async (password) => {
    set({ error: null });
    try {
      const session = await getApi().unlock(password);
      set({ session });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unlock failed' });
      throw error;
    }
  },

  markLocked: () => {
    set((state) => (state.session ? { session: { ...state.session, isLocked: true } } : state));
  },
}));
