import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { BariModelProps } from './BariModel.types';

/**
 * BariModel.native.tsx
 *
 * Repository placeholder boundary for native platforms.
 * Replace this component after selecting a native 3D runtime.
 */
export default function BariModelNative({ size = 220 }: BariModelProps) {
  const numericSize = typeof size === 'number' ? size : 220;

  return (
    <View style={[styles.container, { width: numericSize, height: numericSize }]}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>Bari 3D</Text>
      </View>
      <Text style={styles.helperText}>Native 3D runtime not wired yet.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: '#E8F3FF',
    borderWidth: 1,
    borderColor: '#C9DFFF',
    padding: 16,
  },
  badge: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#0B2D6B',
    marginBottom: 10,
  },
  badgeText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  helperText: {
    color: '#0A1A3C',
    textAlign: 'center',
  },
});
