import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { learnerAnswer } from '@/cards/answerView';
import { AppButton } from '@/components/AppButton';
import { AppShell } from '@/components/AppShell';
import { EmptyState, LoadingState } from '@/components/ScreenState';
import { getLatestMatchSession, recordMatchAttempt, startMatchSession, type MatchSession } from '@/games/matchRepository';
import { initializeDatabase } from '@/storage/database';
import { colors, fonts, radii } from '@/theme/colors';

type Tile = { id: string; cardId: string; side: 'prompt' | 'answer'; label: string };

export default function MatchScreen() {
  const params = useLocalSearchParams<{ deckId?: string; moduleId?: string }>();
  const [session, setSession] = useState<MatchSession | null | undefined>(undefined);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState<Record<string, number>>({});
  const [checking, setChecking] = useState(false);
  const startedAt = useRef(Date.now());

  const load = useCallback(async () => {
    await initializeDatabase();
    const active = await getLatestMatchSession(params.deckId, params.moduleId);
    const loaded = active ?? await startMatchSession(params.deckId, params.moduleId);
    setSession(loaded);
    setMatched(loaded?.matchedCardIds ?? []);
    setMistakes(Object.fromEntries((loaded?.mistakeCardIds ?? []).map((cardId) => [cardId, 1])));
    startedAt.current = Date.now();
  }, [params.deckId, params.moduleId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const tiles = useMemo(() => {
    if (!session) return [];
    const values = session.cards.flatMap<Tile>((card) => [
      { id: `prompt-${card.id}`, cardId: card.id, side: 'prompt', label: card.prompt },
      { id: `answer-${card.id}`, cardId: card.id, side: 'answer', label: learnerAnswer(card.answer) },
    ]);
    return deterministicShuffle(values, session.id);
  }, [session]);

  const complete = Boolean(session && matched.length >= session.totalPairs);

  async function choose(tile: Tile) {
    if (!session || checking || matched.includes(tile.cardId)) return;
    const promptId = tile.side === 'prompt' ? tile.cardId : selectedPrompt;
    const answerId = tile.side === 'answer' ? tile.cardId : selectedAnswer;
    if (tile.side === 'prompt') setSelectedPrompt(tile.cardId);
    else setSelectedAnswer(tile.cardId);
    if (!promptId || !answerId) return;

    setChecking(true);
    try {
      const correct = await recordMatchAttempt(session.id, promptId, answerId, Date.now() - startedAt.current);
      if (correct) {
        setMatched((items) => [...items, promptId]);
        setSession((value) => value ? { ...value, matchedPairs: value.matchedPairs + 1 } : value);
        setSelectedPrompt(null);
        setSelectedAnswer(null);
        setChecking(false);
      } else {
        setMistakes((items) => ({ ...items, [promptId]: (items[promptId] ?? 0) + 1 }));
        setSession((value) => value ? { ...value, mistakeCount: value.mistakeCount + 1 } : value);
        setTimeout(() => {
          setSelectedPrompt(null);
          setSelectedAnswer(null);
          setChecking(false);
        }, 450);
      }
    } catch (error) {
      setChecking(false);
      Alert.alert('Match was not saved', error instanceof Error ? error.message : 'Please try again.');
    }
  }

  async function restart(weakOnly = false) {
    if (!session) return;
    setSession(undefined);
    const weakIds = weakOnly ? Object.keys(mistakes) : undefined;
    const next = await startMatchSession(params.deckId, params.moduleId, weakIds && weakIds.length >= 2 ? weakIds : undefined);
    setSession(next);
    setMatched([]);
    setMistakes({});
    setSelectedPrompt(null);
    setSelectedAnswer(null);
    startedAt.current = Date.now();
  }

  if (session === undefined) return <AppShell active="study"><LoadingState label="Building a safe Match round" /></AppShell>;
  if (!session) {
    return (
      <AppShell active="study">
        <EmptyState title="Not enough distinct pairs" body="Match needs at least two safe cards with distinct questions and answers." />
      </AppShell>
    );
  }

  if (complete) {
    const weakCount = Object.keys(mistakes).length;
    return (
      <AppShell active="study">
      <ScrollView contentContainerStyle={styles.completeContainer}>
        <View style={styles.completeCard}>
          <View style={styles.completeIcon}><Ionicons name="checkmark" size={30} color={colors.surface} /></View>
          <Text style={styles.eyebrow}>ROUND COMPLETE</Text>
          <Text style={styles.completeTitle}>{session.totalPairs} pairs matched</Text>
          <Text style={styles.body}>{session.mistakeCount} mismatch{session.mistakeCount === 1 ? '' : 'es'} · recognition practice only · FSRS unchanged</Text>
          <View style={styles.actions}>
            {weakCount ? <AppButton icon="refresh" label={`Retry ${weakCount} weak pair${weakCount === 1 ? '' : 's'}`} onPress={() => void restart(true)} /> : null}
            <AppButton icon="reload-outline" label="New round" variant="secondary" onPress={() => void restart()} />
            <AppButton icon="home-outline" label="Back to study" variant="quiet" onPress={() => router.back()} />
          </View>
        </View>
      </ScrollView>
      </AppShell>
    );
  }

  return (
    <AppShell active="study">
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerCopy}><Text style={styles.eyebrow}>MATCH · RECOGNITION PRACTICE</Text><Text style={styles.title}>Connect each question to its answer.</Text></View>
        <View style={styles.score}><Text style={styles.scoreValue}>{matched.length}/{session.totalPairs}</Text><Text style={styles.scoreLabel}>MATCHED</Text></View>
      </View>
      <View style={styles.safety}><Ionicons name="shield-checkmark-outline" size={18} color={colors.tealDark} /><Text style={styles.safetyText}>Only existing safe card pairs are used. Match never grants full long-term mastery.</Text></View>
      <View style={styles.tileGrid}>
        {tiles.map((tile) => {
          const done = matched.includes(tile.cardId);
          const selected = tile.side === 'prompt' ? selectedPrompt === tile.cardId : selectedAnswer === tile.cardId;
          return (
            <Pressable
              accessibilityRole="button"
              disabled={done || checking}
              key={tile.id}
              onPress={() => void choose(tile)}
              style={({ pressed }) => [styles.tile, tile.side === 'answer' && styles.answerTile, selected && styles.tileSelected, done && styles.tileDone, pressed && styles.tilePressed]}
            >
              <Text style={styles.tileKind}>{tile.side === 'prompt' ? 'QUESTION' : 'ANSWER'}</Text>
              <Text numberOfLines={5} style={[styles.tileText, done && styles.tileTextDone]}>{done ? 'Matched' : tile.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.footer}>{session.mistakeCount} mismatch{session.mistakeCount === 1 ? '' : 'es'} this round</Text>
    </ScrollView>
    </AppShell>
  );
}

function deterministicShuffle<T>(values: T[], seedText: string) {
  const result = [...values];
  let seed = [...seedText].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 7);
  for (let index = result.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const next = seed % (index + 1);
    [result[index], result[next]] = [result[next], result[index]];
  }
  return result;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  answerTile: { backgroundColor: colors.surfaceMuted },
  body: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  completeCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 13, maxWidth: 620, padding: 28, width: '100%' },
  completeContainer: { alignItems: 'center', justifyContent: 'center', minHeight: '100%', padding: 20 },
  completeIcon: { alignItems: 'center', backgroundColor: colors.green, borderRadius: radii.pill, height: 62, justifyContent: 'center', width: 62 },
  completeTitle: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 25, textAlign: 'center' },
  container: { gap: 14, marginHorizontal: 'auto', maxWidth: 960, padding: 18, paddingBottom: 42, width: '100%' },
  eyebrow: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1 },
  footer: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 11, textAlign: 'center' },
  header: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, flexDirection: 'row', gap: 14, justifyContent: 'space-between', padding: 18 },
  headerCopy: { flex: 1, gap: 3, minWidth: 0 },
  safety: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: radii.sm, flexDirection: 'row', gap: 8, padding: 11 },
  safetyText: { color: colors.tealDark, flex: 1, fontFamily: fonts.semibold, fontSize: 11, lineHeight: 17 },
  score: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.md, flexShrink: 0, minWidth: 74, padding: 10 },
  scoreLabel: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 0.7 },
  scoreValue: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 20 },
  tile: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 1, gap: 7, minHeight: 126, minWidth: 155, padding: 13 },
  tileDone: { backgroundColor: '#eaf8f2', borderColor: '#b9e2d4' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tileKind: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 0.8 },
  tilePressed: { opacity: 0.8 },
  tileSelected: { borderColor: colors.blue, borderWidth: 2 },
  tileText: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 },
  tileTextDone: { color: colors.green },
  title: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 20, lineHeight: 27 },
});
