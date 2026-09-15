import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii } from '@/theme/colors';

type Props = {
  label: string;
  value: string | number;
  tone?: 'teal' | 'coral' | 'gold' | 'indigo';
  icon?: keyof typeof Ionicons.glyphMap;
};

export function StatTile({ icon, label, value, tone = 'teal' }: Props) {
  return (
    <View style={styles.tile}>
      <View style={[styles.icon, styles[`${tone}Surface`]]}>
        <Ionicons name={icon ?? 'pulse-outline'} size={18} color={styles[tone].backgroundColor} />
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  coral: {
    backgroundColor: colors.coral,
  },
  coralSurface: {
    backgroundColor: colors.dangerSurface,
  },
  gold: {
    backgroundColor: colors.gold,
  },
  goldSurface: {
    backgroundColor: colors.warningSurface,
  },
  icon: {
    alignItems: 'center',
    borderRadius: 11,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  indigo: {
    backgroundColor: colors.indigo,
  },
  indigoSurface: {
    backgroundColor: '#eef0ff',
  },
  label: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  teal: {
    backgroundColor: colors.teal,
  },
  tealSurface: {
    backgroundColor: colors.surfaceTeal,
  },
  tile: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    gap: 8,
    minHeight: 126,
    minWidth: 140,
    padding: 14,
  },
  value: {
    color: colors.ink,
    fontFamily: fonts.extraBold,
    fontSize: 28,
  },
});
