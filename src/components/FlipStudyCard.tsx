import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { EvidenceDisplay, ReviewStyle, StudyCard } from '@/domain/types';
import { cardTrustSummary } from '@/cards/trust';
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
  const trust = cardTrustSummary(card);

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
    <Pressable accessibilityRole="button" onPress={onFlip} style={styles.pressable}>
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
          <View style={styles.faceHeader}>
            <View style={styles.deckChip}>
              <Ionicons name="albums-outline" size={17} color={colors.tealDark} />
              <Text numberOfLines={1} style={styles.deckChipText}>
                {card.deckTitle}
              </Text>
            </View>
            {trust.tone === 'review' ? <TrustPill label={trust.label} tone={trust.tone} /> : null}
          </View>

          <View style={styles.centerContent}>
            <Text adjustsFontSizeToFit minimumFontScale={0.72} style={styles.prompt}>
              {card.prompt}
            </Text>
          </View>

          {card.weakScore ? <View style={styles.weakBadge}><Ionicons name="fitness-outline" size={15} color={colors.coral} /><Text style={styles.weakBadgeText}>Repair priority</Text></View> : null}

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
            {trust.tone === 'review' ? <TrustPill label={trust.label} tone={trust.tone} /> : null}
          </View>

          <View style={styles.answerContent}>
            <StructuredAnswer answer={card.answer} variant="study" />
          </View>
        </Animated.View>
      </View>
    </Pressable>
  );
}

function TrustPill({ label, tone }: { label: string; tone: ReturnType<typeof cardTrustSummary>['tone'] }) {
  const style =
    tone === 'verified'
      ? styles.trustVerified
      : tone === 'review'
        ? styles.trustReview
        : tone === 'manual'
          ? styles.trustManual
          : styles.trustSource;
  const textStyle =
    tone === 'verified'
      ? styles.trustVerifiedText
      : tone === 'review'
        ? styles.trustReviewText
        : tone === 'manual'
          ? styles.trustManualText
          : styles.trustSourceText;
  const icon =
    tone === 'verified'
      ? 'shield-checkmark-outline'
      : tone === 'review'
        ? 'alert-circle-outline'
        : tone === 'manual'
          ? 'create-outline'
          : 'link-outline';

  return (
    <View style={[styles.trustPill, style]}>
      <Ionicons name={icon} size={14} color={textStyle.color} />
      <Text numberOfLines={1} style={[styles.trustPillText, textStyle]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  answerContent: {
    alignItems: 'stretch',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  back: {
    backgroundColor: colors.surface,
  },
  centerContent: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 4,
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
    minHeight: 430,
    padding: 20,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  faceHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  front: {
    backgroundColor: colors.surface,
  },
  pressable: {
    borderRadius: radii.md,
  },
  prompt: {
    color: colors.ink,
    fontFamily: fonts.extraBold,
    fontSize: 31,
    lineHeight: 39,
    textAlign: 'center',
  },
  stage: {
    minHeight: 430,
  },
  trustManual: { backgroundColor: colors.dangerSurface },
  trustManualText: { color: colors.coral },
  trustPill: { alignItems: 'center', borderRadius: radii.pill, flexDirection: 'row', gap: 5, maxWidth: 190, minHeight: 30, paddingHorizontal: 9 },
  trustPillText: { fontFamily: fonts.bold, fontSize: 10, textTransform: 'uppercase' },
  trustReview: { backgroundColor: colors.warningSurface },
  trustReviewText: { color: '#9a5b09' },
  trustSource: { backgroundColor: colors.surfaceTeal },
  trustSourceText: { color: colors.tealDark },
  trustVerified: { backgroundColor: '#eaf8f2' },
  trustVerifiedText: { color: colors.green },
  weakBadge: { alignItems: 'center', alignSelf: 'center', backgroundColor: colors.dangerSurface, borderRadius: radii.pill, flexDirection: 'row', gap: 6, marginBottom: 9, paddingHorizontal: 10, paddingVertical: 6 },
  weakBadgeText: { color: colors.coral, fontFamily: fonts.bold, fontSize: 10, textTransform: 'uppercase' },
});
