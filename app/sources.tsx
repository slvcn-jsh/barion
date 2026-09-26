import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/ScreenState';
import { SourceStatusPill } from '@/components/SourceStatusPill';
import type { SourceItem } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import { getSources, importSourceFromPicker, importSourceFromText } from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

const preparationStages = [
  { step: '1', title: 'Reading your material', body: 'Extracts clean text and preserves document sections.' },
  { step: '2', title: 'Finding key concepts', body: 'Identifies core clinical facts, definitions, and mechanisms.' },
  { step: '3', title: 'Creating your cards', body: 'Drafts concise, atomic active-recall questions.' },
  { step: '4', title: 'Finishing your deck', body: 'Checks claims and organizes your ready-to-study set.' },
];

export default function SourcesScreen() {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function refresh() {
        setLoading(true);
        await initializeDatabase();
        const nextSources = await getSources();
        if (active) {
          setSources(nextSources);
          setLoading(false);
        }
      }

      void refresh();
      return () => {
        active = false;
      };
    }, []),
  );

  async function handleImportFile(type?: 'pdf' | 'text') {
    setImporting(true);
    try {
      const allowed = type ? [type] : undefined;
      const sourceId = await importSourceFromPicker(allowed);
      if (sourceId) {
        router.push({
          pathname: '/source/[id]',
          params: { id: sourceId.sourceId, existing: sourceId.duplicate ? '1' : undefined },
        });
      }
    } catch (error) {
      Alert.alert('Import did not finish', error instanceof Error ? error.message : 'Unable to import this file.');
    } finally {
      setImporting(false);
    }
  }

  async function handlePasteSubmit() {
    if (!pasteText.trim()) {
      Alert.alert('Please enter study notes', 'Paste or type text before submitting.');
      return;
    }

    setImporting(true);
    try {
      const sourceId = await importSourceFromText(pasteTitle, pasteText);
      setShowPasteModal(false);
      setPasteTitle('');
      setPasteText('');
      if (sourceId) {
        router.push({
          pathname: '/source/[id]',
          params: { id: sourceId.sourceId, existing: sourceId.duplicate ? '1' : undefined },
        });
      }
    } catch (error) {
      Alert.alert('Import did not finish', error instanceof Error ? error.message : 'Unable to process pasted notes.');
    } finally {
      setImporting(false);
    }
  }

  if (loading) {
    return <LoadingState label="Opening your study materials" />;
  }

  return (
    <AppShell active="add">
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header */}
        <View style={styles.intro}>
          <View style={styles.introIcon}>
            <Ionicons name="document-text-outline" size={26} color={colors.blue} />
          </View>
          <View style={styles.introCopy}>
            <Text style={styles.eyebrow}>ADD MATERIAL</Text>
            <Text style={styles.title}>Turn your notes into study decks</Text>
            <Text style={styles.subtitle}>
              Provide your lecture PDF, note file, or pasted notes. Barion prepares a clean active-recall deck for you.
            </Text>
          </View>
        </View>

        {/* Input Methods Grid */}
        <View style={styles.optionsGrid}>
          <Pressable
            accessibilityRole="button"
            disabled={importing}
            onPress={() => void handleImportFile('pdf')}
            style={({ pressed }) => [styles.optionCard, pressed && styles.optionCardPressed, importing && styles.optionCardDisabled]}
          >
            <View style={[styles.optionIcon, { backgroundColor: '#eef4ff' }]}>
              <Ionicons name="document-outline" size={26} color={colors.blue} />
            </View>
            <Text style={styles.optionTitle}>Upload PDF</Text>
            <Text style={styles.optionBody}>Lectures, chapters, and articles up to 30 MB.</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={importing}
            onPress={() => void handleImportFile('text')}
            style={({ pressed }) => [styles.optionCard, pressed && styles.optionCardPressed, importing && styles.optionCardDisabled]}
          >
            <View style={[styles.optionIcon, { backgroundColor: '#eaf8f2' }]}>
              <Ionicons name="reader-outline" size={26} color={colors.tealDark} />
            </View>
            <Text style={styles.optionTitle}>Upload notes</Text>
            <Text style={styles.optionBody}>Plain text (.txt) and Markdown (.md) documents.</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={importing}
            onPress={() => setShowPasteModal(true)}
            style={({ pressed }) => [styles.optionCard, pressed && styles.optionCardPressed, importing && styles.optionCardDisabled]}
          >
            <View style={[styles.optionIcon, { backgroundColor: '#f5f0ff' }]}>
              <Ionicons name="clipboard-outline" size={26} color="#6366f1" />
            </View>
            <Text style={styles.optionTitle}>Paste text</Text>
            <Text style={styles.optionBody}>Paste copied lecture text, summaries, or notes directly.</Text>
          </Pressable>
        </View>

        {/* Preparation Pipeline */}
        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>HOW IT WORKS</Text>
          <Text style={styles.sectionTitle}>Preparing your deck</Text>
          <View style={styles.stagesGrid}>
            {preparationStages.map((stage) => (
              <View key={stage.step} style={styles.stageCard}>
                <View style={styles.stageStepBadge}>
                  <Text style={styles.stageStepText}>{stage.step}</Text>
                </View>
                <Text style={styles.stageTitle}>{stage.title}</Text>
                <Text style={styles.stageBody}>{stage.body}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Your Sources List */}
        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>STUDY MATERIALS</Text>
          <Text style={styles.sectionTitle}>Your added materials</Text>

          {sources.length === 0 ? (
            <View style={styles.emptyPanel}>
              <Ionicons name="folder-open-outline" size={32} color={colors.muted} />
              <Text style={styles.emptyTitle}>No materials added yet</Text>
              <Text style={styles.emptyBody}>
                Upload your first lecture or notes above to create a study deck.
              </Text>
            </View>
          ) : (
            <View style={styles.sourcesList}>
              {sources.map((source) => (
                <Pressable
                  key={source.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${source.title}`}
                  onPress={() => router.push(`/source/${source.id}`)}
                  style={({ pressed }) => [styles.sourceRow, pressed && styles.sourceRowPressed]}
                >
                  <View style={styles.sourceIcon}>
                    <Ionicons
                      name={source.filename.endsWith('.pdf') ? 'document-text-outline' : 'reader-outline'}
                      size={24}
                      color={colors.blueDark}
                    />
                  </View>
                  <View style={styles.sourceText}>
                    <View style={styles.sourceTitleRow}>
                      <Text numberOfLines={1} style={styles.sourceTitle}>{source.title}</Text>
                      <SourceStatusPill status={source.status} />
                    </View>
                    <Text numberOfLines={1} style={styles.filename}>{source.filename}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.slate} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Paste Text Modal */}
      <Modal
        animationType="slide"
        transparent
        visible={showPasteModal}
        onRequestClose={() => setShowPasteModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Paste study notes</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setShowPasteModal(false)}
                style={styles.modalClose}
              >
                <Ionicons name="close" size={20} color={colors.ink} />
              </Pressable>
            </View>

            <Text style={styles.inputLabel}>Title (optional)</Text>
            <TextInput
              onChangeText={setPasteTitle}
              placeholder="e.g., Pharmacology Lecture 3"
              placeholderTextColor={colors.slate}
              style={styles.titleInput}
              value={pasteTitle}
            />

            <Text style={styles.inputLabel}>Notes</Text>
            <TextInput
              multiline
              onChangeText={setPasteText}
              placeholder="Paste your study notes or lecture material here..."
              placeholderTextColor={colors.slate}
              style={styles.textArea}
              textAlignVertical="top"
              value={pasteText}
            />

            <View style={styles.modalActions}>
              <AppButton
                label="Cancel"
                variant="secondary"
                onPress={() => setShowPasteModal(false)}
              />
              <AppButton
                disabled={importing || !pasteText.trim()}
                icon="sparkles-outline"
                label={importing ? 'Preparing deck…' : 'Prepare deck'}
                onPress={handlePasteSubmit}
              />
            </View>
          </View>
        </View>
      </Modal>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 24,
    marginHorizontal: 'auto',
    maxWidth: 960,
    padding: 18,
    paddingBottom: 48,
    width: '100%',
  },
  emptyBody: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 400,
    textAlign: 'center',
  },
  emptyPanel: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 8,
    padding: 32,
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  eyebrow: {
    color: colors.blueDark,
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  filename: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  inputLabel: {
    color: colors.inkSoft,
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.8,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  intro: {
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    flexDirection: 'row',
    gap: 16,
    padding: 22,
  },
  introCopy: {
    flex: 1,
    gap: 6,
  },
  introIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  modalClose: {
    padding: 6,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    gap: 8,
    maxWidth: 600,
    padding: 22,
    width: '100%',
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: {
    color: colors.ink,
    fontFamily: fonts.extraBold,
    fontSize: 20,
  },
  optionBody: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
  },
  optionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    gap: 8,
    minWidth: 190,
    padding: 18,
  },
  optionCardDisabled: {
    opacity: 0.5,
  },
  optionCardPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.99 }],
  },
  optionIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  optionTitle: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  section: {
    gap: 12,
  },
  sectionEyebrow: {
    color: colors.blueDark,
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 27,
  },
  sourceIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  sourceRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  sourceRowPressed: {
    opacity: 0.8,
  },
  sourceText: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  sourceTitle: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  sourceTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  sourcesList: {
    gap: 10,
  },
  stageBody: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
  },
  stageCard: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    gap: 6,
    minWidth: 170,
    padding: 14,
  },
  stageStepBadge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  stageStepText: {
    color: colors.blueDark,
    fontFamily: fonts.bold,
    fontSize: 11,
  },
  stageTitle: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  stagesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  textArea: {
    backgroundColor: colors.canvas,
    borderColor: colors.lineStrong,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    minHeight: 140,
    padding: 12,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.extraBold,
    fontSize: 26,
    lineHeight: 34,
  },
  titleInput: {
    backgroundColor: colors.canvas,
    borderColor: colors.lineStrong,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  subtitle: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
  },
});
