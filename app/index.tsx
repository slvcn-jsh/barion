import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppShell } from '@/components/AppShell';
import { BrandMark } from '@/components/BrandMark';
import { LoadingState } from '@/components/ScreenState';
import type { DailyPlan, Dashboard, StudyProfile } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import { getDailyPlan, getDashboard, getStudyProfile, updateStudyProfile } from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

const learningFlow = [
  { icon: 'cloud-upload-outline' as const, label: 'Add material' },
  { icon: 'scan-outline' as const, label: 'Build cards' },
  { icon: 'shield-checkmark-outline' as const, label: 'Check sources' },
  { icon: 'play-circle-outline' as const, label: 'Study' },
];

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const [profile, setProfile] = useState<StudyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInsights, setShowInsights] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function refresh() {
        setLoading(true);
        await initializeDatabase();
        const [nextDashboard, nextProfile, nextPlan] = await Promise.all([
          getDashboard(),
          getStudyProfile(),
          getDailyPlan(),
        ]);
        if (active) {
          setDashboard(nextDashboard);
          setProfile(nextProfile);
          setDailyPlan(nextPlan);
          setLoading(false);
        }
      }

      void refresh();
      return () => {
        active = false;
      };
    }, []),
  );

  if (loading || !dashboard || !dailyPlan || !profile) {
    return <LoadingState label="Preparing today" />;
  }

  const today = describeToday(dailyPlan, dashboard);
  const remaining = Math.max(dailyPlan.totalCount - dailyPlan.completedCount, 0);
  const hasCards = dashboard.totalCards > 0;
  const compactFlow = width < 560;

  async function switchWorkspace() {
    if (!profile) return;
    const next = await updateStudyProfile({
      workspaceMode: profile.workspaceMode === 'learner' ? 'builder' : 'learner',
    });
    setProfile(next);
  }

  return (
    <AppShell active="today">
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.workspaceBar}>
          <View style={styles.workspaceCopy}>
            <Ionicons
              name={profile.workspaceMode === 'learner' ? 'school-outline' : 'construct-outline'}
              size={18}
              color={colors.blueDark}
            />
            <Text style={styles.workspaceText}>
              {profile.workspaceMode === 'learner' ? 'Learner workspace' : 'Builder workspace'}
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => void switchWorkspace()} style={styles.workspaceSwitch}>
            <Text style={styles.workspaceSwitchText}>
              Switch to {profile.workspaceMode === 'learner' ? 'Builder' : 'Learner'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroHeader}>
            <BrandMark inverse size={42} />
            <View style={styles.heroBadge}>
              <Ionicons name="sparkles" size={14} color={colors.tealDark} />
              <Text style={styles.heroBadgeText}>Autopilot</Text>
            </View>
          </View>
          <Text style={styles.eyebrow}>{today.eyebrow}</Text>
          <Text style={styles.heroTitle}>{today.title}</Text>
          <Text style={styles.heroBody}>{today.body}</Text>
          <View style={styles.heroActions}>
            <AppButton
              icon={today.primaryIcon}
              label={today.primaryLabel}
              variant="inverse"
              onPress={() => router.push(today.primaryHref)}
            />
            {today.secondaryLabel ? (
              <AppButton
                icon={today.secondaryIcon}
                label={today.secondaryLabel}
                variant="secondary"
                onPress={() => router.push(today.secondaryHref)}
              />
            ) : null}
          </View>
        </View>

        {dashboard.needsReviewCount ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/library')}
            style={({ pressed }) => [styles.notice, pressed && styles.pressed]}
          >
            <View style={styles.warningIcon}>
              <Ionicons name="alert-circle-outline" size={21} color="#9a5b09" />
            </View>
            <View style={styles.noticeCopy}>
              <Text style={styles.noticeTitle}>
                {dashboard.needsReviewCount} card{dashboard.needsReviewCount === 1 ? '' : 's'} need a source check
              </Text>
              <Text style={styles.noticeBody}>Barion is holding them out of study until the evidence is checked.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.slate} />
          </Pressable>
        ) : null}

        <View style={styles.flowSection}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>SOURCE-FIRST WORKFLOW</Text>
              <Text style={styles.sectionTitle}>Add learning material</Text>
            </View>
            <AppButton icon="add" label="Add" onPress={() => router.push('/sources')} />
          </View>
          <Text style={styles.sectionBody}>
            This is Barion's main path: upload a lecture, extract the useful concepts, create source-linked cards, then study the safe set.
          </Text>
          <View style={[styles.flowSteps, compactFlow && styles.flowStepsCompact]}>
            {learningFlow.map((step, index) => (
              <View key={step.label} style={[styles.flowStep, compactFlow && styles.flowStepCompact]}>
                <View style={styles.flowIcon}>
                  <Ionicons name={step.icon} size={18} color={colors.blueDark} />
                </View>
                <Text style={styles.flowLabel}>{step.label}</Text>
                {index < learningFlow.length - 1 && !compactFlow ? <View style={styles.flowLine} /> : null}
              </View>
            ))}
          </View>
        </View>

        {profile.workspaceMode === 'builder' ? (
          <View style={styles.builderPanel}>
            <View>
              <Text style={styles.sectionEyebrow}>BUILDER TOOLS</Text>
              <Text style={styles.sectionTitle}>What would you like to do?</Text>
            </View>
            <View style={styles.actionGrid}>
              <ActionCard
                body="Create courses, folders, and combined exam reviewers."
                icon="library-outline"
                label="Classes & folders"
                onPress={() => router.push('/classes')}
              />
              <ActionCard
                body="Import a source and let Barion build a study set."
                icon="document-text-outline"
                label="Import a source"
                onPress={() => router.push('/sources')}
              />
              <ActionCard
                body="Write, bulk import, or edit your own cards."
                icon="create-outline"
                label="Add a card"
                onPress={() => router.push('/card/new')}
              />
              <ActionCard
                body="Check held cards, archived sets, and recoverable trash."
                icon="shield-checkmark-outline"
                label="Source checks"
                onPress={() => router.push('/library')}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.nextSection}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>NEXT BEST OPTIONS</Text>
              <Text style={styles.sectionTitle}>Only what matters now</Text>
            </View>
          </View>
          <View style={styles.actionGrid}>
            {remaining ? (
              <ActionCard
                body={`${remaining} card${remaining === 1 ? '' : 's'} left in the current plan.`}
                icon="play"
                label="Continue studying"
                onPress={() => router.push({ pathname: '/study', params: { mode: 'autopilot' } })}
              />
            ) : null}
            {dashboard.weakCount ? (
              <ActionCard
                body={`${dashboard.weakCount} repeatedly missed concept${dashboard.weakCount === 1 ? '' : 's'} are ready for repair.`}
                icon="fitness-outline"
                label="Repair weak concepts"
                onPress={() => router.push({ pathname: '/study', params: { focus: 'weak' } })}
              />
            ) : null}
            <ActionCard
              body={hasCards ? 'Choose Learn, Browse, Audio, or quick sorting.' : 'Study modes unlock after you add cards.'}
              disabled={!hasCards}
              icon="school-outline"
              label="Ways to study"
              onPress={() => router.push('/modes')}
            />
            <ActionCard
              body="See due reviews and plan short study blocks."
              icon="calendar-outline"
              label="Review calendar"
              onPress={() => router.push('/calendar')}
            />
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => setShowInsights((value) => !value)}
          style={({ pressed }) => [styles.insightToggle, pressed && styles.pressed]}
        >
          <View>
            <Text style={styles.sectionTitle}>Insights</Text>
            <Text style={styles.sectionBody}>Detailed counts stay here when you need them.</Text>
          </View>
          <Ionicons name={showInsights ? 'chevron-up' : 'chevron-down'} size={22} color={colors.blueDark} />
        </Pressable>

        {showInsights ? (
          <View style={styles.insights}>
            <Insight label="Due today" value={dashboard.dueCount} />
            <Insight label="Total cards" value={dashboard.totalCards} />
            <Insight label="Source-backed" value={dashboard.evidenceLinkedCards} />
            <Insight label="Sources" value={dashboard.sourceCount} />
            <Insight label="Repeatedly missed" value={dashboard.leechCount} />
            <View style={styles.profileStrip}>
              <Ionicons name="options-outline" size={18} color={colors.tealDark} />
              <Text style={styles.profileText}>
                Study preference: {profile.reviewStyle.replace(/-/g, ' ')} - {profile.difficulty}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={styles.profileButton}>
                <Text style={styles.profileButtonText}>Edit</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </AppShell>
  );
}

function describeToday(plan: DailyPlan, dashboard: Dashboard) {
  if (plan.state === 'resume') {
    const remaining = Math.max(plan.totalCount - plan.completedCount, 0);
    return {
      body: `${remaining} retrieval${remaining === 1 ? '' : 's'} remain. Barion kept the session exactly where it stopped.`,
      eyebrow: 'YOUR SAVED PLAN',
      primaryHref: { pathname: '/study', params: { mode: 'autopilot' } } as const,
      primaryIcon: 'play' as const,
      primaryLabel: `Resume · ${remaining} left`,
      secondaryHref: '/sources' as const,
      secondaryIcon: 'add' as const,
      secondaryLabel: 'Add material',
      title: 'Continue where you stopped.',
    };
  }

  if (plan.state === 'complete') {
    return {
      body: dashboard.totalCards
        ? 'No urgent reviews are waiting. Add material, browse your library, or come back when the smart schedule asks for recall.'
        : 'Start by adding a lecture, note, or study guide. Barion will build a source-linked study set from it.',
      eyebrow: 'BARION AUTOPILOT',
      primaryHref: '/sources' as const,
      primaryIcon: 'add' as const,
      primaryLabel: 'Add learning material',
      secondaryHref: dashboard.totalCards ? '/classes' as const : '/more' as const,
      secondaryIcon: dashboard.totalCards ? 'library-outline' as const : 'ellipsis-horizontal-circle-outline' as const,
      secondaryLabel: dashboard.totalCards ? 'Open library' : 'See tools',
      title: dashboard.totalCards ? 'You are caught up for today.' : 'Build your first study set.',
    };
  }

  if (plan.weakCount) {
    return {
      body: `${plan.reason} Barion will start with weak concepts, then move into due review and new source-linked cards.`,
      eyebrow: 'BARION AUTOPILOT',
      primaryHref: { pathname: '/study', params: { mode: 'autopilot' } } as const,
      primaryIcon: 'play' as const,
      primaryLabel: 'Start today’s plan',
      secondaryHref: { pathname: '/study', params: { mode: 'autopilot', size: 'minimum' } } as const,
      secondaryIcon: 'leaf-outline' as const,
      secondaryLabel: 'Minimum day',
      title: `${plan.totalCount} focused retrievals, chosen for you.`,
    };
  }

  return {
    body: plan.reason,
    eyebrow: 'BARION AUTOPILOT',
    primaryHref: { pathname: '/study', params: { mode: 'autopilot' } } as const,
    primaryIcon: 'play' as const,
    primaryLabel: 'Start today’s plan',
    secondaryHref: '/sources' as const,
    secondaryIcon: 'add' as const,
    secondaryLabel: 'Add material',
    title: `${plan.totalCount} cards ready for smart review.`,
  };
}

function ActionCard({
  body,
  disabled,
  icon,
  label,
  onPress,
}: {
  body: string;
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.actionCard, disabled && styles.actionCardDisabled, pressed && styles.pressed]}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={21} color={disabled ? colors.slate : colors.blueDark} />
      </View>
      <View style={styles.actionCopy}>
        <Text style={[styles.actionTitle, disabled && styles.disabledText]}>{label}</Text>
        <Text style={styles.actionBody}>{body}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.slate} />
    </Pressable>
  );
}

function Insight({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.insight}>
      <Text style={styles.insightValue}>{value.toLocaleString()}</Text>
      <Text style={styles.insightLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  actionCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 88,
    minWidth: 250,
    padding: 14,
  },
  actionCardDisabled: { opacity: 0.55 },
  actionCopy: { flex: 1, gap: 3, minWidth: 0 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 13, height: 46, justifyContent: 'center', width: 46 },
  actionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 14 },
  container: { gap: 19, marginHorizontal: 'auto', maxWidth: 960, padding: 18, paddingBottom: 48, width: '100%' },
  disabledText: { color: colors.muted },
  eyebrow: { color: '#b9cff0', fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2 },
  flowIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 12, height: 40, justifyContent: 'center', width: 40 },
  flowLabel: { color: colors.ink, fontFamily: fonts.bold, fontSize: 12, textAlign: 'center' },
  flowLine: { backgroundColor: colors.lineStrong, flex: 1, height: 2, minWidth: 22 },
  flowSection: { gap: 12 },
  flowStep: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8, minWidth: 130 },
  flowStepCompact: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 0, justifyContent: 'flex-start', minHeight: 58, padding: 9, width: '100%' },
  flowSteps: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flowStepsCompact: { alignItems: 'stretch', flexDirection: 'column' },
  hero: { backgroundColor: colors.ink, borderRadius: radii.lg, gap: 13, overflow: 'hidden', padding: 24 },
  heroActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  heroBadge: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: radii.pill, flexDirection: 'row', gap: 5, paddingHorizontal: 10, paddingVertical: 7 },
  heroBadgeText: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 11 },
  heroBody: { color: '#d8e5f7', fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, maxWidth: 680 },
  heroHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  heroTitle: { color: colors.surface, fontFamily: fonts.extraBold, fontSize: 31, lineHeight: 39, maxWidth: 720 },
  insight: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 1, minWidth: 136, padding: 14 },
  insightLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11 },
  insightToggle: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 16 },
  insightValue: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 23 },
  insights: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  nextSection: { gap: 12 },
  notice: { alignItems: 'center', backgroundColor: colors.warningSurface, borderColor: '#efd59f', borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 },
  noticeBody: { color: '#9a5b09', fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  noticeCopy: { flex: 1, gap: 2, minWidth: 0 },
  noticeTitle: { color: '#7a4400', fontFamily: fonts.bold, fontSize: 14 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  profileButton: { backgroundColor: colors.surface, borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 7 },
  profileButtonText: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 11 },
  profileStrip: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderColor: '#c7e9df', borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 9, padding: 13, width: '100%' },
  profileText: { color: colors.tealDark, flex: 1, fontFamily: fonts.semibold, fontSize: 12, textTransform: 'capitalize' },
  sectionBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, maxWidth: 760 },
  sectionEyebrow: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 20, lineHeight: 27 },
  warningIcon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 13, height: 46, justifyContent: 'center', width: 46 },
  builderPanel: { gap: 12 },
  workspaceBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  workspaceCopy: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  workspaceSwitch: { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, minHeight: 38, paddingHorizontal: 12, paddingVertical: 9 },
  workspaceSwitchText: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 11 },
  workspaceText: { color: colors.ink, fontFamily: fonts.bold, fontSize: 13 },
});
