import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  parseCardImportText,
  type CardImportCardSeparator,
  type CardImportFieldSeparator,
  type CardImportReadyRow,
} from '@/cards/importExport';
import { AppButton } from '@/components/AppButton';
import { LoadingState } from '@/components/ScreenState';
import type { DeckSummary } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import { createManualCard, getDashboard, importCardsIntoDeck } from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

type BuilderMode = 'single' | 'bulk';

const fieldSeparators: { value: CardImportFieldSeparator; label: string }[] = [
  { value: 'tab', label: 'Tab' },
  { value: 'comma', label: 'Comma' },
  { value: 'semicolon', label: 'Semicolon' },
  { value: 'pipe', label: 'Pipe' },
  { value: 'custom', label: 'Custom' },
];

const cardSeparators: { value: CardImportCardSeparator; label: string }[] = [
  { value: 'newline', label: 'New line' },
  { value: 'blank-line', label: 'Blank line' },
  { value: 'semicolon', label: 'Semicolon' },
  { value: 'custom', label: 'Custom' },
];

const sampleImport = [
  'Loop diuretics potassium risk\tLoop diuretics can increase potassium loss and may contribute to hypokalemia.',
  'The sinoatrial node is the heart rhythm {{c1::pacemaker}} and starts impulses in the {{c2::right atrium}}.\tAnatomy recall context.',
].join('\n');

export default function NewCardScreen() {
  const params = useLocalSearchParams<{ deckId?: string; mode?: string }>();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState(params.deckId ?? '');
  const [mode, setMode] = useState<BuilderMode>(params.mode === 'bulk' ? 'bulk' : 'single');
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [cardType, setCardType] = useState('basic');
  const [bulkCardType, setBulkCardType] = useState('basic');
  const [importText, setImportText] = useState('');
  const [fieldSeparator, setFieldSeparator] = useState<CardImportFieldSeparator>('tab');
  const [customFieldSeparator, setCustomFieldSeparator] = useState('');
  const [cardSeparator, setCardSeparator] = useState<CardImportCardSeparator>('newline');
  const [customCardSeparator, setCustomCardSeparator] = useState('');
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const selectedDeck = useMemo(
    () => decks.find((deck) => deck.id === selectedDeckId) ?? decks[0],
    [decks, selectedDeckId],
  );

  const previewRows = useMemo(
    () =>
      parseCardImportText(importText, {
        fieldSeparator,
        customFieldSeparator,
        cardSeparator,
        customCardSeparator,
        firstRowIsHeader,
        cardType: bulkCardType,
        clozeEnabled: true,
      }),
    [bulkCardType, cardSeparator, customCardSeparator, customFieldSeparator, fieldSeparator, firstRowIsHeader, importText],
  );
  const readyRows: CardImportReadyRow[] = previewRows
    .filter((row) => row.status === 'ready')
    .map(({ issue: _issue, status: _status, ...row }) => row);
  const readyCardCount = readyRows.reduce((total, row) => total + row.generatedCardCount, 0);
  const invalidCount = previewRows.length - readyRows.length;
  const singleIsCloze = /\{\{c\d+::/i.test(prompt);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      async function load() {
        setLoading(true);
        await initializeDatabase();
        const dashboard = await getDashboard();
        if (!mounted) return;
        setDecks(dashboard.decks);
        setSelectedDeckId((current) => current || dashboard.decks[0]?.id || '');
        setLoading(false);
      }

      void load();
      return () => {
        mounted = false;
      };
    }, []),
  );

  async function saveSingle() {
    if (!selectedDeck) {
      Alert.alert('No deck available', 'Create a deck before adding cards.');
      return;
    }

    if (!prompt.trim() || (!answer.trim() && !singleIsCloze)) {
      Alert.alert('Card is incomplete', 'Add a prompt and an answer, or use cloze markup in the prompt.');
      return;
    }

    setSaving(true);
    try {
      if (singleIsCloze) {
        const result = await importCardsIntoDeck(selectedDeck.id, [
          {
            id: 'manual-cloze',
            rowNumber: 1,
            front: prompt.trim(),
            back: answer.trim(),
            cardType: 'cloze',
            clozeCount: 1,
            generatedCardCount: 1,
          },
        ]);
        if (!result.createdCardCount) {
          Alert.alert('No new card added', 'An identical cloze card already exists in this deck.');
          return;
        }
      } else {
        await createManualCard({
          deckId: selectedDeck.id,
          prompt,
          answer,
          cardType,
        });
      }
      router.replace({ pathname: '/deck/[id]', params: { id: selectedDeck.id } });
    } catch (error) {
      Alert.alert('Unable to save card', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function saveBulk() {
    if (!selectedDeck) {
      Alert.alert('No deck available', 'Create a deck before importing cards.');
      return;
    }

    if (!readyRows.length) {
      Alert.alert('Nothing ready to import', 'Fix the preview rows before saving.');
      return;
    }

    setSaving(true);
    try {
      const result = await importCardsIntoDeck(selectedDeck.id, readyRows);
      Alert.alert(
        'Import complete',
        `${result.createdCardCount} card${result.createdCardCount === 1 ? '' : 's'} added. ${result.skippedDuplicateCount} duplicate${result.skippedDuplicateCount === 1 ? '' : 's'} skipped.`,
      );
      if (result.createdCardCount) {
        router.replace({ pathname: '/deck/[id]', params: { id: selectedDeck.id } });
      }
    } catch (error) {
      Alert.alert('Import did not finish', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function pickImportFile() {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/*', 'text/csv', 'text/tab-separated-values', 'application/csv', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
        base64: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const text = await readPickedText(asset);
      setImportText(text);
      setMode('bulk');
      if (asset.name.toLowerCase().endsWith('.csv')) setFieldSeparator('comma');
      if (asset.name.toLowerCase().endsWith('.tsv')) setFieldSeparator('tab');
    } catch (error) {
      Alert.alert('File could not be read', error instanceof Error ? error.message : 'Try a CSV, TSV, or plain text file.');
    } finally {
      setPicking(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading decks" />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="create-outline" size={25} color={colors.surface} />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>BUILDER WORKSPACE</Text>
          <Text style={styles.title}>Create cards without losing structure</Text>
          <Text style={styles.subtitle}>Single cards, bulk rows, and cloze siblings all become FSRS-ready review cards.</Text>
        </View>
      </View>

      <View style={styles.modeBar}>
        <ModeChoice active={mode === 'single'} icon="flash-outline" label="Single card" onPress={() => setMode('single')} />
        <ModeChoice active={mode === 'bulk'} icon="cloud-upload-outline" label="Bulk import" onPress={() => setMode('bulk')} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Deck</Text>
        <View style={styles.deckList}>
          {decks.map((deck) => (
            <Pressable
              key={deck.id}
              style={[styles.deckChoice, selectedDeck?.id === deck.id && styles.deckChoiceActive]}
              onPress={() => setSelectedDeckId(deck.id)}
            >
              <Text style={[styles.deckChoiceText, selectedDeck?.id === deck.id && styles.deckChoiceTextActive]}>
                {deck.title}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {mode === 'single' ? (
        <View style={styles.section}>
          <View style={styles.field}>
            <Text style={styles.label}>Type</Text>
            <TextInput
              placeholder="basic, cloze, mechanism, lab-value"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={singleIsCloze ? 'cloze' : cardType}
              onChangeText={setCardType}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Front</Text>
            <TextInput
              multiline
              placeholder="Question or cloze text"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.multiline]}
              value={prompt}
              onChangeText={setPrompt}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Back</Text>
            <TextInput
              multiline
              placeholder={singleIsCloze ? 'Optional extra context' : 'Answer'}
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.multiline]}
              value={answer}
              onChangeText={setAnswer}
            />
          </View>

          {singleIsCloze ? (
            <View style={styles.notice}>
              <Ionicons name="layers-outline" size={18} color={colors.tealDark} />
              <Text style={styles.noticeText}>Barion will create one sibling card for each cloze group.</Text>
            </View>
          ) : null}

          <AppButton disabled={saving} label={saving ? 'Saving' : 'Save card'} icon="save-outline" onPress={() => void saveSingle()} />
        </View>
      ) : (
        <View style={styles.section}>
          <View style={styles.importTopline}>
            <View style={styles.importCopy}>
              <Text style={styles.sectionTitle}>Bulk import</Text>
              <Text style={styles.body}>CSV, TSV, pasted rows, and Anki-style cloze text are previewed before saving.</Text>
            </View>
            <View style={styles.actionRow}>
              <AppButton disabled={picking} icon="document-attach-outline" label={picking ? 'Reading' : 'Choose file'} variant="secondary" onPress={() => void pickImportFile()} />
              <AppButton icon="sparkles-outline" label="Use sample" variant="quiet" onPress={() => setImportText(sampleImport)} />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Rows</Text>
            <TextInput
              multiline
              placeholder={'Front\tBack\n{{c1::Hidden term}} in context\tExtra note'}
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.importInput]}
              value={importText}
              onChangeText={setImportText}
            />
          </View>

          <View style={styles.optionGrid}>
            <View style={styles.optionPanel}>
              <Text style={styles.label}>Front/back separator</Text>
              <SeparatorGrid<CardImportFieldSeparator> options={fieldSeparators} selected={fieldSeparator} onSelect={setFieldSeparator} />
              {fieldSeparator === 'custom' ? (
                <TextInput value={customFieldSeparator} onChangeText={setCustomFieldSeparator} placeholder="Custom separator" placeholderTextColor={colors.muted} style={styles.input} />
              ) : null}
            </View>
            <View style={styles.optionPanel}>
              <Text style={styles.label}>Card separator</Text>
              <SeparatorGrid<CardImportCardSeparator> options={cardSeparators} selected={cardSeparator} onSelect={setCardSeparator} />
              {cardSeparator === 'custom' ? (
                <TextInput value={customCardSeparator} onChangeText={setCustomCardSeparator} placeholder="Custom separator" placeholderTextColor={colors.muted} style={styles.input} />
              ) : null}
            </View>
          </View>

          <View style={styles.optionGrid}>
            <View style={styles.optionPanel}>
              <Text style={styles.label}>Card type</Text>
              <TextInput value={bulkCardType} onChangeText={setBulkCardType} placeholder="basic" placeholderTextColor={colors.muted} style={styles.input} />
            </View>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: firstRowIsHeader }}
              onPress={() => setFirstRowIsHeader((value) => !value)}
              style={[styles.headerToggle, firstRowIsHeader && styles.headerToggleActive]}
            >
              <Ionicons name={firstRowIsHeader ? 'checkbox' : 'square-outline'} size={21} color={firstRowIsHeader ? colors.blue : colors.slate} />
              <Text style={styles.headerToggleText}>First row is a header</Text>
            </Pressable>
          </View>

          <View style={styles.previewPanel}>
            <View style={styles.previewHeading}>
              <View>
                <Text style={styles.sectionTitle}>Preview</Text>
                <Text style={styles.body}>
                  {readyRows.length} row{readyRows.length === 1 ? '' : 's'} ready - {readyCardCount} card{readyCardCount === 1 ? '' : 's'} after cloze expansion
                </Text>
              </View>
              {invalidCount ? <Text style={styles.invalidBadge}>{invalidCount} to fix</Text> : <Text style={styles.readyBadge}>Ready</Text>}
            </View>
            {!previewRows.length ? <Text style={styles.emptyPreview}>Paste rows or choose a file to preview cards.</Text> : null}
            {previewRows.slice(0, 8).map((row) => <PreviewRow key={row.id} row={row} />)}
            {previewRows.length > 8 ? <Text style={styles.body}>{previewRows.length - 8} more row{previewRows.length - 8 === 1 ? '' : 's'} hidden from preview.</Text> : null}
          </View>

          <AppButton disabled={saving || !readyRows.length} label={saving ? 'Importing' : `Import ${readyCardCount || 0} cards`} icon="save-outline" onPress={() => void saveBulk()} />
        </View>
      )}
    </ScrollView>
  );
}

async function readPickedText(asset: DocumentPicker.DocumentPickerAsset) {
  if (asset.file && typeof asset.file.text === 'function') {
    return asset.file.text();
  }
  const file = new ExpoFile(asset.uri);
  return file.text();
}

function ModeChoice({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.modeChoice, active && styles.modeChoiceActive]}>
      <Ionicons name={icon} size={19} color={active ? colors.surface : colors.blueDark} />
      <Text style={[styles.modeChoiceText, active && styles.modeChoiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SeparatorGrid<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.separatorGrid}>
      {options.map((option) => (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: selected === option.value }}
          key={option.value}
          onPress={() => onSelect(option.value)}
          style={[styles.separatorChoice, selected === option.value && styles.separatorChoiceActive]}
        >
          <Text style={[styles.separatorText, selected === option.value && styles.separatorTextActive]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function PreviewRow({ row }: { row: ReturnType<typeof parseCardImportText>[number] }) {
  const valid = row.status === 'ready';
  return (
    <View style={[styles.previewRow, !valid && styles.previewRowInvalid]}>
      <View style={styles.previewIndex}>
        <Text style={styles.previewIndexText}>{row.rowNumber}</Text>
      </View>
      <View style={styles.previewCopy}>
        <Text numberOfLines={2} style={styles.previewFront}>{row.front || 'Empty front'}</Text>
        <Text numberOfLines={2} style={styles.previewBack}>{row.back || (row.clozeCount ? 'Cloze answer generated' : 'Empty back')}</Text>
        <View style={styles.badgeRow}>
          <Text style={styles.typeBadge}>{row.cardType}</Text>
          {row.clozeCount ? <Text style={styles.clozeBadge}>{row.clozeCount} cloze</Text> : null}
          {!valid ? <Text style={styles.issueBadge}>{row.issue}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badgeRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  body: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19 },
  clozeBadge: { backgroundColor: colors.warningSurface, borderRadius: radii.pill, color: '#9a5b09', fontFamily: fonts.bold, fontSize: 9, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 },
  container: { gap: 16, marginHorizontal: 'auto', maxWidth: 980, padding: 18, paddingBottom: 48, width: '100%' },
  deckChoice: { backgroundColor: colors.surfaceMuted, borderColor: colors.line, borderRadius: radii.pill, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  deckChoiceActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  deckChoiceText: { color: colors.ink, fontFamily: fonts.bold, fontSize: 13 },
  deckChoiceTextActive: { color: colors.surface },
  deckList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emptyPreview: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.md, borderStyle: 'dashed', borderWidth: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, padding: 18, textAlign: 'center' },
  eyebrow: { color: '#c8dbf7', fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  field: { gap: 8 },
  headerToggle: { alignItems: 'center', backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 9, minHeight: 54, minWidth: 230, paddingHorizontal: 13 },
  headerToggleActive: { backgroundColor: colors.surfaceMuted, borderColor: colors.blue },
  headerToggleText: { color: colors.ink, fontFamily: fonts.bold, fontSize: 13 },
  hero: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radii.lg, flexDirection: 'row', flexWrap: 'wrap', gap: 14, padding: 22 },
  heroCopy: { flex: 1, gap: 5, minWidth: 230 },
  heroIcon: { alignItems: 'center', backgroundColor: colors.blue, borderRadius: 15, height: 52, justifyContent: 'center', width: 52 },
  importCopy: { flex: 1, gap: 4, minWidth: 230 },
  importInput: { minHeight: 180, paddingTop: 12, textAlignVertical: 'top' },
  importTopline: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  input: { backgroundColor: colors.canvas, borderColor: colors.lineStrong, borderRadius: radii.sm, borderWidth: 1, color: colors.ink, fontFamily: fonts.medium, fontSize: 14, minHeight: 48, paddingHorizontal: 12 },
  invalidBadge: { backgroundColor: colors.dangerSurface, borderRadius: radii.pill, color: colors.red, fontFamily: fonts.bold, fontSize: 10, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 6 },
  issueBadge: { backgroundColor: colors.dangerSurface, borderRadius: radii.pill, color: colors.red, fontFamily: fonts.bold, fontSize: 9, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 },
  label: { color: colors.ink, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  modeBar: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 8 },
  modeChoice: { alignItems: 'center', borderRadius: radii.md, flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 48, minWidth: 180, paddingHorizontal: 12 },
  modeChoiceActive: { backgroundColor: colors.blue },
  modeChoiceText: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 14 },
  modeChoiceTextActive: { color: colors.surface },
  multiline: { minHeight: 120, paddingTop: 12, textAlignVertical: 'top' },
  notice: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: radii.md, flexDirection: 'row', gap: 9, padding: 12 },
  noticeText: { color: colors.tealDark, flex: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 },
  optionGrid: { alignItems: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optionPanel: { flex: 1, gap: 8, minWidth: 260 },
  previewBack: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  previewCopy: { flex: 1, gap: 5, minWidth: 0 },
  previewFront: { color: colors.ink, fontFamily: fonts.bold, fontSize: 13, lineHeight: 19 },
  previewHeading: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  previewIndex: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 10, height: 34, justifyContent: 'center', width: 34 },
  previewIndexText: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 11 },
  previewPanel: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, gap: 10, padding: 14 },
  previewRow: { alignItems: 'flex-start', backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.sm, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 11 },
  previewRowInvalid: { borderColor: '#f0c1c6' },
  readyBadge: { backgroundColor: colors.surfaceTeal, borderRadius: radii.pill, color: colors.tealDark, fontFamily: fonts.bold, fontSize: 10, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 6 },
  section: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 15, padding: 18 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 19, lineHeight: 25 },
  separatorChoice: { alignItems: 'center', backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.pill, borderWidth: 1, minHeight: 38, paddingHorizontal: 12, paddingVertical: 9 },
  separatorChoiceActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  separatorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  separatorText: { color: colors.ink, fontFamily: fonts.bold, fontSize: 12 },
  separatorTextActive: { color: colors.surface },
  subtitle: { color: '#d8e5f7', fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  title: { color: colors.surface, fontFamily: fonts.extraBold, fontSize: 25, lineHeight: 32 },
  typeBadge: { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, color: colors.blueDark, fontFamily: fonts.bold, fontSize: 9, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 },
});
