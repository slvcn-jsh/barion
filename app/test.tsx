import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/ScreenState';
import { StructuredAnswer } from '@/components/StructuredAnswer';
import type {
  ActiveTestSession,
  CourseSummary,
  Dashboard,
  StudyCard,
  StudyProfile,
  TestConfidence,
  TestDirection,
  TestFormat,
  TestQuestion,
  TestScope,
} from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import {
  abandonTestSession,
  completeTestSession,
  getCourses,
  getDashboard,
  getStudyProfile,
  getTestCards,
  getLatestActiveTestSession,
  recordTestAnswer,
  startTestSession,
} from '@/storage/repository';
import { buildTestQuestions } from '@/testing/questions';
import { colors, fonts, radii } from '@/theme/colors';

type Phase = 'setup' | 'testing' | 'results';
type Feedback = { question: TestQuestion; correct: boolean; confidence: TestConfidence };

export default function TestScreen() {
  const params = useLocalSearchParams<{
    deckId?: string;
    moduleId?: string;
    scope?: string;
    format?: string;
    direction?: string;
    limit?: string;
    autoStart?: string;
  }>();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [profile, setProfile] = useState<StudyProfile | null>(null);
  const [phase, setPhase] = useState<Phase>('setup');
  const [deckId, setDeckId] = useState(params.deckId || 'all');
  const [moduleId, setModuleId] = useState(params.moduleId || '');
  const [scope, setScope] = useState<TestScope>(parseScope(params.scope));
  const [format, setFormat] = useState<TestFormat>(parseFormat(params.format));
  const [direction, setDirection] = useState<TestDirection>(parseDirection(params.direction));
  const [questionLimit, setQuestionLimit] = useState(parseLimit(params.limit) ?? 10);
  const [customLimit, setCustomLimit] = useState('');
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [writtenResponse, setWrittenResponse] = useState('');
  const [showWrittenAnswer, setShowWrittenAnswer] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [missedCards, setMissedCards] = useState<StudyCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [questionStartedAt, setQuestionStartedAt] = useState(Date.now());
  const [resumableSession, setResumableSession] = useState<ActiveTestSession | null>(null);
  const [autoStarted, setAutoStarted] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void initializeDatabase().then(async () => {
        const [nextDashboard, nextProfile, activeSession, nextCourses] = await Promise.all([
          getDashboard(),
          getStudyProfile(),
          getLatestActiveTestSession(),
          getCourses(),
        ]);
        if (!active) return;
        setDashboard(nextDashboard);
        setCourses(nextCourses);
        setProfile(nextProfile);
        setResumableSession(activeSession);
        if (!params.limit) setQuestionLimit(nextProfile.sessionLength || 20);
        if (!params.format) {
          setFormat(nextProfile.examGoal === 'board-style' || nextProfile.examGoal === 'clinical-recall' ? 'clinical' : 'adaptive');
        }
      });
      return () => { active = false; };
    }, []),
  );

  useEffect(() => {
    if (!dashboard || !profile || autoStarted || params.autoStart !== '1' || phase !== 'setup') return;
    setAutoStarted(true);
    void beginTest();
  }, [autoStarted, dashboard, params.autoStart, phase, profile]);

  const current = questions[questionIndex];
  const progress = questions.length ? questionIndex / questions.length : 0;

  async function beginTest(cardsOverride?: StudyCard[]) {
    if (!profile) return;
    setBusy(true);
    try {
      const cards = cardsOverride ?? await getTestCards({
        deckId: moduleId ? undefined : deckId === 'all' ? undefined : deckId,
        moduleId: moduleId || undefined,
        scope,
        limit: questionLimit,
      });
      if (!cards.length) {
        Alert.alert(
          scope === 'weak' ? 'No weak cards yet' : 'No cards available',
          scope === 'weak'
            ? 'Missed or uncertain test answers will automatically build this repair set.'
            : 'Try All cards or choose another deck.',
        );
        return;
      }
      const nextQuestions = buildTestQuestions(cards, format, profile.difficulty, direction);
      const nextSessionId = await startTestSession({
        deckId: moduleId ? undefined : deckId === 'all' ? undefined : deckId,
        format,
        direction,
        scope,
        questionLimit,
        questions: nextQuestions,
      });
      setQuestions(nextQuestions);
      setSessionId(nextSessionId);
      setQuestionIndex(0);
      setCorrectCount(0);
      setMissedCards([]);
      resetQuestionState();
      setQuestionStartedAt(Date.now());
      setResumableSession(null);
      setPhase('testing');
    } catch (error) {
      Alert.alert('Test could not start', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function resumeTest() {
    if (!resumableSession) return;
    setDeckId(resumableSession.deckId ?? 'all');
    setModuleId('');
    setScope(resumableSession.scope);
    setFormat(resumableSession.format);
    setDirection(resumableSession.direction);
    setQuestionLimit(resumableSession.questionLimit);
    setCustomLimit([0, 5, 10, 20].includes(resumableSession.questionLimit) ? '' : String(resumableSession.questionLimit));
    setQuestions(resumableSession.questions);
    setSessionId(resumableSession.id);
    setQuestionIndex(Math.min(resumableSession.answeredCount, resumableSession.questions.length - 1));
    setCorrectCount(resumableSession.correctCount);
    setMissedCards(resumableSession.missedCards);
    resetQuestionState();
    setQuestionStartedAt(Date.now());
    setPhase('testing');
  }

  async function discardResumableTest() {
    if (!resumableSession || busy) return;
    setBusy(true);
    try {
      await abandonTestSession(resumableSession.id);
      setResumableSession(null);
    } catch (error) {
      Alert.alert('Test could not be discarded', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer(correct: boolean, confidence: TestConfidence, responseText: string) {
    if (!current || !sessionId || busy) return;
    setBusy(true);
    try {
      await recordTestAnswer({
        sessionId,
        card: current.card,
        isCorrect: correct,
        confidence,
        responseText,
        responseTimeMs: Date.now() - questionStartedAt,
      });
      const nextCorrect = correctCount + (correct ? 1 : 0);
      const nextMissed = correct ? missedCards : [...missedCards, current.card];
      setCorrectCount(nextCorrect);
      setMissedCards(nextMissed);

      if (profile?.feedbackTiming === 'immediate' || current.type === 'written-recall') {
        setFeedback({ question: current, correct, confidence });
      } else {
        await goNext(nextCorrect, nextMissed);
      }
    } catch (error) {
      Alert.alert('Answer was not saved', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function goNext(nextCorrect = correctCount, nextMissed = missedCards) {
    if (questionIndex + 1 >= questions.length) {
      if (sessionId) await completeTestSession(sessionId);
      setCorrectCount(nextCorrect);
      setMissedCards(nextMissed);
      setPhase('results');
      setResumableSession(null);
      setFeedback(null);
      return;
    }
    setQuestionIndex((value) => value + 1);
    resetQuestionState();
    setQuestionStartedAt(Date.now());
  }

  function resetQuestionState() {
    setSelectedOptionId(null);
    setWrittenResponse('');
    setShowWrittenAnswer(false);
    setFeedback(null);
  }

  if (!dashboard || !profile) {
    return (
      <AppShell active="study">
        <LoadingState label="Preparing Test Mode" />
      </AppShell>
    );
  }

  function chooseTarget(nextDeckId: string, nextModuleId = '') {
    setDeckId(nextDeckId);
    setModuleId(nextModuleId);
  }

  if (phase === 'setup') {
    return (
      <AppShell active="study">
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name="school" size={27} color={colors.surface} /></View>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>ACTIVE RECALL · SOURCE GROUNDED</Text>
            <Text style={styles.heroTitle}>{params.autoStart === '1' ? 'Building practice questions' : 'Build a focused test'}</Text>
            <Text style={styles.heroBody}>Barion mixes written recall, best-answer recognition, and proposed-answer checks, then sends misses back to FSRS automatically.</Text>
          </View>
        </View>

        {resumableSession ? (
          <View style={styles.resumeCard}>
            <View style={styles.resumeIcon}>
              <Ionicons name="time-outline" size={23} color={colors.blue} />
            </View>
            <View style={styles.resumeCopy}>
              <Text style={styles.resumeEyebrow}>TEST IN PROGRESS</Text>
              <Text style={styles.resumeTitle}>Continue {resumableSession.deckTitle ?? 'your library'}?</Text>
              <Text style={styles.body}>
                {resumableSession.answeredCount} of {resumableSession.totalCount} answered · your exact question order is saved
              </Text>
              <View style={styles.actions}>
                <AppButton icon="play" label="Resume test" onPress={resumeTest} />
                <AppButton disabled={busy} label="Discard" variant="quiet" onPress={() => void discardResumableTest()} />
              </View>
            </View>
          </View>
        ) : null}

        <SetupSection title="Study set" body="Choose one deck, a combined folder, or your full active library.">
          <View style={styles.choiceGrid}>
            <Choice selected={deckId === 'all' && !moduleId} label="All active cards" detail={`${dashboard.totalCards} cards`} onPress={() => chooseTarget('all')} />
            {dashboard.decks.map((deck) => <Choice key={deck.id} selected={deckId === deck.id && !moduleId} label={deck.title} detail={`${deck.cardCount} cards · ${deck.dueCount} due`} onPress={() => chooseTarget(deck.id)} />)}
            {courses.flatMap((course) => course.modules).filter((module) => module.deckCount > 0).map((module) => (
              <Choice
                key={module.id}
                selected={moduleId === module.id}
                label={module.title}
                detail={`${module.cardCount} cards · ${module.deckCount} decks in folder`}
                onPress={() => chooseTarget('all', module.id)}
              />
            ))}
          </View>
        </SetupSection>

        <SetupSection title="What to test" body="Adaptive is the default; weak concepts appear after a miss or uncertain answer.">
          <View style={styles.choiceGrid}>
            <Choice selected={scope === 'due'} label="Due now" detail={`${dashboard.dueCount} scheduled`} onPress={() => setScope('due')} />
            <Choice selected={scope === 'weak'} label="Weak concepts" detail={`${dashboard.weakCount} need repair`} onPress={() => setScope('weak')} />
            <Choice selected={scope === 'all'} label="All cards" detail="Ignore due dates for this test" onPress={() => setScope('all')} />
          </View>
        </SetupSection>

        <SetupSection title="Test style" body="Barion chooses the cleanest recall format for the selected material.">
          <View style={styles.choiceGrid}>
            <Choice selected={format === 'adaptive'} label="Adaptive mix" detail="Weak and due concepts first" recommended onPress={() => setFormat('adaptive')} />
            <Choice selected={format === 'clinical'} label="Clinical focus" detail="Mechanism, findings, treatment, safety" onPress={() => setFormat('clinical')} />
            <Choice selected={format === 'rapid-recall'} label="Rapid recall" detail="A direct pass through the set" onPress={() => setFormat('rapid-recall')} />
          </View>
        </SetupSection>

        <SetupSection title="Answer direction" body="Automatic both reverses only cards whose two sides make a clear prompt and answer.">
          <View style={styles.choiceGrid}>
            <Choice selected={direction === 'both'} label="Automatic both" detail="Varied recall when the card is suitable" recommended onPress={() => setDirection('both')} />
            <Choice selected={direction === 'front-to-back'} label="Front to back" detail="Question or term → answer" onPress={() => setDirection('front-to-back')} />
            <Choice selected={direction === 'back-to-front'} label="Back to front" detail="Answer or definition → original front" onPress={() => setDirection('back-to-front')} />
          </View>
        </SetupSection>

        <SetupSection title="Length" body={`Your Study Profile target is ${profile.sessionLength || 'unlimited'} cards.`}>
          <View style={styles.compactChoices}>
            {[5, 10, 20, 0].map((count) => <SmallChoice key={count} selected={questionLimit === count && !customLimit} label={count || 'All'} onPress={() => { setCustomLimit(''); setQuestionLimit(count); }} />)}
            <TextInput
              accessibilityLabel="Custom question count"
              keyboardType="number-pad"
              maxLength={3}
              onChangeText={(value) => {
                const digits = value.replace(/\D/g, '');
                const amount = digits ? Math.max(1, Math.min(100, Number(digits))) : null;
                setCustomLimit(amount ? String(amount) : '');
                if (amount) setQuestionLimit(amount);
              }}
              placeholder="Custom"
              placeholderTextColor={colors.slate}
              style={styles.customCount}
              value={customLimit}
            />
          </View>
        </SetupSection>

        <AppButton disabled={busy} icon="play" label={busy ? 'Building practice…' : 'Start test'} onPress={() => void beginTest()} />
      </ScrollView>
      </AppShell>
    );
  }

  if (phase === 'results') {
    const accuracy = questions.length ? Math.round((correctCount / questions.length) * 100) : 0;
    return (
      <AppShell active="study">
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.resultHero}>
          <View style={styles.scoreRing}><Text style={styles.score}>{accuracy}%</Text><Text style={styles.scoreLabel}>ACCURACY</Text></View>
          <View style={styles.resultCopy}>
            <Text style={styles.eyebrowDark}>TEST COMPLETE</Text>
            <Text style={styles.resultTitle}>{correctCount} of {questions.length} concepts recalled</Text>
            <Text style={styles.body}>{missedCards.length ? `${missedCards.length} missed concept${missedCards.length === 1 ? ' is' : 's are'} now prioritized in your repair queue.` : 'Strong result. Confident answers now follow their FSRS schedule.'}</Text>
          </View>
        </View>
        <View style={styles.actions}>
          {missedCards.length ? <AppButton icon="fitness-outline" label="Repair missed cards" onPress={() => router.push({ pathname: '/study', params: { deckId: moduleId ? undefined : deckId === 'all' ? undefined : deckId, moduleId: moduleId || undefined, focus: 'weak' } })} /> : null}
          {missedCards.length ? <AppButton icon="refresh-outline" label="Retest misses" variant="secondary" onPress={() => void beginTest(missedCards)} /> : null}
          <AppButton icon="options-outline" label="New test" variant="secondary" onPress={() => setPhase('setup')} />
        </View>
        {missedCards.length ? <View style={styles.section}><Text style={styles.sectionTitle}>Concepts to repair</Text>{missedCards.map((card) => <View key={card.id} style={styles.reviewCard}><Text style={styles.questionText}>{card.prompt}</Text><StructuredAnswer answer={card.answer} variant="study" /></View>)}</View> : null}
      </ScrollView>
      </AppShell>
    );
  }

  if (!current) {
    return (
      <AppShell active="study">
        <LoadingState label="Preparing question" />
      </AppShell>
    );
  }
  const awaitingConfidence =
    (current.type === 'multiple-choice' || current.type === 'true-false') && selectedOptionId && !feedback;

  return (
    <AppShell active="study">
    <ScrollView contentContainerStyle={styles.testContainer} keyboardShouldPersistTaps="handled">
      <View style={styles.testHeader}>
        <View style={styles.testTopline}><Text style={styles.testMeta}>QUESTION {questionIndex + 1} OF {questions.length}</Text><Text style={styles.typePill}>{questionTypeLabel(current.type)}</Text></View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(4, progress * 100)}%` }]} /></View>
      </View>

      <View style={styles.questionCard}>
        <Text style={styles.deckLabel}>{current.card.deckTitle} · {current.card.cardType.replace(/-/g, ' ')}</Text>
        <Text style={styles.questionTextLarge}>{current.prompt}</Text>
      </View>

      {current.type === 'true-false' && current.proposedAnswer ? (
        <View style={styles.proposedPanel}>
          <Text style={styles.proposedLabel}>PROPOSED ANSWER</Text>
          <Text style={styles.proposedAnswer}>{current.proposedAnswer}</Text>
        </View>
      ) : null}

      {current.type === 'multiple-choice' || current.type === 'true-false' ? (
        <View style={styles.optionList}>{current.options.map((option, index) => {
          const selected = selectedOptionId === option.id;
          const showResult = Boolean(feedback);
          const correct = option.id === current.correctOptionId;
          return <Pressable disabled={Boolean(feedback) || busy} key={option.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => setSelectedOptionId(option.id)} style={({ pressed }) => [styles.answerOption, selected && styles.answerOptionSelected, showResult && correct && styles.answerOptionCorrect, showResult && selected && !correct && styles.answerOptionWrong, pressed && styles.pressed]}><Text style={[styles.optionLetter, (selected || (showResult && correct)) && styles.optionLetterSelected]}>{current.type === 'true-false' ? (index === 0 ? 'YES' : 'NO') : String.fromCharCode(65 + index)}</Text><Text style={styles.answerOptionText}>{option.label}</Text></Pressable>;
        })}</View>
      ) : (
        <View style={styles.writtenPanel}>
          <TextInput multiline editable={!showWrittenAnswer} value={writtenResponse} onChangeText={setWrittenResponse} placeholder="Recall the answer in your own words…" placeholderTextColor={colors.slate} style={styles.writtenInput} />
          {!showWrittenAnswer ? <AppButton disabled={!writtenResponse.trim()} icon="eye-outline" label="Compare answer" onPress={() => setShowWrittenAnswer(true)} /> : null}
        </View>
      )}

      {awaitingConfidence ? <ConfidenceRow disabled={busy} onChoose={(confidence) => void submitAnswer(selectedOptionId === current.correctOptionId, confidence, current.options.find((option) => option.id === selectedOptionId)?.label ?? '')} /> : null}

      {showWrittenAnswer && !feedback ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackTitle}>Compare meaning, not exact wording</Text>
          <StructuredAnswer answer={current.correctAnswer} variant="study" />
          <View style={styles.actions}>
            <AppButton disabled={busy} label="I missed it" variant="danger" onPress={() => void submitAnswer(false, 'unsure', writtenResponse)} />
            <AppButton disabled={busy} label="Partly recalled" variant="secondary" onPress={() => void submitAnswer(true, 'unsure', writtenResponse)} />
            <AppButton disabled={busy} label="I knew it" onPress={() => void submitAnswer(true, 'confident', writtenResponse)} />
          </View>
        </View>
      ) : null}

      {feedback ? (
        <View style={[styles.feedbackCard, feedback.correct ? styles.feedbackCorrect : styles.feedbackWrong]}>
          <View style={styles.feedbackHeading}><Ionicons name={feedback.correct ? 'checkmark-circle' : 'refresh-circle'} size={24} color={feedback.correct ? colors.green : colors.coral} /><Text style={styles.feedbackTitle}>{feedback.correct ? (feedback.confidence === 'unsure' ? 'Correct, but keep it close' : 'Correct') : feedback.confidence !== 'unsure' ? 'Confident miss · urgent repair added' : 'Added to your repair queue'}</Text></View>
          <StructuredAnswer answer={feedback.question.correctAnswer} variant="study" />
          <AppButton disabled={busy} icon="arrow-forward" label={questionIndex + 1 === questions.length ? 'See results' : 'Next question'} onPress={() => void goNext()} />
        </View>
      ) : null}
    </ScrollView>
    </AppShell>
  );
}

function ConfidenceRow({ disabled, onChoose }: { disabled: boolean; onChoose: (value: TestConfidence) => void }) {
  return <View style={styles.confidencePanel}><View><Text style={styles.feedbackTitle}>How sure were you?</Text><Text style={styles.body}>Confidence helps Barion schedule the concept honestly.</Text></View><View style={styles.actions}><AppButton disabled={disabled} label="I guessed" variant="secondary" onPress={() => onChoose('unsure')} /><AppButton disabled={disabled} label="Confident" onPress={() => onChoose('confident')} /><AppButton disabled={disabled} label="Very easy" variant="quiet" onPress={() => onChoose('easy')} /></View></View>;
}

function parseScope(value?: string): TestScope {
  return value === 'weak' || value === 'all' || value === 'due' ? value : 'due';
}

function parseFormat(value?: string): TestFormat {
  return value === 'clinical' || value === 'rapid-recall' || value === 'adaptive' ? value : 'adaptive';
}

function parseDirection(value?: string): TestDirection {
  return value === 'front-to-back' || value === 'back-to-front' || value === 'both' ? value : 'both';
}

function parseLimit(value?: string) {
  if (!value) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.max(0, Math.min(100, Math.round(amount)));
}

function questionTypeLabel(type: TestQuestion['type']) {
  if (type === 'multiple-choice') return 'BEST ANSWER';
  if (type === 'true-false') return 'PROPOSED ANSWER';
  return 'WRITTEN RECALL';
}

function SetupSection({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.body}>{body}</Text>{children}</View>;
}

function Choice({ selected, label, detail, recommended, onPress }: { selected: boolean; label: string; detail: string; recommended?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.pressed]}><View style={styles.choiceTopline}><Text style={styles.choiceLabel}>{label}</Text>{recommended ? <Text style={styles.recommended}>RECOMMENDED</Text> : null}{selected ? <Ionicons name="checkmark-circle" size={19} color={colors.blue} /> : null}</View><Text style={styles.choiceDetail}>{detail}</Text></Pressable>;
}

function SmallChoice({ selected, label, onPress }: { selected: boolean; label: string | number; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.smallChoice, selected && styles.smallChoiceSelected]}><Text style={[styles.smallChoiceText, selected && styles.smallChoiceTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  answerOption: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 68, padding: 13 },
  answerOptionCorrect: { backgroundColor: '#eaf8f2', borderColor: colors.green },
  answerOptionSelected: { backgroundColor: colors.surfaceMuted, borderColor: colors.blue, borderWidth: 2 },
  answerOptionText: { color: colors.ink, flex: 1, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 21 },
  answerOptionWrong: { backgroundColor: colors.dangerSurface, borderColor: colors.coral },
  body: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  choice: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 1, gap: 5, minHeight: 76, minWidth: 185, padding: 12 },
  choiceDetail: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11 },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceLabel: { color: colors.ink, flex: 1, fontFamily: fonts.bold, fontSize: 13 },
  choiceSelected: { backgroundColor: colors.surfaceMuted, borderColor: colors.blue, borderWidth: 2 },
  choiceTopline: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  compactChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  customCount: { backgroundColor: colors.canvas, borderColor: colors.lineStrong, borderRadius: radii.sm, borderWidth: 1, color: colors.ink, fontFamily: fonts.bold, fontSize: 13, minHeight: 44, minWidth: 96, paddingHorizontal: 12 },
  confidencePanel: { backgroundColor: colors.surface, borderColor: colors.lineStrong, borderRadius: radii.md, borderWidth: 1, gap: 12, padding: 15 },
  container: { gap: 17, marginHorizontal: 'auto', maxWidth: 1040, padding: 18, paddingBottom: 48, width: '100%' },
  deckLabel: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
  eyebrow: { color: '#c8dbf7', fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2 },
  eyebrowDark: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2 },
  feedbackCard: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 13, padding: 17 },
  feedbackCorrect: { borderColor: '#b9e2d4' },
  feedbackHeading: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  feedbackTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 16 },
  feedbackWrong: { borderColor: '#f0c1c6' },
  hero: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radii.lg, flexDirection: 'row', flexWrap: 'wrap', gap: 15, padding: 22 },
  heroBody: { color: '#d8e5f7', fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  heroCopy: { flex: 1, gap: 6, minWidth: 230 },
  heroIcon: { alignItems: 'center', backgroundColor: colors.blue, borderRadius: 16, height: 56, justifyContent: 'center', width: 56 },
  heroTitle: { color: colors.surface, fontFamily: fonts.extraBold, fontSize: 26 },
  objective: { alignItems: 'center', backgroundColor: colors.warningSurface, borderRadius: radii.md, flexDirection: 'row', gap: 8, padding: 11 },
  objectiveText: { color: colors.inkSoft, flex: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 },
  optionLetter: { backgroundColor: colors.surfaceMuted, borderRadius: 10, color: colors.blueDark, fontFamily: fonts.bold, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 7 },
  optionLetterSelected: { backgroundColor: colors.blue, color: colors.surface },
  optionList: { gap: 9 },
  pressed: { opacity: 0.8 },
  proposedAnswer: { color: colors.ink, fontFamily: fonts.bold, fontSize: 17, lineHeight: 25 },
  proposedLabel: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.9 },
  proposedPanel: { backgroundColor: colors.surfaceMuted, borderColor: colors.lineStrong, borderRadius: radii.md, borderWidth: 1, gap: 8, padding: 14 },
  progressFill: { backgroundColor: colors.blue, borderRadius: radii.pill, height: '100%' },
  progressTrack: { backgroundColor: colors.line, borderRadius: radii.pill, height: 7, overflow: 'hidden' },
  questionCard: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 12, padding: 20 },
  questionText: { color: colors.ink, fontFamily: fonts.bold, fontSize: 15, lineHeight: 22 },
  questionTextLarge: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 23, lineHeight: 32 },
  recommended: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 0.5 },
  resumeCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.blue, borderRadius: radii.lg, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 14, padding: 17 },
  resumeCopy: { flex: 1, gap: 6, minWidth: 220 },
  resumeEyebrow: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1 },
  resumeIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 14, height: 48, justifyContent: 'center', width: 48 },
  resumeTitle: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 18 },
  resultCopy: { flex: 1, gap: 5, minWidth: 220 },
  resultHero: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.lg, flexDirection: 'row', flexWrap: 'wrap', gap: 17, padding: 22 },
  resultTitle: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 24, lineHeight: 31 },
  reviewCard: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, gap: 11, padding: 14 },
  score: { color: colors.surface, fontFamily: fonts.extraBold, fontSize: 24 },
  scoreLabel: { color: '#d9e7fb', fontFamily: fonts.bold, fontSize: 8, letterSpacing: 0.7 },
  scoreRing: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: 999, height: 92, justifyContent: 'center', width: 92 },
  section: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 10, padding: 17 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 18 },
  smallChoice: { alignItems: 'center', backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.pill, borderWidth: 1, minWidth: 64, paddingHorizontal: 15, paddingVertical: 10 },
  smallChoiceSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  smallChoiceText: { color: colors.ink, fontFamily: fonts.bold, fontSize: 13 },
  smallChoiceTextSelected: { color: colors.surface },
  testContainer: { gap: 14, marginHorizontal: 'auto', maxWidth: 820, padding: 18, paddingBottom: 44, width: '100%' },
  testHeader: { gap: 9 },
  testMeta: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.9 },
  testTopline: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  typePill: { backgroundColor: colors.surfaceTeal, borderRadius: radii.pill, color: colors.tealDark, fontFamily: fonts.bold, fontSize: 9, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 6 },
  writtenInput: { backgroundColor: colors.surface, borderColor: colors.lineStrong, borderRadius: radii.md, borderWidth: 1, color: colors.ink, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, minHeight: 130, padding: 14, textAlignVertical: 'top' },
  writtenPanel: { gap: 10 },
});
