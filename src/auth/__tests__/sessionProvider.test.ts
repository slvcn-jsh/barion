/**
 * Unit tests for src/auth/sessionProvider.ts
 * Supabase client singleton mocked; native modules mocked for Jest.
 */

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

const mockSession = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  user: { id: 'user-1', email: 'user@example.com' },
};

const mockGetSession = jest.fn();
const mockGetUser = jest.fn();
const mockSignIn = jest.fn();
const mockSignUp = jest.fn();
const mockResetPassword = jest.fn();
const mockSignOut = jest.fn();
const mockRefreshSession = jest.fn();
const mockOnAuthStateChange = jest.fn(() => ({
  data: { subscription: { unsubscribe: jest.fn() } },
}));

const mockSupabaseClient = {
  auth: {
    getSession: mockGetSession,
    getUser: mockGetUser,
    signInWithPassword: mockSignIn,
    signUp: mockSignUp,
    resetPasswordForEmail: mockResetPassword,
    signOut: mockSignOut,
    refreshSession: mockRefreshSession,
    onAuthStateChange: mockOnAuthStateChange,
  },
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupabaseClient,
}));

// Mock supabaseClient to return configured client for these tests
jest.mock('@/auth/supabaseClient', () => ({
  getSupabaseClient: () => mockSupabaseClient,
}));

import {
  createSupabaseAccessTokenProvider,
  getCurrentUser,
  onAuthStateChange,
  resetPassword,
  restoreSession,
  signIn,
  signOut,
  signUp,
} from '@/auth/sessionProvider';

beforeEach(() => { jest.clearAllMocks(); });


describe('restoreSession', () => {
  it('returns session when one exists', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: mockSession } });
    expect(await restoreSession()).toBe(mockSession);
  });

  it('returns null when no session', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    expect(await restoreSession()).toBeNull();
  });
});

describe('signIn', () => {
  it('returns session on success', async () => {
    mockSignIn.mockResolvedValueOnce({ data: { session: mockSession }, error: null });
    const result = await signIn({ email: 'user@example.com', password: 'secret' });
    expect(result).toBe(mockSession);
    expect(mockSignIn).toHaveBeenCalledWith({ email: 'user@example.com', password: 'secret' });
  });

  it('throws when Supabase returns error', async () => {
    mockSignIn.mockResolvedValueOnce({ data: { session: null }, error: { message: 'Invalid credentials' } });
    await expect(signIn({ email: 'bad@example.com', password: 'wrong' })).rejects.toThrow('Invalid credentials');
  });

  it('throws generic when session missing without error object', async () => {
    mockSignIn.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(signIn({ email: 'x@x.com', password: 'y' })).rejects.toThrow('Sign-in failed.');
  });
});

describe('signUp', () => {
  it('returns session and user on success', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: { session: mockSession, user: mockSession.user },
      error: null,
    });
    const result = await signUp({ email: 'new@example.com', password: 'secretpassword' });
    expect(result.session).toBe(mockSession);
    expect(result.user).toBe(mockSession.user);
    expect(mockSignUp).toHaveBeenCalledWith({ email: 'new@example.com', password: 'secretpassword' });
  });

  it('handles sign-up with email confirmation required (no session returned)', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: { session: null, user: mockSession.user },
      error: null,
    });
    const result = await signUp({ email: 'new@example.com', password: 'secretpassword' });
    expect(result.session).toBeNull();
    expect(result.user).toBe(mockSession.user);
  });

  it('throws error when signUp fails', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: 'User already registered' },
    });
    await expect(signUp({ email: 'existing@example.com', password: 'pass' })).rejects.toThrow(
      'User already registered'
    );
  });
});

describe('resetPassword', () => {
  it('calls resetPasswordForEmail with trimmed email', async () => {
    mockResetPassword.mockResolvedValueOnce({ data: {}, error: null });
    await resetPassword('  user@example.com  ');
    expect(mockResetPassword).toHaveBeenCalledWith('user@example.com');
  });

  it('throws error when resetPassword fails', async () => {
    mockResetPassword.mockResolvedValueOnce({
      data: {},
      error: { message: 'Rate limit exceeded' },
    });
    await expect(resetPassword('user@example.com')).rejects.toThrow('Rate limit exceeded');
  });
});

describe('signOut', () => {
  it('calls supabase signOut', async () => {
    mockSignOut.mockResolvedValueOnce({});
    await signOut();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('getCurrentUser', () => {
  it('returns user when present', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: mockSession.user } });
    expect(await getCurrentUser()).toBe(mockSession.user);
  });

  it('returns null when no user', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    expect(await getCurrentUser()).toBeNull();
  });
});

describe('createSupabaseAccessTokenProvider', () => {
  it('returns token from session when forceRefresh=false', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: mockSession } });
    expect(await createSupabaseAccessTokenProvider()(false)).toBe('test-access-token');
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  it('returns null when no session and forceRefresh=false', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    expect(await createSupabaseAccessTokenProvider()(false)).toBeNull();
  });

  it('force-refreshes and returns new token when forceRefresh=true', async () => {
    mockRefreshSession.mockResolvedValueOnce({
      data: { session: { ...mockSession, access_token: 'refreshed-token' } },
      error: null,
    });
    expect(await createSupabaseAccessTokenProvider()(true)).toBe('refreshed-token');
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('returns null when force-refresh fails', async () => {
    mockRefreshSession.mockResolvedValueOnce({ data: { session: null }, error: { message: 'Failed' } });
    expect(await createSupabaseAccessTokenProvider()(true)).toBeNull();
  });

  it('defaults forceRefresh to false', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: mockSession } });
    await createSupabaseAccessTokenProvider()();
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });
});

describe('onAuthStateChange', () => {
  it('calls listener and returns working unsubscribe', () => {
    const listener = jest.fn();
    const fakeUnsub = jest.fn();
    (mockOnAuthStateChange as jest.Mock).mockImplementationOnce((cb: (e: string, s: unknown) => void) => {
      cb('SIGNED_IN', mockSession);
      return { data: { subscription: { unsubscribe: fakeUnsub } } };
    });
    const unsub = onAuthStateChange(listener);
    expect(listener).toHaveBeenCalledWith(mockSession);
    unsub();
    expect(fakeUnsub).toHaveBeenCalledTimes(1);
  });

  it('passes null session on sign-out', () => {
    const listener = jest.fn();
    (mockOnAuthStateChange as jest.Mock).mockImplementationOnce((cb: (e: string, s: unknown) => void) => {
      cb('SIGNED_OUT', null);
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });
    onAuthStateChange(listener);
    expect(listener).toHaveBeenCalledWith(null);
  });
});
