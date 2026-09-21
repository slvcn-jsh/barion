import 'react-native-gesture-handler';

import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';

import { AppButton } from '@/components/AppButton';
import { BrandMark } from '@/components/BrandMark';
import { initializeDatabase } from '@/storage/database';
import { colors, fonts } from '@/theme/colors';
import { restoreSession, onAuthStateChange, signOut, AuthContext } from '@/auth';


void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  const [databaseReady, setDatabaseReady] = useState(false);
  const [databaseError, setDatabaseError] = useState<string | null>(null);

  // Auth state
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  const openDatabase = useCallback(() => {
    setDatabaseError(null);
    setDatabaseReady(false);
    void initializeDatabase()
      .then(() => setDatabaseReady(true))
      .catch((error) => setDatabaseError(formatDatabaseError(error)));
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontError, fontsLoaded]);

  useEffect(() => {
    if (fontsLoaded || fontError) openDatabase();
  }, [fontError, fontsLoaded, openDatabase]);

  // Restore Supabase session on launch; subscribe to subsequent auth changes
  useEffect(() => {
    let cancelled = false;
    void restoreSession().then((s) => {
      if (!cancelled) { setSession(s); setSessionReady(true); }
    });
    const unsubscribe = onAuthStateChange((s) => { if (!cancelled) setSession(s); });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  if (!databaseReady) {
    return <DatabaseGate error={databaseError} onRetry={openDatabase} />;
  }

  return (
    <AuthContext.Provider value={{ session, sessionReady, signOut }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: colors.canvas },
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.canvas },
            headerTitleStyle: { color: colors.ink, fontFamily: fonts.bold },
            headerTintColor: colors.ink,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false, title: 'BARION' }} />
          <Stack.Screen name="study" options={{ title: 'Review' }} />
          <Stack.Screen name="modes" options={{ headerShown: false, title: 'Ways to Study' }} />
          <Stack.Screen name="calendar" options={{ headerShown: false, title: 'Review Calendar' }} />
          <Stack.Screen name="match" options={{ headerShown: false, title: 'Match' }} />
          <Stack.Screen name="print" options={{ title: 'Print Deck' }} />
          <Stack.Screen name="sources" options={{ headerShown: false, title: 'Source Library' }} />
          <Stack.Screen name="library" options={{ headerShown: false, title: 'Manage Library' }} />
          <Stack.Screen name="data" options={{ headerShown: false, title: 'Data & Offline' }} />
          <Stack.Screen name="profile" options={{ headerShown: false, title: 'Study Profile' }} />
          <Stack.Screen name="classes" options={{ headerShown: false, title: 'Classes & Folders' }} />
          <Stack.Screen name="courses" options={{ headerShown: false, title: 'Classes & Folders' }} />
          <Stack.Screen name="more" options={{ headerShown: false, title: 'More' }} />
          <Stack.Screen name="signin" options={{ headerShown: false, title: 'Sign In' }} />
          <Stack.Screen name="test" options={{ headerShown: false, title: 'Test Mode' }} />
          <Stack.Screen name="deck/[id]" options={{ title: 'Deck' }} />
          <Stack.Screen name="deck/new" options={{ title: 'New Deck' }} />
          <Stack.Screen name="card/new" options={{ title: 'New Card' }} />
          <Stack.Screen name="source/[id]" options={{ title: 'Source' }} />
        </Stack>
      </SafeAreaProvider>
    </AuthContext.Provider>
  );
}

function DatabaseGate({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <View style={styles.gate}>
      <View style={styles.gateCard}>
        <BrandMark size={44} />
        {error ? (
          <>
            <View style={styles.errorIcon}>
              <Ionicons name="lock-closed-outline" size={24} color={colors.red} />
            </View>
            <Text style={styles.gateTitle}>Your local library is temporarily locked</Text>
            <Text style={styles.gateBody}>{error}</Text>
            <AppButton icon="refresh" label="Try again" onPress={onRetry} />
          </>
        ) : (
          <>
            <View style={styles.loadingDot} />
            <Text style={styles.gateTitle}>Preparing your learning space</Text>
            <Text style={styles.gateBody}>Opening your private, offline study library.</Text>
          </>
        )}
      </View>
    </View>
  );
}

function formatDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes('Access Handles') ||
    message.includes('NoModificationAllowedError') ||
    message === 'Unknown'
  ) {
    return 'Close any other Barion browser tabs, then try again. Your cards and review history are safe.';
  }
  if (message.includes('SharedArrayBuffer') || message.includes('secure context')) {
    return 'Open Barion from its secure app address, then try again. Browser SQLite requires an isolated secure page.';
  }
  return `Barion could not open local storage. ${message}`;
}

const styles = StyleSheet.create({
  errorIcon: { alignItems: 'center', backgroundColor: colors.dangerSurface, borderRadius: 15, height: 50, justifyContent: 'center', width: 50 },
  gate: { alignItems: 'center', backgroundColor: colors.canvas, flex: 1, justifyContent: 'center', padding: 20 },
  gateBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, maxWidth: 430, textAlign: 'center' },
  gateCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: 24, borderWidth: 1, gap: 14, maxWidth: 520, padding: 28, width: '100%' },
  gateTitle: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 21, lineHeight: 28, textAlign: 'center' },
  loadingDot: { backgroundColor: colors.teal, borderRadius: 999, height: 10, width: 10 },
});
