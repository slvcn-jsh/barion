import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  ImageSourcePropType,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { colors } from '@/theme/colors';

export type BariExpression = 'idle' | 'thinking' | 'happy' | 'explaining';

export type BariMascotProps = {
  size?: 'sm' | 'md' | 'lg' | 'xl' | number;
  expression?: BariExpression;
  showBadge?: boolean;
  animated?: boolean;
  interactive?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

const mascotSource: ImageSourcePropType = require('../../app/image/BARI_MASCOT.png');

export function BariMascot({
  size = 'md',
  expression = 'idle',
  showBadge = false,
  animated = true,
  interactive = false,
  onPress,
  style,
}: BariMascotProps) {
  const dimension =
    typeof size === 'number'
      ? size
      : size === 'sm'
        ? 32
        : size === 'lg'
          ? 64
          : size === 'xl'
            ? 100
            : 44;

  let floatAnim = useRefSafe(0);
  let scaleAnim = useRefSafe(1);
  let rotateAnim = useRefSafe(0);
  let badgeScaleAnim = useRefSafe(1);

  // Continuous physics / floating & expression animation loops
  useEffectSafe(() => {
    if (!animated) return;

    let floatLoop: Animated.CompositeAnimation | null = null;
    let expressionLoop: Animated.CompositeAnimation | null = null;

    // 1. Idle gentle floating loop
    floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -3.5,
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 2.5,
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    floatLoop.start();

    // 2. Expression-specific reaction animations
    if (expression === 'thinking') {
      expressionLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(rotateAnim, {
            toValue: -0.06,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(rotateAnim, {
            toValue: 0.06,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      expressionLoop.start();
    } else if (expression === 'happy') {
      Animated.sequence([
        Animated.spring(scaleAnim, {
          toValue: 1.12,
          friction: 4,
          tension: 140,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1.0,
          friction: 5,
          tension: 120,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (expression === 'explaining') {
      expressionLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.04,
            duration: 600,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 0.98,
            duration: 600,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      expressionLoop.start();
    } else {
      Animated.timing(rotateAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
      Animated.timing(scaleAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    }

    return () => {
      floatLoop?.stop();
      expressionLoop?.stop();
    };
  }, [animated, expression]);

  // Badge pop animation on expression switch
  useEffectSafe(() => {
    if (!showBadge || !animated) return;
    badgeScaleAnim.setValue(0.5);
    Animated.spring(badgeScaleAnim, {
      toValue: 1,
      friction: 5,
      tension: 180,
      useNativeDriver: true,
    }).start();
  }, [expression, showBadge]);

  function handlePress() {
    if (animated) {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 0.88,
          duration: 90,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1.08,
          friction: 3,
          tension: 160,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1.0,
          friction: 5,
          tension: 140,
          useNativeDriver: true,
        }),
      ]).start();
    }
    onPress?.();
  }

  const badgeIcon =
    expression === 'thinking'
      ? 'bulb'
      : expression === 'happy'
        ? 'sparkles'
        : expression === 'explaining'
          ? 'chatbubble-ellipses'
          : null;

  const badgeColor =
    expression === 'thinking'
      ? colors.tealDark
      : expression === 'happy'
        ? colors.blue
        : colors.blueDark;

  const rotateInterpolate = rotateAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-180deg', '180deg'],
  });

  const mascotContent = (
    <Animated.View
      style={[
        styles.animatedWrapper,
        animated && {
          transform: [
            { translateY: floatAnim },
            { scale: scaleAnim },
            { rotate: rotateInterpolate },
          ],
        },
      ]}
    >
      {/* 3D Outer Depth Glow Ring */}
      <View
        style={[
          styles.glowRing,
          {
            width: dimension + 6,
            height: dimension + 6,
            borderRadius: (dimension + 6) / 2,
          },
        ]}
      />

      {/* Main 3D Mascot Sphere */}
      <View
        style={[
          styles.mascotCore,
          {
            width: dimension,
            height: dimension,
            borderRadius: dimension / 2,
          },
        ]}
      >
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          source={mascotSource}
          style={{
            width: dimension,
            height: dimension,
            borderRadius: dimension / 2,
          }}
        />
        {/* Subtle 3D Top Specular Light Highlight */}
        <View
          style={[
            styles.specularHighlight,
            {
              width: dimension * 0.7,
              height: dimension * 0.35,
              borderRadius: dimension * 0.35,
            },
          ]}
        />
      </View>

      {/* Animated Expression Badge */}
      {showBadge && badgeIcon ? (
        <Animated.View
          style={[
            styles.badge,
            {
              backgroundColor: badgeColor,
              right: dimension > 40 ? 0 : -2,
              bottom: dimension > 40 ? 0 : -2,
              width: dimension > 40 ? 20 : 16,
              height: dimension > 40 ? 20 : 16,
              borderRadius: dimension > 40 ? 10 : 8,
              transform: [{ scale: badgeScaleAnim }],
            },
          ]}
        >
          <Ionicons
            name={badgeIcon as keyof typeof Ionicons.glyphMap}
            size={dimension > 40 ? 11 : 9}
            color={colors.surface}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );

  return (
    <View
      accessibilityLabel={`Bari Mascot (${expression})`}
      accessibilityRole="image"
      style={[
        styles.container,
        {
          width: dimension,
          height: dimension,
        },
        style,
      ]}
    >
      {interactive || onPress ? (
        <Pressable
          accessibilityLabel={`Interact with Bari Mascot (${expression})`}
          accessibilityRole="button"
          onPress={handlePress}
          style={styles.pressableArea}
        >
          {mascotContent}
        </Pressable>
      ) : (
        mascotContent
      )}
    </View>
  );
}

function useRefSafe(initialValue: number) {
  try {
    return useRef(new Animated.Value(initialValue)).current;
  } catch {
    return new Animated.Value(initialValue);
  }
}

function useEffectSafe(effect: React.EffectCallback, deps?: React.DependencyList) {
  try {
    useEffect(effect, deps);
  } catch {
    // Ignored in direct function call testing
  }
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pressableArea: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  animatedWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  glowRing: {
    position: 'absolute',
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(147, 197, 253, 0.35)',
  },
  mascotCore: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF6FF',
    borderWidth: 1.5,
    borderColor: '#C6E0FF',
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 3px 6px rgba(15, 45, 96, 0.18)' }
      : {
          elevation: 4,
          shadowColor: colors.blueDark,
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.18,
          shadowRadius: 6,
        }),
  },
  specularHighlight: {
    position: 'absolute',
    top: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.38)',
    transform: [{ rotate: '-12deg' }],
  },
  badge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.surface,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)' }
      : {
          elevation: 3,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.2,
          shadowRadius: 2,
        }),
  },
});
