import { buildBariCardEvidence } from '@/ai/bariChat';
import { BariChatModal } from '@/components/BariChatModal';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { learnerAnswer } from '@/cards/answerView';
import { cardTrustSummary } from '@/cards/trust';
import { AppButton } from '@/components/AppButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FlipStudyCard } from '@/components/FlipStudyCard';
import { EmptyState, LoadingState } from '@/components/ScreenState';
import type { ActiveStudySession, ReviewRating, StudyActivityOutcome, StudyCard, StudyProfile } from '@/domain/types';
import { previewFsrsOutcomes } from '@/scheduler/fsrs';
import { initializeDatabase } from '@/storage/database';
import {
  getLatestActiveStudySession,
  getModeStudyQueue,
  getStudyProfile,
  getStudyQueue,
  markCardNeedsSourceReview,
  recordCardReview,
  startStudySession,
  undoLastReview,
} from '@/storage/repository';
import {
  chooseLearnActivity,
  effectiveMemoryPolicy,
  formatFsrsInterval,
  modeUsesAllActiveCards,
  parseStudyEngineMode,
  parseStudyLearningGoal,
  spacedSortLabel,
  STUDY_MODES,
} from '@/study/engine';
import { recordStudyActivity } from '@/study/repository';
import { colors, fonts, radii } from '@/theme/colors';

export default function StudyScreen() {
  const params = useLocalSearchParams<{ deckId?: string; moduleId?: string; focus?: string; mode?: string; size?: string; engine?: string; goal?: string }>();
  const [queue, setQueue] = useState<StudyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [lastReviewed, setLastReviewed] = useState<StudyCard | null>(null);
  const [bariChatOpen, setBariChatOpen] = useState(false);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [profile, setProfile] = useState<StudyProfile | null>(null);
  const [session, setSession] = useState<ActiveStudySession | null>(null);
  const [reviewHoldCard, setReviewHoldCard] = useState<StudyCard | null>(null);
  const [holdingReview, setHoldingReview] = useState(false);
  const [recallDraft, setRecallDraft] = useState('');

  const engineMode = parseStudyEngineMode(params.engine);
  const learningGoal = parseStudyLearningGoal(params.goal);
  const memoryPolicy = effectiveMemoryPolicy(engineMode, learningGoal);
  const modeDefinition = STUDY_MODES.find((mode) => mode.id === engineMode) ?? STUDY_MODES[0];

  const current = queue[0];
  const remaining = queue.length;
  const completed = Math.max(sessionTotal - remaining, 0);
  const progress = sessionTotal ? completed / sessionTotal : 0;
  const trust = current ? cardTrustSummary(current) : null;
  const learnActivity = current && engineMode === 'learn' ? chooseLearnActivity(current) : null;
  const intervalLabels = useMemo(() => {
    if (!current) return null;
    if (memoryPolicy === 'short-term') {
      return {
        again: spacedSortLabel('again'),
        hard: spacedSortLabel('hard'),
        good: spacedSortLabel('good'),
        easy: spacedSortLabel('easy'),
      };
    }
    const now = new Date();
    const preview = previewFsrsOutcomes(current.fsrsCardJson, now);
    return {
      again: formatFsrsInterval(preview.again, now),
      hard: formatFsrsInterval(preview.hard, now),
      good: formatFsrsInterval(preview.good, now),
      easy: formatFsrsInterval(preview.easy, now),
    };
  }, [current, memoryPolicy]);

  useEffect(() => () => { void Speech.stop(); }, []);

  useEffect(() => {
    if (engineMode !== 'audio' || !current) return;
    void Speech.stop().then(() => {
      Speech.speak(current.prompt, { language: 'en-US', rate: 0.94, useApplicationAudioSession: false });
    });
  }, [current, engineMode]);

  useEffect(() => {
    if (engineMode !== 'audio' || !current || !revealed) return;
    void Speech.stop().then(() => {
      Speech.speak(learnerAnswer(current.answer), { language: 'en-US', rate: 0.92, useApplicationAudioSession: false });
    });
  }, [current, engineMode, revealed]);

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
        activeSession.engineMode === engineMode &&
        activeSession.learningGoal === learningGoal &&
        (!params.deckId || activeSession.deckId === params.deckId) &&
        (!sessionFocus || activeSession.focus === sessionFocus),
    );
    let nextSession = canResume ? activeSession : null;
    if (!nextSession) {
      const dueCards = modeUsesAllActiveCards(engineMode, learningGoal)
        ? await getModeStudyQueue(params.deckId, params.moduleId, planSize === 'minimum' ? 5 : undefined)
        : await getStudyQueue(
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
            engineMode,
            learningGoal,
          })
        : null;
    }
    const dueCards = nextSession?.cards ?? [];
    setSession(nextSession);
    setQueue(dueCards);
    setProfile(nextProfile);
    setSessionTotal(nextSession?.totalCount ?? dueCards.length);
    setRevealed(false);
    setRecallDraft('');
    setStartedAt(Date.now());
    setLastReviewed(null);
    setLoading(false);
  }, [engineMode, learningGoal, params.deckId, params.focus, params.mode, params.moduleId, params.size]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function grade(rating: ReviewRating) {
    if (!current) {
      return;
    }

    const responseTime = Date.now() - startedAt;
    if (memoryPolicy === 'fsrs') {
      await recordCardReview(
        current,
        rating,
        responseTime,
        engineMode === 'audio' ? 'audio' : engineMode === 'learn' ? 'learn' : 'scheduled',
        session?.id,
      );
      setLastReviewed(current);
      setQueue((items) => items.slice(1));
      setSession((value) => value ? { ...value, completedCount: value.completedCount + 1, cards: value.cards.filter((card) => card.id !== current.id) } : value);
    } else if (session) {
      const result = await recordStudyActivity({
        sessionId: session.id,
        card: current,
        engineMode,
        learningGoal,
        outcome: rating,
        responseTimeMs: responseTime,
      });
      setLastReviewed(null);
      setQueue((items) => result.requeue ? (items.length > 1 ? [...items.slice(1), items[0]] : items) : items.slice(1));
      setSession((value) => value ? {
        ...value,
        completedCount: value.completedCount + (result.requeue ? 0 : 1),
        cards: result.requeue
          ? (value.cards.length > 1 ? [...value.cards.slice(1), value.cards[0]] : value.cards)
          : value.cards.filter((card) => card.id !== current.id),
      } : value);
    }
    setRevealed(false);
    setRecallDraft('');
    setStartedAt(Date.now());
  }

  async function recordSimpleOutcome(outcome: StudyActivityOutcome) {
    if (!current || !session) return;
    const result = await recordStudyActivity({
      sessionId: session.id,
      card: current,
      engineMode,
      learningGoal,
      outcome,
      responseTimeMs: Date.now() - startedAt,
    });
    setQueue((items) => result.requeue ? (items.length > 1 ? [...items.slice(1), items[0]] : items) : items.slice(1));
    setSession((value) => value ? {
      ...value,
      completedCount: value.completedCount + (result.requeue ? 0 : 1),
      cards: result.requeue
        ? (value.cards.length > 1 ? [...value.cards.slice(1), value.cards[0]] : value.cards)
        : value.cards.filter((card) => card.id !== current.id),
    } : value);
    setRevealed(false);
    setRecallDraft('');
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
      setRecallDraft('');
      setStartedAt(Date.now());
    }
  }

  function skip() {
    setQueue((items) => (items.length > 1 ? [...items.slice(1), items[0]] : items));
    setRevealed(false);
    setRecallDraft('');
    setStartedAt(Date.now());
  }

  function flip() {
    setRevealed((value) => !value);
  }

  function speakQuestion() {
    if (!current) return;
    void Speech.stop().then(() => Speech.speak(current.prompt, { language: 'en-US', rate: 0.94, useApplicationAudioSession: false }));
  }

  function speakAnswer() {
    if (!current) return;
    void Speech.stop().then(() => Speech.speak(learnerAnswer(current.answer), { language: 'en-US', rate: 0.92, useApplicationAudioSession: false }));
  }

  async function holdForSourceCheck() {
    if (!reviewHoldCard || holdingReview) {
      return;
    }

    setHoldingReview(true);
    try {
      await markCardNeedsSourceReview(reviewHoldCard.id, session?.id);
      setQueue((items) => items.filter((card) => card.id !== reviewHoldCard.id));
      setSession((value) =>
        value
          ? {
              ...value,
              totalCount: Math.max(0, value.totalCount - 1),
              cards: value.cards.filter((card) => card.id !== reviewHoldCard.id),
            }
          : value,
      );
      setSessionTotal((value) => Math.max(0, value - 1));
      setReviewHoldCard(null);
      setRevealed(false);
      setRecallDraft('');
      setStartedAt(Date.now());
    } catch (error) {
      Alert.alert('Card was not held', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setHoldingReview(false);
    }
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
            <Text style={styles.completeEyebrow}>{engineMode === 'fsrs' ? 'TODAY’S PLAN COMPLETE' : `${modeDefinition.title.toUpperCase()} COMPLETE`}</Text>
            <Text style={styles.completeTitle}>{sessionTotal} card{sessionTotal === 1 ? '' : 's'} finished</Text>
            <Text style={styles.completeBody}>
              {memoryPolicy === 'fsrs'
                ? 'Barion saved every rating and will bring each concept back when another retrieval is useful.'
                : memoryPolicy === 'short-term'
                  ? 'This practice pass was saved as short-term learning evidence without pretending it changed durable FSRS memory.'
                  : 'Browse progress was saved without changing card scheduling.'}
            </Text>
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
        title={modeUsesAllActiveCards(engineMode, learningGoal) ? 'No cards available' : 'No cards due'}
        body={modeUsesAllActiveCards(engineMode, learningGoal)
          ? 'This set has no safe, active cards to study yet.'
          : 'There are no cards available for this session. You may be caught up, have reached a daily guardrail, or have no weak concepts yet.'}
      />
    );
  }

  return (
    <>
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.sessionHeader}>
        <View style={styles.topline}>
          <Text style={styles.meta}>{params.focus === 'weak' ? `${remaining} weak` : `${remaining} in session`}</Text>
          <Text style={styles.meta}>
            {completed}/{sessionTotal} complete
          </Text>
        </View>
        <View style={styles.modeLine}>
          <View style={styles.modeBadge}><Ionicons name={engineMode === 'audio' ? 'headset-outline' : engineMode.includes('sort') ? 'swap-horizontal-outline' : 'school-outline'} size={14} color={colors.blueDark} /><Text style={styles.modeBadgeText}>{modeDefinition.title}</Text></View>
          <Text style={styles.memoryPolicy}>{memoryPolicy === 'fsrs' ? 'Long-term memory' : memoryPolicy === 'short-term' ? 'Short-term only' : 'No scheduling change'}</Text>
        </View>
        {session?.completedCount ? <View style={styles.resumeBadge}><Ionicons name="time-outline" size={14} color={colors.tealDark} /><Text style={styles.resumeText}>Saved plan resumed</Text></View> : null}
        {profile ? <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={styles.profileChip}><Ionicons name="options-outline" size={14} color={colors.blueDark} /><Text style={styles.profileChipText}>{profile.reviewStyle.replace(/-/g, ' ')} · {profile.difficulty}</Text></Pressable> : null}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%` }]} />
        </View>
      </View>

      {trust && trust.tone === 'review' ? (
        <View style={[styles.safetyNotice, trust.tone === 'review' && styles.safetyNoticeWarn]}>
          <Ionicons
            name={trust.tone === 'review' ? 'alert-circle-outline' : 'link-outline'}
            size={19}
            color={trust.tone === 'review' ? '#9a5b09' : colors.tealDark}
          />
          <Text style={[styles.safetyNoticeText, trust.tone === 'review' && styles.safetyNoticeTextWarn]}>
            This card is pending source confirmation and has been held out of normal study.
          </Text>
        </View>
      ) : null}

      {learnActivity ? (
        <View style={styles.activityHint}><Ionicons name="bulb-outline" size={17} color={colors.tealDark} /><Text style={styles.activityHintText}>This card uses {learnActivity}. Recall first, then reveal the answer.</Text></View>
      ) : null}

      {engineMode === 'learn' && !revealed ? (
        <View style={styles.recallPanel}>
          <Text style={styles.recallLabel}>YOUR RECALL · OPTIONAL</Text>
          <TextInput
            accessibilityLabel="Your recall before revealing"
            multiline
            onChangeText={setRecallDraft}
            placeholder={learnActivity === 'clinical reasoning' ? 'Reason through the case or say your answer aloud…' : 'Write the key idea, sequence, or explanation from memory…'}
            placeholderTextColor={colors.slate}
            style={styles.recallInput}
            value={recallDraft}
          />
          <Text style={styles.recallHelp}>This stays with the current card only. Barion will not falsely auto-grade free medical wording.</Text>
        </View>
      ) : null}

      <FlipStudyCard key={current.id} card={current} evidenceDisplay={profile?.evidenceDisplay} reviewStyle={profile?.reviewStyle} revealed={revealed} onFlip={flip} />

      {engineMode === 'learn' && revealed && recallDraft.trim() ? (
        <View style={styles.recallComparison}>
          <Text style={styles.recallLabel}>WHAT YOU RECALLED</Text>
          <Text style={styles.recallText}>{recallDraft.trim()}</Text>
          <Text style={styles.recallHelp}>Compare meaning and required qualifiers against the answer before rating.</Text>
        </View>
      ) : null}

      <AppButton icon="sparkles-outline" label="Ask Bari" variant="quiet" onPress={() => setBariChatOpen(true)} />

      {engineMode === 'audio' ? (
        <View style={styles.audioBar}>
          <AppButton icon="volume-high-outline" label="Question" variant="secondary" onPress={speakQuestion} />
          <AppButton disabled={!revealed} icon="volume-medium-outline" label="Answer" variant="secondary" onPress={speakAnswer} />
          <AppButton icon="stop-circle-outline" label="Stop audio" variant="quiet" onPress={() => void Speech.stop()} />
        </View>
      ) : null}

      {!revealed ? (
        <View style={styles.primaryActions}>
          <AppButton label={engineMode === 'learn' ? 'Compare answer' : 'Reveal'} icon="eye-outline" onPress={() => setRevealed(true)} />
          <AppButton label="Skip" icon="play-skip-forward-outline" variant="secondary" onPress={skip} />
          <AppButton
            disabled={holdingReview}
            label="Hold for source check"
            icon="alert-circle-outline"
            variant="quiet"
            onPress={() => setReviewHoldCard(current)}
          />
        </View>
      ) : (
        <>
          {engineMode === 'browse' ? (
            <AppButton icon="arrow-forward" label={remaining === 1 ? 'Finish browsing' : 'Next card'} onPress={() => void recordSimpleOutcome('viewed')} />
          ) : engineMode === 'basic-sort' || engineMode === 'loop-sort' ? (
            <View style={styles.sortGrid}>
              <RatingButton label="Still learning" helper={engineMode === 'loop-sort' ? 'Returns in this round' : 'Save for practice'} tone="danger" onPress={() => void recordSimpleOutcome('learning')} />
              <RatingButton label="Know" helper="Clear for this round" tone="calm" onPress={() => void recordSimpleOutcome('known')} />
            </View>
          ) : (
            <View style={styles.gradeGrid}>
              <RatingButton label="Again" helper={intervalLabels?.again ?? 'Soon'} tone="danger" onPress={() => void grade('again')} />
              <RatingButton label="Hard" helper={intervalLabels?.hard ?? 'Soon'} tone="warn" onPress={() => void grade('hard')} />
              <RatingButton label="Good" helper={intervalLabels?.good ?? 'Later'} tone="primary" onPress={() => void grade('good')} />
              <RatingButton label="Easy" helper={intervalLabels?.easy ?? 'Later'} tone="calm" onPress={() => void grade('easy')} />
            </View>
          )}
          <AppButton
            disabled={holdingReview}
            label="Answer is confusing or unsafe"
            icon="alert-circle-outline"
            variant="secondary"
            onPress={() => setReviewHoldCard(current)}
          />
        </>
      )}

      {lastReviewed ? (
        <AppButton label="Undo Last Rating" icon="arrow-undo-outline" variant="secondary" onPress={undo} />
      ) : null}
    </ScrollView>
    <ConfirmDialog
      body="This card will be removed from study and tests, flagged as needing a source check, and kept recoverable in Manage Library."
      busy={holdingReview}
      confirmLabel="Hold card"
      title="Hold this card for source review?"
      visible={reviewHoldCard !== null}
      onCancel={() => setReviewHoldCard(null)}
      onConfirm={() => void holdForSourceCheck()}
    />
    {current ? (
      <BariChatModal
        visible={bariChatOpen}
        onClose={() => setBariChatOpen(false)}
        contextType="card"
        contextId={current.id}
        contextTitle={current.prompt}
        evidence={buildBariCardEvidence(current, current.evidence)}
      />
    ) : null}
    </>
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
  activityHint: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: radii.sm, flexDirection: 'row', gap: 8, padding: 11 },
  activityHintText: { color: colors.tealDark, flex: 1, fontFamily: fonts.semibold, fontSize: 11, lineHeight: 17 },
  audioBar: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 10 },
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
  memoryPolicy: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 10 },
  modeBadge: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, flexDirection: 'row', gap: 5, paddingHorizontal: 9, paddingVertical: 6 },
  modeBadgeText: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10 },
  modeLine: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
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
  recallComparison: { backgroundColor: colors.surface, borderColor: colors.lineStrong, borderRadius: radii.md, borderWidth: 1, gap: 7, padding: 14 },
  recallHelp: { color: colors.muted, fontFamily: fonts.regular, fontSize: 10, lineHeight: 16 },
  recallInput: { backgroundColor: colors.canvas, borderColor: colors.lineStrong, borderRadius: radii.sm, borderWidth: 1, color: colors.ink, fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, minHeight: 86, padding: 12, textAlignVertical: 'top' },
  recallLabel: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.9 },
  recallPanel: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, gap: 8, padding: 14 },
  recallText: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 20 },
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
  sortGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  safetyNotice: {
    alignItems: 'center',
    backgroundColor: colors.surfaceTeal,
    borderColor: '#c7e9df',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 12,
  },
  safetyNoticeText: {
    color: colors.tealDark,
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 18,
  },
  safetyNoticeTextWarn: {
    color: '#9a5b09',
  },
  safetyNoticeWarn: {
    backgroundColor: colors.warningSurface,
    borderColor: '#efd59f',
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
