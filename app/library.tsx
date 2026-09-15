import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { LoadingState } from '@/components/ScreenState';
import type { ArchivedItem, StudyCard, TrashItem } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import {
  getArchivedItems,
  getLeechCards,
  getTrashItems,
  restoreArchivedItem,
  restoreTrashItem,
  setCardsSuspended,
} from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

export default function ManageLibraryScreen() {
  const [archived, setArchived] = useState<ArchivedItem[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [leeches, setLeeches] = useState<StudyCard[]>([]);
  const [actionId, setActionId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await initializeDatabase();
    const [nextArchived, nextTrash, nextLeeches] = await Promise.all([getArchivedItems(), getTrashItems(), getLeechCards()]);
    setArchived(nextArchived);
    setTrash(nextTrash);
    setLeeches(nextLeeches);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void refresh();
    }, [refresh]),
  );

  async function runAction(id: string, action: () => Promise<unknown>) {
    setActionId(id);
    try {
      await action();
      await refresh();
    } finally {
      setActionId(null);
    }
  }

  if (loading) return <LoadingState label="Opening library controls" />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="library-outline" size={27} color={colors.blue} />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>SAFE LIBRARY CONTROL</Text>
          <Text style={styles.title}>Archive, clean up, and recover.</Text>
          <Text style={styles.body}>
            Removed study material stays recoverable. Review history is preserved unless you explicitly purge data in a future advanced setting.
          </Text>
        </View>
        <AppButton icon="documents-outline" label="Source library" variant="secondary" onPress={() => router.push('/sources')} />
      </View>

      <LibrarySection
        body="Cards with eight or more lapses are flagged for a Builder rewrite. Pausing one protects the learner while its wording or source is checked."
        count={leeches.length}
        icon="warning-outline"
        title="Needs rewrite"
      >
        {!leeches.length ? <EmptyRow body="No persistent leeches detected." /> : null}
        {leeches.map((card) => (
          <View key={card.id} style={styles.row}>
            <View style={[styles.rowIcon, styles.warningIcon]}><Ionicons name="warning-outline" size={21} color={colors.gold} /></View>
            <View style={styles.rowCopy}>
              <Text numberOfLines={2} style={styles.rowTitle}>{card.prompt}</Text>
              <Text style={styles.meta}>{card.deckTitle} · {card.lapseCount ?? 0} lapses</Text>
            </View>
            <AppButton icon="open-outline" label="Open set" variant="secondary" onPress={() => router.push({ pathname: '/deck/[id]', params: { id: card.deckId } })} />
            <AppButton disabled={Boolean(card.isSuspended) || actionId === card.id} label={card.isSuspended ? 'Paused' : 'Pause card'} variant="quiet" onPress={() => void runAction(card.id, () => setCardsSuspended([card.id], true))} />
          </View>
        ))}
      </LibrarySection>

      <LibrarySection
        body="Archived sets are paused and excluded from search, dashboard totals, and study queues."
        count={archived.length}
        icon="archive-outline"
        title="Archived"
      >
        {!archived.length ? <EmptyRow body="No paused study sets." /> : null}
        {archived.map((item) => (
          <View key={`${item.entityType}-${item.entityId}`} style={styles.row}>
            <View style={styles.rowIcon}><Ionicons name="archive-outline" size={21} color={colors.blue} /></View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.meta}>{item.itemCount} cards · archived {formatDate(item.archivedAt)}</Text>
            </View>
            <AppButton
              disabled={actionId === item.entityId}
              icon="return-up-back-outline"
              label={actionId === item.entityId ? 'Restoring…' : 'Restore'}
              variant="secondary"
              onPress={() => void runAction(item.entityId, () => restoreArchivedItem(item.entityType, item.entityId))}
            />
          </View>
        ))}
      </LibrarySection>

      <LibrarySection
        body="Trash hides items without erasing cards, evidence, or FSRS review history."
        count={trash.length}
        icon="trash-outline"
        title="Recently removed"
      >
        {!trash.length ? <EmptyRow body="Trash is empty." /> : null}
        {trash.map((item) => (
          <View key={item.id} style={styles.row}>
            <View style={[styles.rowIcon, styles.trashIcon]}><Ionicons name="trash-outline" size={21} color={colors.red} /></View>
            <View style={styles.rowCopy}>
              <Text numberOfLines={2} style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.meta}>
                {item.itemCount} item{item.itemCount === 1 ? '' : 's'} · removed {formatDate(item.deletedAt)}
              </Text>
              {item.reviewedCardCount ? (
                <Text style={styles.historyNote}>{item.reviewedCardCount} reviewed card{item.reviewedCardCount === 1 ? '' : 's'} preserved</Text>
              ) : null}
            </View>
            <AppButton
              disabled={actionId === item.id}
              icon="refresh-outline"
              label={actionId === item.id ? 'Restoring…' : 'Restore'}
              variant="secondary"
              onPress={() => void runAction(item.id, () => restoreTrashItem(item.id))}
            />
          </View>
        ))}
      </LibrarySection>
    </ScrollView>
  );
}

function LibrarySection({ body, children, count, icon, title }: {
  body: string;
  children: React.ReactNode;
  count: number;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <View style={styles.sectionTitleRow}>
          <Ionicons name={icon} size={20} color={colors.blueDark} />
          <View style={styles.sectionCopy}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
          </View>
        </View>
        <Text style={styles.count}>{count}</Text>
      </View>
      {children}
    </View>
  );
}

function EmptyRow({ body }: { body: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name="checkmark-circle-outline" size={22} color={colors.tealDark} />
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  body: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19 },
  container: { gap: 20, marginHorizontal: 'auto', maxWidth: 980, padding: 18, paddingBottom: 48, width: '100%' },
  count: { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, color: colors.blueDark, fontFamily: fonts.bold, minWidth: 34, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6, textAlign: 'center' },
  empty: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: 9, padding: 17 },
  eyebrow: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.25 },
  hero: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.lg, flexDirection: 'row', flexWrap: 'wrap', gap: 15, padding: 20 },
  heroCopy: { flex: 1, gap: 6, minWidth: 220 },
  heroIcon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 16, height: 54, justifyContent: 'center', width: 54 },
  historyNote: { color: colors.tealDark, fontFamily: fonts.semibold, fontSize: 11 },
  meta: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11, lineHeight: 17 },
  row: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 14 },
  rowCopy: { flex: 1, gap: 4, minWidth: 190 },
  rowIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 12, height: 44, justifyContent: 'center', width: 44 },
  rowTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 },
  section: { gap: 10 },
  sectionCopy: { flex: 1, gap: 3 },
  sectionHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 19 },
  sectionTitleRow: { alignItems: 'flex-start', flex: 1, flexDirection: 'row', gap: 9 },
  title: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 25, lineHeight: 32 },
  trashIcon: { backgroundColor: colors.dangerSurface },
  warningIcon: { backgroundColor: colors.warningSurface },
});
