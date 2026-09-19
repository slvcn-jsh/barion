import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/ScreenState';
import type { ReviewCalendarDay } from '@/domain/types';
import {
  createStudyBlock,
  deleteStudyBlock,
  getReviewCalendar,
  setStudyBlockCompleted,
} from '@/calendar/repository';
import { initializeDatabase } from '@/storage/database';
import { colors, fonts, radii } from '@/theme/colors';

export default function ReviewCalendarScreen() {
  const [days, setDays] = useState<ReviewCalendarDay[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await initializeDatabase();
    setDays(await getReviewCalendar(14));
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function plan(day: ReviewCalendarDay) {
    setBusyId(day.date);
    try {
      await createStudyBlock(day.date, day.isToday ? 'Today’s Barion plan' : 'Barion review block', 20);
      await refresh();
    } catch (error) {
      Alert.alert('Study block was not created', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleBlock(blockId: string, completed: boolean) {
    setBusyId(blockId);
    await setStudyBlockCompleted(blockId, completed);
    await refresh();
    setBusyId(null);
  }

  async function removeBlock(blockId: string) {
    setBusyId(blockId);
    await deleteStudyBlock(blockId);
    await refresh();
    setBusyId(null);
  }

  if (!days) return <LoadingState label="Building review calendar" />;

  const dueToday = days[0]?.dueCount ?? 0;
  const shortToday = days[0]?.shortTermCount ?? 0;

  return (
    <AppShell active="more">
      <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="calendar" size={25} color={colors.surface} /></View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>NEXT 14 DAYS</Text>
          <Text style={styles.title}>Your reviews, without calendar math.</Text>
          <Text style={styles.heroBody}>Overdue cards roll into today. Quick-spacing practice stays visibly separate from durable FSRS review.</Text>
        </View>
      </View>

      <View style={styles.todayCard}>
        <View style={styles.todayCopy}>
          <Text style={styles.todayLabel}>TODAY</Text>
          <Text style={styles.todayTitle}>{dueToday + shortToday ? `${dueToday + shortToday} retrievals ready` : 'You are caught up'}</Text>
          <Text style={styles.body}>{dueToday} long-term · {shortToday} short-term</Text>
        </View>
        <AppButton disabled={!dueToday} icon="play" label={dueToday ? 'Start today’s plan' : 'Plan complete'} onPress={() => router.push({ pathname: '/study', params: { mode: 'autopilot' } })} />
      </View>

      <View style={styles.dayList}>
        {days.map((day) => (
          <View key={day.date} style={[styles.dayCard, day.isToday && styles.dayCardToday]}>
            <View style={styles.dayHeader}>
              <View><Text style={styles.dayLabel}>{day.label}</Text><Text style={styles.date}>{day.date}</Text></View>
              <View style={styles.counts}>
                <CountPill label={`${day.dueCount} FSRS`} active={day.dueCount > 0} />
                <CountPill label={`${day.shortTermCount} quick`} active={day.shortTermCount > 0} />
              </View>
            </View>

            {day.exams.map((exam) => (
              <View key={exam.courseId} style={styles.examRow}><Ionicons name="school-outline" size={17} color="#9a5b09" /><Text style={styles.examText}>{exam.title} exam</Text></View>
            ))}

            {day.blocks.map((block) => (
              <View key={block.id} style={styles.blockRow}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: block.status === 'completed' }} disabled={busyId === block.id} onPress={() => void toggleBlock(block.id, block.status !== 'completed')} style={[styles.checkbox, block.status === 'completed' && styles.checkboxDone]}>
                  {block.status === 'completed' ? <Ionicons name="checkmark" size={15} color={colors.surface} /> : null}
                </Pressable>
                <View style={styles.blockCopy}><Text style={[styles.blockTitle, block.status === 'completed' && styles.blockTitleDone]}>{block.title}</Text><Text style={styles.body}>{block.durationMinutes} minutes · local plan</Text></View>
                <Pressable accessibilityLabel={`Remove ${block.title}`} accessibilityRole="button" disabled={busyId === block.id} hitSlop={8} onPress={() => void removeBlock(block.id)}><Ionicons name="close" size={20} color={colors.muted} /></Pressable>
              </View>
            ))}

            {!day.blocks.length ? <AppButton disabled={busyId === day.date} icon="add" label={busyId === day.date ? 'Planning…' : 'Plan 20 minutes'} variant="quiet" onPress={() => void plan(day)} /> : null}
          </View>
        ))}
      </View>

      <View style={styles.note}><Ionicons name="phone-portrait-outline" size={19} color={colors.tealDark} /><Text style={styles.noteText}>This calendar is fully local and works offline. System-calendar export remains optional so Barion never asks for calendar permission just to study.</Text></View>
      </ScrollView>
    </AppShell>
  );
}

function CountPill({ label, active }: { label: string; active: boolean }) {
  return <Text style={[styles.countPill, active && styles.countPillActive]}>{label}</Text>;
}

const styles = StyleSheet.create({
  blockCopy: { flex: 1, gap: 2 },
  blockRow: { alignItems: 'center', backgroundColor: colors.canvas, borderRadius: radii.sm, flexDirection: 'row', gap: 10, padding: 11 },
  blockTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 13 },
  blockTitleDone: { color: colors.muted, textDecorationLine: 'line-through' },
  body: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  checkbox: { alignItems: 'center', borderColor: colors.lineStrong, borderRadius: 7, borderWidth: 2, height: 26, justifyContent: 'center', width: 26 },
  checkboxDone: { backgroundColor: colors.green, borderColor: colors.green },
  container: { gap: 16, marginHorizontal: 'auto', maxWidth: 900, padding: 18, paddingBottom: 44, width: '100%' },
  countPill: { backgroundColor: colors.canvas, borderRadius: radii.pill, color: colors.muted, fontFamily: fonts.bold, fontSize: 9, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 },
  countPillActive: { backgroundColor: colors.surfaceMuted, color: colors.blueDark },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  date: { color: colors.muted, fontFamily: fonts.medium, fontSize: 10 },
  dayCard: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, gap: 10, padding: 15 },
  dayCardToday: { borderColor: colors.blue, borderWidth: 2 },
  dayHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  dayLabel: { color: colors.ink, fontFamily: fonts.bold, fontSize: 15 },
  dayList: { gap: 9 },
  examRow: { alignItems: 'center', backgroundColor: colors.warningSurface, borderRadius: radii.sm, flexDirection: 'row', gap: 8, padding: 10 },
  examText: { color: '#9a5b09', flex: 1, fontFamily: fonts.bold, fontSize: 12 },
  eyebrow: { color: '#c8dbf7', fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  hero: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radii.lg, flexDirection: 'row', gap: 15, padding: 22 },
  heroBody: { color: '#d8e5f7', fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  heroCopy: { flex: 1, gap: 6 },
  heroIcon: { alignItems: 'center', backgroundColor: colors.blue, borderRadius: 16, height: 54, justifyContent: 'center', width: 54 },
  note: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: radii.md, flexDirection: 'row', gap: 10, padding: 14 },
  noteText: { color: colors.tealDark, flex: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 },
  title: { color: colors.surface, fontFamily: fonts.extraBold, fontSize: 24, lineHeight: 31 },
  todayCard: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderColor: colors.blue, borderRadius: radii.lg, borderWidth: 2, flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', padding: 18 },
  todayCopy: { flex: 1, gap: 3, minWidth: 220 },
  todayLabel: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1 },
  todayTitle: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 20 },
});
