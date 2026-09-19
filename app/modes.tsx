import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/ScreenState';
import type { Dashboard, StudyEngineMode, StudyLearningGoal, StudyProfile } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import { getDashboard, getStudyProfile } from '@/storage/repository';
import { recommendedStudyMode, STUDY_MODES } from '@/study/engine';
import { colors, fonts, radii } from '@/theme/colors';

export default function StudyModesScreen() {
  const params = useLocalSearchParams<{ deckId?: string; moduleId?: string }>();
  const [profile, setProfile] = useState<StudyProfile | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [goal, setGoal] = useState<StudyLearningGoal>('long-term');
  const [showMore, setShowMore] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void initializeDatabase()
        .then(() => Promise.all([getStudyProfile(), getDashboard()]))
        .then(([nextProfile, nextDashboard]) => {
          if (!active) return;
          setProfile(nextProfile);
          setDashboard(nextDashboard);
        });
      return () => { active = false; };
    }, []),
  );

  const recommendation = useMemo(
    () => profile ? recommendedStudyMode(profile, goal) : 'fsrs',
    [goal, profile],
  );
  const recommended = STUDY_MODES.find((mode) => mode.id === recommendation) ?? STUDY_MODES[0];
  const otherModes = STUDY_MODES.filter((mode) => mode.id !== recommendation);

  function openMode(mode: StudyEngineMode, selectedGoal = goal) {
    router.push({
      pathname: '/study',
      params: {
        deckId: params.deckId,
        moduleId: params.moduleId,
        engine: mode,
        goal: selectedGoal,
      },
    });
  }

  if (!profile || !dashboard) return <LoadingState label="Preparing study choices" />;

  return (
    <AppShell active="study">
      <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="sparkles" size={24} color={colors.surface} /></View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>BARION STUDY ENGINE</Text>
          <Text style={styles.title}>Choose a goal, not a complicated setup.</Text>
          <Text style={styles.heroBody}>Every mode uses the same safe card library. Only genuine recall changes long-term FSRS scheduling.</Text>
        </View>
      </View>

      <View style={styles.goalPanel}>
        <Text style={styles.sectionTitle}>What are you studying for?</Text>
        <View style={styles.goalRow}>
          <GoalChoice
            detail="FSRS plans future recall."
            label="Remember long-term"
            selected={goal === 'long-term'}
            onPress={() => setGoal('long-term')}
          />
          <GoalChoice
            detail="Repeat misses without changing FSRS."
            label="Cram for a test"
            selected={goal === 'cram'}
            onPress={() => setGoal('cram')}
          />
        </View>
      </View>

      <View style={styles.recommendedCard}>
        <View style={styles.recommendedTopline}>
          <Text style={styles.recommendedLabel}>RECOMMENDED FOR YOUR PROFILE</Text>
          <Text style={styles.countPill}>{dashboard.dueCount} due</Text>
        </View>
        <Text style={styles.recommendedTitle}>{goal === 'cram' ? 'Learn until clear' : recommended.title}</Text>
        <Text style={styles.body}>{goal === 'cram' ? 'Missed cards loop back automatically. This is short-term preparation, not a false claim of durable mastery.' : recommended.description}</Text>
        <AppButton
          icon="play"
          label={goal === 'cram' ? 'Start cram session' : `Start ${recommended.title.toLowerCase()}`}
          onPress={() => openMode(goal === 'cram' ? 'learn' : recommended.id, goal)}
        />
      </View>

      <Pressable accessibilityRole="button" onPress={() => setShowMore((value) => !value)} style={styles.moreToggle}>
        <View><Text style={styles.sectionTitle}>More ways to study</Text><Text style={styles.body}>Optional tools stay out of the main path.</Text></View>
        <Ionicons name={showMore ? 'chevron-up' : 'chevron-down'} size={22} color={colors.blueDark} />
      </Pressable>

      {showMore ? (
        <View style={styles.modeGrid}>
          {otherModes.map((mode) => (
            <Pressable
              accessibilityRole="button"
              key={mode.id}
              onPress={() => openMode(mode.id, goal)}
              style={({ pressed }) => [styles.modeCard, pressed && styles.pressed]}
            >
              <View style={styles.modeIcon}><Ionicons name={iconForMode(mode.id)} size={21} color={colors.blueDark} /></View>
              <Text style={styles.modeTitle}>{mode.title}</Text>
              <Text style={styles.body}>{mode.description}</Text>
              <Text style={styles.policy}>{policyLabel(mode.memoryPolicy)}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/test', params })} style={styles.modeCard}>
            <View style={styles.modeIcon}><Ionicons name="school-outline" size={21} color={colors.blueDark} /></View>
            <Text style={styles.modeTitle}>Test</Text>
            <Text style={styles.body}>Build a configurable assessment with confidence-aware feedback.</Text>
            <Text style={styles.policy}>Assessment evidence</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/match', params })} style={styles.modeCard}>
            <View style={styles.modeIcon}><Ionicons name="grid-outline" size={21} color={colors.blueDark} /></View>
            <Text style={styles.modeTitle}>Match</Text>
            <Text style={styles.body}>Connect six real question-and-answer pairs, then retry only the weak ones.</Text>
            <Text style={styles.policy}>Recognition only · FSRS unchanged</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={styles.profileLink}>
        <Ionicons name="options-outline" size={19} color={colors.tealDark} />
        <Text style={styles.profileText}>Teaching preference: {profile.reviewStyle.replace(/-/g, ' ')} · {profile.difficulty}</Text>
        <Ionicons name="arrow-forward" size={17} color={colors.tealDark} />
      </Pressable>
      </ScrollView>
    </AppShell>
  );
}

function GoalChoice({ label, detail, selected, onPress }: { label: string; detail: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.goalChoice, selected && styles.goalChoiceSelected]}>
      <View style={styles.goalTopline}><Text style={styles.goalLabel}>{label}</Text>{selected ? <Ionicons name="checkmark-circle" size={20} color={colors.blue} /> : null}</View>
      <Text style={styles.body}>{detail}</Text>
    </Pressable>
  );
}

function iconForMode(mode: StudyEngineMode): keyof typeof Ionicons.glyphMap {
  if (mode === 'audio') return 'headset-outline';
  if (mode === 'browse') return 'albums-outline';
  if (mode === 'learn') return 'sparkles-outline';
  if (mode.includes('sort')) return 'swap-horizontal-outline';
  return 'time-outline';
}

function policyLabel(policy: 'none' | 'short-term' | 'fsrs') {
  if (policy === 'fsrs') return 'Updates long-term memory';
  if (policy === 'short-term') return 'Short-term practice only';
  return 'Does not change scheduling';
}

const styles = StyleSheet.create({
  body: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  container: { gap: 16, marginHorizontal: 'auto', maxWidth: 960, padding: 18, paddingBottom: 44, width: '100%' },
  countPill: { backgroundColor: colors.surface, borderRadius: radii.pill, color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 6 },
  eyebrow: { color: '#c8dbf7', fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  goalChoice: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 1, gap: 5, minWidth: 230, padding: 14 },
  goalChoiceSelected: { backgroundColor: colors.surfaceMuted, borderColor: colors.blue, borderWidth: 2 },
  goalLabel: { color: colors.ink, flex: 1, fontFamily: fonts.bold, fontSize: 14 },
  goalPanel: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 12, padding: 18 },
  goalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  goalTopline: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  hero: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radii.lg, flexDirection: 'row', gap: 15, padding: 22 },
  heroBody: { color: '#d8e5f7', fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  heroCopy: { flex: 1, gap: 6 },
  heroIcon: { alignItems: 'center', backgroundColor: colors.blue, borderRadius: 16, height: 54, justifyContent: 'center', width: 54 },
  modeCard: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 1, gap: 8, minHeight: 180, minWidth: 230, padding: 16 },
  modeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  modeIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 12, height: 42, justifyContent: 'center', width: 42 },
  modeTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 16 },
  moreToggle: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 16 },
  policy: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 10, marginTop: 'auto', textTransform: 'uppercase' },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  profileLink: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: radii.md, flexDirection: 'row', gap: 9, padding: 14 },
  profileText: { color: colors.tealDark, flex: 1, fontFamily: fonts.semibold, fontSize: 12, textTransform: 'capitalize' },
  recommendedCard: { backgroundColor: colors.surfaceMuted, borderColor: colors.blue, borderRadius: radii.lg, borderWidth: 2, gap: 10, padding: 20 },
  recommendedLabel: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1 },
  recommendedTitle: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 23 },
  recommendedTopline: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 17 },
  title: { color: colors.surface, fontFamily: fonts.extraBold, fontSize: 24, lineHeight: 31 },
});
