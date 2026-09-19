import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { buildDeckPrintHtml, type DeckPrintLayout } from '@/cards/print';
import { AppButton } from '@/components/AppButton';
import { EmptyState, LoadingState } from '@/components/ScreenState';
import type { DeckSummary, StudyCard } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import { getDeck } from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

const LAYOUTS: { id: DeckPrintLayout; title: string; detail: string }[] = [
  { id: 'source-linked', title: 'Source-linked review', detail: 'Questions, answers, and the supporting excerpt.' },
  { id: 'compact', title: 'Compact table', detail: 'Dense two-column reviewer.' },
  { id: 'cutouts', title: 'Flashcard cutouts', detail: 'Larger cards with trim-friendly borders.' },
  { id: 'cram', title: 'Cram sheet', detail: 'Small, scan-friendly cards.' },
];

export default function PrintDeckScreen() {
  const params = useLocalSearchParams<{ deckId?: string }>();
  const [deck, setDeck] = useState<DeckSummary | null | undefined>(undefined);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [layout, setLayout] = useState<DeckPrintLayout>('source-linked');
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    if (!params.deckId) { setDeck(null); return; }
    void initializeDatabase().then(() => getDeck(params.deckId!)).then((result) => { setDeck(result.deck); setCards(result.cards); });
  }, [params.deckId]));

  const html = useMemo(() => deck ? buildDeckPrintHtml(deck, cards, layout) : '', [cards, deck, layout]);

  async function printDeck() {
    if (!deck || busy) return;
    setBusy(true);
    try {
      await Print.printAsync({ html });
    } catch (error) {
      Alert.alert('Print did not finish', error instanceof Error ? error.message : 'Please try again.');
    } finally { setBusy(false); }
  }

  async function sharePdf() {
    if (!deck || busy) return;
    if (Platform.OS === 'web') { await printDeck(); return; }
    setBusy(true);
    try {
      const file = await Print.printToFileAsync({ html, margins: { top: 24, right: 24, bottom: 24, left: 24 } });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Share ${deck.title}` });
      else Alert.alert('PDF ready', `Saved to ${file.uri}`);
    } catch (error) {
      Alert.alert('PDF was not created', error instanceof Error ? error.message : 'Please try again.');
    } finally { setBusy(false); }
  }

  if (deck === undefined) return <LoadingState label="Preparing print layouts" />;
  if (!deck) return <EmptyState title="Deck not found" body="Open Print from an active deck." />;

  const safeCount = cards.filter((card) => card.status !== 'needs_review').length;
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="print" size={24} color={colors.surface} /></View><View style={styles.heroCopy}><Text style={styles.eyebrow}>PRINT OR SAVE PDF</Text><Text style={styles.title}>{deck.title}</Text><Text style={styles.heroBody}>{safeCount} safe cards available. Cards waiting for source review are automatically excluded.</Text></View></View>
      <View style={styles.section}><Text style={styles.sectionTitle}>Choose a layout</Text><View style={styles.grid}>{LAYOUTS.map((item) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: layout === item.id }} key={item.id} onPress={() => setLayout(item.id)} style={[styles.choice, layout === item.id && styles.choiceSelected]}><View style={styles.choiceTop}><Text style={styles.choiceTitle}>{item.title}</Text>{layout === item.id ? <Ionicons name="checkmark-circle" size={19} color={colors.blue} /> : null}</View><Text style={styles.body}>{item.detail}</Text></Pressable>)}</View></View>
      <View style={styles.actions}><AppButton disabled={busy || !safeCount} icon="print-outline" label={busy ? 'Preparing…' : 'Print'} onPress={() => void printDeck()} /><AppButton disabled={busy || !safeCount} icon="document-outline" label={Platform.OS === 'web' ? 'Open print dialog' : 'Save or share PDF'} variant="secondary" onPress={() => void sharePdf()} /></View>
      <View style={styles.note}><Ionicons name="shield-checkmark-outline" size={19} color={colors.tealDark} /><Text style={styles.noteText}>Printed medical material keeps Barion’s source context, but it cannot update itself. Recheck the app when the source or guideline changes.</Text></View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  body: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  choice: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 1, gap: 5, minWidth: 220, padding: 14 },
  choiceSelected: { backgroundColor: colors.surfaceMuted, borderColor: colors.blue, borderWidth: 2 },
  choiceTitle: { color: colors.ink, flex: 1, fontFamily: fonts.bold, fontSize: 14 },
  choiceTop: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  container: { gap: 16, marginHorizontal: 'auto', maxWidth: 900, padding: 18, paddingBottom: 44, width: '100%' },
  eyebrow: { color: '#c8dbf7', fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  hero: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radii.lg, flexDirection: 'row', gap: 14, padding: 21 },
  heroBody: { color: '#d8e5f7', fontFamily: fonts.regular, fontSize: 12, lineHeight: 19 },
  heroCopy: { flex: 1, gap: 5 },
  heroIcon: { alignItems: 'center', backgroundColor: colors.blue, borderRadius: 15, height: 52, justifyContent: 'center', width: 52 },
  note: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: radii.md, flexDirection: 'row', gap: 9, padding: 13 },
  noteText: { color: colors.tealDark, flex: 1, fontFamily: fonts.semibold, fontSize: 11, lineHeight: 17 },
  section: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 11, padding: 18 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 17 },
  title: { color: colors.surface, fontFamily: fonts.extraBold, fontSize: 22 },
});
