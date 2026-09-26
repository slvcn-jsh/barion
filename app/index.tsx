import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppShell } from '@/components/AppShell';
import { BariMascot } from '@/components/BariMascot';
import { BariChatModal } from '@/components/BariChatModal';
import { BrandMark } from '@/components/BrandMark';
import { LoadingState } from '@/components/ScreenState';
import type { DailyPlan, Dashboard, DeckSummary, StudyProfile } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import { getDailyPlan, getDashboard, getStudyProfile } from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

export default function HomeScreen() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const [profile, setProfile] = useState<StudyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [bariChatOpen, setBariChatOpen] = useState(false);

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
    return <LoadingState label="Preparing your study workspace" />;
  }

  const dueCount = dashboard.dueCount;
  const totalCards = dashboard.totalCards;
  const decks = dashboard.decks;
  const remaining = Math.max(dailyPlan.totalCount - dailyPlan.completedCount, 0);

  return (
    <AppShell active="today">
      <ScrollView contentContainerStyle={styles.container}>
        {/* Study Hero */}
        <View style={styles.hero}>
          <View style={styles.heroHeader}>
            <BrandMark inverse size={38} />
            <Pressable
              accessibilityLabel="Chat with Bari"
              onPress={() => setBariChatOpen(true)}
              style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
            >
              <BariMascot size="sm" expression={dueCount > 0 ? 'thinking' : 'happy'} showBadge interactive />
            </Pressable>
          </View>

          {totalCards === 0 ? (
            <>
              <Text style={styles.eyebrow}>GET STARTED</Text>
              <Text style={styles.heroTitle}>Turn your material into flashcards</Text>
              <Text style={styles.heroBody}>
                Upload a PDF, notes, or paste text. Barion finds the key concepts and prepares your active-recall deck.
              </Text>
              <View style={styles.heroActions}>
                <AppButton
                  icon="add"
                  label="Add material"
                  variant="inverse"
                  onPress={() => router.push('/sources')}
                />
              </View>
            </>
          ) : dueCount > 0 || dailyPlan.state === 'resume' ? (
            <>
              <Text style={styles.eyebrow}>DAILY ACTIVE RECALL</Text>
              <Text style={styles.heroTitle}>Continue studying</Text>
              <Text style={styles.heroBody}>
                {remaining > 0
                  ? `${remaining} card${remaining === 1 ? '' : 's'} ready for review today.`
                  : `${dueCount} card${dueCount === 1 ? '' : 's'} due for review.`}
              </Text>
              <View style={styles.heroActions}>
                <AppButton
                  icon="play"
                  label={`Study now (${remaining || dueCount})`}
                  variant="inverse"
                  onPress={() => router.push({ pathname: '/study', params: { mode: 'autopilot' } })}
                />
                <AppButton
                  icon="add"
                  label="Add material"
                  variant="secondary"
                  onPress={() => router.push('/sources')}
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.eyebrow}>ALL CAUGHT UP</Text>
              <Text style={styles.heroTitle}>You’re caught up for today</Text>
              <Text style={styles.heroBody}>
                {`${totalCards} cards across ${decks.length} deck${decks.length === 1 ? '' : 's'}. Come back when cards are due, or practice anytime.`}
              </Text>
              <View style={styles.heroActions}>
                <AppButton
                  icon="add"
                  label="Add material"
                  variant="inverse"
                  onPress={() => router.push('/sources')}
                />
                <AppButton
                  icon="refresh-outline"
                  label="Practice anyway"
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/study', params: { mode: 'autopilot' } })}
                />
              </View>
            </>
          )}
        </View>

        {/* Your Decks Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Your decks</Text>
              <Text style={styles.sectionSubtitle}>
                {decks.length === 0
                  ? 'No decks created yet.'
                  : `${decks.length} deck${decks.length === 1 ? '' : 's'} in your study library`}
              </Text>
            </View>
            <AppButton
              icon="add"
              label="Add material"
              variant="secondary"
              onPress={() => router.push('/sources')}
            />
          </View>

          {decks.length === 0 ? (
            <View style={styles.emptyDeckPanel}>
              <Ionicons name="albums-outline" size={36} color={colors.muted} />
              <Text style={styles.emptyDeckTitle}>No decks yet</Text>
              <Text style={styles.emptyDeckBody}>
                Add your study notes or PDFs to create your first deck.
              </Text>
              <AppButton
                icon="add"
                label="Add material"
                onPress={() => router.push('/sources')}
              />
            </View>
          ) : (
            <View style={styles.deckList}>
              {decks.map((deck) => (
                <DeckRowItem key={deck.id} deck={deck} />
              ))}
            </View>
          )}
        </View>

        {/* Quiet Navigation Shortcuts */}
        <View style={styles.quickLinksSection}>
          <Text style={styles.quickLinksHeading}>MORE OPTIONS</Text>
          <View style={styles.quickLinksGrid}>
            <QuickLinkCard
              icon="school-outline"
              title="Ways to study"
              body="Flashcards, Learn, Audio, and Sorting modes."
              onPress={() => router.push('/modes')}
            />
            <QuickLinkCard
              icon="calendar-outline"
              title="Review calendar"
              body="See upcoming due reviews."
              onPress={() => router.push('/calendar')}
            />
            <QuickLinkCard
              icon="library-outline"
              title="Classes & library"
              body="Organize decks and archived material."
              onPress={() => router.push('/classes')}
            />
          </View>
        </View>
      </ScrollView>
      <BariChatModal
        visible={bariChatOpen}
        onClose={() => setBariChatOpen(false)}
        contextType="general"
        contextTitle="Study Companion"
      />
    </AppShell>
  );
}

function DeckRowItem({ deck }: { deck: DeckSummary }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${deck.title} deck`}
      onPress={() => router.push(`/deck/${deck.id}`)}
      style={({ pressed }) => [styles.deckCard, pressed && styles.deckCardPressed]}
    >
      <View style={[styles.deckIcon, { backgroundColor: deck.color || colors.blue }]}>
        <Ionicons name={(deck.icon as keyof typeof Ionicons.glyphMap) || 'albums-outline'} size={22} color="#fff" />
      </View>
      <View style={styles.deckCopy}>
        <Text numberOfLines={1} style={styles.deckTitle}>{deck.title}</Text>
        <Text numberOfLines={1} style={styles.deckDescription}>
          {deck.description || `${deck.cardCount} cards`}
        </Text>
      </View>
      <View style={styles.deckMeta}>
        {deck.dueCount > 0 ? (
          <View style={styles.dueBadge}>
            <Text style={styles.dueBadgeText}>{deck.dueCount} due</Text>
          </View>
        ) : null}
        <Text style={styles.cardCountText}>{deck.cardCount} cards</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.slate} />
      </View>
    </Pressable>
  );
}

function QuickLinkCard({
  icon,
  title,
  body,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quickLink, pressed && styles.quickLinkPressed]}
    >
      <View style={styles.quickLinkIcon}>
        <Ionicons name={icon} size={20} color={colors.blueDark} />
      </View>
      <View style={styles.quickLinkCopy}>
        <Text style={styles.quickLinkTitle}>{title}</Text>
        <Text style={styles.quickLinkBody}>{body}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardCountText: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  container: {
    gap: 22,
    marginHorizontal: 'auto',
    maxWidth: 900,
    padding: 18,
    paddingBottom: 48,
    width: '100%',
  },
  deckCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    padding: 15,
  },
  deckCardPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.995 }],
  },
  deckCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  deckDescription: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  deckIcon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  deckList: {
    gap: 10,
  },
  deckMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  deckTitle: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  dueBadge: {
    backgroundColor: colors.surfaceTeal,
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  dueBadgeText: {
    color: colors.tealDark,
    fontFamily: fonts.bold,
    fontSize: 11,
  },
  emptyDeckBody: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 400,
    textAlign: 'center',
  },
  emptyDeckPanel: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 10,
    padding: 32,
  },
  emptyDeckTitle: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 17,
  },
  eyebrow: {
    color: '#b9cff0',
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  hero: {
    backgroundColor: colors.ink,
    borderRadius: radii.lg,
    gap: 12,
    overflow: 'hidden',
    padding: 24,
  },
  heroActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  heroBody: {
    color: '#d8e5f7',
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    maxWidth: 680,
  },
  heroHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroTitle: {
    color: colors.surface,
    fontFamily: fonts.extraBold,
    fontSize: 29,
    lineHeight: 37,
    maxWidth: 720,
  },
  quickLink: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minWidth: 240,
    padding: 14,
  },
  quickLinkBody: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
  },
  quickLinkCopy: {
    flex: 1,
    gap: 2,
  },
  quickLinkIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  quickLinkPressed: {
    opacity: 0.8,
  },
  quickLinkTitle: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  quickLinksGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  quickLinksHeading: {
    color: colors.muted,
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 1.1,
  },
  quickLinksSection: {
    gap: 10,
    marginTop: 8,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionSubtitle: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 27,
  },
});
