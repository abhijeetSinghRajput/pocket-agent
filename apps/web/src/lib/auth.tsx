'use client';

import { MeResponse, type LoginRequest, type RegisterRequest, type UserDto } from '@agentdock/protocol';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiRequest, ApiClientError } from '@/lib/api';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'authenticated'; user: UserDto }
  | { status: 'unauthenticated'; user: null }
  | { status: 'error'; user: null; message: string };

interface AuthApi {
  state: AuthState;
  login(input: LoginRequest): Promise<void>;
  register(input: RegisterRequest): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

/**
 * Session state comes from the API (`/auth/me`); the browser never sees the session token
 * (httpOnly cookie). Authorization is always enforced server-side — this only drives the UI.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });

  const refresh = useCallback(async () => {
    try {
      const { user } = await apiRequest('/auth/me', MeResponse);
      setState({ status: 'authenticated', user });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401)
        setState({ status: 'unauthenticated', user: null });
      else setState({ status: 'error', user: null, message: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(id);
  }, [refresh]);

  const api = useMemo<AuthApi>(
    () => ({
      state,
      refresh,
      async login(input) {
        const { user } = await apiRequest('/auth/login', MeResponse, { method: 'POST', body: input });
        setState({ status: 'authenticated', user });
      },
      async register(input) {
        const { user } = await apiRequest('/auth/register', MeResponse, { method: 'POST', body: input });
        setState({ status: 'authenticated', user });
      },
      async logout() {
        await apiRequest('/auth/logout', null, { method: 'POST' }).catch(() => undefined);
        setState({ status: 'unauthenticated', user: null });
      },
    }),
    [state, refresh],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
