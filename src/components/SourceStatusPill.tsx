import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { normalizeSourceStatus, type SourceStatus } from '@/domain/types';
import { colors, fonts, radii } from '@/theme/colors';

export function getSourceStatusMeta(status: unknown) {
  switch (normalizeSourceStatus(status)) {
    case 'importing':
      return { label: 'Saving file', description: 'Keeping a local source record.', progress: 0.16, tone: 'active' as const };
    case 'parsing':
      return { label: 'Extracting', description: 'Reading text and preserving page locations.', progress: 0.42, tone: 'active' as const };
    case 'generating':
      return { label: 'Building study set', description: 'Finding concepts and publishing source-grounded cards.', progress: 0.68, tone: 'active' as const };
    case 'review-ready':
      return { label: 'Check exceptions', description: 'A few uncertain cards need attention.', progress: 0.84, tone: 'review' as const };
    case 'ready':
      return { label: 'Ready to study', description: 'Its independent study set is organized and available.', progress: 1, tone: 'success' as const };
    case 'action-required':
      return { label: 'Needs attention', description: 'A quick action is needed to continue.', progress: 0.25, tone: 'warning' as const };
    case 'failed':
      return { label: 'Could not process', description: 'Review the issue and try again.', progress: 0, tone: 'danger' as const };
  }

  return {
    label: 'Needs attention',
    description: 'A quick action is needed to continue.',
    progress: 0.25,
    tone: 'warning' as const,
  };
}

export function SourceStatusPill({ status }: { status: SourceStatus }) {
  const meta = getSourceStatusMeta(status);
  const isActive = meta.tone === 'active';
  const icon = meta.tone === 'success' ? 'checkmark-circle' : meta.tone === 'review' ? 'sparkles' : meta.tone === 'danger' ? 'alert-circle' : 'information-circle';

  return (
    <View style={[styles.pill, styles[meta.tone]]}>
      {isActive ? (
        <ActivityIndicator color={colors.blueDark} size="small" />
      ) : (
        <Ionicons name={icon} size={15} color={styles[`${meta.tone}Text`].color} />
      )}
      <Text style={[styles.label, styles[`${meta.tone}Text`]]}>{meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  active: {
    backgroundColor: colors.surfaceMuted,
  },
  activeText: {
    color: colors.blueDark,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
  },
  dangerText: {
    color: colors.red,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 10,
  },
  review: {
    backgroundColor: colors.surfaceTeal,
  },
  reviewText: {
    color: colors.tealDark,
  },
  success: {
    backgroundColor: '#eaf8f2',
  },
  successText: {
    color: colors.green,
  },
  warning: {
    backgroundColor: colors.warningSurface,
  },
  warningText: {
    color: '#9a5b09',
  },
});
