import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile, Paths } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { BackupSummary } from '@/backup/format';
import { AppButton } from '@/components/AppButton';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/ScreenState';
import {
  createBarionBackup,
  getOfflineDataSummary,
  inspectBarionBackup,
  restoreBarionBackup,
  type OfflineDataSummary,
} from '@/storage/backup';
import { colors, fonts, radii } from '@/theme/colors';

type SelectedBackup = {
  filename: string;
  serialized: string;
  exportedAt: string;
  summary: BackupSummary;
};

export default function DataAndOfflineScreen() {
  const [summary, setSummary] = useState<OfflineDataSummary | null>(null);
  const [selected, setSelected] = useState<SelectedBackup | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'backup' | 'choose' | 'restore' | null>(null);

  const refresh = useCallback(async () => {
    setSummary(await getOfflineDataSummary());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function createBackup() {
    if (busy) return;
    setBusy('backup');
    try {
      const backup = await createBarionBackup();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([backup.serialized], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = backup.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        Alert.alert('Backup downloaded', describeBackup(backup.summary));
      } else {
        const file = new ExpoFile(Paths.cache, backup.filename);
        if (!file.exists) file.create();
        file.write(backup.serialized);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, {
            dialogTitle: 'Save Barion backup',
            mimeType: 'application/json',
            UTI: 'public.json',
          });
        } else {
          Alert.alert('Backup ready', `Saved to ${file.uri}`);
        }
      }
      await refresh();
    } catch (error) {
      Alert.alert('Backup did not finish', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function chooseBackup() {
    if (busy) return;
    setBusy('choose');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['application/json', 'text/json', 'text/plain'],
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      const serialized = asset.file ? await asset.file.text() : await new ExpoFile(asset.uri).text();
      const inspection = await inspectBarionBackup(serialized);
      setSelected({
        filename: asset.name,
        serialized,
        exportedAt: inspection.envelope.payload.exportedAt,
        summary: inspection.summary,
      });
    } catch (error) {
      setSelected(null);
      Alert.alert('Backup could not be opened', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function restoreBackup() {
    if (!selected || busy) return;
    setBusy('restore');
    try {
      const result = await restoreBarionBackup(selected.serialized);
      setConfirming(false);
      setSelected(null);
      await refresh();
      Alert.alert(
        'Backup merged safely',
        `${result.insertedCount.toLocaleString()} missing records were restored. ${result.skippedCount.toLocaleString()} records already on this device were left unchanged.`,
      );
    } catch (error) {
      setConfirming(false);
      Alert.alert('Restore did not finish', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  if (!summary) return <LoadingState label="Checking offline data" />;

  return (
    <AppShell active="more">
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name="shield-checkmark-outline" size={30} color={colors.blue} /></View>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>LOCAL-FIRST PROTECTION</Text>
            <Text style={styles.title}>Your learning stays on this device.</Text>
            <Text style={styles.body}>
              Barion works from its local library. Create a portable backup before changing devices or making large library changes.
            </Text>
          </View>
        </View>

        <View style={styles.stats}>
          <DataStat label="Classes" value={summary.courseCount} />
          <DataStat label="Decks" value={summary.deckCount} />
          <DataStat label="Cards" value={summary.cardCount} />
          <DataStat label="Reviews" value={summary.reviewCount} />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <View style={styles.sectionIcon}><Ionicons name="download-outline" size={22} color={colors.blueDark} /></View>
            <View style={styles.sectionCopy}>
              <Text style={styles.sectionTitle}>Full learning backup</Text>
              <Text style={styles.body}>
                Includes organization, cards, extracted source text, evidence, FSRS state, review history, test history, trash, and study preferences.
              </Text>
            </View>
          </View>
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={20} color={colors.tealDark} />
            <Text style={styles.noticeText}>
              Original PDF and document binaries stay private on their current device and are not embedded. Restored cards and source evidence remain fully studyable offline.
            </Text>
          </View>
          <View style={styles.actions}>
            <AppButton
              disabled={Boolean(busy)}
              icon="download-outline"
              label={busy === 'backup' ? 'Preparing backup…' : 'Create backup'}
              onPress={() => void createBackup()}
            />
            <AppButton
              disabled={Boolean(busy)}
              icon="folder-open-outline"
              label={busy === 'choose' ? 'Checking file…' : 'Choose backup to restore'}
              variant="secondary"
              onPress={() => void chooseBackup()}
            />
          </View>
          <Text style={styles.meta}>
            {summary.lastBackupAt ? `Last backup prepared ${formatDateTime(summary.lastBackupAt)}` : 'No backup has been prepared on this device yet.'}
          </Text>
        </View>

        {selected ? (
          <View style={[styles.section, styles.preview]}>
            <View style={styles.sectionHeading}>
              <View style={[styles.sectionIcon, styles.previewIcon]}><Ionicons name="checkmark-circle-outline" size={22} color={colors.green} /></View>
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>Backup verified</Text>
                <Text numberOfLines={1} style={styles.fileName}>{selected.filename}</Text>
                <Text style={styles.meta}>Created {formatDateTime(selected.exportedAt)}</Text>
              </View>
            </View>
            <View style={styles.previewStats}>
              <PreviewStat label="Classes" value={selected.summary.courseCount} />
              <PreviewStat label="Folders" value={selected.summary.folderCount} />
              <PreviewStat label="Decks" value={selected.summary.deckCount} />
              <PreviewStat label="Cards" value={selected.summary.cardCount} />
              <PreviewStat label="Reviews" value={selected.summary.reviewCount} />
            </View>
            <Text style={styles.body}>
              Merge restore never deletes this device’s library. Matching record IDs are kept; only missing data is added.
            </Text>
            <View style={styles.actions}>
              <AppButton label="Cancel" variant="quiet" onPress={() => setSelected(null)} />
              <AppButton icon="git-merge-outline" label="Review merge" onPress={() => setConfirming(true)} />
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <View style={styles.sectionIcon}><Ionicons name="cloud-offline-outline" size={22} color={colors.blueDark} /></View>
            <View style={styles.sectionCopy}>
              <Text style={styles.sectionTitle}>Cloud sync is not connected</Text>
              <Text style={styles.body}>
                Barion is fully local-first today. {summary.pendingSyncCount.toLocaleString()} local change{summary.pendingSyncCount === 1 ? ' is' : 's are'} recorded for a future account-sync service, but nothing is uploaded silently.
              </Text>
            </View>
          </View>
          <View style={styles.statusRow}>
            <StatusItem icon="phone-portrait-outline" label={`${summary.deviceFileCount} source files on device`} />
            <StatusItem icon="document-text-outline" label={`${summary.recoveredSourceCount} sources recovered from backup`} />
            <StatusItem icon="flask-outline" label={`${summary.testCount} test sessions preserved`} />
          </View>
          {summary.lastRestoreAt ? <Text style={styles.meta}>Last restore {formatDateTime(summary.lastRestoreAt)}</Text> : null}
        </View>
      </ScrollView>

      <Modal animationType="fade" onRequestClose={() => setConfirming(false)} transparent visible={confirming}>
        <View style={styles.backdrop}>
          <Pressable accessibilityLabel="Close restore confirmation" onPress={() => setConfirming(false)} style={StyleSheet.absoluteFill} />
          <View accessibilityRole="alert" style={styles.dialog}>
            <View style={styles.dialogIcon}><Ionicons name="git-merge-outline" size={25} color={colors.blue} /></View>
            <View style={styles.dialogCopy}>
              <Text style={styles.eyebrow}>SAFE MERGE RESTORE</Text>
              <Text style={styles.dialogTitle}>Add this backup to this device?</Text>
              <Text style={styles.body}>
                Existing cards and progress will not be overwritten. The merge is transactional, so a failed restore is rolled back instead of leaving half-restored data.
              </Text>
            </View>
            <View style={styles.actions}>
              <AppButton disabled={busy === 'restore'} label="Not now" variant="secondary" onPress={() => setConfirming(false)} />
              <AppButton
                disabled={busy === 'restore'}
                icon="git-merge-outline"
                label={busy === 'restore' ? 'Restoring…' : 'Merge backup'}
                onPress={() => void restoreBackup()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </AppShell>
  );
}

function DataStat({ label, value }: { label: string; value: number }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value.toLocaleString()}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function PreviewStat({ label, value }: { label: string; value: number }) {
  return <View style={styles.previewStat}><Text style={styles.previewValue}>{value.toLocaleString()}</Text><Text style={styles.previewLabel}>{label}</Text></View>;
}

function StatusItem({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return <View style={styles.statusItem}><Ionicons name={icon} size={18} color={colors.tealDark} /><Text style={styles.statusText}>{label}</Text></View>;
}

function describeBackup(summary: BackupSummary) {
  return `${summary.cardCount.toLocaleString()} cards and ${summary.reviewCount.toLocaleString()} review events are ready to save.`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Please try again.';
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' },
  backdrop: { alignItems: 'center', backgroundColor: 'rgba(15, 45, 96, 0.42)', flex: 1, justifyContent: 'center', padding: 18 },
  body: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21 },
  container: { gap: 18, marginHorizontal: 'auto', maxWidth: 920, padding: 18, paddingBottom: 48, width: '100%' },
  dialog: { backgroundColor: colors.surface, borderRadius: radii.lg, gap: 17, maxWidth: 520, padding: 22, width: '100%' },
  dialogCopy: { gap: 7 },
  dialogIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 16, height: 52, justifyContent: 'center', width: 52 },
  dialogTitle: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 22, lineHeight: 29 },
  eyebrow: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.25 },
  fileName: { color: colors.inkSoft, fontFamily: fonts.semibold, fontSize: 12 },
  hero: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.lg, flexDirection: 'row', gap: 16, padding: 21 },
  heroCopy: { flex: 1, gap: 7 },
  heroIcon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 18, height: 60, justifyContent: 'center', width: 60 },
  meta: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11, lineHeight: 17 },
  notice: { alignItems: 'flex-start', backgroundColor: colors.surfaceTeal, borderRadius: radii.sm, flexDirection: 'row', gap: 9, padding: 13 },
  noticeText: { color: colors.tealDark, flex: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 19 },
  preview: { borderColor: colors.teal, borderWidth: 1 },
  previewIcon: { backgroundColor: colors.surfaceTeal },
  previewLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: 10 },
  previewStat: { minWidth: 74 },
  previewStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  previewValue: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 17 },
  section: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 15, padding: 19 },
  sectionCopy: { flex: 1, gap: 5, minWidth: 210 },
  sectionHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  sectionIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 13, height: 46, justifyContent: 'center', width: 46 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 18, lineHeight: 24 },
  stat: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 1, minWidth: 120, padding: 15 },
  statLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statValue: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 22 },
  statusItem: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.sm, flexDirection: 'row', gap: 7, paddingHorizontal: 11, paddingVertical: 9 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusText: { color: colors.inkSoft, fontFamily: fonts.semibold, fontSize: 11 },
  title: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 25, lineHeight: 32 },
});
