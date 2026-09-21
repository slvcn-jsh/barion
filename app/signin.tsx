import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/AppButton';
import { BrandMark } from '@/components/BrandMark';
import { resetPassword, signIn, signUp, useAuth } from '@/auth';
import { getSupabaseClient } from '@/auth/supabaseClient';
import { colors, fonts, radii } from '@/theme/colors';

type AuthMode = 'signin' | 'signup' | 'forgot_password';

const isAuthConfigured = (): boolean => {
  return getSupabaseClient() !== null;
};

export default function SignInScreen() {
  const { session, sessionReady } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  // Already signed in — bounce to home
  useEffect(() => {
    if (sessionReady && session) {
      router.replace('/');
    }
  }, [session, sessionReady]);

  function switchMode(next: AuthMode) {
    setMode(next);
    setError(null);
    setInfoMessage(null);
  }

  async function handleSubmit() {
    if (!isAuthConfigured()) {
      setError(
        'Authentication is not configured. This feature requires Supabase credentials. ' +
        'You can still use all offline features including AI card generation.'
      );
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }

    if (mode === 'forgot_password') {
      setError(null);
      setInfoMessage(null);
      setLoading(true);
      try {
        await resetPassword(trimmedEmail);
        setInfoMessage('Password reset email sent. Check your inbox.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send reset email.');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!password) {
      setError('Please enter your password.');
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setError(null);
    setInfoMessage(null);
    setLoading(true);

    try {
      if (mode === 'signin') {
        await signIn({ email: trimmedEmail, password });
        router.replace('/');
      } else if (mode === 'signup') {
        const result = await signUp({ email: trimmedEmail, password });
        if (result.session) {
          router.replace('/');
        } else {
          setInfoMessage('Account created! Please check your email to confirm your address.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <View style={styles.brand}>
            <BrandMark size={40} />
            <Text style={styles.appName}>BARION</Text>
          </View>

          {/* Mode Switcher Tabs */}
          {mode !== 'forgot_password' && (
            <View style={styles.tabContainer}>
              <Pressable
                onPress={() => switchMode('signin')}
                style={[styles.tab, mode === 'signin' && styles.tabActive]}
              >
                <Text style={[styles.tabText, mode === 'signin' && styles.tabTextActive]}>
                  Sign in
                </Text>
              </Pressable>
              <Pressable
                onPress={() => switchMode('signup')}
                style={[styles.tab, mode === 'signup' && styles.tabActive]}
              >
                <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>
                  Create account
                </Text>
              </Pressable>
            </View>
          )}

          <View style={styles.copy}>
            <Text style={styles.title}>
              {mode === 'signin'
                ? 'Sign in to your account'
                : mode === 'signup'
                ? 'Create a Barion account'
                : 'Reset your password'}
            </Text>
            <Text style={styles.body}>
              {mode === 'signin'
                ? 'Access AI card generation and sync your study progress.'
                : mode === 'signup'
                ? 'Sign up to enable smart grounded AI card generation.'
                : 'Enter your email and we will send a password reset link.'}
            </Text>
          </View>

          <View style={styles.fields}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                inputMode="email"
                onChangeText={setEmail}
                onSubmitEditing={() => {
                  if (mode === 'forgot_password') void handleSubmit();
                  else passwordRef.current?.focus();
                }}
                placeholder="you@example.com"
                placeholderTextColor={colors.slate}
                returnKeyType={mode === 'forgot_password' ? 'go' : 'next'}
                style={styles.input}
                value={email}
              />
            </View>

            {mode !== 'forgot_password' && (
              <View style={styles.fieldGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Password</Text>
                  {mode === 'signin' && (
                    <Pressable onPress={() => switchMode('forgot_password')}>
                      <Text style={styles.forgotLink}>Forgot?</Text>
                    </Pressable>
                  )}
                </View>
                <TextInput
                  accessibilityLabel="Password"
                  autoCapitalize="none"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  onChangeText={setPassword}
                  onSubmitEditing={() => {
                    if (mode === 'signup') confirmPasswordRef.current?.focus();
                    else void handleSubmit();
                  }}
                  placeholder="••••••••"
                  placeholderTextColor={colors.slate}
                  ref={passwordRef}
                  returnKeyType={mode === 'signup' ? 'next' : 'go'}
                  secureTextEntry
                  style={styles.input}
                  value={password}
                />
              </View>
            )}

            {mode === 'signup' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Confirm password</Text>
                <TextInput
                  accessibilityLabel="Confirm password"
                  autoCapitalize="none"
                  autoComplete="new-password"
                  onChangeText={setConfirmPassword}
                  onSubmitEditing={handleSubmit}
                  placeholder="••••••••"
                  placeholderTextColor={colors.slate}
                  ref={confirmPasswordRef}
                  returnKeyType="go"
                  secureTextEntry
                  style={styles.input}
                  value={confirmPassword}
                />
              </View>
            )}
          </View>

          {infoMessage ? (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>{infoMessage}</Text>
            </View>
          ) : null}

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {loading ? (
            <ActivityIndicator color={colors.blue} size="small" />
          ) : (
            <AppButton
              disabled={loading}
              icon={
                mode === 'signin'
                  ? 'log-in-outline'
                  : mode === 'signup'
                  ? 'person-add-outline'
                  : 'mail-outline'
              }
              label={
                mode === 'signin'
                  ? 'Sign in'
                  : mode === 'signup'
                  ? 'Create account'
                  : 'Send reset link'
              }
              onPress={handleSubmit}
            />
          )}

          {mode === 'forgot_password' && (
            <Pressable onPress={() => switchMode('signin')} style={styles.backLinkWrapper}>
              <Text style={styles.backLinkText}>← Back to sign in</Text>
            </Pressable>
          )}

          <Text style={styles.hint}>
            Study data and AI card generation work offline. Sign in is optional
            and only needed for future cloud sync features.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  appName: {
    color: colors.ink,
    fontFamily: fonts.extraBold,
    fontSize: 18,
    letterSpacing: 2,
  },
  backLinkText: {
    color: colors.blueDark,
    fontFamily: fonts.semibold,
    fontSize: 13,
    textAlign: 'center',
  },
  backLinkWrapper: {
    alignSelf: 'center',
    paddingVertical: 4,
  },
  body: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  brand: { alignItems: 'center', gap: 8 },
  card: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: 18,
    maxWidth: 440,
    padding: 24,
    width: '100%',
  },
  container: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  copy: { alignItems: 'center', gap: 6 },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderRadius: radii.sm,
    padding: 12,
  },
  errorText: {
    color: colors.red,
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
  },
  fieldGroup: { gap: 6 },
  fields: { gap: 12 },
  flex: { flex: 1 },
  forgotLink: {
    color: colors.blueDark,
    fontFamily: fonts.semibold,
    fontSize: 12,
  },
  hint: {
    color: colors.slate,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  infoBox: {
    backgroundColor: colors.surfaceTeal,
    borderRadius: radii.sm,
    padding: 12,
  },
  infoText: {
    color: colors.tealDark,
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    backgroundColor: colors.canvas,
    borderColor: colors.line,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  label: {
    color: colors.inkSoft,
    fontFamily: fonts.semibold,
    fontSize: 13,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tab: {
    alignItems: 'center',
    borderRadius: radii.sm,
    flex: 1,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: colors.surface,
  },
  tabContainer: {
    backgroundColor: colors.canvas,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 4,
  },
  tabText: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  tabTextActive: {
    color: colors.ink,
    fontFamily: fonts.bold,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.extraBold,
    fontSize: 21,
    lineHeight: 28,
    textAlign: 'center',
  },
});
