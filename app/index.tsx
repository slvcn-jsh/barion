import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { BrandMark } from '@/components/BrandMark';
import { LoadingState } from '@/components/ScreenState';
import { StatTile } from '@/components/StatTile';
import type { DailyPlan, Dashboard, StudyCard, StudyProfile } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import { getDailyPlan, getDashboard, getStudyProfile, searchCards, updateStudyProfile } from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

export default function HomeScreen() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StudyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<StudyProfile | null>(null);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const searchRequest = useRef(0);

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

  async function runSearch(value: string) {
    setQuery(value);
    const requestId = ++searchRequest.current;
    if (!value.trim()) {
      setResults([]);
      return;
    }

    const nextResults = await searchCards(value);
    if (requestId === searchRequest.current) {
      setResults(nextResults);
    }
  }

  async function switchWorkspace() {
    if (!profile) return;
    const next = await updateStudyProfile({ workspaceMode: profile.workspaceMode === 'learner' ? 'builder' : 'learner' });
    setProfile(next);
  }

  if (loading || !dashboard || !profile || !dailyPlan) {
    return <LoadingState label="Preparing your learning space" />;
  }

  if (profile.workspaceMode === 'learner') {
    return <LearnerHome dashboard={dashboard} plan={dailyPlan} profile={profile} onSwitch={() => void switchWorkspace()} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <WorkspaceBar mode="builder" onSwitch={() => void switchWorkspace()} />
      <View style={styles.hero}>
        <View style={styles.heroGlowOne} />
        <View style={styles.heroGlowTwo} />
        <BrandMark inverse showTagline size={48} />
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>YOUR DAILY LEARNING PLAN</Text>
          <Text style={styles.heroTitle}>
            {dashboard.dueCount
              ? `${dashboard.dueCount} cards ready for a focused review.`
              : 'You are caught up for now.'}
          </Text>
          <Text style={styles.heroSubtitle}>
            Build durable medical knowledge with source-linked cards and smart scheduling.
          </Text>
        </View>
        <View style={styles.heroActions}>
          <AppButton
            label={dashboard.dueCount ? 'Start review' : 'Open study'}
            icon="play"
            variant="inverse"
            onPress={() => router.push('/study')}
          />
          <Pressable accessibilityRole="button" onPress={() => router.push('/sources')} style={styles.heroLink}>
            <Ionicons name="document-text-outline" size={18} color="#d9e7fb" />
            <Text style={styles.heroLinkText}>Add learning material</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionEyebrow}>QUICK START</Text>
            <Text style={styles.sectionTitle}>What would you like to do?</Text>
          </View>
        </View>
        <View style={styles.quickGrid}>
          <QuickAction
            detail={`${dashboard.dueCount} due today`}
            icon="layers-outline"
            label="Review cards"
            tone="blue"
            onPress={() => router.push('/study')}
          />
          <QuickAction
            detail="Write your own"
            icon="create-outline"
            label="Add a card"
            tone="indigo"
            onPress={() => router.push('/card/new')}
          />
          <QuickAction
            detail={`${dashboard.sourceCount} in your library`}
            icon="document-text-outline"
            label="Import a source"
            tone="teal"
            onPress={() => router.push('/sources')}
          />
          <QuickAction
            detail="Organize a topic"
            icon="add-circle-outline"
            label="Create a deck"
            tone="gold"
            onPress={() => router.push('/deck/new')}
          />
          <QuickAction
            detail="Archive, trash, restore"
            icon="options-outline"
            label="Manage library"
            tone="blue"
            onPress={() => router.push('/library')}
          />
          <QuickAction
            detail={`${dashboard.weakCount} weak concepts`}
            icon="school-outline"
            label="Take a test"
            tone="teal"
            onPress={() => router.push('/test')}
          />
          <QuickAction
            detail={`${dashboard.sessionLength || 'Unlimited'} cards per session`}
            icon="options-outline"
            label="Study profile"
            tone="indigo"
            onPress={() => router.push('/profile')}
          />
          <QuickAction
            detail="Classes, folders, exam decks"
            icon="calendar-outline"
            label="Classes & folders"
            tone="gold"
            onPress={() => router.push('/classes')}
          />
        </View>
      </View>

      <View style={styles.planStrip}>
        <View style={styles.planIcon}><Ionicons name="today-outline" size={22} color={colors.blue} /></View>
        <View style={styles.trustCopy}>
          <Text style={styles.trustTitle}>Today’s workload</Text>
          <Text style={styles.trustBody}>
            {dashboard.reviewedToday} reviewed · {dashboard.dailyReviewLimit ? `${Math.max(dashboard.dailyReviewLimit - dashboard.reviewedToday, 0)} left before your daily guardrail` : 'no daily cap'}
          </Text>
        </View>
        {dashboard.weakCount ? <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/study', params: { focus: 'weak' } })} style={styles.repairLink}><Text style={styles.repairText}>Repair weak</Text><Ionicons name="arrow-forward" size={16} color={colors.blueDark} /></Pressable> : null}
      </View>

      <View style={styles.statsGrid}>
        <StatTile icon="time-outline" label="Due cards" value={dashboard.dueCount} tone="teal" />
        <StatTile icon="albums-outline" label="Total cards" value={dashboard.totalCards} tone="indigo" />
        <StatTile
          icon="shield-checkmark-outline"
          label="Evidence linked"
          value={dashboard.evidenceLinkedCards}
          tone="coral"
        />
        <StatTile icon="library-outline" label="Sources" value={dashboard.sourceCount} tone="gold" />
        <StatTile icon="fitness-outline" label="Weak concepts" value={dashboard.weakCount} tone="coral" />
        <StatTile icon="warning-outline" label="Needs rewrite" value={dashboard.leechCount} tone="gold" />
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={20} color={colors.muted} />
        <TextInput
          accessibilityLabel="Search your cards"
          autoCapitalize="none"
          placeholder="Search questions, answers, or decks"
          placeholderTextColor={colors.slate}
          returnKeyType="search"
          style={styles.searchInput}
          value={query}
          onChangeText={runSearch}
        />
        {query ? (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => void runSearch('')}
          >
            <Ionicons name="close-circle" size={20} color={colors.slate} />
          </Pressable>
        ) : null}
      </View>

      {query.trim() ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Search results</Text>
          {results.map((card) => (
            <Pressable
              accessibilityRole="button"
              key={card.id}
              style={({ pressed }) => [styles.resultRow, pressed && styles.rowPressed]}
              onPress={() => router.push({ pathname: '/deck/[id]', params: { id: card.deckId } })}
            >
              <View style={styles.resultIcon}>
                <Ionicons name="flash-outline" size={18} color={colors.blue} />
              </View>
              <View style={styles.resultCopy}>
                <Text style={styles.resultTitle}>{card.prompt}</Text>
                <Text style={styles.resultDeck}>{card.deckTitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.slate} />
            </Pressable>
          ))}
          {!results.length ? <Text style={styles.muted}>No matching cards in your local library.</Text> : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionEyebrow}>YOUR LIBRARY</Text>
            <Text style={styles.sectionTitle}>Study decks</Text>
          </View>
          <Text style={styles.sectionCount}>{dashboard.decks.length}</Text>
        </View>
        {!dashboard.decks.length ? (
          <Text style={styles.muted}>Create your first deck to start building a study routine.</Text>
        ) : null}
        {dashboard.decks.map((deck) => (
          <Pressable
            accessibilityRole="button"
            key={deck.id}
            style={({ pressed }) => [styles.deckRow, pressed && styles.rowPressed]}
            onPress={() => router.push({ pathname: '/deck/[id]', params: { id: deck.id } })}
          >
            <View style={[styles.deckIcon, { backgroundColor: deck.color || colors.blue }]}> 
              <Ionicons name={deck.icon as keyof typeof Ionicons.glyphMap} size={21} color="#fff" />
            </View>
            <View style={styles.deckText}>
              <Text style={styles.deckTitle}>{deck.title}</Text>
              <Text style={styles.deckMeta}>
                {deck.cardCount} cards · {deck.dueCount} due · {deck.evidenceCount} source links
              </Text>
            </View>
            {deck.dueCount ? <View style={styles.dueDot} /> : null}
            <Ionicons name="chevron-forward" size={20} color={colors.slate} />
          </Pressable>
        ))}
      </View>

      <View style={styles.trustStrip}>
        <View style={styles.trustIcon}>
          <Ionicons name="shield-checkmark" size={22} color={colors.tealDark} />
        </View>
        <View style={styles.trustCopy}>
          <Text style={styles.trustTitle}>Your study data stays local</Text>
          <Text style={styles.trustBody}>Offline SQLite, FSRS scheduling, and evidence you can inspect.</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function LearnerHome({
  dashboard,
  plan,
  profile,
  onSwitch,
}: {
  dashboard: Dashboard;
  plan: DailyPlan;
  profile: StudyProfile;
  onSwitch: () => void;
}) {
  const isStudyDay = profile.weeklyStudyDays.includes(new Date().getDay());
  return (
    <ScrollView contentContainerStyle={styles.learnerContainer}>
      <WorkspaceBar mode="learner" onSwitch={onSwitch} />
      <View style={styles.learnerHero}>
        <View style={styles.heroGlowOne} />
        <BrandMark inverse showTagline size={48} />
        <Text style={styles.eyebrow}>{plan.state === 'resume' ? 'YOUR SAVED PLAN' : 'BARION AUTOPILOT'}</Text>
        <Text style={styles.learnerTitle}>
          {plan.state === 'resume'
            ? 'Continue where you stopped.'
            : plan.state === 'complete'
              ? 'You’re finished for today.'
              : `${plan.totalCount} focused retrievals, chosen for you.`}
        </Text>
        <Text style={styles.heroSubtitle}>{plan.reason}</Text>
        {plan.state !== 'complete' ? (
          <AppButton
            icon={plan.state === 'resume' ? 'play' : 'sparkles-outline'}
            label={plan.state === 'resume' ? `Resume · ${plan.totalCount - plan.completedCount} left` : 'Start today’s plan'}
            variant="inverse"
            onPress={() => router.push({ pathname: '/study', params: { mode: 'autopilot' } })}
          />
        ) : (
          <AppButton icon="library-outline" label="Preview your library" variant="inverse" onPress={() => router.push('/sources')} />
        )}
      </View>

      <View style={styles.planSummary}>
        <View style={styles.planSummaryHeading}>
          <View>
            <Text style={styles.sectionEyebrow}>TODAY’S MIX</Text>
            <Text style={styles.sectionTitle}>{plan.estimatedMinutes ? `About ${plan.estimatedMinutes} minutes` : 'Plan complete'}</Text>
          </View>
          <View style={styles.autoBadge}><Ionicons name="sparkles" size={14} color={colors.tealDark} /><Text style={styles.autoBadgeText}>AUTO</Text></View>
        </View>
        <View style={styles.learnerStats}>
          <PlanMetric color={colors.coral} label="Weak repair" value={plan.weakCount} />
          <PlanMetric color={colors.blue} label="Due review" value={plan.dueCount} />
          <PlanMetric color={colors.teal} label="New concepts" value={plan.newCount} />
        </View>
        {!isStudyDay && plan.state !== 'complete' ? <Text style={styles.restNote}>Today is outside your normal study days. Choose the minimum day if you only have a few minutes.</Text> : null}
      </View>

      {plan.state !== 'complete' ? (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/study', params: { mode: 'autopilot', size: 'minimum' } })} style={styles.minimumDay}>
          <View style={styles.minimumIcon}><Ionicons name="leaf-outline" size={22} color={colors.green} /></View>
          <View style={styles.trustCopy}><Text style={styles.trustTitle}>Minimum viable day</Text><Text style={styles.trustBody}>Do up to five priority cards. No guilt and no broken streak promises.</Text></View>
          <Ionicons name="arrow-forward" size={18} color={colors.blueDark} />
        </Pressable>
      ) : null}

      {dashboard.weakCount ? <View style={styles.learnerNotice}><Ionicons name="fitness-outline" size={20} color={colors.coral} /><Text style={styles.learnerNoticeText}>{dashboard.weakCount} concept{dashboard.weakCount === 1 ? '' : 's'} need repair; Autopilot has already prioritized them.</Text></View> : null}
    </ScrollView>
  );
}

function WorkspaceBar({ mode, onSwitch }: { mode: 'learner' | 'builder'; onSwitch: () => void }) {
  return <View style={styles.workspaceBar}><View style={styles.workspaceCopy}><Ionicons name={mode === 'learner' ? 'school-outline' : 'construct-outline'} size={18} color={colors.blueDark} /><Text style={styles.workspaceText}>{mode === 'learner' ? 'Learner workspace' : 'Builder workspace'}</Text></View><Pressable accessibilityRole="button" onPress={onSwitch} style={styles.workspaceSwitch}><Text style={styles.workspaceSwitchText}>Switch to {mode === 'learner' ? 'Builder' : 'Learner'}</Text></Pressable></View>;
}

function PlanMetric({ color, label, value }: { color: string; label: string; value: number }) {
  return <View style={styles.planMetric}><View style={[styles.planMetricDot, { backgroundColor: color }]} /><Text style={styles.planMetricValue}>{value}</Text><Text style={styles.planMetricLabel}>{label}</Text></View>;
}

function QuickAction({
  detail,
  icon,
  label,
  onPress,
  tone,
}: {
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone: 'blue' | 'indigo' | 'teal' | 'gold';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.quickAction, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={[styles.quickIcon, styles[`${tone}Surface`]]}>
        <Ionicons name={icon} size={23} color={styles[tone].color} />
      </View>
      <View style={styles.quickCopy}>
        <Text style={styles.quickLabel}>{label}</Text>
        <Text style={styles.quickDetail}>{detail}</Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color={colors.slate} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  autoBadge: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: radii.pill, flexDirection: 'row', gap: 5, paddingHorizontal: 9, paddingVertical: 6 },
  autoBadgeText: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.8 },
  blue: { color: colors.blue },
  blueSurface: { backgroundColor: colors.surfaceMuted },
  container: {
    gap: 24,
    marginHorizontal: 'auto',
    maxWidth: 1180,
    padding: 18,
    paddingBottom: 44,
    width: '100%',
  },
  deckIcon: {
    alignItems: 'center',
    borderRadius: 13,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  deckMeta: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  deckRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 13,
    minHeight: 82,
    padding: 15,
  },
  deckText: { flex: 1, gap: 4 },
  deckTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 16 },
  dueDot: { backgroundColor: colors.teal, borderRadius: radii.pill, height: 8, width: 8 },
  eyebrow: { color: '#b9cff0', fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.4 },
  gold: { color: colors.gold },
  goldSurface: { backgroundColor: colors.warningSurface },
  hero: {
    backgroundColor: colors.ink,
    borderRadius: radii.lg,
    gap: 20,
    overflow: 'hidden',
    padding: 24,
    position: 'relative',
  },
  heroActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  heroCopy: { gap: 9, maxWidth: 710 },
  heroGlowOne: {
    backgroundColor: 'rgba(59,130,246,0.22)',
    borderRadius: 180,
    height: 280,
    pointerEvents: 'none',
    position: 'absolute',
    right: -70,
    top: -120,
    width: 280,
  },
  heroGlowTwo: {
    backgroundColor: 'rgba(20,184,166,0.12)',
    borderRadius: 120,
    bottom: -100,
    height: 220,
    pointerEvents: 'none',
    position: 'absolute',
    right: 130,
    width: 220,
  },
  heroLink: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 48, paddingHorizontal: 4 },
  heroLinkText: { color: '#e6effd', fontFamily: fonts.bold, fontSize: 14 },
  heroSubtitle: { color: '#cfddf2', fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, maxWidth: 620 },
  heroTitle: { color: colors.surface, fontFamily: fonts.extraBold, fontSize: 31, lineHeight: 39, maxWidth: 720 },
  indigo: { color: colors.indigo },
  indigoSurface: { backgroundColor: '#eef0ff' },
  learnerContainer: { gap: 16, marginHorizontal: 'auto', maxWidth: 860, padding: 18, paddingBottom: 44, width: '100%' },
  learnerHero: { backgroundColor: colors.ink, borderRadius: radii.lg, gap: 14, overflow: 'hidden', padding: 25, position: 'relative' },
  learnerNotice: { alignItems: 'center', backgroundColor: colors.dangerSurface, borderRadius: radii.md, flexDirection: 'row', gap: 10, padding: 14 },
  learnerNoticeText: { color: colors.red, flex: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 19 },
  learnerStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  learnerTitle: { color: colors.surface, fontFamily: fonts.extraBold, fontSize: 32, lineHeight: 40, maxWidth: 700 },
  minimumDay: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 15 },
  minimumIcon: { alignItems: 'center', backgroundColor: '#eaf8f2', borderRadius: 13, height: 44, justifyContent: 'center', width: 44 },
  muted: { color: colors.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  planIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 13, height: 44, justifyContent: 'center', width: 44 },
  planMetric: { alignItems: 'center', backgroundColor: colors.canvas, borderRadius: radii.md, flex: 1, minWidth: 130, padding: 13 },
  planMetricDot: { borderRadius: radii.pill, height: 7, marginBottom: 7, width: 28 },
  planMetricLabel: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 10, marginTop: 2 },
  planMetricValue: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 22 },
  planSummary: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 14, padding: 18 },
  planSummaryHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  planStrip: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 14 },
  quickAction: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexBasis: 220,
    flexDirection: 'row',
    gap: 12,
    minHeight: 82,
    minWidth: 180,
    padding: 14,
  },
  quickCopy: { flex: 1, gap: 3 },
  quickDetail: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickIcon: { alignItems: 'center', borderRadius: 13, height: 46, justifyContent: 'center', width: 46 },
  quickLabel: { color: colors.ink, fontFamily: fonts.bold, fontSize: 14 },
  resultCopy: { flex: 1, gap: 3 },
  resultDeck: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
  resultIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 10, height: 36, justifyContent: 'center', width: 36 },
  resultRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    padding: 12,
  },
  resultTitle: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 14 },
  restNote: { backgroundColor: colors.warningSurface, borderRadius: radii.sm, color: colors.inkSoft, fontFamily: fonts.medium, fontSize: 11, lineHeight: 18, padding: 10 },
  rowPressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  repairLink: { alignItems: 'center', flexDirection: 'row', gap: 5, minHeight: 40, paddingHorizontal: 6 },
  repairText: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 12 },
  searchBox: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.lineStrong,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 15,
  },
  searchInput: { color: colors.ink, flex: 1, fontFamily: fonts.medium, fontSize: 15 },
  section: { gap: 11 },
  sectionCount: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    color: colors.blueDark,
    fontFamily: fonts.bold,
    minWidth: 30,
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5,
    textAlign: 'center',
  },
  sectionEyebrow: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.3 },
  sectionHeading: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 20, lineHeight: 27 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  teal: { color: colors.tealDark },
  tealSurface: { backgroundColor: colors.surfaceTeal },
  trustBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  trustCopy: { flex: 1, gap: 3 },
  trustIcon: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: 13, height: 44, justifyContent: 'center', width: 44 },
  trustStrip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  trustTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 14 },
  workspaceBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  workspaceCopy: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  workspaceSwitch: { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, minHeight: 38, paddingHorizontal: 12, paddingVertical: 9 },
  workspaceSwitchText: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 11 },
  workspaceText: { color: colors.ink, fontFamily: fonts.bold, fontSize: 13 },
});
