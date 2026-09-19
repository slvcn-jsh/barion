import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { colors, fonts, radii } from '@/theme/colors';

type ToolItem = {
  body: string;
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
};

const studyTools: ToolItem[] = [
  {
    body: 'Plan review blocks around due cards, quick-spacing cards, and exams.',
    href: '/calendar',
    icon: 'calendar-outline' as const,
    label: 'Review calendar',
  },
  {
    body: 'Build a configurable assessment from a deck, folder, or weak concepts.',
    href: '/test',
    icon: 'school-outline' as const,
    label: 'Test mode',
  },
  {
    body: 'Match compact term-answer pairs without changing long-term scheduling.',
    href: '/match',
    icon: 'grid-outline' as const,
    label: 'Match practice',
  },
  {
    body: 'Tune session length, reminders, difficulty, and feedback timing.',
    href: '/profile',
    icon: 'options-outline' as const,
    label: 'Study preferences',
  },
];

const libraryTools: ToolItem[] = [
  {
    body: 'Check paused cards, recover removed items, and inspect weak material.',
    href: '/library',
    icon: 'shield-checkmark-outline' as const,
    label: 'Source checks and trash',
  },
  {
    body: 'Create backups, restore safely, and see local/offline storage status.',
    href: '/data',
    icon: 'cloud-offline-outline' as const,
    label: 'Data and backup',
  },
  {
    body: 'Open the source-first import workspace for PDFs, notes, and text.',
    href: '/sources',
    icon: 'document-text-outline' as const,
    label: 'Source library',
  },
  {
    body: 'Organize courses, subjects, modules, folders, and exam decks.',
    href: '/classes',
    icon: 'library-outline' as const,
    label: 'Classes and folders',
  },
];

export default function MoreScreen() {
  return (
    <AppShell active="more">
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="ellipsis-horizontal-circle" size={30} color={colors.blue} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>ADVANCED WHEN NEEDED</Text>
            <Text style={styles.title}>More tools, without crowding Today.</Text>
            <Text style={styles.body}>
              These features stay available for deeper study, cleanup, and backup, but they no longer compete with the next learning action.
            </Text>
          </View>
        </View>

        <ToolSection title="Study tools" items={studyTools} />
        <ToolSection title="Library controls" items={libraryTools} />
      </ScrollView>
    </AppShell>
  );
}

function ToolSection({
  items,
  title,
}: {
  items: ToolItem[];
  title: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.toolGrid}>
        {items.map((item) => (
          <Pressable
            accessibilityRole="button"
            key={item.href}
            onPress={() => router.push(item.href)}
            style={({ pressed }) => [styles.toolCard, pressed && styles.pressed]}
          >
            <View style={styles.toolIcon}>
              <Ionicons name={item.icon} size={22} color={colors.blueDark} />
            </View>
            <View style={styles.toolCopy}>
              <Text style={styles.toolTitle}>{item.label}</Text>
              <Text style={styles.toolBody}>{item.body}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.slate} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21 },
  container: { gap: 18, marginHorizontal: 'auto', maxWidth: 980, padding: 18, paddingBottom: 48, width: '100%' },
  eyebrow: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2 },
  hero: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.lg, flexDirection: 'row', gap: 16, padding: 21 },
  heroCopy: { flex: 1, gap: 6, minWidth: 220 },
  heroIcon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 18, height: 60, justifyContent: 'center', width: 60 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  section: { gap: 11 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 19 },
  title: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 25, lineHeight: 32 },
  toolBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  toolCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 86,
    minWidth: 250,
    padding: 14,
  },
  toolCopy: { flex: 1, gap: 3, minWidth: 0 },
  toolGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  toolIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 13, height: 46, justifyContent: 'center', width: 46 },
  toolTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 14 },
});
