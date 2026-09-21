/**
 * Supabase session helpers and gateway access-token provider.
 *
 * Gateway token contract (from docs/architecture/ai-gateway-authentication.md):
 *   1. Obtain current access token via getSession() (auto-refreshes when needed).
 *   2. On 401, force one refresh and retry once.
 *   3. If retry 401 or refresh fails, surface authentication_error; fall back to local generation.
 *   4. Refresh tokens never leave this module.
 */
import type { Session, User } from '@supabase/supabase-js';
import type { GatewayAccessTokenProvider } from '@/ai/gatewayProvider';
import { getSupabaseClient } from '@/auth/supabaseClient';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export type AuthCredentials = { email: string; password: string };

/** Sign in with email + password. Returns session or throws. */
export async function signIn(credentials: AuthCredentials): Promise<Session> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Authentication not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }
  const { data, error } = await client.auth.signInWithPassword(credentials);
  if (error || !data.session) {
    throw new Error(error?.message ?? 'Sign-in failed.');
  }
  return data.session;
}

export type SignUpResult = {
  session: Session | null;
  user: User | null;
};

/** Sign up with email + password. Returns session and user or throws. */
export async function signUp(credentials: AuthCredentials): Promise<SignUpResult> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Authentication not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }
  const { data, error } = await client.auth.signUp(credentials);
  if (error) {
    throw new Error(error.message);
  }
  return { session: data.session ?? null, user: data.user ?? null };
}

/** Send a password reset email for the given address. */
export async function resetPassword(email: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Authentication not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }
  const { error } = await client.auth.resetPasswordForEmail(email.trim());
  if (error) {
    throw new Error(error.message);
  }
}


/** Sign out and clear persisted session. */
export async function signOut(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return; // No-op when auth not configured
  await client.auth.signOut();
}

/**
 * Restore a persisted session from secure storage.
 * Returns the session if one exists and is valid, otherwise null.
 * Safe to call on app launch before any UI renders.
 * Returns null when Supabase is not configured.
 */
export async function restoreSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) return null; // Auth not configured
  const { data } = await client.auth.getSession();
  return data.session ?? null;
}

/** Returns the current authenticated user, or null if signed out. */
export async function getCurrentUser(): Promise<User | null> {
  const client = getSupabaseClient();
  if (!client) return null; // Auth not configured
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}

// ---------------------------------------------------------------------------
// Gateway access-token provider
// ---------------------------------------------------------------------------

/**
 * Creates a GatewayAccessTokenProvider backed by the live Supabase session.
 *
 * When forceRefresh=true the client is asked to refresh the session before
 * returning the token (used on 401 retry by gatewayProvider.ts).
 *
 * Returns null when no session is present or auth is not configured; the
 * gateway will omit the Authorization header and the request will fail with
 * 401, which is correct.
 */
export function createSupabaseAccessTokenProvider(): GatewayAccessTokenProvider {
  const client = getSupabaseClient();

  return async (forceRefresh = false): Promise<string | null> => {
    if (!client) return null; // Auth not configured

    if (forceRefresh) {
      const { data, error } = await client.auth.refreshSession();
      if (error || !data.session) return null;
      return data.session.access_token;
    }

    const { data } = await client.auth.getSession();
    return data.session?.access_token ?? null;
  };
}

// ---------------------------------------------------------------------------
// Auth state change listener
// ---------------------------------------------------------------------------

export type AuthStateListener = (session: Session | null) => void;

/**
 * Subscribe to auth state changes (sign-in, sign-out, token refresh).
 * Returns an unsubscribe function (no-op when auth not configured).
 */
export function onAuthStateChange(listener: AuthStateListener): () => void {
  const client = getSupabaseClient();
  if (!client) {
    // Auth not configured - return no-op unsubscribe
    return () => undefined;
  }
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    listener(session);
  });
  return () => data.subscription.unsubscribe();
}
