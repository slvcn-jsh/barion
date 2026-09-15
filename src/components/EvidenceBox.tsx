import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { EvidenceSnippet } from '@/domain/types';
import { colors, fonts, radii } from '@/theme/colors';

type Props = {
  evidence?: EvidenceSnippet;
};

export function EvidenceBox({ evidence }: Props) {
  if (!evidence) {
    return (
      <View style={styles.box}>
        <View style={styles.header}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.coral} />
          <Text style={styles.title}>No source link</Text>
        </View>
        <Text style={styles.text}>Manual card without bound evidence.</Text>
      </View>
    );
  }

  const status = describeEvidenceStatus(evidence.verificationStatus);

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Ionicons name="document-text-outline" size={18} color={colors.teal} />
        <Text style={styles.title}>{evidence.sourceTitle}</Text>
      </View>
      <Text style={styles.locator}>{evidence.locator}</Text>
      <Text style={styles.text}>{evidence.text}</Text>
      <Text style={styles.support}>
        {status} - {Math.round(evidence.supportScore * 100)}% source support
      </Text>
    </View>
  );
}

function describeEvidenceStatus(status: string) {
  if (
    status === 'auto-published-extractive' ||
    status === 'user-approved-extractive' ||
    status === 'extractive-source-match'
  ) {
    return 'Source linked';
  }
  if (status === 'built-in-curated-demo') return 'Built-in source';
  if (status === 'user-approved-edited' || status === 'user-edited') return 'Edited source link';
  return 'Needs source review';
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.surfaceTeal,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  locator: {
    color: colors.muted,
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  support: {
    color: colors.green,
    fontFamily: fonts.bold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  text: {
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  title: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 14,
  },
});
