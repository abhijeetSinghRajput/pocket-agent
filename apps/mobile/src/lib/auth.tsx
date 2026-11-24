import {
  AuthResponse,
  MeResponse,
  type LoginRequest,
  type RegisterRequest,
  type UserDto,
} from '@pocket-agent/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiClientError, apiRequest } from '@/lib/api';
import { pushSignedOut } from '@/lib/push';
import { loadToken, onTokenChange, saveToken, signedOut } from '@/lib/session';
import { widgetSignedOut } from '@/widget/sync';

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'authenticated'; user: UserDto }
  | { status: 'unauthenticated'; user: null }
  | { status: 'error'; user: null; message: string };

interface AuthApi {
  state: AuthState;
  login(input: LoginRequest): Promise<void>;
  register(input: RegisterRequest): Promise<void>;
  /** Signs in with a Firebase ID token from "Sign in with Google". */
  loginWithGoogle(idToken: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

/**
 * Who is signed in. The session token is kept in secure storage; the server is always the judge
 * (`/auth/me`), this only drives the UI.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });
  const client = useQueryClient();

  const refresh = useCallback(async () => {
    if (!(await loadToken())) return setState({ status: 'unauthenticated', user: null });
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
    const first = setTimeout(() => void refresh(), 0);
    // The token disappearing (signed out here, or the server ended the session) ends the UI session.
    const off = onTokenChange((token) => {
      if (token) return;
      client.clear();
      setState({ status: 'unauthenticated', user: null });
    });
    return () => {
      clearTimeout(first);
      off();
    };
  }, [refresh, client]);

  const api = useMemo<AuthApi>(() => {
    const start = async (path: string, body: unknown) => {
      const res = await apiRequest(path, AuthResponse, { method: 'POST', body });
      if (!res.token) throw new ApiClientError(200, 'bad_response', 'Update the server: no session returned');
      await saveToken(res.token);
      setState({ status: 'authenticated', user: res.user });
    };
    return {
      state,
      refresh,
      login: (input) => start('/auth/login', input),
      register: (input) => start('/auth/register', input),
      loginWithGoogle: (idToken) => start('/auth/google', { idToken }),
      async logout() {
        await pushSignedOut().catch(() => undefined);
        await apiRequest('/auth/logout', null, { method: 'POST' }).catch(() => undefined);
        signedOut();
        // The home-screen widget stops showing this account's numbers.
        void widgetSignedOut();
      },
    };
  }, [state, refresh]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** The signed-in user (only inside the signed-in part of the app). */
export function useUser(): UserDto {
  const { state } = useAuth();
  if (state.status !== 'authenticated') throw new Error('useUser outside the signed-in app');
  return state.user;
}
