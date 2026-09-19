import { StyleSheet, Text, View } from 'react-native';

import { learnerAnswer, parseAnswerSections } from '@/cards/answerView';
import { colors, fonts, radii } from '@/theme/colors';

type Props = {
  answer: string;
  variant?: 'study' | 'preview' | 'candidate';
};

export function StructuredAnswer({ answer, variant = 'preview' }: Props) {
  const sections = parseAnswerSections(variant === 'study' ? learnerAnswer(answer) : answer);
  const study = variant === 'study';
  const candidate = variant === 'candidate';

  return (
    <View style={[styles.wrapper, study && styles.studyWrapper, candidate && styles.candidateWrapper]}>
      {sections.map((section, index) => (
        <View
          key={`${section.label ?? 'body'}-${index}`}
          style={[styles.section, index > 0 && styles.sectionDivider]}
        >
          {section.label ? <Text style={styles.label}>{section.label}</Text> : null}
          <Text style={[styles.body, study && styles.studyBody, candidate && styles.candidateBody]}>
            {section.body}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: colors.inkSoft,
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 21,
  },
  candidateBody: {
    color: colors.inkSoft,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
  },
  candidateWrapper: {
    backgroundColor: colors.canvas,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: 12,
  },
  label: {
    color: colors.tealDark,
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  section: {
    gap: 4,
  },
  sectionDivider: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    paddingTop: 9,
  },
  studyBody: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 22,
  },
  studyWrapper: {
    width: '100%',
  },
  wrapper: {
    gap: 9,
    width: '100%',
  },
});
