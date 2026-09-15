import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { EvidenceDisplay, ReviewStyle, StudyCard } from '@/domain/types';
import { StructuredAnswer } from '@/components/StructuredAnswer';
import { colors, fonts, radii } from '@/theme/colors';

type Props = {
  card: StudyCard;
  revealed: boolean;
  evidenceDisplay?: EvidenceDisplay;
  reviewStyle?: ReviewStyle;
  onFlip: () => void;
};

export function FlipStudyCard({ card, revealed, evidenceDisplay = 'compact', reviewStyle = 'clinical-reasoning', onFlip }: Props) {
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
            <Text style={styles.sideLabel}>Question</Text>
          </View>

          <View style={styles.centerContent}>
            <Text adjustsFontSizeToFit minimumFontScale={0.72} style={styles.prompt}>
              {card.prompt}
            </Text>
          </View>

          {card.weakScore ? <View style={styles.weakBadge}><Ionicons name="fitness-outline" size={15} color={colors.coral} /><Text style={styles.weakBadgeText}>Repair priority</Text></View> : null}

          <SourceLine card={card} />
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
                {card.cardType}
              </Text>
            </View>
            <Text style={styles.sideLabel}>Answer</Text>
          </View>

          <View style={styles.answerContent}>
            <StructuredAnswer answer={reviewStyle === 'concise' ? conciseAnswer(card.answer) : card.answer} variant="study" />
          </View>

          <View style={styles.evidenceArea}>
            <View style={styles.evidenceHeader}>
              <Ionicons
                name={card.evidence ? 'document-text-outline' : 'create-outline'}
                size={17}
                color={card.evidence ? colors.teal : colors.coral}
              />
              <Text style={styles.evidenceTitle}>
                {card.evidence ? card.evidence.sourceTitle : 'Manual card'}
              </Text>
            </View>
            {card.evidence ? (
              <>
                <Text style={styles.evidenceLocator}>{card.evidence.locator}</Text>
                <Text numberOfLines={evidenceDisplay === 'expanded' ? undefined : 4} style={styles.evidenceText}>
                  {card.evidence.text}
                </Text>
              </>
            ) : (
              <Text style={styles.evidenceText}>No source evidence has been attached yet.</Text>
            )}
          </View>
        </Animated.View>
      </View>
    </Pressable>
  );
}

function conciseAnswer(answer: string) {
  return answer.split(/\n+/).find((line) => /^answer:/i.test(line.trim())) ?? answer.split(/\n+/)[0] ?? answer;
}

function SourceLine({ card }: { card: StudyCard }) {
  if (!card.evidence) {
    return (
      <View style={styles.sourceLine}>
        <Ionicons name="create-outline" size={16} color={colors.coral} />
        <Text numberOfLines={1} style={styles.sourceLineText}>
          Manual card
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.sourceLine}>
      <Ionicons name="link-outline" size={16} color={colors.tealDark} />
      <Text numberOfLines={1} style={styles.sourceLineText}>
        {card.evidence.sourceTitle} - {card.evidence.locator}
      </Text>
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
  evidenceArea: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    gap: 6,
    paddingTop: 14,
  },
  evidenceHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  evidenceLocator: {
    color: colors.muted,
    fontFamily: fonts.bold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  evidenceText: {
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  evidenceTitle: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 13,
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
  sideLabel: {
    color: colors.muted,
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  sourceLine: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 7,
    maxWidth: '100%',
    minHeight: 38,
    paddingHorizontal: 13,
  },
  sourceLineText: {
    color: colors.tealDark,
    flexShrink: 1,
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  stage: {
    minHeight: 430,
  },
  weakBadge: { alignItems: 'center', alignSelf: 'center', backgroundColor: colors.dangerSurface, borderRadius: radii.pill, flexDirection: 'row', gap: 6, marginBottom: 9, paddingHorizontal: 10, paddingVertical: 6 },
  weakBadgeText: { color: colors.coral, fontFamily: fonts.bold, fontSize: 10, textTransform: 'uppercase' },
});
