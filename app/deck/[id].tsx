import { Ionicons } from '@expo/vector-icons';
import { File as ExpoFile, Paths } from 'expo-file-system';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EvidenceBox } from '@/components/EvidenceBox';
import { EmptyState, LoadingState } from '@/components/ScreenState';
import { StructuredAnswer } from '@/components/StructuredAnswer';
import type { DeckSummary, StudyCard } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import {
  archiveDeck,
  deleteCardsToTrash,
  deleteDeckToTrash,
  exportDeckToCsv,
  getCardDeletionImpact,
  getDeck,
  getDeckDeletionImpact,
  setCardFlagged,
  setCardsSuspended,
} from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

export default function DeckScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const [deck, setDeck] = useState<DeckSummary | null>(null);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    kind: 'deck' | 'cards';
    ids: string[];
    count: number;
    reviewedCount: number;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!params.id) {
      return;
    }

    setLoading(true);
    await initializeDatabase();
    const result = await getDeck(params.id);
    setDeck(result.deck);
    setCards(result.cards);
    setLoading(false);
  }, [params.id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  function toggleCard(cardId: string) {
    setSelectedIds((current) =>
      current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId],
    );
  }

  async function requestCardRemoval(ids: string[]) {
    const impact = await getCardDeletionImpact(ids);
    setConfirmation({ kind: 'cards', ids, count: impact.cardCount, reviewedCount: impact.reviewedCardCount });
  }

  async function requestDeckRemoval() {
    if (!deck) return;
    const impact = await getDeckDeletionImpact(deck.id);
    setConfirmation({ kind: 'deck', ids: [], count: impact.cardCount, reviewedCount: impact.reviewedCardCount });
  }

  async function confirmRemoval() {
    if (!confirmation || !deck) return;
    setBusy(true);
    try {
      if (confirmation.kind === 'deck') {
        await deleteDeckToTrash(deck.id);
        setConfirmation(null);
        router.replace('/library');
      } else {
        await deleteCardsToTrash(confirmation.ids);
        setConfirmation(null);
        setSelectedIds([]);
        setSelecting(false);
        await refresh();
      }
    } catch (error) {
      Alert.alert('Removal did not finish', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function archiveCurrentDeck() {
    if (!deck) return;
    setBusy(true);
    try {
      await archiveDeck(deck.id);
      router.replace('/library');
    } catch (error) {
      Alert.alert('Archive did not finish', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function suspendSelected() {
    if (!selectedIds.length) return;
    setBusy(true);
    try {
      await setCardsSuspended(selectedIds, true);
      setSelectedIds([]);
      setSelecting(false);
      await refresh();
    } catch (error) {
      Alert.alert('Cards were not paused', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleCardFlag(card: StudyCard) {
    setBusy(true);
    try {
      await setCardFlagged(card.id, !card.isFlagged);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleCardSuspended(card: StudyCard) {
    setBusy(true);
    try {
      await setCardsSuspended([card.id], !card.isSuspended);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    if (!deck || exporting) return;
    setExporting(true);
    try {
      const exported = await exportDeckToCsv(deck.id);
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([exported.csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = exported.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        Alert.alert('CSV export ready', `${exported.cardCount} cards were prepared for download.`);
      } else {
        const file = new ExpoFile(Paths.cache, exported.filename);
        if (!file.exists) file.create();
        file.write(exported.csv);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, {
            mimeType: 'text/csv',
            UTI: 'public.comma-separated-values-text',
            dialogTitle: `Export ${deck.title}`,
          });
        } else {
          Alert.alert('CSV export ready', `${exported.cardCount} cards were saved to ${file.uri}.`);
        }
      }
    } catch (error) {
      Alert.alert('Export did not finish', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading deck" />;
  }

  if (!deck) {
    return <EmptyState title="Deck not found" body="This local deck is not available." />;
  }

  return (
    <>
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: deck.color }]}>
          <Ionicons name={deck.icon as keyof typeof Ionicons.glyphMap} size={24} color="#fff" />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{deck.title}</Text>
          <Text style={styles.subtitle}>{deck.description}</Text>
        </View>
      </View>

      <View style={styles.summary}>
        <Text style={styles.summaryItem}>{deck.cardCount} cards</Text>
        <Text style={styles.summaryItem}>{deck.dueCount} due</Text>
        <Text style={styles.summaryItem}>{deck.evidenceCount} evidence links</Text>
      </View>

      <View style={styles.actions}>
        <AppButton
          label="Review Due Cards"
          icon="play"
          onPress={() => router.push({ pathname: '/study', params: { deckId: deck.id } })}
        />
        <AppButton
          label="Add Card"
          icon="add-circle-outline"
          variant="secondary"
          onPress={() => router.push({ pathname: '/card/new', params: { deckId: deck.id } })}
        />
        <AppButton
          label="Import Cards"
          icon="cloud-upload-outline"
          variant="secondary"
          onPress={() => router.push({ pathname: '/card/new', params: { deckId: deck.id, mode: 'bulk' } })}
        />
        <AppButton
          label="Test This Set"
          icon="school-outline"
          variant="secondary"
          onPress={() => router.push({ pathname: '/test', params: { deckId: deck.id } })}
        />
        <AppButton
          disabled={exporting || !deck.cardCount}
          label={exporting ? 'Exporting' : 'Export CSV'}
          icon="download-outline"
          variant="secondary"
          onPress={() => void exportCsv()}
        />
      </View>

      <View style={styles.managePanel}>
        <View style={styles.manageCopy}>
          <Text style={styles.sectionTitle}>Manage this deck</Text>
          <Text style={styles.manageBody}>Archive pauses every card. Trash is recoverable and preserves review history.</Text>
        </View>
        <View style={styles.actions}>
          <AppButton disabled={busy} icon="archive-outline" label="Archive" variant="secondary" onPress={() => void archiveCurrentDeck()} />
          <AppButton disabled={busy} icon="trash-outline" label="Move deck to Trash" variant="danger" onPress={() => void requestDeckRemoval()} />
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.cardSectionHeading}>
          <Text style={styles.sectionTitle}>Cards</Text>
          <View style={styles.actions}>
            {selecting && selectedIds.length ? (
              <>
                <AppButton icon="pause-circle-outline" label={`Pause ${selectedIds.length}`} variant="secondary" onPress={() => void suspendSelected()} />
                <AppButton icon="trash-outline" label={`Remove ${selectedIds.length}`} variant="danger" onPress={() => void requestCardRemoval(selectedIds)} />
              </>
            ) : null}
            <AppButton
              label={selecting ? 'Done' : 'Select'}
              variant="secondary"
              onPress={() => {
                setSelecting((value) => !value);
                setSelectedIds([]);
              }}
            />
          </View>
        </View>
        {cards.map((card) => (
          <View key={card.id} style={styles.cardRow}>
            <View style={styles.cardTitleRow}>
              {selecting ? (
                <Pressable
                  accessibilityLabel={`${selectedIds.includes(card.id) ? 'Deselect' : 'Select'} card`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selectedIds.includes(card.id) }}
                  hitSlop={8}
                  onPress={() => toggleCard(card.id)}
                  style={[styles.checkbox, selectedIds.includes(card.id) && styles.checkboxSelected]}
                >
                  {selectedIds.includes(card.id) ? <Ionicons name="checkmark" size={16} color={colors.surface} /> : null}
                </Pressable>
              ) : null}
              <Text style={styles.cardPrompt}>{card.prompt}</Text>
              <View style={styles.cardBadges}>
                {card.weakScore ? <Text style={styles.weakStatus}>WEAK · REPAIR</Text> : null}
                {card.isSuspended ? <Text style={styles.pauseStatus}>PAUSED</Text> : null}
                {card.isFlagged ? <Text style={styles.flagStatus}>FLAGGED</Text> : null}
                {card.qualityScore ? <Text style={styles.qualityStatus}>{Math.round(card.qualityScore * 100)}% QUALITY</Text> : null}
                <Text style={styles.status}>{formatCardStatus(card.status)}</Text>
              </View>
            </View>
            {card.learningObjective ? <View style={styles.objective}><Ionicons name="bulb-outline" size={16} color={colors.gold} /><Text style={styles.objectiveText}>{card.learningObjective}</Text></View> : null}
            <StructuredAnswer answer={card.answer} />
            <EvidenceBox evidence={card.evidence} />
            {!selecting ? (
              <View style={styles.cardActions}>
                <AppButton disabled={busy} icon={card.isFlagged ? 'flag' : 'flag-outline'} label={card.isFlagged ? 'Unflag' : 'Flag'} variant="quiet" onPress={() => void toggleCardFlag(card)} />
                <AppButton disabled={busy} icon={card.isSuspended ? 'play-circle-outline' : 'pause-circle-outline'} label={card.isSuspended ? 'Resume' : 'Pause'} variant="quiet" onPress={() => void toggleCardSuspended(card)} />
                <AppButton icon="trash-outline" label="Remove card" variant="quiet" onPress={() => void requestCardRemoval([card.id])} />
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </ScrollView>
    <ConfirmDialog
      body={
        confirmation?.kind === 'deck'
          ? `This deck and its ${confirmation.count} cards will disappear from study and search. You can restore the complete deck later.`
          : `${confirmation?.count ?? 0} selected card${confirmation?.count === 1 ? '' : 's'} will disappear from study and search. You can restore them later.`
      }
      busy={busy}
      confirmLabel={confirmation?.kind === 'deck' ? 'Move deck to Trash' : 'Remove cards'}
      reviewedCardCount={confirmation?.reviewedCount ?? 0}
      title={confirmation?.kind === 'deck' ? 'Move this deck to Trash?' : 'Remove selected cards?'}
      visible={confirmation !== null}
      onCancel={() => setConfirmation(null)}
      onConfirm={() => void confirmRemoval()}
    />
    </>
  );
}

function formatCardStatus(status: StudyCard['status']) {
  if (status === 'source_extracted') return 'Source linked';
  if (status === 'needs_review') return 'Check source';
  if (status === 'generated_pending') return 'Pending';
  return status;
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cardPrompt: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 22,
  },
  cardActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' },
  cardBadges: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: 5, justifyContent: 'flex-end' },
  cardSectionHeading: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  cardRow: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  cardTitleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
  },
  objective: { alignItems: 'center', backgroundColor: colors.warningSurface, borderRadius: radii.sm, flexDirection: 'row', gap: 7, padding: 10 },
  objectiveText: { color: colors.inkSoft, flex: 1, fontFamily: fonts.semibold, fontSize: 11, lineHeight: 17 },
  flagStatus: { backgroundColor: colors.warningSurface, borderRadius: radii.pill, color: '#9a5b09', fontFamily: fonts.bold, fontSize: 9, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 },
  pauseStatus: { backgroundColor: colors.canvas, borderRadius: radii.pill, color: colors.muted, fontFamily: fonts.bold, fontSize: 9, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 },
  qualityStatus: { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, color: colors.blueDark, fontFamily: fonts.bold, fontSize: 9, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 },
  weakStatus: { backgroundColor: colors.dangerSurface, borderRadius: radii.pill, color: colors.coral, fontFamily: fonts.bold, fontSize: 9, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 },
  checkbox: { alignItems: 'center', borderColor: colors.lineStrong, borderRadius: 7, borderWidth: 2, height: 25, justifyContent: 'center', width: 25 },
  checkboxSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  container: {
    gap: 16,
    marginHorizontal: 'auto',
    maxWidth: 920,
    padding: 18,
    paddingBottom: 36,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    padding: 18,
  },
  headerText: {
    flex: 1,
    gap: 6,
  },
  icon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  manageBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19 },
  manageCopy: { flex: 1, gap: 3, minWidth: 220 },
  managePanel: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 15 },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 18,
  },
  status: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    color: colors.tealDark,
    fontFamily: fonts.bold,
    fontSize: 11,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5,
    textTransform: 'uppercase',
  },
  subtitle: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  summary: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    padding: 14,
  },
  summaryItem: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.extraBold,
    fontSize: 23,
    lineHeight: 28,
  },
});
