/**
 * Singleton Supabase client.
 *
 * Storage adapter:
 *   - Native (iOS/Android): expo-secure-store (encrypted keychain)
 *   - Web: window.localStorage (standard Supabase JS default)
 *
 * Never import this file server-side; it references browser/native storage APIs.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '[Barion] Supabase env vars missing. Auth features disabled. ' +
      'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

/**
 * SecureStore adapter for @supabase/supabase-js on native platforms.
 * Keys are sanitised because SecureStore rejects certain characters.
 */
const secureStoreAdapter = {
  getItem: (key: string): string | null | Promise<string | null> =>
    SecureStore.getItemAsync(sanitiseKey(key)),
  setItem: (key: string, value: string): void | Promise<void> =>
    SecureStore.setItemAsync(sanitiseKey(key), value),
  removeItem: (key: string): void | Promise<void> =>
    SecureStore.deleteItemAsync(sanitiseKey(key)),
};

function sanitiseKey(key: string) {
  // SecureStore accepts [A-Za-z0-9._-]; replace anything else with '_'
  return key.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 255);
}

let _client: SupabaseClient | null = null;
let _clientAttempted = false;

/**
 * Returns the Supabase client if configured, otherwise null.
 * Safe to call even when EXPO_PUBLIC_SUPABASE_* vars are missing.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (_clientAttempted) return _client;
  _clientAttempted = true;

  // Supabase not configured - auth features disabled
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null;
  }

  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: Platform.OS === 'web' ? undefined : secureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  });

  return _client;
}
