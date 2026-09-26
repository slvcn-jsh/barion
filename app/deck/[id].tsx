import { buildBariDeckEvidence } from '@/ai/bariChat';
import type { BariChatSourceSegment } from '@/ai/types';
import { BariChatModal } from '@/components/BariChatModal';
import { Ionicons } from '@expo/vector-icons';
import { File as ExpoFile, Paths } from 'expo-file-system';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { cardTrustSummary } from '@/cards/trust';
import { AppButton } from '@/components/AppButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, LoadingState } from '@/components/ScreenState';
import { StructuredAnswer } from '@/components/StructuredAnswer';
import { SourceProvenance } from '@/components/SourceProvenance';
import type { DeckSummary, StudyCard } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import {
  archiveDeck,
  copyDeck,
  deleteCardsToTrash,
  deleteDeckToTrash,
  exportDeckToCsv,
  getCardDeletionImpact,
  getDeck,
  getDeckDeletionImpact,
  getSourceSegmentsForDeck,
  markCardNeedsSourceReview,
  restoreCardFromSourceReview,
  setCardFlagged,
  setCardsSuspended,
  updateStudyCard,
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
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [editAnswer, setEditAnswer] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [bariChatOpen, setBariChatOpen] = useState(false);
  const [deckEvidence, setDeckEvidence] = useState<BariChatSourceSegment[]>([]);
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

  function beginEditingCard(card: StudyCard) {
    setSelecting(false);
    setSelectedIds([]);
    setEditingCardId(card.id);
    setEditPrompt(card.prompt);
    setEditAnswer(card.answer);
    setEditNotes(card.qualityNotes ?? '');
  }

  function cancelCardEdit() {
    setEditingCardId(null);
    setEditPrompt('');
    setEditAnswer('');
    setEditNotes('');
  }

  async function saveCardEdit(card: StudyCard) {
    if (!editPrompt.trim() || !editAnswer.trim()) {
      Alert.alert('Card is incomplete', 'Keep both the front and back filled in.');
      return;
    }

    setBusy(true);
    try {
      await updateStudyCard(card.id, {
        prompt: editPrompt,
        answer: editAnswer,
        qualityNotes: editNotes,
      });
      cancelCardEdit();
      await refresh();
    } catch (error) {
      Alert.alert('Card was not saved', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function holdCardForReview(card: StudyCard) {
    setBusy(true);
    try {
      await markCardNeedsSourceReview(card.id);
      await refresh();
    } catch (error) {
      Alert.alert('Card was not held', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function restoreCardAfterReview(card: StudyCard) {
    setBusy(true);
    try {
      await restoreCardFromSourceReview(card.id);
      await refresh();
    } catch (error) {
      Alert.alert('Card was not restored', error instanceof Error ? error.message : 'Please try again.');
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


  async function openBariChat() {
    if (!deck) return;
    const segments = await getSourceSegmentsForDeck(deck.id);
    const evidence = buildBariDeckEvidence(segments);
    setDeckEvidence(evidence);
    setBariChatOpen(true);
  }

  async function copyCurrentDeck() {
    if (!deck || busy) return;
    setBusy(true);
    try {
      const copied = await copyDeck(deck.id);
      router.replace(`/deck/${copied.deckId}`);
      Alert.alert('Fresh copy created', `${copied.cardCount} cards were copied without review history. Source evidence and safety holds were preserved.`);
    } catch (error) {
      Alert.alert('Copy did not finish', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading deck" />;
  }

  if (!deck) {
    return <EmptyState title="Deck not found" body="This local deck is not available." />;
  }

  const needsSourceCheckCount = Math.max(
    deck.needsReviewCount,
    cards.filter((card) => card.status === 'needs_review' || card.evidence?.verificationStatus === 'needs-source-review').length,
  );

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
      </View>

      <View style={styles.actions}>
        <AppButton
          label="Study This Deck"
          icon="sparkles-outline"
          onPress={() => router.push({ pathname: '/modes', params: { deckId: deck.id } })}
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
          label="Ask Bari About Deck"
          icon="sparkles-outline"
          variant="secondary"
          onPress={() => void openBariChat()}
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
        <AppButton
          disabled={!deck.cardCount}
          label="Print or Save PDF"
          icon="print-outline"
          variant="secondary"
          onPress={() => router.push({ pathname: '/print', params: { deckId: deck.id } })}
        />
      </View>

      {needsSourceCheckCount ? (
        <View style={styles.sourceCheckPanel}>
          <View style={styles.sourceCheckIcon}>
            <Ionicons name="alert-circle-outline" size={22} color="#9a5b09" />
          </View>
          <View style={styles.sourceCheckCopy}>
            <Text style={styles.sectionTitle}>Source checks are held out</Text>
            <Text style={styles.manageBody}>
              {needsSourceCheckCount} card{needsSourceCheckCount === 1 ? ' is' : 's are'} paused from review and tests until the answer is checked against its evidence.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.managePanel}>
        <View style={styles.manageCopy}>
          <Text style={styles.sectionTitle}>Manage this deck</Text>
          <Text style={styles.manageBody}>Archive pauses every card. Trash is recoverable and preserves review history.</Text>
        </View>
        <View style={styles.actions}>
          <AppButton disabled={busy} icon="copy-outline" label="Copy without progress" variant="secondary" onPress={() => void copyCurrentDeck()} />
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
        {cards.map((card) => {
          const trust = cardTrustSummary(card);
          const needsCheck = trust.tone === 'review';
          const editing = editingCardId === card.id;
          return (
          <View key={card.id} style={[styles.cardRow, needsCheck && styles.cardRowReview]}>
            <View style={styles.cardTitleRow}>
              {selecting && !editing ? (
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
              <Text style={styles.cardPrompt}>{editing ? 'Edit card wording' : card.prompt}</Text>
                <View style={styles.cardBadges}>
                  <TrustBadge label={trust.label} tone={trust.tone} />
                  {card.weakScore ? <Text style={styles.weakStatus}>WEAK · REPAIR</Text> : null}
                  {card.isSuspended ? <Text style={styles.pauseStatus}>PAUSED</Text> : null}
                  {card.isFlagged ? <Text style={styles.flagStatus}>FLAGGED</Text> : null}
                  <Text style={styles.status}>{formatCardStatus(card.status)}</Text>
                </View>
              </View>
            {editing ? (
              <View style={styles.editor}>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Front</Text>
                  <TextInput
                    multiline
                    placeholder="Question"
                    placeholderTextColor={colors.slate}
                    style={[styles.input, styles.promptInput]}
                    value={editPrompt}
                    onChangeText={setEditPrompt}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Back</Text>
                  <TextInput
                    multiline
                    placeholder="Answer"
                    placeholderTextColor={colors.slate}
                    style={[styles.input, styles.answerInput]}
                    value={editAnswer}
                    onChangeText={setEditAnswer}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Review note</Text>
                  <TextInput
                    multiline
                    placeholder="What changed or what needs source confirmation?"
                    placeholderTextColor={colors.slate}
                    style={[styles.input, styles.noteInput]}
                    value={editNotes}
                    onChangeText={setEditNotes}
                  />
                </View>
                {card.evidence ? (
                  <View style={styles.editSafetyNote}>
                    <Ionicons name="alert-circle-outline" size={17} color="#9a5b09" />
                    <Text style={styles.editSafetyText}>Source-linked edits stay paused until the evidence is checked again.</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <>
                {card.learningObjective ? <View style={styles.objective}><Ionicons name="bulb-outline" size={16} color={colors.gold} /><Text style={styles.objectiveText}>{card.learningObjective}</Text></View> : null}
                <StructuredAnswer answer={card.answer} />
              </>
            )}
            <SourceProvenance evidence={card.evidence} initialExpanded={false} />
            {!editing && needsCheck && card.qualityNotes ? (
              <View style={styles.reviewReason}>
                <Ionicons name="create-outline" size={16} color="#9a5b09" />
                <Text style={styles.reviewReasonText}>{card.qualityNotes}</Text>
              </View>
            ) : null}
            {!selecting ? (
              <View style={styles.cardActions}>
                {editing ? (
                  <>
                    <AppButton disabled={busy || !editPrompt.trim() || !editAnswer.trim()} icon="save-outline" label={busy ? 'Saving' : 'Save edits'} variant="secondary" onPress={() => void saveCardEdit(card)} />
                    <AppButton disabled={busy} label="Cancel" variant="quiet" onPress={cancelCardEdit} />
                  </>
                ) : (
                  <>
                    <AppButton disabled={busy} icon="create-outline" label="Edit" variant="quiet" onPress={() => beginEditingCard(card)} />
                    {needsCheck ? (
                      <AppButton disabled={busy} icon="play-circle-outline" label="Allow study" variant="quiet" onPress={() => void restoreCardAfterReview(card)} />
                    ) : (
                      <AppButton disabled={busy} icon="alert-circle-outline" label="Check source" variant="quiet" onPress={() => void holdCardForReview(card)} />
                    )}
                    <AppButton disabled={busy} icon={card.isFlagged ? 'flag' : 'flag-outline'} label={card.isFlagged ? 'Unflag' : 'Flag'} variant="quiet" onPress={() => void toggleCardFlag(card)} />
                    <AppButton disabled={busy} icon={card.isSuspended ? 'play-circle-outline' : 'pause-circle-outline'} label={card.isSuspended ? 'Resume' : 'Pause'} variant="quiet" onPress={() => void toggleCardSuspended(card)} />
                    <AppButton icon="trash-outline" label="Remove card" variant="quiet" onPress={() => void requestCardRemoval([card.id])} />
                  </>
                )}
              </View>
            ) : null}
          </View>
        );
        })}
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
    {deck ? (
      <BariChatModal
        visible={bariChatOpen}
        onClose={() => setBariChatOpen(false)}
        contextType="deck"
        contextId={deck.id}
        contextTitle={deck.title}
        evidence={deckEvidence}
      />
    ) : null}
    </>
  );
}

function formatCardStatus(status: StudyCard['status']) {
  if (status === 'source_extracted') return 'Source linked';
  if (status === 'needs_review') return 'Check source';
  if (status === 'generated_pending') return 'Pending';
  return status;
}

function TrustBadge({ label, tone }: { label: string; tone: ReturnType<typeof cardTrustSummary>['tone'] }) {
  const badgeStyle =
    tone === 'verified'
      ? styles.trustVerified
      : tone === 'review'
        ? styles.trustReview
        : tone === 'manual'
          ? styles.trustManual
          : styles.trustSource;
  const textStyle =
    tone === 'verified'
      ? styles.trustVerifiedText
      : tone === 'review'
        ? styles.trustReviewText
        : tone === 'manual'
          ? styles.trustManualText
          : styles.trustSourceText;

  return <Text style={[styles.trustStatus, badgeStyle, textStyle]}>{label}</Text>;
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  answerInput: { minHeight: 126, textAlignVertical: 'top' },
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
  cardRowReview: {
    backgroundColor: colors.warningSurface,
    borderColor: '#efd59f',
  },
  cardTitleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
  },
  editSafetyNote: { alignItems: 'center', backgroundColor: colors.warningSurface, borderRadius: radii.sm, flexDirection: 'row', gap: 8, padding: 10 },
  editSafetyText: { color: '#9a5b09', flex: 1, fontFamily: fonts.semibold, fontSize: 11, lineHeight: 17 },
  editor: { gap: 10 },
  field: { gap: 6 },
  fieldLabel: { color: colors.inkSoft, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
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
  input: { backgroundColor: colors.canvas, borderColor: colors.lineStrong, borderRadius: radii.sm, borderWidth: 1, color: colors.ink, fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, minHeight: 48, padding: 12 },
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
  noteInput: { minHeight: 76, textAlignVertical: 'top' },
  promptInput: { minHeight: 78, textAlignVertical: 'top' },
  reviewReason: { alignItems: 'center', backgroundColor: '#fff2d9', borderRadius: radii.sm, flexDirection: 'row', gap: 8, padding: 10 },
  reviewReasonText: { color: '#9a5b09', flex: 1, fontFamily: fonts.semibold, fontSize: 11, lineHeight: 17 },
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
  sourceCheckCopy: { flex: 1, gap: 3, minWidth: 220 },
  sourceCheckIcon: { alignItems: 'center', backgroundColor: colors.warningSurface, borderRadius: 13, height: 46, justifyContent: 'center', width: 46 },
  sourceCheckPanel: { alignItems: 'center', backgroundColor: colors.warningSurface, borderColor: '#efd59f', borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 14 },
  summaryWarning: { color: '#9a5b09' },
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
  trustManual: { backgroundColor: colors.dangerSurface },
  trustManualText: { color: colors.coral },
  trustReview: { backgroundColor: '#fff2d9' },
  trustReviewText: { color: '#9a5b09' },
  trustSource: { backgroundColor: colors.surfaceTeal },
  trustSourceText: { color: colors.tealDark },
  trustStatus: { borderRadius: radii.pill, fontFamily: fonts.bold, fontSize: 9, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5, textTransform: 'uppercase' },
  trustVerified: { backgroundColor: '#eaf8f2' },
  trustVerifiedText: { color: colors.green },
});
