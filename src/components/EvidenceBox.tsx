import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { cardTrustSummary } from '@/cards/trust';
import type { EvidenceSnippet } from '@/domain/types';
import { colors, fonts, radii } from '@/theme/colors';

type Props = {
  evidence?: EvidenceSnippet;
};

export function EvidenceBox({ evidence }: Props) {
  if (!evidence) {
    const trust = cardTrustSummary({});
    return (
      <View style={styles.box}>
        <View style={styles.header}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.coral} />
          <Text style={styles.title}>{trust.label}</Text>
        </View>
        <Text style={styles.text}>{trust.detail}</Text>
      </View>
    );
  }

  const trust = cardTrustSummary({ evidence });
  const toneStyle = styles[`${trust.tone}Support`];

  return (
    <View style={[styles.box, trust.tone === 'review' && styles.reviewBox]}>
      <View style={styles.header}>
        <Ionicons
          name={trust.tone === 'review' ? 'alert-circle-outline' : 'document-text-outline'}
          size={18}
          color={toneStyle.color}
        />
        <Text style={styles.title}>{evidence.sourceTitle}</Text>
      </View>
      <Text style={styles.locator}>{evidence.locator}</Text>
      <Text style={styles.text}>{evidence.text}</Text>
      <Text style={[styles.support, toneStyle]}>{trust.label} - {trust.detail}</Text>
    </View>
  );
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
  manualSupport: {
    color: colors.coral,
  },
  reviewBox: {
    backgroundColor: colors.warningSurface,
    borderColor: '#efd59f',
  },
  reviewSupport: {
    color: '#9a5b09',
  },
  sourceSupport: {
    color: colors.tealDark,
  },
  support: {
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
  verifiedSupport: {
    color: colors.green,
  },
});
