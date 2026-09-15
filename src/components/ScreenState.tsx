import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { BrandMark } from '@/components/BrandMark';
import { colors, fonts } from '@/theme/colors';

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={styles.center}>
      <BrandMark compact size={46} />
      <ActivityIndicator color={colors.teal} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.center}>
      <BrandMark compact size={52} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.label}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    flex: 1,
    gap: 10,
    justifyContent: 'center',
    padding: 24,
  },
  label: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 18,
    textAlign: 'center',
  },
});
