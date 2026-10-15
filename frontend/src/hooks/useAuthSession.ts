import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, fetchAuthMe, logout, SESSION_EXPIRED_EVENT, type AuthUser } from '../api';
import { clearProjectStorage } from '../storage';

export interface AuthSessionState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  user: AuthUser | null;
  configured: boolean;
  error: string | null;
}

const initialState: AuthSessionState = { status: 'loading', user: null, configured: true, error: null };

export function useAuthSession() {
  const [session, setSession] = useState<AuthSessionState>(initialState);
  const mounted = useRef(false);
  const generation = useRef(0);
  const checkController = useRef<AbortController | null>(null);
  const logoutController = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (logoutController.current || !mounted.current) return;
    checkController.current?.abort();
    const controller = new AbortController();
    const operation = ++generation.current;
    checkController.current = controller;
    const current = () => mounted.current && !controller.signal.aborted && operation === generation.current;
    try {
      const result = await fetchAuthMe(controller.signal);
      if (!current()) return;
      if (!result.user) clearProjectStorage();
      setSession({ status: result.user ? 'authenticated' : 'unauthenticated', user: result.user, configured: result.configured, error: null });
    } catch (reason: unknown) {
      if (!current()) return;
      setSession({ status: 'unauthenticated', user: null, configured: true, error: reason instanceof ApiError ? reason.message : 'We could not verify the current session.' });
    } finally {
      if (checkController.current === controller) checkController.current = null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const expired = (event: Event) => {
      generation.current += 1;
      checkController.current?.abort();
      clearProjectStorage();
      setSession({ status: 'unauthenticated', user: null, configured: true, error: (event as CustomEvent<string>).detail || 'Your session expired. Sign in with GitHub again.' });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    void refresh();
    return () => {
      mounted.current = false;
      generation.current += 1;
      checkController.current?.abort();
      logoutController.current?.abort();
      checkController.current = null;
      logoutController.current = null;
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    if (!mounted.current || logoutController.current) return;
    generation.current += 1;
    checkController.current?.abort();
    const controller = new AbortController();
    logoutController.current = controller;
    const current = () => mounted.current && !controller.signal.aborted && logoutController.current === controller;
    setSession((previous) => ({ ...previous, error: null }));
    try {
      await logout(controller.signal);
      if (!current()) return;
      clearProjectStorage();
      setSession({ status: 'unauthenticated', user: null, configured: true, error: null });
    } catch (reason: unknown) {
      if (current()) setSession((previous) => ({ ...previous, error: reason instanceof ApiError ? reason.message : 'GitHub sign-out could not be completed.' }));
    } finally {
      if (logoutController.current === controller) logoutController.current = null;
    }
  }, []);

  return { session, refresh, signOut };
}
