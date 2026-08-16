import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import type { Settings, User } from './types';

/** Mirrors server/lib/permissions.js. The server is still the authority. */
export const PERMISSIONS = {
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage',
  STOCK_RECEIVE: 'stock.receive',
  STOCK_DISPENSE: 'stock.dispense',
  STOCK_ADJUST: 'stock.adjust',
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  USERS_MANAGE: 'users.manage',
  SETTINGS_MANAGE: 'settings.manage',
  BACKUP_MANAGE: 'backup.manage',
} as const;

export const ROLE_LABELS: Record<string, string> = {
  DOCTOR: 'Doctor',
  PHARMACIST: 'Pharmacist',
  ASSISTANT: 'Pharmacy Assistant',
};

interface AuthState {
  user: User | null;
  settings: Settings | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

interface SessionResponse {
  user: User | null;
  settings: Settings;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<SessionResponse>('/auth/me');
      setUser(data.user);
      setSettings(data.settings);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (username: string, password: string) => {
    const data = await api.post<SessionResponse>('/auth/login', { username, password });
    setUser(data.user);
    setSettings(data.settings);
    return data.user as User;
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  const can = useCallback(
    (permission: string) => Boolean(user?.permissions.includes(permission)),
    [user]
  );

  const value = useMemo(
    () => ({ user, settings, loading, signIn, signOut, refresh, can }),
    [user, settings, loading, signIn, signOut, refresh, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
