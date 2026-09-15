import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FlipStudyCard } from '@/components/FlipStudyCard';
import { EmptyState, LoadingState } from '@/components/ScreenState';
import type { ActiveStudySession, ReviewRating, StudyCard, StudyProfile } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import {
  getLatestActiveStudySession,
  getStudyProfile,
  getStudyQueue,
  recordCardReview,
  startStudySession,
  undoLastReview,
} from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

export default function StudyScreen() {
  const params = useLocalSearchParams<{ deckId?: string; moduleId?: string; focus?: string; mode?: string; size?: string }>();
  const [queue, setQueue] = useState<StudyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [lastReviewed, setLastReviewed] = useState<StudyCard | null>(null);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [profile, setProfile] = useState<StudyProfile | null>(null);
  const [session, setSession] = useState<ActiveStudySession | null>(null);

  const current = queue[0];
  const remaining = queue.length;
  const completed = Math.max(sessionTotal - remaining, 0);
  const progress = sessionTotal ? completed / sessionTotal : 0;

  const refresh = useCallback(async () => {
    setLoading(true);
    await initializeDatabase();
    const planSize = params.size === 'minimum' ? 'minimum' : 'normal';
    const sessionFocus = params.moduleId
      ? `module:${params.moduleId}${params.focus === 'weak' ? ':weak' : ''}`
      : params.focus;
    const requestedMode: ActiveStudySession['mode'] = params.focus === 'weak'
      ? 'weak'
      : params.mode === 'autopilot'
        ? 'autopilot'
        : 'deck';
    const [activeSession, nextProfile] = await Promise.all([
      getLatestActiveStudySession(),
      getStudyProfile(),
    ]);
    const canResume = Boolean(
      activeSession &&
        (!params.deckId || activeSession.deckId === params.deckId) &&
        (!sessionFocus || activeSession.focus === sessionFocus),
    );
    let nextSession = canResume ? activeSession : null;
    if (!nextSession) {
      const dueCards = await getStudyQueue(
        params.deckId,
        params.focus === 'weak' ? 'weak' : undefined,
        planSize === 'minimum' ? 5 : undefined,
        params.moduleId,
      );
      nextSession = dueCards.length
        ? await startStudySession({
            cards: dueCards,
            deckId: params.deckId,
            focus: sessionFocus,
            mode: requestedMode,
            planSize,
          })
        : null;
    }
    const dueCards = nextSession?.cards ?? [];
    setSession(nextSession);
    setQueue(dueCards);
    setProfile(nextProfile);
    setSessionTotal(nextSession?.totalCount ?? dueCards.length);
    setRevealed(false);
    setStartedAt(Date.now());
    setLastReviewed(null);
    setLoading(false);
  }, [params.deckId, params.focus, params.mode, params.moduleId, params.size]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function grade(rating: ReviewRating) {
    if (!current) {
      return;
    }

    await recordCardReview(current, rating, Date.now() - startedAt, 'scheduled', session?.id);
    setLastReviewed(current);
    setQueue((items) => items.slice(1));
    setSession((value) => value ? { ...value, completedCount: value.completedCount + 1, cards: value.cards.filter((card) => card.id !== current.id) } : value);
    setRevealed(false);
    setStartedAt(Date.now());
  }

  async function undo() {
    if (!lastReviewed) {
      return;
    }

    const restored = await undoLastReview(lastReviewed.id, session?.id);
    if (restored) {
      setQueue((items) => [lastReviewed, ...items.filter((item) => item.id !== lastReviewed.id)]);
      setLastReviewed(null);
      setSession((value) => value ? { ...value, completedCount: Math.max(0, value.completedCount - 1), cards: [lastReviewed, ...value.cards.filter((card) => card.id !== lastReviewed.id)] } : value);
      setRevealed(false);
      setStartedAt(Date.now());
    }
  }

  function skip() {
    setQueue((items) => (items.length > 1 ? [...items.slice(1), items[0]] : items));
    setRevealed(false);
    setStartedAt(Date.now());
  }

  function flip() {
    setRevealed((value) => !value);
  }

  if (loading) {
    return <LoadingState label="Loading due queue" />;
  }

  if (!current) {
    if (sessionTotal > 0) {
      return (
        <ScrollView contentContainerStyle={styles.completeContainer}>
          <View style={styles.completeCard}>
            <View style={styles.completeIcon}><Ionicons name="checkmark" size={31} color={colors.surface} /></View>
            <Text style={styles.completeEyebrow}>TODAY’S PLAN COMPLETE</Text>
            <Text style={styles.completeTitle}>{sessionTotal} retrievals finished</Text>
            <Text style={styles.completeBody}>Barion saved every rating and will bring each concept back when another retrieval is useful.</Text>
            <View style={styles.primaryActions}>
              <AppButton icon="home-outline" label="Back to today" onPress={() => router.replace('/')} />
              <AppButton icon="school-outline" label="Test weak concepts" variant="secondary" onPress={() => router.replace({ pathname: '/test', params: { scope: 'weak' } })} />
              {lastReviewed ? <AppButton icon="arrow-undo-outline" label="Undo last rating" variant="quiet" onPress={() => void undo()} /> : null}
            </View>
          </View>
        </ScrollView>
      );
    }
    return (
      <EmptyState
        title="No cards due"
        body="There are no cards available for this session. You may be caught up, have reached a daily guardrail, or have no weak concepts yet."
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.sessionHeader}>
        <View style={styles.topline}>
          <Text style={styles.meta}>{params.focus === 'weak' ? `${remaining} weak` : `${remaining} in session`}</Text>
          <Text style={styles.meta}>
            {completed}/{sessionTotal} reviewed
          </Text>
        </View>
        {session?.completedCount ? <View style={styles.resumeBadge}><Ionicons name="time-outline" size={14} color={colors.tealDark} /><Text style={styles.resumeText}>Saved plan resumed</Text></View> : null}
        {profile ? <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={styles.profileChip}><Ionicons name="options-outline" size={14} color={colors.blueDark} /><Text style={styles.profileChipText}>{profile.reviewStyle.replace(/-/g, ' ')} · {profile.difficulty}</Text></Pressable> : null}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%` }]} />
        </View>
      </View>

      <FlipStudyCard key={current.id} card={current} evidenceDisplay={profile?.evidenceDisplay} reviewStyle={profile?.reviewStyle} revealed={revealed} onFlip={flip} />

      {!revealed ? (
        <View style={styles.primaryActions}>
          <AppButton label="Reveal" icon="eye-outline" onPress={() => setRevealed(true)} />
          <AppButton label="Skip" icon="play-skip-forward-outline" variant="secondary" onPress={skip} />
        </View>
      ) : (
        <View style={styles.gradeGrid}>
          <RatingButton label="Again" helper="Repeat soon" tone="danger" onPress={() => grade('again')} />
          <RatingButton label="Hard" helper="Keep close" tone="warn" onPress={() => grade('hard')} />
          <RatingButton label="Good" helper="On track" tone="primary" onPress={() => grade('good')} />
          <RatingButton label="Easy" helper="Stretch out" tone="calm" onPress={() => grade('easy')} />
        </View>
      )}

      {lastReviewed ? (
        <AppButton label="Undo Last Rating" icon="arrow-undo-outline" variant="secondary" onPress={undo} />
      ) : null}
    </ScrollView>
  );
}

function RatingButton({
  label,
  helper,
  tone,
  onPress,
}: {
  label: string;
  helper: string;
  tone: 'danger' | 'warn' | 'primary' | 'calm';
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.ratingButton, styles[tone], pressed && styles.ratingPressed]}
    >
      <Text style={[styles.ratingLabel, tone === 'danger' && styles.ratingLabelOnDark]}>
        {label}
      </Text>
      <Text style={[styles.ratingHelper, tone === 'danger' && styles.ratingHelperOnDark]}>
        {helper}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  calm: {
    backgroundColor: '#eaf8f2',
    borderColor: '#b9e2d4',
  },
  completeBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, maxWidth: 520, textAlign: 'center' },
  completeCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 12, maxWidth: 620, padding: 30, width: '100%' },
  completeContainer: { alignItems: 'center', justifyContent: 'center', minHeight: '100%', padding: 20 },
  completeEyebrow: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2 },
  completeIcon: { alignItems: 'center', backgroundColor: colors.green, borderRadius: 999, height: 64, justifyContent: 'center', width: 64 },
  completeTitle: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 25, lineHeight: 32, textAlign: 'center' },
  container: {
    gap: 16,
    marginHorizontal: 'auto',
    maxWidth: 820,
    padding: 18,
    paddingBottom: 36,
    width: '100%',
  },
  danger: {
    backgroundColor: colors.coral,
    borderColor: colors.coral,
  },
  gradeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  meta: {
    color: colors.muted,
    fontFamily: fonts.bold,
    fontSize: 13,
    textTransform: 'uppercase',
  },
  primary: {
    backgroundColor: colors.surfaceTeal,
    borderColor: '#b8e7df',
  },
  primaryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  progressFill: {
    backgroundColor: colors.blue,
    borderRadius: 999,
    height: '100%',
  },
  progressTrack: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  profileChip: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 7 },
  profileChipText: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, textTransform: 'capitalize' },
  ratingButton: {
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minHeight: 64,
    minWidth: 148,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  ratingHelper: {
    color: colors.muted,
    fontFamily: fonts.semibold,
    fontSize: 12,
  },
  ratingHelperOnDark: {
    color: colors.surface,
    opacity: 0.9,
  },
  ratingLabel: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  ratingLabelOnDark: {
    color: colors.surface,
  },
  ratingPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  resumeBadge: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.surfaceTeal, borderRadius: radii.pill, flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 7 },
  resumeText: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 10 },
  sessionHeader: {
    gap: 10,
  },
  topline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  warn: {
    backgroundColor: colors.warningSurface,
    borderColor: '#efd59f',
  },
});
