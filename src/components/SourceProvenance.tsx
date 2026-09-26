import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { EvidenceSnippet } from '@/domain/types';
import { colors, fonts, radii } from '@/theme/colors';

type Props = {
  evidence?: EvidenceSnippet;
  initialExpanded?: boolean;
};

export function SourceProvenance({ evidence, initialExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(initialExpanded);

  if (!evidence) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Toggle source provenance"
        onPress={() => setExpanded((v) => !v)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <View style={styles.triggerContent}>
          <Ionicons name="document-text-outline" size={15} color={colors.tealDark} />
          <Text style={styles.triggerLabel}>Source</Text>
          {evidence.locator ? <Text style={styles.locatorBadge}>{evidence.locator}</Text> : null}
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.muted}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.drawer}>
          <Text style={styles.sourceTitle}>{evidence.sourceTitle}</Text>
          {evidence.locator ? <Text style={styles.locatorText}>{evidence.locator}</Text> : null}
          <Text style={styles.excerpt}>{`"${evidence.text.trim()}"`}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    marginTop: 10,
  },
  drawer: {
    backgroundColor: colors.surfaceTeal,
    borderColor: '#c7e9df',
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: 4,
    marginTop: 6,
    padding: 12,
  },
  excerpt: {
    color: colors.inkSoft,
    fontFamily: fonts.regular,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 19,
    marginTop: 4,
  },
  locatorBadge: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    color: colors.tealDark,
    fontFamily: fonts.bold,
    fontSize: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  locatorText: {
    color: colors.muted,
    fontFamily: fonts.semibold,
    fontSize: 11,
  },
  pressed: {
    opacity: 0.78,
  },
  sourceTitle: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  triggerContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  triggerLabel: {
    color: colors.tealDark,
    fontFamily: fonts.bold,
    fontSize: 12,
  },
});
