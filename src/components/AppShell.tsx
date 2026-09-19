import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/BrandMark';
import { colors, fonts, radii } from '@/theme/colors';

export type AppDestination = 'today' | 'add' | 'library' | 'study' | 'more';

const destinations: {
  key: AppDestination;
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  label: string;
  helper: string;
}[] = [
  {
    key: 'today',
    href: '/',
    icon: 'today-outline',
    activeIcon: 'today',
    label: 'Today',
    helper: 'Your next action',
  },
  {
    key: 'add',
    href: '/sources',
    icon: 'add-circle-outline',
    activeIcon: 'add-circle',
    label: 'Add',
    helper: 'Import material',
  },
  {
    key: 'library',
    href: '/classes',
    icon: 'library-outline',
    activeIcon: 'library',
    label: 'Library',
    helper: 'Classes and decks',
  },
  {
    key: 'study',
    href: '/modes',
    icon: 'school-outline',
    activeIcon: 'school',
    label: 'Study',
    helper: 'Review and test',
  },
  {
    key: 'more',
    href: '/more',
    icon: 'ellipsis-horizontal-circle-outline',
    activeIcon: 'ellipsis-horizontal-circle',
    label: 'More',
    helper: 'Settings and tools',
  },
];

export function AppShell({
  active,
  children,
}: PropsWithChildren<{
  active: AppDestination;
}>) {
  const { width } = useWindowDimensions();
  const useSidebar = width >= 768;
  const activeDestination = destinations.find((item) => item.key === active) ?? destinations[0];

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safeArea}>
      <View style={[styles.shell, useSidebar && styles.shellWide]}>
        {useSidebar ? <Sidebar active={active} /> : <MobileTopBar destination={activeDestination} />}
        <View style={styles.content}>{children}</View>
        {!useSidebar ? <BottomNav active={active} /> : null}
      </View>
    </SafeAreaView>
  );
}

function Sidebar({ active }: { active: AppDestination }) {
  return (
    <View style={styles.sidebar}>
      <View style={styles.brandBlock}>
        <BrandMark size={42} showTagline />
      </View>
      <View style={styles.sideNav}>
        {destinations.map((item) => (
          <NavButton active={active === item.key} item={item} key={item.key} variant="sidebar" />
        ))}
      </View>
      <View style={styles.sidebarNote}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.tealDark} />
        <View style={styles.sidebarNoteCopy}>
          <Text style={styles.sidebarNoteTitle}>Clean study view</Text>
          <Text style={styles.sidebarNoteText}>Source checks stay behind the scenes until a card needs attention.</Text>
        </View>
      </View>
    </View>
  );
}

function MobileTopBar({
  destination,
}: {
  destination: (typeof destinations)[number];
}) {
  return (
    <View style={styles.mobileTopBar}>
      <View style={styles.mobileBrand}>
        <BrandMark size={34} />
        <View>
          <Text style={styles.mobileTitle}>Barion</Text>
          <Text style={styles.mobileSubtitle}>{destination.helper}</Text>
        </View>
      </View>
      <View style={styles.mobilePill}>
        <Ionicons name={destination.activeIcon} size={14} color={colors.blueDark} />
        <Text style={styles.mobilePillText}>{destination.label}</Text>
      </View>
    </View>
  );
}

function BottomNav({ active }: { active: AppDestination }) {
  return (
    <View style={styles.bottomNav}>
      {destinations.map((item) => (
        <NavButton active={active === item.key} item={item} key={item.key} variant="bottom" />
      ))}
    </View>
  );
}

function NavButton({
  active,
  item,
  variant,
}: {
  active: boolean;
  item: (typeof destinations)[number];
  variant: 'bottom' | 'sidebar';
}) {
  const icon = active ? item.activeIcon : item.icon;
  const navigate = () => {
    if (!active) router.replace(item.href);
  };

  if (variant === 'bottom') {
    return (
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        onPress={navigate}
        style={({ pressed }) => [styles.bottomItem, active && styles.bottomItemActive, pressed && styles.pressed]}
      >
        <Ionicons name={icon} size={22} color={active ? colors.blueDark : colors.muted} />
        <Text style={[styles.bottomLabel, active && styles.bottomLabelActive]}>{item.label}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={navigate}
      style={({ pressed }) => [styles.sideItem, active && styles.sideItemActive, pressed && styles.pressed]}
    >
      <View style={[styles.sideIcon, active && styles.sideIconActive]}>
        <Ionicons name={icon} size={20} color={active ? colors.surface : colors.blueDark} />
      </View>
      <View style={styles.sideCopy}>
        <Text style={[styles.sideLabel, active && styles.sideLabelActive]}>{item.label}</Text>
        <Text style={styles.sideHelper}>{item.helper}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bottomItem: {
    alignItems: 'center',
    borderRadius: radii.sm,
    flex: 1,
    gap: 3,
    justifyContent: 'center',
    minHeight: 58,
    paddingHorizontal: 4,
    paddingVertical: 7,
  },
  bottomItemActive: { backgroundColor: colors.surfaceMuted },
  bottomLabel: { color: colors.muted, fontFamily: fonts.bold, fontSize: 10 },
  bottomLabelActive: { color: colors.blueDark },
  bottomNav: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 8,
    paddingTop: 7,
  },
  brandBlock: { gap: 8, paddingBottom: 8 },
  content: { flex: 1, minWidth: 0 },
  mobileBrand: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  mobilePill: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  mobilePillText: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 11 },
  mobileSubtitle: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11 },
  mobileTitle: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 16 },
  mobileTopBar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 62,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  shell: { backgroundColor: colors.canvas, flex: 1 },
  shellWide: { flexDirection: 'row' },
  sideCopy: { flex: 1, gap: 2 },
  sideHelper: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11 },
  sideIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  sideIconActive: { backgroundColor: colors.blue },
  sideItem: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    minHeight: 62,
    padding: 10,
  },
  sideItemActive: { backgroundColor: colors.surfaceMuted, borderColor: colors.lineStrong },
  sideLabel: { color: colors.inkSoft, fontFamily: fonts.bold, fontSize: 14 },
  sideLabelActive: { color: colors.ink },
  sideNav: { gap: 6 },
  sidebar: {
    backgroundColor: colors.surface,
    borderRightColor: colors.line,
    borderRightWidth: 1,
    gap: 16,
    padding: 16,
    width: 256,
  },
  sidebarNote: {
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceTeal,
    borderColor: '#c7e9df',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginTop: 'auto',
    padding: 12,
  },
  sidebarNoteCopy: { flex: 1, gap: 2 },
  sidebarNoteText: { color: colors.tealDark, fontFamily: fonts.medium, fontSize: 11, lineHeight: 16 },
  sidebarNoteTitle: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 12 },
});
