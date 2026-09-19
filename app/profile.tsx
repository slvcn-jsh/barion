import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/ScreenState';
import type {
  EvidenceDisplay,
  ExamGoal,
  FeedbackTiming,
  ReviewStyle,
  StudyDifficulty,
  StudyProfile,
} from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import { getStudyProfile, updateStudyProfile } from '@/storage/repository';
import { syncStudyReminders } from '@/notifications/studyReminders';
import { colors, fonts, radii } from '@/theme/colors';

type Choice<T extends string | number> = { value: T; label: string; detail: string; recommended?: boolean };

export default function ProfileScreen() {
  const [profile, setProfile] = useState<StudyProfile | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void initializeDatabase()
        .then(getStudyProfile)
        .then((next) => active && setProfile(next));
      return () => { active = false; };
    }, []),
  );

  async function choose(patch: Partial<StudyProfile>) {
    if (!profile) return;
    const optimistic = { ...profile, ...patch };
    setProfile(optimistic);
    setSaving(true);
    try {
      let saved = await updateStudyProfile(patch);
      if ('reminderEnabled' in patch || 'reminderHour' in patch || 'weeklyStudyDays' in patch) {
        const result = await syncStudyReminders(saved);
        if (result === 'denied' && saved.reminderEnabled) {
          saved = await updateStudyProfile({ reminderEnabled: false });
          Alert.alert('Reminders remain off', 'Notification permission was not granted. Your study plan still works normally inside Barion.');
        }
      }
      setProfile(saved);
    } catch (error) {
      setProfile(profile);
      Alert.alert('Preference was not saved', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return <LoadingState label="Loading Study Profile" />;

  return (
    <AppShell active="more">
      <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="options" size={25} color={colors.surface} /></View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>PERSONALIZED WITHOUT EXTRA SETUP</Text>
          <Text style={styles.title}>How Barion should teach you</Text>
          <Text style={styles.heroBody}>Barion starts with sensible medical-study defaults. Changes save automatically and shape review, tests, evidence, and workload.</Text>
        </View>
        <View style={styles.savedBadge}>
          <Ionicons name={saving ? 'sync-outline' : 'checkmark-circle'} size={16} color={colors.tealDark} />
          <Text style={styles.savedText}>{saving ? 'Saving' : 'Saved locally'}</Text>
        </View>
      </View>

      <ProfileSection title="Study approach" body="This is a preference, not a fixed learning-style label.">
        <OptionGroup
          value={profile.reviewStyle}
          choices={REVIEW_STYLES}
          onChange={(reviewStyle) => void choose({ reviewStyle })}
        />
      </ProfileSection>

      <ProfileSection title="Primary goal" body="Barion uses this to prioritize clinically useful card and test formats.">
        <OptionGroup value={profile.examGoal} choices={EXAM_GOALS} onChange={(examGoal) => void choose({ examGoal })} />
      </ProfileSection>

      <ProfileSection title="Challenge level" body="Controls how much recognition versus free recall Barion asks for.">
        <OptionGroup value={profile.difficulty} choices={DIFFICULTIES} onChange={(difficulty) => void choose({ difficulty })} />
      </ProfileSection>

      <ProfileSection title="A normal session" body="Barion stops at this target so review stays focused. Unlimited is available when you want it.">
        <OptionGroup value={profile.sessionLength} choices={SESSION_LENGTHS} onChange={(sessionLength) => void choose({ sessionLength })} />
      </ProfileSection>

      <View style={styles.twoColumn}>
        <ProfileSection title="Test feedback" body="Choose whether answers appear as you go or together at the end.">
          <OptionGroup value={profile.feedbackTiming} choices={FEEDBACK} onChange={(feedbackTiming) => void choose({ feedbackTiming })} />
        </ProfileSection>
        <ProfileSection title="Source evidence" body="Evidence always remains one tap away; this controls its default detail.">
          <OptionGroup value={profile.evidenceDisplay} choices={EVIDENCE} onChange={(evidenceDisplay) => void choose({ evidenceDisplay })} />
        </ProfileSection>
      </View>

      <ProfileSection title="Daily workload guardrails" body="These are safety rails, not streak penalties. Zero means unlimited.">
        <View style={styles.twoColumn}>
          <View style={styles.limitBlock}>
            <Text style={styles.limitLabel}>NEW CARDS PER DAY</Text>
            <OptionGroup value={profile.dailyNewLimit} choices={NEW_LIMITS} onChange={(dailyNewLimit) => void choose({ dailyNewLimit })} />
          </View>
          <View style={styles.limitBlock}>
            <Text style={styles.limitLabel}>TOTAL REVIEWS PER DAY</Text>
            <OptionGroup value={profile.dailyReviewLimit} choices={REVIEW_LIMITS} onChange={(dailyReviewLimit) => void choose({ dailyReviewLimit })} />
          </View>
        </View>
      </ProfileSection>

      <ProfileSection title="Study days" body="Autopilot uses these for gentle pacing and optional reminders. Due work remains available whenever you open Barion.">
        <View style={styles.dayRow}>
          {DAY_CHOICES.map((choice) => {
            const selected = profile.weeklyStudyDays.includes(choice.value);
            return <Pressable accessibilityLabel={choice.accessibilityLabel} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} key={choice.value} onPress={() => { const days = selected ? profile.weeklyStudyDays.filter((value) => value !== choice.value) : [...profile.weeklyStudyDays, choice.value]; void choose({ weeklyStudyDays: days }) }} style={[styles.dayChoice, selected && styles.dayChoiceSelected]}><Text style={[styles.dayText, selected && styles.dayTextSelected]}>{choice.label}</Text></Pressable>;
          })}
        </View>
      </ProfileSection>

      <ProfileSection title="Quiet reminder" body={Platform.OS === 'web' ? 'Configure reminders in the iOS or Android app. Web study remains fully available.' : 'One local reminder is scheduled on each selected study day. No account or push token is required.'}>
        <OptionGroup
          value={profile.reminderEnabled ? 'on' : 'off'}
          choices={REMINDER_STATE}
          onChange={(value) => {
            if (value === 'on' && Platform.OS === 'web') {
              Alert.alert('Use the mobile app for reminders', 'Open Barion on iOS or Android to schedule this local study reminder.');
              return;
            }
            void choose({ reminderEnabled: value === 'on' });
          }}
        />
        {profile.reminderEnabled ? <OptionGroup value={profile.reminderHour} choices={REMINDER_HOURS} onChange={(reminderHour) => void choose({ reminderHour })} /> : null}
      </ProfileSection>

      <View style={styles.note}>
        <Ionicons name="shield-checkmark-outline" size={21} color={colors.tealDark} />
        <Text style={styles.noteText}>These settings stay in the local Barion library. They do not diagnose a learning style or change source facts.</Text>
      </View>
      </ScrollView>
    </AppShell>
  );
}

function ProfileSection({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.body}>{body}</Text>{children}</View>;
}

function OptionGroup<T extends string | number>({ value, choices, onChange }: { value: T; choices: Choice<T>[]; onChange: (value: T) => void }) {
  return <View style={styles.optionGrid}>{choices.map((choice) => {
    const selected = value === choice.value;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        key={String(choice.value)}
        onPress={() => onChange(choice.value)}
        style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
      >
        <View style={styles.optionTopline}>
          <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{choice.label}</Text>
          {choice.recommended ? <Text style={styles.recommended}>RECOMMENDED</Text> : null}
          {selected ? <Ionicons name="checkmark-circle" size={19} color={colors.blue} /> : null}
        </View>
        <Text style={styles.optionDetail}>{choice.detail}</Text>
      </Pressable>
    );
  })}</View>;
}

const REVIEW_STYLES: Choice<ReviewStyle>[] = [
  { value: 'clinical-reasoning', label: 'Clinical reasoning', detail: 'Prioritize mechanisms, decisions, safety, and patient patterns.', recommended: true },
  { value: 'concise', label: 'Concise recall', detail: 'Keep prompts and explanations short.' },
  { value: 'explanatory', label: 'Explanatory', detail: 'Show more rationale after recall.' },
  { value: 'visual-support', label: 'Visual support', detail: 'Prefer comparisons, structures, and stepwise summaries.' },
  { value: 'test-first', label: 'Test first', detail: 'Lead with questions before routine review.' },
];
const EXAM_GOALS: Choice<ExamGoal>[] = [
  { value: 'clinical-recall', label: 'Clinical recall', detail: 'Recognize findings and make sound decisions.', recommended: true },
  { value: 'board-style', label: 'Board-style exams', detail: 'Prioritize applied mechanisms and vignettes.' },
  { value: 'class-quiz', label: 'Class quizzes', detail: 'Balance definitions and course detail.' },
  { value: 'source-mastery', label: 'Source mastery', detail: 'Cover the imported material systematically.' },
];
const DIFFICULTIES: Choice<StudyDifficulty>[] = [
  { value: 'standard', label: 'Standard', detail: 'A balanced mix of recognition and recall.', recommended: true },
  { value: 'gentle', label: 'Gentle', detail: 'More recognition and shorter sessions.' },
  { value: 'challenging', label: 'Challenging', detail: 'More written recall and fewer cues.' },
];
const SESSION_LENGTHS: Choice<number>[] = [
  { value: 5, label: '5 cards', detail: 'A quick reset.' },
  { value: 10, label: '10 cards', detail: 'Focused default.', recommended: true },
  { value: 20, label: '20 cards', detail: 'A deeper session.' },
  { value: 0, label: 'Unlimited', detail: 'Continue until the queue is clear.' },
];
const FEEDBACK: Choice<FeedbackTiming>[] = [
  { value: 'immediate', label: 'Immediate', detail: 'Learn from each answer as you go.', recommended: true },
  { value: 'end', label: 'At the end', detail: 'Reduce cues during multiple-choice tests.' },
];
const EVIDENCE: Choice<EvidenceDisplay>[] = [
  { value: 'compact', label: 'Compact', detail: 'Show a short source excerpt.', recommended: true },
  { value: 'expanded', label: 'Expanded', detail: 'Show the complete linked excerpt.' },
];
const NEW_LIMITS: Choice<number>[] = [
  { value: 5, label: '5', detail: 'Gentle' }, { value: 10, label: '10', detail: 'Balanced', recommended: true },
  { value: 20, label: '20', detail: 'Ambitious' }, { value: 0, label: '∞', detail: 'Unlimited' },
];
const REVIEW_LIMITS: Choice<number>[] = [
  { value: 20, label: '20', detail: 'Light' }, { value: 40, label: '40', detail: 'Balanced', recommended: true },
  { value: 80, label: '80', detail: 'Intensive' }, { value: 0, label: '∞', detail: 'Unlimited' },
];
const DAY_CHOICES = [
  { value: 0, label: 'S', accessibilityLabel: 'Sunday' },
  { value: 1, label: 'M', accessibilityLabel: 'Monday' },
  { value: 2, label: 'T', accessibilityLabel: 'Tuesday' },
  { value: 3, label: 'W', accessibilityLabel: 'Wednesday' },
  { value: 4, label: 'T', accessibilityLabel: 'Thursday' },
  { value: 5, label: 'F', accessibilityLabel: 'Friday' },
  { value: 6, label: 'S', accessibilityLabel: 'Saturday' },
];
const REMINDER_STATE: Choice<'on' | 'off'>[] = [
  { value: 'off', label: 'Off', detail: 'Open Barion on your own schedule.' },
  { value: 'on', label: 'On', detail: 'A quiet local reminder on selected days.', recommended: true },
];
const REMINDER_HOURS: Choice<number>[] = [
  { value: 8, label: '8 AM', detail: 'Morning' },
  { value: 12, label: '12 PM', detail: 'Midday' },
  { value: 18, label: '6 PM', detail: 'Evening', recommended: true },
  { value: 20, label: '8 PM', detail: 'Later' },
];

const styles = StyleSheet.create({
  body: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  container: { gap: 18, marginHorizontal: 'auto', maxWidth: 1060, padding: 18, paddingBottom: 48, width: '100%' },
  dayChoice: { alignItems: 'center', backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.pill, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  dayChoiceSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayText: { color: colors.ink, fontFamily: fonts.bold, fontSize: 12 },
  dayTextSelected: { color: colors.surface },
  eyebrow: { color: '#c8dbf7', fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2 },
  hero: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radii.lg, flexDirection: 'row', flexWrap: 'wrap', gap: 15, padding: 22 },
  heroCopy: { flex: 1, gap: 6, minWidth: 230 },
  heroBody: { color: '#d8e5f7', fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  heroIcon: { alignItems: 'center', backgroundColor: colors.blue, borderRadius: 16, height: 54, justifyContent: 'center', width: 54 },
  limitBlock: { flex: 1, gap: 9, minWidth: 260 },
  limitLabel: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1 },
  note: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: radii.md, flexDirection: 'row', gap: 10, padding: 14 },
  noteText: { color: colors.tealDark, flex: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 },
  option: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 1, gap: 5, minHeight: 82, minWidth: 175, padding: 12 },
  optionDetail: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionLabel: { color: colors.ink, flex: 1, fontFamily: fonts.bold, fontSize: 13 },
  optionLabelSelected: { color: colors.blueDark },
  optionSelected: { backgroundColor: colors.surfaceMuted, borderColor: colors.blue, borderWidth: 2 },
  optionTopline: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  pressed: { opacity: 0.8 },
  recommended: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 0.5 },
  savedBadge: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: radii.pill, flexDirection: 'row', gap: 5, paddingHorizontal: 10, paddingVertical: 7 },
  savedText: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 10 },
  section: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, flex: 1, gap: 10, padding: 18 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 18 },
  title: { color: colors.surface, fontFamily: fonts.extraBold, fontSize: 25, lineHeight: 32 },
  twoColumn: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});
