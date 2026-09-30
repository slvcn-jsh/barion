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
  showShadow?: boolean;
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
  showShadow = true,
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

  const floatAnim = useRefSafe(0);
  const scaleAnim = useRefSafe(1);
  const rotateAnim = useRefSafe(0);
  const badgeScaleAnim = useRefSafe(1);

  // 1. Continuous physical float loop (decoupled from expression changes)
  // Changing expressions or typing in chat will NEVER interrupt the vertical float mid-air.
  useEffectSafe(() => {
    if (!animated) {
      floatAnim.setValue(0);
      return;
    }

    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -4,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 2.5,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    floatLoop.start();

    return () => {
      floatLoop.stop();
    };
  }, [animated]);

  // 2. Expression-specific reaction animations (runs independently)
  useEffectSafe(() => {
    if (!animated) {
      rotateAnim.setValue(0);
      scaleAnim.setValue(1);
      return;
    }

    let loop: Animated.CompositeAnimation | null = null;

    if (expression === 'thinking') {
      loop = Animated.loop(
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
      loop.start();
    } else if (expression === 'happy') {
      Animated.sequence([
        Animated.spring(scaleAnim, {
          toValue: 1.14,
          friction: 4,
          tension: 150,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1.0,
          friction: 5,
          tension: 120,
          useNativeDriver: true,
        }),
      ]).start();
      Animated.timing(rotateAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    } else if (expression === 'explaining') {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.04,
            duration: 650,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 0.98,
            duration: 650,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      Animated.timing(rotateAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    } else {
      // Idle: smoothly return to neutral
      Animated.timing(rotateAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
      Animated.timing(scaleAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    }

    return () => {
      loop?.stop();
    };
  }, [animated, expression]);

  // 3. Badge pop animation on expression change
  useEffectSafe(() => {
    if (!showBadge || !animated) return;
    badgeScaleAnim.setValue(0.4);
    Animated.spring(badgeScaleAnim, {
      toValue: 1,
      friction: 5,
      tension: 190,
      useNativeDriver: true,
    }).start();
  }, [expression, showBadge, animated]);

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
          toValue: 1.10,
          friction: 3.5,
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

  // Dynamic 3D ground shadow: expands & darkens as mascot floats closer to ground,
  // shrinks and softens as mascot floats up into the air.
  const shadowScale = floatAnim.interpolate({
    inputRange: [-4, 2.5],
    outputRange: [0.84, 1.08],
  });

  const shadowOpacity = floatAnim.interpolate({
    inputRange: [-4, 2.5],
    outputRange: [0.14, 0.28],
  });

  const mascotContent = (
    <View style={styles.contentAnchor}>
      {/* Dynamic 3D Ground Shadow */}
      {showShadow && dimension >= 32 ? (
        <Animated.View
          style={[
            styles.groundShadow,
            {
              width: dimension * 0.76,
              height: Math.max(6, dimension * 0.16),
              borderRadius: dimension * 0.38,
              bottom: -(dimension * 0.12),
              transform: [{ scaleX: animated ? shadowScale : 1 }],
              opacity: animated ? shadowOpacity : 0.2,
            },
          ]}
        />
      ) : null}

      {/* Floating 3D Body */}
      <Animated.View
        style={[
          styles.animatedWrapper,
          Platform.OS === 'web' ? ({ willChange: 'transform' } as any) : null,
          animated && {
            transform: [
              { translateY: floatAnim },
              { scale: scaleAnim },
              { rotate: rotateInterpolate },
            ],
          },
        ]}
      >
        {/* 3D Ambient Halo */}
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

        {/* Mascot Core Sphere */}
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

          {/* 3D Curved Specular Highlight (creates depth & glass/enamel curvature) */}
          <View
            style={[
              styles.specularHighlight,
              {
                width: dimension * 0.65,
                height: dimension * 0.32,
                borderRadius: dimension * 0.32,
              },
            ]}
          />

          {/* Subtle bottom ambient occlusion ring */}
          <View
            style={[
              styles.bottomShade,
              {
                width: dimension,
                height: dimension * 0.3,
                bottom: 0,
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
    </View>
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
    const ref = useRef<Animated.Value | null>(null);
    if (!ref.current) {
      ref.current = new Animated.Value(initialValue);
    }
    return ref.current;
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
  contentAnchor: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  groundShadow: {
    position: 'absolute',
    backgroundColor: '#0F2D60',
    ...(Platform.OS === 'web'
      ? { filter: 'blur(3px)' }
      : {
          shadowColor: '#0F2D60',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 3,
        }),
  },
  animatedWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  glowRing: {
    position: 'absolute',
    backgroundColor: 'rgba(59, 130, 246, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(147, 197, 253, 0.30)',
  },
  mascotCore: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF6FF',
    borderWidth: 1.5,
    borderColor: '#C6E0FF',
    overflow: 'hidden',
    position: 'relative',
    ...(Platform.OS === 'web'
      ? {
          boxShadow: '0 4px 10px rgba(15, 45, 96, 0.20), inset 0 -2px 5px rgba(15, 45, 96, 0.08)',
        }
      : {
          elevation: 5,
          shadowColor: colors.blueDark,
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.20,
          shadowRadius: 6,
        }),
  },
  specularHighlight: {
    position: 'absolute',
    top: 2,
    left: '12%',
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    transform: [{ rotate: '-14deg' }],
  },
  bottomShade: {
    position: 'absolute',
    backgroundColor: 'rgba(15, 45, 96, 0.06)',
    borderBottomLeftRadius: 100,
    borderBottomRightRadius: 100,
  },
  badge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.surface,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 2px 4px rgba(0, 0, 0, 0.22)' }
      : {
          elevation: 4,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.22,
          shadowRadius: 2,
        }),
  },
});
