import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';

import { colors, fonts, radii } from '@/theme/colors';

type Props = {
  label: string;
  accessibilityLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'secondary' | 'inverse' | 'quiet' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
};

export function AppButton({
  label,
  accessibilityLabel,
  icon,
  variant = 'primary',
  disabled = false,
  style,
  onPress,
}: Props) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={18}
          color={
            variant === 'primary' || variant === 'danger'
              ? colors.surface
              : variant === 'inverse'
                ? colors.ink
                : colors.ink
          }
        />
      ) : null}
      <Text
        style={[
          styles.label,
          (variant === 'primary' || variant === 'danger') && styles.labelOnDark,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: radii.sm,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 18,
  },
  danger: {
    backgroundColor: colors.coral,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  labelOnDark: {
    color: colors.surface,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  primary: {
    backgroundColor: colors.blue,
  },
  inverse: {
    backgroundColor: colors.surface,
  },
  quiet: {
    backgroundColor: 'transparent',
  },
  secondary: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.lineStrong,
    borderWidth: 1,
  },
});
