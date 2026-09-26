import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { EvidenceDisplay, ReviewStyle, StudyCard } from '@/domain/types';
import { SourceProvenance } from '@/components/SourceProvenance';
import { StructuredAnswer } from '@/components/StructuredAnswer';
import { colors, fonts, radii } from '@/theme/colors';

type Props = {
  card: StudyCard;
  revealed: boolean;
  evidenceDisplay?: EvidenceDisplay;
  reviewStyle?: ReviewStyle;
  onFlip: () => void;
};

export function FlipStudyCard({ card, revealed, onFlip }: Props) {
  const flip = useRef(new Animated.Value(revealed ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(flip, {
      friction: 9,
      tension: 68,
      toValue: revealed ? 1 : 0,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [flip, revealed]);

  const frontRotate = flip.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  const backRotate = flip.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });
  const frontOpacity = flip.interpolate({
    inputRange: [0, 0.48, 0.52, 1],
    outputRange: [1, 1, 0, 0],
  });
  const backOpacity = flip.interpolate({
    inputRange: [0, 0.48, 0.52, 1],
    outputRange: [0, 0, 1, 1],
  });

  return (
    <View style={styles.container}>
      <View style={styles.stage}>
        <Animated.View
          style={[
            styles.face,
            styles.front,
            styles.cardShadow,
            {
              opacity: frontOpacity,
              pointerEvents: revealed ? 'none' : 'auto',
              transform: [{ perspective: 1200 }, { rotateY: frontRotate }],
            },
          ]}
        >
          <Pressable accessibilityRole="button" accessibilityLabel="Flip to reveal answer" onPress={onFlip} style={styles.cardInnerPressable}>
            <View style={styles.faceHeader}>
              <View style={styles.deckChip}>
                <Ionicons name="albums-outline" size={17} color={colors.tealDark} />
                <Text numberOfLines={1} style={styles.deckChipText}>
                  {card.deckTitle}
                </Text>
              </View>
            </View>

            <View style={styles.centerContent}>
              <Text adjustsFontSizeToFit minimumFontScale={0.72} style={styles.prompt}>
                {card.prompt}
              </Text>
            </View>

            <View style={styles.tapToReveal}>
              <Ionicons name="eye-outline" size={15} color={colors.muted} />
              <Text style={styles.tapToRevealText}>Tap card to reveal answer</Text>
            </View>
          </Pressable>
        </Animated.View>

        <Animated.View
          style={[
            styles.face,
            styles.back,
            styles.cardShadow,
            {
              opacity: backOpacity,
              pointerEvents: revealed ? 'auto' : 'none',
              transform: [{ perspective: 1200 }, { rotateY: backRotate }],
            },
          ]}
        >
          <View style={styles.faceHeader}>
            <View style={styles.deckChip}>
              <Ionicons name="checkmark-circle-outline" size={17} color={colors.green} />
              <Text numberOfLines={1} style={styles.deckChipText}>
                Answer
              </Text>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.answerScrollContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.answerContent}>
              <StructuredAnswer answer={card.answer} variant="study" />
              <SourceProvenance evidence={card.evidence} />
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  answerContent: {
    alignItems: 'stretch',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 12,
  },
  answerScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  back: {
    backgroundColor: colors.surface,
  },
  cardInnerPressable: {
    flex: 1,
    justifyContent: 'space-between',
  },
  cardShadow:
    Platform.OS === 'web'
      ? {
          boxShadow: '0 10px 20px rgba(31, 41, 55, 0.08)',
        }
      : {
          elevation: 3,
          shadowColor: '#000',
          shadowOffset: { height: 10, width: 0 },
          shadowOpacity: 0.08,
          shadowRadius: 20,
        },
  centerContent: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  container: {
    borderRadius: radii.md,
    width: '100%',
  },
  deckChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 34,
    paddingHorizontal: 11,
  },
  deckChipText: {
    color: colors.tealDark,
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  face: {
    backfaceVisibility: 'hidden',
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    bottom: 0,
    left: 0,
    minHeight: 400,
    padding: 20,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  faceHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  front: {
    backgroundColor: colors.surface,
  },
  prompt: {
    color: colors.ink,
    fontFamily: fonts.extraBold,
    fontSize: 27,
    lineHeight: 36,
    textAlign: 'center',
  },
  stage: {
    minHeight: 400,
  },
  tapToReveal: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 6,
  },
  tapToRevealText: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 12,
  },
});
