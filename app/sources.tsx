import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/ScreenState';
import { SourceStatusPill } from '@/components/SourceStatusPill';
import type { SourceItem } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import { getSources, importSourceFromPicker } from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

const pipeline = [
  { icon: 'cloud-upload-outline' as const, label: 'Import', body: 'Choose PDF, text, or Markdown.' },
  { icon: 'scan-outline' as const, label: 'Extract', body: 'Keep page-level source locations.' },
  { icon: 'sparkles-outline' as const, label: 'Build', body: 'Find concepts, remove repeats, create cards.' },
  { icon: 'play-circle-outline' as const, label: 'Study', body: 'Open the source’s ready-made study set.' },
];

export default function SourcesScreen() {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

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

  async function importSource() {
    setImporting(true);
    try {
      const sourceId = await importSourceFromPicker();
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

  if (loading) {
    return <LoadingState label="Opening your source library" />;
  }

  return (
    <AppShell active="add">
      <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.intro}>
        <View style={styles.introIcon}>
          <Ionicons name="library-outline" size={26} color={colors.blue} />
        </View>
        <View style={styles.introCopy}>
          <Text style={styles.eyebrow}>SOURCE-GROUNDED LEARNING</Text>
          <Text style={styles.title}>Turn your material into review-ready cards.</Text>
          <Text style={styles.subtitle}>
            Every unique source becomes its own ready-to-study set. Barion handles the organization for you.
          </Text>
        </View>
      </View>

      <View style={styles.importPanel}>
        <View style={styles.uploadMark}>
          <Ionicons name="cloud-upload-outline" size={31} color={colors.blue} />
        </View>
        <View style={styles.importCopy}>
          <Text style={styles.importTitle}>{importing ? 'Building your study set…' : 'Add learning material'}</Text>
          <Text style={styles.importBody}>
            {importing
              ? 'Keep Barion open while it extracts concepts, removes repeats, and creates cards.'
              : 'Choose a selectable-text PDF, .txt, or .md file up to 30 MB.'}
          </Text>
        </View>
        <AppButton
          disabled={importing}
          label={importing ? 'Processing…' : 'Choose a file'}
          icon={importing ? 'hourglass-outline' : 'add'}
          onPress={importSource}
        />
        <View style={styles.localNote}>
          <Ionicons name="lock-closed-outline" size={15} color={colors.tealDark} />
          <Text style={styles.localNoteText}>
            {Platform.OS === 'web'
              ? 'PDF text stays in this browser. A separate study set is created automatically.'
              : 'Text notes stay local. Mobile PDFs use only your configured Barion service.'}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <View>
          <Text style={styles.sectionEyebrow}>A CLEAR FOUR-STEP FLOW</Text>
          <Text style={styles.sectionTitle}>From file to flashcard</Text>
        </View>
        <View style={styles.pipelineGrid}>
          {pipeline.map((step, index) => (
            <View key={step.label} style={styles.pipelineCard}>
              <View style={styles.pipelineTopline}>
                <View style={styles.stepIcon}>
                  <Ionicons name={step.icon} size={19} color={colors.blueDark} />
                </View>
                <Text style={styles.stepNumber}>0{index + 1}</Text>
              </View>
              <Text style={styles.stepLabel}>{step.label}</Text>
              <Text style={styles.stepBody}>{step.body}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.libraryHeading}>
          <View>
            <Text style={styles.sectionEyebrow}>YOUR EVIDENCE BASE</Text>
            <Text style={styles.sectionTitle}>Sources</Text>
          </View>
          <View style={styles.libraryControls}>
            <Text style={styles.countBadge}>{sources.length}</Text>
            <AppButton icon="options-outline" label="Manage" variant="secondary" onPress={() => router.push('/library')} />
          </View>
        </View>

        {!sources.length ? (
          <View style={styles.emptyPanel}>
            <Ionicons name="documents-outline" size={30} color={colors.slate} />
            <Text style={styles.emptyTitle}>No sources yet</Text>
            <Text style={styles.emptyBody}>Import a chapter, lecture note, or study guide to create your first grounded drafts.</Text>
          </View>
        ) : null}

        {sources.map((source) => (
          <Pressable
            accessibilityRole="button"
            key={source.id}
            style={({ pressed }) => [styles.sourceRow, pressed && styles.sourceRowPressed]}
            onPress={() => router.push({ pathname: '/source/[id]', params: { id: source.id } })}
          >
            <View style={styles.sourceIcon}>
              <Ionicons name={source.mimeType === 'application/pdf' ? 'document-text' : 'reader-outline'} size={23} color={colors.blue} />
            </View>
            <View style={styles.sourceText}>
              <View style={styles.sourceTitleRow}>
                <Text numberOfLines={1} style={styles.sourceTitle}>{source.title}</Text>
                <SourceStatusPill status={source.status} />
              </View>
              <Text numberOfLines={1} style={styles.filename}>{source.filename}</Text>
              <View style={styles.sourceFacts}>
                <Text style={styles.sourceMeta}>{source.sourceCardCount} cards</Text>
                <View style={styles.factDot} />
                <Text style={[styles.sourceMeta, source.needsReviewCardCount ? styles.sourceMetaWarning : null]}>
                  {source.needsReviewCardCount
                    ? `${source.needsReviewCardCount} source checks`
                    : source.draftCount
                      ? `${source.draftCount} need attention`
                      : 'Independent study set'}
                </Text>
                {source.verifiedCardCount ? (
                  <>
                    <View style={styles.factDot} />
                    <Text style={styles.sourceMeta}>{source.verifiedCardCount} verified</Text>
                  </>
                ) : null}
                {source.sizeBytes ? (
                  <>
                    <View style={styles.factDot} />
                    <Text style={styles.sourceMeta}>{formatBytes(source.sizeBytes)}</Text>
                  </>
                ) : null}
              </View>
              {source.ingestionError ? <Text numberOfLines={2} style={styles.sourceIssue}>{source.ingestionError}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.slate} />
          </Pressable>
        ))}
      </View>
      </ScrollView>
    </AppShell>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  container: { gap: 24, marginHorizontal: 'auto', maxWidth: 1180, padding: 18, paddingBottom: 44, width: '100%' },
  countBadge: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    color: colors.blueDark,
    fontFamily: fonts.bold,
    minWidth: 32,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
    textAlign: 'center',
  },
  emptyBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, maxWidth: 460, textAlign: 'center' },
  emptyPanel: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderStyle: 'dashed', borderWidth: 1, gap: 8, padding: 32 },
  emptyTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 17 },
  eyebrow: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.3 },
  factDot: { backgroundColor: colors.lineStrong, borderRadius: radii.pill, height: 4, width: 4 },
  filename: { color: colors.inkSoft, fontFamily: fonts.medium, fontSize: 12 },
  importBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, maxWidth: 560, textAlign: 'center' },
  importCopy: { alignItems: 'center', gap: 5 },
  importPanel: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.lineStrong,
    borderRadius: radii.lg,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 15,
    padding: 28,
  },
  importTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 20 },
  intro: { alignItems: 'flex-start', backgroundColor: colors.surfaceMuted, borderRadius: radii.lg, flexDirection: 'row', gap: 16, padding: 22 },
  introCopy: { flex: 1, gap: 7 },
  introIcon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 16, height: 54, justifyContent: 'center', width: 54 },
  libraryHeading: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  libraryControls: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  localNote: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: radii.pill, flexDirection: 'row', gap: 6, paddingHorizontal: 11, paddingVertical: 7 },
  localNoteText: { color: colors.tealDark, fontFamily: fonts.semibold, fontSize: 11 },
  pipelineCard: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 1, flexBasis: 190, gap: 7, minWidth: 160, padding: 14 },
  pipelineGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pipelineTopline: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  section: { gap: 11 },
  sectionEyebrow: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.25 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 21, lineHeight: 29 },
  sourceFacts: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  sourceIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 14, height: 50, justifyContent: 'center', width: 50 },
  sourceIssue: { color: colors.red, fontFamily: fonts.medium, fontSize: 11, lineHeight: 17 },
  sourceMeta: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11 },
  sourceMetaWarning: { color: '#9a5b09', fontFamily: fonts.bold },
  sourceRow: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 13, padding: 15 },
  sourceRowPressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  sourceText: { flex: 1, gap: 5, minWidth: 0 },
  sourceTitle: { color: colors.ink, flex: 1, fontFamily: fonts.bold, fontSize: 15 },
  sourceTitleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  stepBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 },
  stepIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 11, height: 36, justifyContent: 'center', width: 36 },
  stepLabel: { color: colors.ink, fontFamily: fonts.bold, fontSize: 15 },
  stepNumber: { color: colors.slate, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 },
  subtitle: { color: colors.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, maxWidth: 720 },
  title: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 28, lineHeight: 36 },
  uploadMark: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, height: 64, justifyContent: 'center', width: 64 },
});
