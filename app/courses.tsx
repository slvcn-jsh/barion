import { Ionicons } from '@expo/vector-icons';
import { File as ExpoFile, Paths } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppShell } from '@/components/AppShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/ScreenState';
import type { CourseModuleSummary, CourseSummary, Dashboard, DeckSummary } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import {
  createCourse,
  createCourseModule,
  createDeck,
  exportCollectionCards,
  getCourses,
  getDashboard,
  removeCourse,
  removeCourseModule,
  setDeckInModule,
  updateCourseExamDate,
} from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

export default function CoursesScreen() {
  const [classes, setClasses] = useState<CourseSummary[] | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedModuleId, setSelectedModuleId] = useState('');
  const [classTitle, setClassTitle] = useState('');
  const [classExamDate, setClassExamDate] = useState('');
  const [folderTitle, setFolderTitle] = useState('');
  const [deckTitle, setDeckTitle] = useState('');
  const [deckDescription, setDeckDescription] = useState('');
  const [selectedExamDate, setSelectedExamDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPortableTools, setShowPortableTools] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    kind: 'class' | 'folder';
    id: string;
    classId?: string;
    title: string;
    folderCount: number;
    deckCount: number;
    cardCount: number;
  } | null>(null);

  const refresh = useCallback(async () => {
    await initializeDatabase();
    const [nextClasses, nextDashboard] = await Promise.all([getCourses(), getDashboard()]);
    setClasses(nextClasses);
    setDashboard(nextDashboard);
    setSelectedClassId((current) => {
      const nextClass = nextClasses.find((course) => course.id === current) ?? nextClasses[0] ?? null;
      setSelectedModuleId((currentModule) => {
        if (!nextClass) return '';
        return nextClass.modules.some((module) => module.id === currentModule)
          ? currentModule
          : nextClass.modules[0]?.id ?? '';
      });
      return nextClass?.id ?? '';
    });
    return nextClasses;
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const selectedClass = useMemo(
    () => classes?.find((course) => course.id === selectedClassId) ?? classes?.[0] ?? null,
    [classes, selectedClassId],
  );
  const selectedFolder = useMemo(
    () => selectedClass?.modules.find((module) => module.id === selectedModuleId) ?? selectedClass?.modules[0] ?? null,
    [selectedClass, selectedModuleId],
  );
  const decksById = useMemo(() => new Map((dashboard?.decks ?? []).map((deck) => [deck.id, deck])), [dashboard?.decks]);
  const folderDecks = useMemo(
    () => (selectedFolder?.deckIds.map((deckId) => decksById.get(deckId)).filter(Boolean) as DeckSummary[] | undefined) ?? [],
    [decksById, selectedFolder?.deckIds],
  );

  useEffect(() => {
    setSelectedExamDate(selectedClass?.examDate ?? '');
  }, [selectedClass?.examDate, selectedClass?.id]);

  async function addClass() {
    if (busy) return;
    setBusy(true);
    try {
      const classId = await createCourse(classTitle, classExamDate);
      setClassTitle('');
      setClassExamDate('');
      const nextClasses = await refresh();
      const createdClass = nextClasses.find((course) => course.id === classId);
      setSelectedClassId(classId);
      setSelectedModuleId(createdClass?.modules[0]?.id ?? '');
    } catch (error) {
      Alert.alert('Class was not created', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function addFolder() {
    if (!selectedClass || busy) return;
    setBusy(true);
    try {
      const folderId = await createCourseModule(selectedClass.id, folderTitle);
      setFolderTitle('');
      await refresh();
      setSelectedClassId(selectedClass.id);
      setSelectedModuleId(folderId);
    } catch (error) {
      Alert.alert('Folder was not created', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function addDeckToFolder() {
    if (!selectedFolder || busy) return;
    setBusy(true);
    try {
      await createDeck({ title: deckTitle, description: deckDescription, moduleId: selectedFolder.id });
      setDeckTitle('');
      setDeckDescription('');
      await refresh();
    } catch (error) {
      Alert.alert('Deck was not created', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleDeck(deckId: string) {
    if (!selectedFolder || busy) return;
    setBusy(true);
    try {
      await setDeckInModule(selectedFolder.id, deckId, !selectedFolder.deckIds.includes(deckId));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveExamDate() {
    if (!selectedClass || busy) return;
    setBusy(true);
    try {
      await updateCourseExamDate(selectedClass.id, selectedExamDate);
      await refresh();
    } catch (error) {
      Alert.alert('Exam date was not saved', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function exportCollection(scope: 'class' | 'folder', format: 'csv' | 'tsv') {
    const courseId = scope === 'class' ? selectedClass?.id : undefined;
    const moduleId = scope === 'folder' ? selectedFolder?.id : undefined;
    if ((!courseId && !moduleId) || busy) return;
    setBusy(true);
    try {
      const exported = await exportCollectionCards({ courseId, moduleId, format });
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([exported.content], { type: `${exported.mimeType};charset=utf-8` });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = exported.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        Alert.alert('Export ready', `${exported.cardCount} cards were prepared from this ${scope}.`);
      } else {
        const file = new ExpoFile(Paths.cache, exported.filename);
        if (!file.exists) file.create();
        file.write(exported.content);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, {
            mimeType: exported.mimeType,
            dialogTitle: `Export ${scope}`,
          });
        } else {
          Alert.alert('Export ready', `${exported.cardCount} cards were saved to ${file.uri}.`);
        }
      }
    } catch (error) {
      Alert.alert('Export did not finish', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function requestClassRemoval() {
    if (!selectedClass || busy) return;
    setConfirmation({
      kind: 'class',
      id: selectedClass.id,
      title: selectedClass.title,
      folderCount: selectedClass.moduleCount,
      deckCount: selectedClass.deckCount,
      cardCount: selectedClass.cardCount,
    });
  }

  function requestFolderRemoval() {
    if (!selectedClass || !selectedFolder || busy) return;
    setConfirmation({
      kind: 'folder',
      id: selectedFolder.id,
      classId: selectedClass.id,
      title: selectedFolder.title,
      folderCount: 1,
      deckCount: selectedFolder.deckCount,
      cardCount: selectedFolder.cardCount,
    });
  }

  async function confirmRemoval() {
    if (!confirmation || busy) return;
    setBusy(true);
    try {
      if (confirmation.kind === 'class') {
        await removeCourse(confirmation.id);
      } else {
        await removeCourseModule(confirmation.id);
      }
      const nextClasses = await refresh();
      const nextClass =
        confirmation.kind === 'folder'
          ? nextClasses.find((course) => course.id === confirmation.classId) ?? nextClasses[0] ?? null
          : nextClasses[0] ?? null;
      setSelectedClassId(nextClass?.id ?? '');
      setSelectedModuleId(nextClass?.modules[0]?.id ?? '');
      setConfirmation(null);
    } catch (error) {
      Alert.alert('Removal did not finish', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!classes || !dashboard) return <LoadingState label="Opening Classes & Folders" />;

  return (
    <AppShell active="library">
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="school" size={23} color={colors.surface} /></View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>CLASS - FOLDER - DECK</Text>
          <Text style={styles.title}>Class folders for real exam prep.</Text>
          <Text style={styles.heroBody}>Build subjects, modules, and combined reviewer decks without duplicating cards.</Text>
        </View>
      </View>

      <View style={styles.mapStrip}>
        <HierarchyStep active icon="school-outline" label="Class" value={selectedClass?.title ?? 'No class'} />
        <Ionicons name="chevron-forward" size={18} color={colors.slate} />
        <HierarchyStep active={Boolean(selectedFolder)} icon="folder-outline" label="Folder" value={selectedFolder?.title ?? 'Choose a folder'} />
        <Ionicons name="chevron-forward" size={18} color={colors.slate} />
        <HierarchyStep active={Boolean(folderDecks.length)} icon="albums-outline" label="Decks" value={`${folderDecks.length} selected`} />
      </View>

      <View style={styles.createClassPanel}>
        <View style={styles.panelCopy}>
          <Text style={styles.sectionTitle}>Create class</Text>
          <Text style={styles.body}>Use classes for a course, subject, semester, school year, or major exam block.</Text>
        </View>
        <View style={styles.formRow}>
          <TextInput accessibilityLabel="Class name" value={classTitle} onChangeText={setClassTitle} placeholder="Example: Second Year Medicine" placeholderTextColor={colors.slate} style={styles.input} />
          <TextInput accessibilityLabel="New class exam date" value={classExamDate} onChangeText={setClassExamDate} placeholder="Exam date YYYY-MM-DD" placeholderTextColor={colors.slate} style={styles.input} />
          <AppButton disabled={!classTitle.trim() || busy} icon="add" label="Create class" onPress={() => void addClass()} />
        </View>
      </View>

      <View style={styles.workspace}>
        <View style={styles.classRail}>
          <Text style={styles.sectionTitle}>Classes</Text>
          {classes.map((course) => (
            <Pressable
              accessibilityLabel={`Class ${course.title}, ${course.moduleCount} folders, ${course.deckCount} decks`}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedClass?.id === course.id }}
              key={course.id}
              onPress={() => {
                setSelectedClassId(course.id);
                setSelectedModuleId(course.modules[0]?.id ?? '');
              }}
              style={[styles.classCard, selectedClass?.id === course.id && styles.classCardActive]}
            >
              <View style={[styles.classIcon, { backgroundColor: course.color }]}>
                <Ionicons name="school-outline" size={19} color={colors.surface} />
              </View>
              <View style={styles.classCopy}>
                <Text style={styles.classTitle}>{course.title}</Text>
                <Text style={styles.meta}>{course.moduleCount} folders - {course.deckCount} decks - {course.cardCount} cards</Text>
                {course.examDate ? <Text style={styles.examDate}>Exam {course.examDate}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>

        <View style={styles.detailPane}>
          <View style={styles.classHeader}>
            <View style={styles.panelCopy}>
              <Text style={styles.eyebrowDark}>SELECTED CLASS</Text>
              <Text style={styles.detailTitle}>{selectedClass?.title ?? 'No class selected'}</Text>
              <Text style={styles.body}>Folders below can be subjects, modules, lessons, finals, midterms, or any reviewer bundle.</Text>
            </View>
            <View style={styles.classActions}>
              <TextInput accessibilityLabel="Selected class exam date" value={selectedExamDate} onChangeText={setSelectedExamDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.slate} style={styles.dateInput} />
              <AppButton disabled={!selectedClass || busy} label="Save date" variant="secondary" onPress={() => void saveExamDate()} />
              <AppButton disabled={!selectedClass || busy} icon="trash-outline" label="Remove class" variant="danger" onPress={requestClassRemoval} />
            </View>
          </View>

          <View style={styles.folderGrid}>
            {selectedClass?.modules.map((folder) => {
              const active = selectedFolder?.id === folder.id;
              return (
                <Pressable
                  accessibilityLabel={`Folder ${folder.title}, ${folder.deckCount} decks, ${folder.cardCount} cards`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  key={folder.id}
                  onPress={() => setSelectedModuleId(folder.id)}
                  style={[styles.folderCard, active && styles.folderCardActive]}
                >
                  <View style={styles.folderTopline}>
                    <Ionicons name={active ? 'folder-open' : 'folder-outline'} size={21} color={active ? colors.blue : colors.slate} />
                    {active ? <Ionicons name="checkmark-circle" size={18} color={colors.blue} /> : null}
                  </View>
                  <Text style={styles.folderTitle}>{folder.title}</Text>
                  <Text style={styles.meta}>{folder.deckCount} decks - {folder.cardCount} cards</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.createFolder}>
            <TextInput accessibilityLabel="Folder name" value={folderTitle} onChangeText={setFolderTitle} placeholder="New folder: Cardiology, Midterms, Finals..." placeholderTextColor={colors.slate} style={styles.input} />
            <AppButton disabled={!selectedClass || !folderTitle.trim() || busy} icon="folder-outline" label="Create folder" variant="secondary" onPress={() => void addFolder()} />
          </View>
        </View>
      </View>

      <View style={styles.folderWorkspace}>
        <View style={styles.folderHeader}>
          <View style={styles.panelCopy}>
            <Text style={styles.eyebrowDark}>SELECTED FOLDER</Text>
            <Text style={styles.detailTitle}>{selectedFolder?.title ?? 'Choose a folder'}</Text>
            <Text style={styles.body}>Review or test this folder as one combined set without copying cards.</Text>
          </View>
          <View style={styles.moduleActions}>
            <AppButton
              disabled={!selectedFolder?.deckCount}
              icon="play"
              label="Study folder"
              onPress={() => selectedFolder && router.push({ pathname: '/modes', params: { moduleId: selectedFolder.id } })}
            />
            <AppButton
              disabled={!selectedFolder?.deckCount}
              icon="school-outline"
              label="Test folder"
              variant="secondary"
              onPress={() => selectedFolder && router.push({ pathname: '/test', params: { moduleId: selectedFolder.id } })}
            />
            <AppButton
              disabled={!selectedFolder || busy}
              icon="remove-circle-outline"
              label="Remove folder"
              variant="danger"
              onPress={requestFolderRemoval}
            />
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showPortableTools }}
          onPress={() => setShowPortableTools((value) => !value)}
          style={({ pressed }) => [styles.portableToggle, pressed && styles.pressed]}
        >
          <View style={styles.panelCopy}>
            <Text style={styles.sectionTitle}>Offline copies & exports</Text>
            <Text style={styles.body}>Optional Builder tools for moving a class or combined folder into another study app.</Text>
          </View>
          <Ionicons name={showPortableTools ? 'chevron-up' : 'chevron-down'} size={20} color={colors.blueDark} />
        </Pressable>
        {showPortableTools ? (
          <View style={styles.portablePanel}>
            <Text style={styles.body}>CSV and TSV contain card content only. Use Barion Backup when you need source evidence, scheduling, and review history.</Text>
            <View style={styles.moduleActions}>
              <AppButton disabled={!selectedClass?.cardCount || busy} icon="download-outline" label="Class CSV" variant="secondary" onPress={() => void exportCollection('class', 'csv')} />
              <AppButton disabled={!selectedClass?.cardCount || busy} icon="download-outline" label="Class TSV" variant="secondary" onPress={() => void exportCollection('class', 'tsv')} />
              <AppButton disabled={!selectedFolder?.cardCount || busy} icon="download-outline" label="Folder CSV" variant="secondary" onPress={() => void exportCollection('folder', 'csv')} />
              <AppButton disabled={!selectedFolder?.cardCount || busy} icon="download-outline" label="Folder TSV" variant="secondary" onPress={() => void exportCollection('folder', 'tsv')} />
            </View>
          </View>
        ) : null}

        <View style={styles.createDeckPanel}>
          <View style={styles.panelCopy}>
            <Text style={styles.sectionTitle}>Create deck in this folder</Text>
            <Text style={styles.body}>Use decks for lessons, chapters, exam reviewers, or imported source sets.</Text>
          </View>
          <View style={styles.formRow}>
            <TextInput accessibilityLabel="Deck title" value={deckTitle} onChangeText={setDeckTitle} placeholder="Example: Final exam reviewer" placeholderTextColor={colors.slate} style={styles.input} />
            <TextInput accessibilityLabel="Deck description" value={deckDescription} onChangeText={setDeckDescription} placeholder="Optional focus" placeholderTextColor={colors.slate} style={styles.input} />
            <AppButton disabled={!selectedFolder || !deckTitle.trim() || busy} icon="albums-outline" label="Create deck" onPress={() => void addDeckToFolder()} />
          </View>
        </View>

        <View style={styles.deckSection}>
          <View style={styles.sectionHeading}>
            <View>
              <Text style={styles.sectionTitle}>Decks in folder</Text>
              <Text style={styles.body}>{folderDecks.length ? 'These decks study together when you review or test this folder.' : 'No decks are inside this folder yet.'}</Text>
            </View>
            <Text style={styles.countBadge}>{folderDecks.length}</Text>
          </View>
          {folderDecks.map((deck) => (
            <DeckRow
              deck={deck}
              key={deck.id}
              selected
              disabled={busy}
              onOpen={() => router.push({ pathname: '/deck/[id]', params: { id: deck.id } })}
              onToggle={() => void toggleDeck(deck.id)}
            />
          ))}
        </View>

        <View style={styles.deckSection}>
          <View style={styles.sectionHeading}>
            <View>
              <Text style={styles.sectionTitle}>Add existing decks</Text>
              <Text style={styles.body}>A deck can be placed in multiple folders without duplicating cards or review history.</Text>
            </View>
            <Text style={styles.countBadge}>{dashboard.decks.length}</Text>
          </View>
          <View style={styles.deckGrid}>
            {dashboard.decks.map((deck) => (
              <DeckRow
                compact
                deck={deck}
                key={deck.id}
                selected={Boolean(selectedFolder?.deckIds.includes(deck.id))}
                disabled={!selectedFolder || busy}
                onOpen={() => router.push({ pathname: '/deck/[id]', params: { id: deck.id } })}
                onToggle={() => void toggleDeck(deck.id)}
              />
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
    <ConfirmDialog
      body={
        confirmation?.kind === 'class'
          ? `${confirmation.deckCount} deck placement${confirmation.deckCount === 1 ? '' : 's'} across ${confirmation.folderCount} folder${confirmation.folderCount === 1 ? '' : 's'} will be removed. The decks, cards, and review history stay in your library.`
          : `${confirmation?.deckCount ?? 0} deck placement${confirmation?.deckCount === 1 ? '' : 's'} will be removed from this folder. The decks, cards, and review history stay in your library.`
      }
      busy={busy}
      busyLabel="Removing"
      confirmIcon="remove-circle-outline"
      confirmLabel={confirmation?.kind === 'class' ? 'Remove class' : 'Remove folder'}
      eyebrow="REMOVE CONTAINER"
      icon="remove-circle-outline"
      title={confirmation?.kind === 'class' ? `Remove ${confirmation.title}?` : `Remove ${confirmation?.title ?? 'this folder'}?`}
      visible={confirmation !== null}
      onCancel={() => setConfirmation(null)}
      onConfirm={() => void confirmRemoval()}
    />
    </AppShell>
  );
}

function HierarchyStep({
  active,
  icon,
  label,
  value,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={[styles.hierarchyStep, active && styles.hierarchyStepActive]}>
      <Ionicons name={icon} size={18} color={active ? colors.blue : colors.slate} />
      <View>
        <Text style={styles.hierarchyLabel}>{label}</Text>
        <Text numberOfLines={1} style={styles.hierarchyValue}>{value}</Text>
      </View>
    </View>
  );
}

function DeckRow({
  compact = false,
  deck,
  disabled = false,
  selected,
  onOpen,
  onToggle,
}: {
  compact?: boolean;
  deck: DeckSummary;
  disabled?: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  return (
    <View style={[styles.deckRow, compact && styles.deckRowCompact, selected && styles.deckRowSelected]}>
      <Pressable accessibilityLabel={`Open deck ${deck.title}`} accessibilityRole="button" onPress={onOpen} style={styles.deckOpenArea}>
        <View style={[styles.deckIcon, { backgroundColor: deck.color || colors.blue }]}>
          <Ionicons name={deck.icon as keyof typeof Ionicons.glyphMap} size={19} color={colors.surface} />
        </View>
        <View style={styles.deckCopy}>
          <Text numberOfLines={1} style={styles.deckTitle}>{deck.title}</Text>
          <Text style={styles.meta}>{deck.cardCount} cards - {deck.dueCount} due - {deck.evidenceCount} source links</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${deck.title} ${selected ? 'from' : 'to'} folder`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        disabled={disabled}
        onPress={onToggle}
        style={[styles.deckToggle, selected && styles.deckToggleSelected, disabled && styles.deckToggleDisabled]}
      >
        <Ionicons name={selected ? 'checkmark' : 'add'} size={18} color={selected ? colors.surface : colors.blueDark} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  classActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  classCard: { alignItems: 'center', backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 12 },
  classCardActive: { backgroundColor: colors.surfaceMuted, borderColor: colors.blue, borderWidth: 2 },
  classCopy: { flex: 1, gap: 3, minWidth: 0 },
  classHeader: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  classIcon: { alignItems: 'center', borderRadius: 12, height: 42, justifyContent: 'center', width: 42 },
  classRail: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, flex: 0.86, gap: 10, minWidth: 270, padding: 15 },
  classTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  container: { gap: 18, marginHorizontal: 'auto', maxWidth: 1180, padding: 18, paddingBottom: 48, width: '100%' },
  countBadge: { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, color: colors.blueDark, fontFamily: fonts.bold, minWidth: 32, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6, textAlign: 'center' },
  createClassPanel: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 12, padding: 18 },
  createDeckPanel: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, gap: 11, padding: 14 },
  createFolder: { alignItems: 'center', backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 9, padding: 12 },
  dateInput: { backgroundColor: colors.canvas, borderColor: colors.lineStrong, borderRadius: radii.sm, borderWidth: 1, color: colors.ink, fontFamily: fonts.medium, fontSize: 14, minHeight: 48, minWidth: 165, paddingHorizontal: 13 },
  deckCopy: { flex: 1, gap: 3, minWidth: 0 },
  deckGrid: { gap: 8 },
  deckIcon: { alignItems: 'center', borderRadius: 12, height: 42, justifyContent: 'center', width: 42 },
  deckOpenArea: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 10, minWidth: 0 },
  deckRow: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 9, padding: 11 },
  deckRowCompact: { flex: 1, minWidth: 260 },
  deckRowSelected: { borderColor: colors.blue },
  deckSection: { gap: 9 },
  deckTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 14 },
  deckToggle: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 11, height: 40, justifyContent: 'center', width: 40 },
  deckToggleDisabled: { opacity: 0.45 },
  deckToggleSelected: { backgroundColor: colors.blue },
  detailPane: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, flex: 1.45, gap: 14, minWidth: 320, padding: 16 },
  detailTitle: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 22, lineHeight: 29 },
  examDate: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 10 },
  eyebrow: { color: '#c8dbf7', fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2 },
  eyebrowDark: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  folderCard: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 1, gap: 7, minWidth: 155, padding: 12 },
  folderCardActive: { backgroundColor: colors.surfaceMuted, borderColor: colors.blue, borderWidth: 2 },
  folderGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  folderHeader: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  folderTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 14 },
  folderTopline: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  folderWorkspace: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 16, padding: 18 },
  formRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  hero: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radii.lg, flexDirection: 'row', flexWrap: 'wrap', gap: 14, padding: 18 },
  heroBody: { color: '#d8e5f7', fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  heroCopy: { flex: 1, gap: 6, minWidth: 230 },
  heroIcon: { alignItems: 'center', backgroundColor: colors.blue, borderRadius: 14, height: 48, justifyContent: 'center', width: 48 },
  hierarchyLabel: { color: colors.muted, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase' },
  hierarchyStep: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 9, minHeight: 58, minWidth: 165, padding: 11 },
  hierarchyStepActive: { backgroundColor: colors.surfaceMuted, borderColor: colors.blue },
  hierarchyValue: { color: colors.ink, fontFamily: fonts.bold, fontSize: 13, maxWidth: 190 },
  input: { backgroundColor: colors.canvas, borderColor: colors.lineStrong, borderRadius: radii.sm, borderWidth: 1, color: colors.ink, flex: 1, fontFamily: fonts.medium, fontSize: 14, minHeight: 48, minWidth: 210, paddingHorizontal: 13 },
  mapStrip: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  meta: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11, lineHeight: 17 },
  moduleActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  panelCopy: { flex: 1, gap: 4, minWidth: 220 },
  portablePanel: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, gap: 10, padding: 14 },
  portableToggle: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 },
  pressed: { opacity: 0.78 },
  sectionHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 18, lineHeight: 24 },
  title: { color: colors.surface, fontFamily: fonts.extraBold, fontSize: 23, lineHeight: 29 },
  workspace: { alignItems: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
});
