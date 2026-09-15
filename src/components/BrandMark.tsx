import { Image, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/theme/colors';

type Props = {
  compact?: boolean;
  inverse?: boolean;
  showTagline?: boolean;
  size?: number;
};

const logoSource = require('../../app/image/BARIONLOGO.png');

export function BrandMark({ compact = false, inverse = false, showTagline = false, size = 42 }: Props) {
  return (
    <View accessibilityLabel="Barion" accessibilityRole="image" style={styles.lockup}>
      <View style={[styles.markCrop, { height: size, width: size }]}>
        <Image
          accessibilityIgnoresInvertColors
          source={logoSource}
          style={{
            height: size * 1.96,
            left: size * -0.44,
            position: 'absolute',
            top: size * -0.34,
            width: size * 1.96,
          }}
        />
      </View>
      {!compact ? (
        <View style={styles.wordmarkGroup}>
          <Text style={[styles.wordmark, inverse && styles.inverse]}>BARION</Text>
          {showTagline ? (
            <Text style={[styles.tagline, inverse && styles.taglineInverse]}>
              LEARN TODAY. HEAL TOMORROW.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inverse: {
    color: colors.surface,
  },
  lockup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  markCrop: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  tagline: {
    color: colors.inkSoft,
    fontFamily: fonts.semibold,
    fontSize: 8,
    letterSpacing: 1.45,
  },
  taglineInverse: {
    color: '#cbdcf5',
  },
  wordmark: {
    color: colors.ink,
    fontFamily: fonts.extraBold,
    fontSize: 20,
    letterSpacing: 2.2,
  },
  wordmarkGroup: {
    gap: 1,
  },
});
