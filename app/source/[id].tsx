import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, LoadingState } from '@/components/ScreenState';
import { getSourceStatusMeta, SourceStatusPill } from '@/components/SourceStatusPill';
import { StructuredAnswer } from '@/components/StructuredAnswer';
import { describeStudentGeneration, GENERATION_FAILURE_ALERT } from '@/ai/generationExperience';
import type { GeneratedCandidate, SourceDetail } from '@/domain/types';
import { initializeDatabase } from '@/storage/database';
import {
  approveCandidate,
  archiveSource,
  deleteSourceCardsToTrash,
  deleteSourceToTrash,
  generateDraftsForSource,
  getSourceDetail,
  rejectCandidate,
  refreshStudyGuideForSource,
  retrySourceProcessing,
  updateCandidateDraft,
} from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

const pipelineSteps = [
  { label: 'Imported', icon: 'cloud-done-outline' as const },
  { label: 'Extracted', icon: 'scan-outline' as const },
  { label: 'Guide', icon: 'book-outline' as const },
  { label: 'Cards built', icon: 'sparkles-outline' as const },
  { label: 'Ready', icon: 'play-circle-outline' as const },
];

export default function SourceDetailScreen() {
  const params = useLocalSearchParams<{ id: string; existing?: string }>();
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftQuestion, setDraftQuestion] = useState('');
  const [draftAnswer, setDraftAnswer] = useState('');
  const [showSourceDetails, setShowSourceDetails] = useState(false);
  const [showFullGuide, setShowFullGuide] = useState(false);
  const [confirmation, setConfirmation] = useState<'cards' | 'source' | null>(null);

  const applyLoadedData = useCallback((detail: SourceDetail | null) => {
    setSource(detail);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!params.id) return;
    await initializeDatabase();
    const detail = await getSourceDetail(params.id);
    applyLoadedData(detail);
  }, [applyLoadedData, params.id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      void (async () => {
        if (!params.id) return;
        await initializeDatabase();
        const detail = await getSourceDetail(params.id);
        if (active) applyLoadedData(detail);
      })();
      return () => {
        active = false;
      };
    }, [applyLoadedData, params.id]),
  );

  const pendingCandidates = useMemo(
    () => source?.candidates.filter((candidate) => candidate.status === 'pending') ?? [],
    [source],
  );
  async function runAction(key: string, action: () => Promise<unknown>) {
    setActionId(key);
    try {
      await action();
      await refresh();
    } catch (error) {
      Alert.alert('That action did not finish', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setActionId(null);
    }
  }

  async function runGeneration() {
    if (!source) return;
    setActionId('generate');
    let failed = false;
    try {
      await generateDraftsForSource(source.id);
    } catch {
      failed = true;
    }

    try {
      await refresh();
    } catch {
      failed = true;
    } finally {
      setActionId(null);
    }

    if (failed) {
      Alert.alert(GENERATION_FAILURE_ALERT.title, GENERATION_FAILURE_ALERT.body);
    }
  }

  function beginEditing(candidate: GeneratedCandidate) {
    setEditingId(candidate.id);
    setDraftQuestion(candidate.question);
    setDraftAnswer(candidate.answer);
  }

  function confirmReject(candidateId: string) {
    Alert.alert('Reject this draft?', 'It will not be added to a deck. You can regenerate drafts later.', [
      { text: 'Keep draft', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: () => void runAction(candidateId, () => rejectCandidate(candidateId)),
      },
    ]);
  }

  async function archiveCurrentSource() {
    if (!source) return;
    setActionId('archive');
    try {
      await archiveSource(source.id);
      router.replace('/library');
    } catch (error) {
      Alert.alert('Archive did not finish', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setActionId(null);
    }
  }

  async function confirmRemoval() {
    if (!source || !confirmation) return;
    const kind = confirmation;
    setActionId(`delete-${kind}`);
    try {
      if (kind === 'cards') {
        await deleteSourceCardsToTrash(source.id);
        setConfirmation(null);
        await refresh();
      } else {
        await deleteSourceToTrash(source.id);
        setConfirmation(null);
        router.replace('/library');
      }
    } catch (error) {
      Alert.alert('Removal did not finish', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setActionId(null);
    }
  }

  if (loading) return <LoadingState label="Opening this source" />;
  if (!source) return <EmptyState title="Source not found" body="This local source is not available." />;

  const statusMeta = getSourceStatusMeta(source.status);
  const isBusy = source.status === 'importing' || source.status === 'parsing' || source.status === 'generating';
  const canRetry = source.status === 'action-required' || source.status === 'failed';
  const hasGuide = Boolean(source.studyGuide?.outline.length || source.studyGuide?.quickReference.length);
  const pipelineStage = source.status === 'ready'
    ? 5
    : source.sourceCardCount || pendingCandidates.length
      ? 4
      : hasGuide
        ? 3
        : source.segmentCount
          ? 2
          : 1;
  const readyCardCount = Math.max(0, source.sourceCardCount - source.needsReviewCardCount);
  const guide = source.studyGuide;
  const generationExperience = describeStudentGeneration(
    source.generationJob,
    source.sourceCardCount,
    source.defaultDeckTitle || 'this source set',
  );
  const visibleOutline = guide ? guide.outline.slice(0, showFullGuide ? guide.outline.length : 4) : [];
  const visibleQuickReference = guide ? guide.quickReference.slice(0, showFullGuide ? guide.quickReference.length : 8) : [];
  const visibleQuestions = guide ? guide.discussionQuestions.slice(0, showFullGuide ? guide.discussionQuestions.length : 3) : [];

  return (
    <>
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {params.existing === '1' ? (
        <View style={styles.duplicateNotice}>
          <Ionicons name="checkmark-circle" size={19} color={colors.green} />
          <View style={styles.duplicateCopy}>
            <Text style={styles.cardTitle}>Already in your library</Text>
            <Text style={styles.smallText}>Barion opened the existing study set. No duplicate source or cards were added.</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.hero}>
        <View style={styles.documentIcon}>
          <Ionicons
            name={source.mimeType === 'application/pdf' ? 'document-text' : 'reader-outline'}
            size={27}
            color={colors.blue}
          />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>SOURCE WORKSPACE</Text>
          <Text style={styles.title}>{source.title}</Text>
          <Text numberOfLines={2} style={styles.filename}>{source.filename}</Text>
          <SourceStatusPill status={source.status} />
        </View>
      </View>

      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <View style={styles.statusCopy}>
            <Text style={styles.sectionTitle}>{statusMeta.label}</Text>
            <Text style={styles.bodyText}>{source.ingestionError || statusMeta.description}</Text>
          </View>
          <Text style={styles.progressValue}>{Math.round(statusMeta.progress * 100)}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${statusMeta.progress * 100}%` }]} />
        </View>
        <View style={styles.pipeline}>
          {pipelineSteps.map((step, index) => {
            const complete = index < pipelineStage;
            const current = index === pipelineStage && pipelineStage < pipelineSteps.length;
            return (
              <View key={step.label} style={styles.pipelineStep}>
                <View style={[styles.pipelineIcon, complete && styles.pipelineIconComplete, current && styles.pipelineIconCurrent]}>
                  <Ionicons
                    name={complete ? 'checkmark' : step.icon}
                    size={16}
                    color={complete ? colors.surface : current ? colors.blue : colors.slate}
                  />
                </View>
                <Text style={[styles.pipelineLabel, (complete || current) && styles.pipelineLabelActive]}>{step.label}</Text>
              </View>
            );
          })}
        </View>
        {canRetry ? (
          <View style={styles.issueActions}>
            <AppButton
              disabled={actionId === 'retry'}
              icon="refresh"
              label={actionId === 'retry' ? 'Trying again…' : 'Try processing again'}
              onPress={() => void runAction('retry', () => retrySourceProcessing(source.id))}
            />
            <AppButton icon="add" label="Choose another file" variant="secondary" onPress={() => router.replace('/sources')} />
          </View>
        ) : null}
        {isBusy ? <Text style={styles.busyNote}>Keep Barion open until deck preparation finishes.</Text> : null}
      </View>

      {guide ? (
        <View style={styles.guidePanel}>
          <View style={styles.guideHeader}>
            <View style={styles.guideIcon}>
              <Ionicons name="book-outline" size={25} color={colors.surface} />
            </View>
            <View style={styles.guideCopy}>
              <Text style={styles.eyebrow}>STUDY GUIDE FIRST</Text>
              <Text style={styles.guideTitle}>{guide.title}</Text>
              <Text style={styles.bodyText}>{guide.overview}</Text>
            </View>
          </View>

          <View style={styles.guideActions}>
            <AppButton
              disabled={!readyCardCount}
              icon="albums-outline"
              label="Flashcards"
              onPress={() => router.push({ pathname: '/study', params: { deckId: source.defaultDeckId! } })}
            />
            <AppButton
              disabled={!readyCardCount}
              icon="help-circle-outline"
              label="Practice questions"
              variant="secondary"
              onPress={() => router.push({
                pathname: '/test',
                params: {
                  autoStart: '1',
                  deckId: source.defaultDeckId!,
                  direction: 'front-to-back',
                  format: 'clinical',
                  scope: 'all',
                },
              })}
            />
            <AppButton
              disabled={actionId === 'guide'}
              icon="refresh-outline"
              label={actionId === 'guide' ? 'Refreshing...' : 'Refresh guide'}
              variant="quiet"
              onPress={() => void runAction('guide', () => refreshStudyGuideForSource(source.id))}
            />
          </View>

          {visibleOutline.length ? (
            <View style={styles.guideBlock}>
              <View style={styles.guideBlockHeading}>
                <Text style={styles.guideBlockTitle}>Outline</Text>
                <Text style={styles.guideCount}>{guide.outline.length}</Text>
              </View>
              {visibleOutline.map((section) => (
                <View key={section.id} style={styles.outlineSection}>
                  <View style={styles.outlineTitleRow}>
                    <View style={[styles.emphasisDot, emphasisDotStyle(section.emphasis)]} />
                    <Text style={styles.outlineTitle}>{section.title}</Text>
                  </View>
                  {section.bullets.map((bullet, index) => (
                    <View key={`${section.id}-${index}`} style={styles.bulletRow}>
                      <View style={styles.bulletDot} />
                      <Text style={styles.bulletText}>{bullet}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : null}

          {visibleQuickReference.length ? (
            <View style={styles.guideBlock}>
              <View style={styles.guideBlockHeading}>
                <Text style={styles.guideBlockTitle}>Quick reference</Text>
                <Text style={styles.guideCount}>{guide.quickReference.length}</Text>
              </View>
              <View style={styles.referenceGrid}>
                {visibleQuickReference.map((item) => (
                  <View key={item.id} style={styles.referenceItem}>
                    <Text style={styles.referenceTerm}>{item.term}</Text>
                    <Text style={styles.referenceDetail}>{item.detail}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {visibleQuestions.length ? (
            <View style={styles.guideBlock}>
              <View style={styles.guideBlockHeading}>
                <Text style={styles.guideBlockTitle}>Discussion questions</Text>
                <Text style={styles.guideCount}>{guide.discussionQuestions.length}</Text>
              </View>
              {visibleQuestions.map((question) => (
                <View key={question.id} style={styles.discussionItem}>
                  <View style={styles.discussionTopline}>
                    <Text style={styles.discussionPrompt}>{question.prompt}</Text>
                    <Text style={styles.difficultyPill}>{question.difficulty}</Text>
                  </View>
                  <Text style={styles.discussionAnswer}>{question.answer}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {guide.outline.length > 4 || guide.quickReference.length > 8 || guide.discussionQuestions.length > 3 ? (
            <Pressable accessibilityRole="button" onPress={() => setShowFullGuide((value) => !value)} style={styles.expandGuide}>
              <Text style={styles.expandGuideText}>{showFullGuide ? 'Show less' : 'Show complete guide'}</Text>
              <Ionicons name={showFullGuide ? 'chevron-up' : 'chevron-down'} size={18} color={colors.blueDark} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {source.defaultDeckId ? (
        <View style={styles.studySetCard}>
          <View style={styles.studySetIcon}>
            <Ionicons name="albums" size={25} color={colors.surface} />
          </View>
          <View style={styles.studySetCopy}>
            <Text style={styles.eyebrow}>AUTOMATIC STUDY SET</Text>
            <Text style={styles.studySetTitle}>{source.defaultDeckTitle || source.title}</Text>
            <Text style={styles.bodyText}>
              {readyCardCount} ready card{readyCardCount === 1 ? '' : 's'} · {source.needsReviewCardCount} held for source check
            </Text>
          </View>
          {generationExperience.basicModeNotice ? (
            <View style={styles.basicModeNotice}>
              <Ionicons name="cloud-offline-outline" size={18} color={colors.blueDark} />
              <Text style={styles.basicModeText}>{generationExperience.basicModeNotice}</Text>
            </View>
          ) : null}
          <AppButton
            disabled={!readyCardCount}
            icon="play"
            label="Start studying"
            onPress={() => router.push({ pathname: '/study', params: { deckId: source.defaultDeckId! } })}
          />
          <AppButton
            disabled={!readyCardCount}
            icon="school-outline"
            label="Test this source"
            variant="secondary"
            onPress={() => router.push({ pathname: '/test', params: { deckId: source.defaultDeckId!, scope: 'all' } })}
          />
        </View>
      ) : null}

      {source.needsReviewCardCount ? (
        <View style={styles.sourceCheckPanel}>
          <View style={styles.sourceCheckIcon}>
            <Ionicons name="alert-circle-outline" size={22} color="#9a5b09" />
          </View>
          <View style={styles.sourceCheckCopy}>
            <Text style={styles.cardTitle}>Some cards are held for source check</Text>
            <Text style={styles.bodyText}>
              These cards are hidden from study and tests until their wording is checked against the source evidence.
            </Text>
          </View>
          {source.defaultDeckId ? (
            <AppButton
              icon="open-outline"
              label="Open set"
              variant="secondary"
              onPress={() => router.push({ pathname: '/deck/[id]', params: { id: source.defaultDeckId! } })}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.factGrid}>
        <Fact icon="albums-outline" label="Study cards" value={String(source.sourceCardCount)} />
        <Fact icon="shield-checkmark-outline" label="Verified cards" value={String(source.verifiedCardCount)} />
        <Fact icon="alert-circle-outline" label="Source checks" value={String(source.needsReviewCardCount)} />
        <Fact icon="create-outline" label="Needs attention" value={String(pendingCandidates.length)} />
        <Fact icon="document-text-outline" label="Source sections" value={String(source.segmentCount)} />
      </View>

      {pendingCandidates.length ? (
        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <View style={styles.headingCopy}>
              <Text style={styles.eyebrow}>ONLY WHEN NEEDED</Text>
              <Text style={styles.sectionTitle}>Check these exceptions</Text>
              <Text style={styles.bodyText}>Barion publishes safe extractive cards automatically. Only uncertain or edited cards stop here.</Text>
            </View>
            <Text style={styles.countBadge}>{pendingCandidates.length}</Text>
          </View>

          {pendingCandidates.map((candidate, index) => {
            const editing = editingId === candidate.id;
            const acting = actionId === candidate.id;
            const evaluation = parseCandidateEvaluation(candidate.evaluationJson);
            const problematicClaim = evaluation ? firstProblematicClaim(evaluation) : null;
            return (
              <View key={candidate.id} style={styles.candidateCard}>
                <View style={styles.candidateTopline}>
                  <Text style={styles.candidateNumber}>DRAFT {String(index + 1).padStart(2, '0')}</Text>
                  <View style={styles.badgeRow}>
                    <View style={styles.typeBadge}>
                      <Text style={styles.typeBadgeText}>{formatCardType(candidate.cardType)}</Text>
                    </View>
                    {candidate.qualityScore ? (
                      <View style={styles.qualityBadge}>
                        <Ionicons name="sparkles-outline" size={13} color={colors.blueDark} />
                        <Text style={styles.qualityBadgeText}>{Math.round(candidate.qualityScore * 100)}%</Text>
                      </View>
                    ) : null}
                    <View style={styles.groundedBadge}>
                      <Ionicons
                        name={candidate.verificationStatus === 'user-edited' ? 'create-outline' : 'link-outline'}
                        size={14}
                        color={colors.tealDark}
                      />
                      <Text style={styles.groundedText}>
                        {candidate.verificationStatus === 'user-edited' ? 'Edited · re-check evidence' : 'Source linked'}
                      </Text>
                    </View>
                  </View>
                </View>

                {candidate.learningObjective ? (
                  <View style={styles.objectivePanel}>
                    <Ionicons name="bulb-outline" size={17} color={colors.gold} />
                    <Text style={styles.objectiveText}>{candidate.learningObjective}</Text>
                  </View>
                ) : null}

                {editing ? (
                  <View style={styles.editor}>
                    <Text style={styles.fieldLabel}>QUESTION</Text>
                    <TextInput multiline value={draftQuestion} onChangeText={setDraftQuestion} style={styles.editorInput} />
                    <Text style={styles.fieldLabel}>ANSWER</Text>
                    <TextInput multiline value={draftAnswer} onChangeText={setDraftAnswer} style={[styles.editorInput, styles.answerInput]} />
                    <Text style={styles.editWarning}>
                      Edited wording stays linked to this evidence, but Barion will flag it for review instead of calling it automatically verified.
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.question}>{candidate.question}</Text>
                    <StructuredAnswer answer={candidate.answer} variant="candidate" />
                  </>
                )}

                <View style={styles.evidencePanel}>
                  <View style={styles.evidenceTopline}>
                    <Ionicons name="document-text-outline" size={17} color={colors.teal} />
                    <Text style={styles.evidenceLabel}>ORIGINAL EVIDENCE · {candidate.locator}</Text>
                  </View>
                  <Text style={styles.evidenceText}>{candidate.evidenceText}</Text>
                  {candidate.evidenceSpanJson ? (
                    <Text style={styles.spanMeta}>{formatSpanProvenance(candidate.evidenceSpanJson)}</Text>
                  ) : (
                    <Text style={styles.spanWarning}>Legacy evidence link · exact span unavailable</Text>
                  )}
                </View>

                {evaluation ? (
                  <View style={styles.holdPanel}>
                    <Text style={styles.holdTitle}>{evaluation.publicationDisposition} · {explainDisposition(evaluation)}</Text>
                    <Text style={styles.holdDetail}>Grounding: {evaluation.sourceClaimSupported} · Citation: {evaluation.citationStatus}</Text>
                    <Text style={styles.holdDetail}>Medical verification: {evaluation.medicalVerificationStatus}</Text>
                    {problematicClaim ? (
                      <Text style={styles.holdDetail}>
                        Claim held ({formatEvaluationField(problematicClaim.field)} · {problematicClaim.sourceSupport}): {problematicClaim.claimText}
                      </Text>
                    ) : null}
                    {problematicClaim?.supportingEvidence[0] ? (
                      <Text style={styles.holdDetail}>Supporting source: {problematicClaim.supportingEvidence[0].text}</Text>
                    ) : null}
                    {problematicClaim?.contradictionEvidence[0] ? (
                      <Text style={styles.holdDetail}>Conflict: {problematicClaim.contradictionEvidence[0]}</Text>
                    ) : null}
                    {evaluation.sanitization ? (
                      <Text style={styles.holdDetail}>Sanitization: {evaluation.sanitization.reason}</Text>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.candidateActions}>
                  {editing ? (
                    <>
                      <AppButton
                        disabled={acting || !draftQuestion.trim() || !draftAnswer.trim()}
                        label={acting ? 'Saving…' : 'Save draft'}
                        icon="checkmark"
                        onPress={() => void runAction(candidate.id, async () => {
                          await updateCandidateDraft(candidate.id, draftQuestion, draftAnswer);
                          setEditingId(null);
                        })}
                      />
                      <AppButton label="Cancel" variant="quiet" onPress={() => setEditingId(null)} />
                    </>
                  ) : (
                    <>
                      {evaluation?.publicationDisposition === 'REJECT' ? (
                        <AppButton disabled label="Blocked by quality gate" icon="shield-outline" onPress={() => undefined} />
                      ) : (
                        <AppButton
                          disabled={acting || !source.defaultDeckId}
                          label={acting ? 'Adding…' : 'Approve card'}
                          icon="checkmark-circle-outline"
                          onPress={() => void runAction(candidate.id, () => approveCandidate(candidate.id, source.defaultDeckId!))}
                        />
                      )}
                      <AppButton label="Edit" icon="create-outline" variant="secondary" onPress={() => beginEditing(candidate)} />
                      <AppButton label="Reject" icon="close" variant="quiet" onPress={() => confirmReject(candidate.id)} />
                    </>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ) : source.segmentCount > 0 && !isBusy ? (
        <View style={styles.completePanel}>
          <View style={styles.completeIcon}>
            <Ionicons name="checkmark-done" size={26} color={colors.green} />
          </View>
          <View style={styles.completeCopy}>
            <Text style={styles.cardTitle}>{generationExperience.title}</Text>
            <Text style={styles.bodyText}>{generationExperience.body}</Text>
          </View>
          {source.sha256 === 'built-in-curated-demo-v1' ? (
            <View style={styles.curatedBadge}><Ionicons name="shield-checkmark" size={16} color={colors.tealDark} /><Text style={styles.curatedText}>Curated demo set</Text></View>
          ) : (
            <AppButton
              disabled={actionId === 'generate'}
              label={actionId === 'generate' ? 'Refreshing…' : 'Refresh from source'}
              icon="refresh-outline"
              variant="secondary"
              onPress={() => void runGeneration()}
            />
          )}
        </View>
      ) : null}

      <View style={styles.managePanel}>
        <View style={styles.manageHeading}>
          <View style={styles.manageIcon}>
            <Ionicons name="options-outline" size={21} color={colors.blue} />
          </View>
          <View style={styles.manageCopy}>
            <Text style={styles.cardTitle}>Manage this study set</Text>
            <Text style={styles.smallText}>Pause it, remove untouched auto-created cards, or move the complete source set to recoverable trash.</Text>
          </View>
        </View>
        <View style={styles.manageActions}>
          <AppButton
            disabled={actionId === 'archive'}
            icon="archive-outline"
            label={actionId === 'archive' ? 'Archiving…' : 'Archive set'}
            variant="secondary"
            onPress={() => void archiveCurrentSource()}
          />
          <AppButton
            disabled={!source.autoGeneratedCardCount}
            icon="layers-outline"
            label="Remove auto-created cards"
            variant="secondary"
            onPress={() => setConfirmation('cards')}
          />
          <AppButton icon="trash-outline" label="Move set to Trash" variant="danger" onPress={() => setConfirmation('source')} />
        </View>
      </View>

      <View style={styles.sourceDetailsPanel}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showSourceDetails }}
          onPress={() => setShowSourceDetails((value) => !value)}
          style={styles.sourceDetailsToggle}
        >
          <View style={styles.sourceDetailsLabel}>
            <Ionicons name="document-text-outline" size={19} color={colors.blue} />
            <View>
              <Text style={styles.cardTitle}>Source details</Text>
              <Text style={styles.smallText}>Evidence excerpts and file information</Text>
            </View>
          </View>
          <Ionicons name={showSourceDetails ? 'chevron-up' : 'chevron-down'} size={20} color={colors.slate} />
        </Pressable>

        {showSourceDetails ? (
          <View style={styles.sourceDetailsContent}>
            <View style={styles.sectionHeading}>
              <View style={styles.headingCopy}>
                <Text style={styles.eyebrow}>TRACEABLE SOURCE TEXT</Text>
                <Text style={styles.sectionTitle}>Evidence sections</Text>
                <Text style={styles.bodyText}>Every card keeps a link back to one of these excerpts.</Text>
              </View>
              <Text style={styles.countBadge}>{source.segments.length}</Text>
            </View>
            {source.segments.length ? source.segments.map((segment) => (
              <View key={segment.id} style={styles.segment}>
                <View style={styles.segmentTopline}>
                  <Text style={styles.segmentLocator}>{segment.locator}</Text>
                  <Text numberOfLines={1} style={styles.segmentPath}>{segment.sectionPath}</Text>
                </View>
                <Text style={styles.segmentText}>{segment.text}</Text>
              </View>
            )) : (
              <View style={styles.emptySegment}>
                <Ionicons name="scan-outline" size={23} color={colors.slate} />
                <Text style={styles.smallText}>{isBusy ? 'Text extraction is still underway.' : 'No readable evidence sections were created from this file.'}</Text>
              </View>
            )}

            <View style={styles.fileDetails}>
              <Text style={styles.fileDetailsTitle}>File record</Text>
              <Text style={styles.fileDetail}>Type: {source.mimeType}</Text>
              <Text selectable style={styles.hash}>SHA-256: {source.sha256}</Text>
              <Text style={styles.fileDetail}>Imported: {new Date(source.createdAt).toLocaleString()}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
    <ConfirmDialog
      body={
        confirmation === 'cards'
          ? `The imported source and study set remain available. ${source.autoGeneratedCardCount} untouched auto-created cards are hidden; manual and edited cards stay in place.`
          : 'The source, its automatic deck, and every card in that deck are hidden. You can restore the complete set from Manage Library.'
      }
      busy={actionId === `delete-${confirmation}`}
      confirmLabel={confirmation === 'cards' ? 'Remove cards' : 'Move set to Trash'}
      reviewedCardCount={confirmation === 'cards' ? source.autoGeneratedReviewedCardCount : source.reviewedCardCount}
      title={confirmation === 'cards' ? 'Remove auto-created cards?' : 'Move this source set to Trash?'}
      visible={confirmation !== null}
      onCancel={() => setConfirmation(null)}
      onConfirm={() => void confirmRemoval()}
    />
    </>
  );
}

function formatCardType(cardType: string) {
  return cardType.replace(/-/g, ' ');
}

function emphasisDotStyle(emphasis: 'overview' | 'definition' | 'clinical' | 'treatment' | 'safety') {
  switch (emphasis) {
    case 'clinical':
      return styles.clinicalDot;
    case 'definition':
      return styles.definitionDot;
    case 'safety':
      return styles.safetyDot;
    case 'treatment':
      return styles.treatmentDot;
    case 'overview':
    default:
      return styles.overviewDot;
  }
}

function Fact({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={19} color={colors.blue} />
      <View>
        <Text style={styles.factValue}>{value}</Text>
        <Text style={styles.factLabel}>{label}</Text>
      </View>
    </View>
  );
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type CandidateEvaluationView = {
  publicationDisposition: string;
  reasonCodes: string[];
  sourceClaimSupported: string;
  citationStatus: string;
  medicalVerificationStatus: string;
  claimResults?: {
    claimText: string;
    field: string;
    sourceSupport: string;
    citationStatus: string;
    verificationStatus: string;
    reasonCodes: string[];
    contradictionEvidence: string[];
    supportingEvidence: { text: string }[];
  }[];
  sanitization?: { reason: string; reevaluated: boolean; finalDisposition: string };
};

function parseCandidateEvaluation(value?: string | null): CandidateEvaluationView | null {
  if (!value) return null;
  try { return JSON.parse(value) as CandidateEvaluationView; } catch { return null; }
}

function explainDisposition(evaluation: CandidateEvaluationView) {
  const code = evaluation.reasonCodes[0];
  if (code === 'SOURCE_CONFLICT') return 'Source claim conflicts with current authoritative evidence.';
  if (code === 'HIGH_RISK_UNVERIFIED') return 'High-risk claim awaits authoritative verification.';
  if (code === 'SOURCE_SPAN_UNRESOLVED' || code === 'STALE_OR_AMBIGUOUS_SOURCE_SPAN') return 'Cited text could not be uniquely located.';
  if (code === 'REMOVABLE_OPTIONAL_CLAIMS_UNSUPPORTED') return 'Optional explanation contains unsupported material.';
  if (code === 'UNSUPPORTED_CORE_CLAIM') return 'Core answer is not supported by this source.';
  if (code === 'CONTRADICTED_CORE_CLAIM') return 'Core answer conflicts with this source.';
  if (code === 'CORE_EVIDENCE_UNCERTAIN') return 'Source support is too uncertain for automatic study.';
  if (code === 'SANITIZED_CARD_FAILED_REEVALUATION') return 'Removed optional content, but remaining card still failed evaluation.';
  if (evaluation.publicationDisposition === 'REJECT') return 'Candidate failed source or safety requirements.';
  return 'Card remains held until source or safety evidence is resolved.';
}

function firstProblematicClaim(evaluation: CandidateEvaluationView) {
  return evaluation.claimResults?.find((claim) =>
    ['unsupported', 'contradicted', 'uncertain'].includes(claim.sourceSupport)
    || ['conflict', 'incorrect', 'outdated', 'authority_unavailable', 'not_performed_offline'].includes(claim.verificationStatus)
    || claim.reasonCodes.length > 0
    || claim.contradictionEvidence.length > 0,
  ) ?? null;
}

function formatEvaluationField(field: string) {
  return field.replace(/_/g, ' ');
}

function formatSpanProvenance(value: string) {
  try {
    const span = JSON.parse(value) as { status?: string; startOffset?: number | null; endOffset?: number | null };
    if (span.startOffset === null || span.startOffset === undefined || span.endOffset === null || span.endOffset === undefined) {
      return `Span ${span.status ?? 'unresolved'} · source review required`;
    }
    return `Span ${span.status ?? 'resolved'} · UTF-16 [${span.startOffset}, ${span.endOffset})`;
  } catch {
    return 'Invalid span metadata · source review required';
  }
}

const styles = StyleSheet.create({
  answerInput: { minHeight: 104 },
  badgeRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' },
  bodyText: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  basicModeNotice: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.md, flexBasis: '100%', flexDirection: 'row', gap: 9, padding: 12 },
  basicModeText: { color: colors.blueDark, flex: 1, fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  busyNote: { color: colors.blueDark, fontFamily: fonts.semibold, fontSize: 12, textAlign: 'center' },
  candidateActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  candidateCard: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 15, padding: 18 },
  candidateNumber: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2 },
  candidateTopline: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'space-between' },
  cardTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 },
  completeCopy: { flex: 1, gap: 4, minWidth: 180 },
  completeIcon: { alignItems: 'center', backgroundColor: '#eaf8f2', borderRadius: 15, height: 52, justifyContent: 'center', width: 52 },
  completePanel: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 14, padding: 18 },
  container: { gap: 20, marginHorizontal: 'auto', maxWidth: 1050, padding: 18, paddingBottom: 48, width: '100%' },
  countBadge: { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, color: colors.blueDark, fontFamily: fonts.bold, minWidth: 34, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6, textAlign: 'center' },
  curatedBadge: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: radii.pill, flexDirection: 'row', gap: 6, paddingHorizontal: 11, paddingVertical: 8 },
  curatedText: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 10 },
  deckChip: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderColor: colors.lineStrong, borderRadius: radii.pill, borderWidth: 1, flexDirection: 'row', gap: 7, minHeight: 40, paddingHorizontal: 13 },
  deckChipSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  deckChipText: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 12 },
  deckChipTextSelected: { color: colors.surface },
  deckChips: { gap: 8, paddingRight: 10 },
  deckPicker: { gap: 8 },
  documentIcon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 17, height: 58, justifyContent: 'center', width: 58 },
  duplicateCopy: { flex: 1, gap: 2 },
  duplicateNotice: { alignItems: 'center', backgroundColor: '#eaf8f2', borderColor: '#b9e2d4', borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 13 },
  clinicalDot: { backgroundColor: colors.blue },
  definitionDot: { backgroundColor: colors.indigo },
  difficultyPill: { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 5 },
  discussionAnswer: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19 },
  discussionItem: { borderTopColor: colors.line, borderTopWidth: 1, gap: 7, paddingTop: 11 },
  discussionPrompt: { color: colors.ink, flex: 1, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 },
  discussionTopline: { alignItems: 'flex-start', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  editWarning: { color: '#9a5b09', fontFamily: fonts.medium, fontSize: 11, lineHeight: 17 },
  editor: { gap: 8 },
  editorInput: { backgroundColor: colors.canvas, borderColor: colors.lineStrong, borderRadius: radii.sm, borderWidth: 1, color: colors.ink, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, minHeight: 76, padding: 12, textAlignVertical: 'top' },
  emphasisDot: { borderRadius: radii.pill, height: 9, marginTop: 6, width: 9 },
  emptySegment: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: 10, padding: 18 },
  evidenceLabel: { color: colors.tealDark, flex: 1, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.55 },
  evidencePanel: { backgroundColor: colors.surfaceTeal, borderRadius: radii.md, gap: 8, padding: 14 },
  evidenceText: { color: colors.inkSoft, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19 },
  spanMeta: { color: colors.tealDark, fontFamily: fonts.semibold, fontSize: 10 },
  spanWarning: { color: colors.coral, fontFamily: fonts.semibold, fontSize: 10 },
  evidenceTopline: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  eyebrow: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.25 },
  expandGuide: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 5, minHeight: 38, paddingRight: 8 },
  expandGuideText: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 13 },
  fact: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, flex: 1, flexBasis: 180, flexDirection: 'row', gap: 11, minWidth: 145, padding: 14 },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  factLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: 10 },
  factValue: { color: colors.ink, fontFamily: fonts.bold, fontSize: 17 },
  fieldLabel: { color: colors.inkSoft, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.9 },
  fileDetail: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 },
  fileDetails: { borderTopColor: colors.line, borderTopWidth: 1, gap: 5, paddingTop: 16 },
  fileDetailsTitle: { color: colors.inkSoft, fontFamily: fonts.bold, fontSize: 12 },
  filename: { color: colors.inkSoft, fontFamily: fonts.medium, fontSize: 12 },
  groundedBadge: { alignItems: 'center', backgroundColor: colors.surfaceTeal, borderRadius: radii.pill, flexDirection: 'row', gap: 5, paddingHorizontal: 9, paddingVertical: 6 },
  groundedText: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 10 },
  holdDetail: { color: colors.inkSoft, fontFamily: fonts.medium, fontSize: 11, lineHeight: 17 },
  holdPanel: { backgroundColor: colors.surfaceMuted, borderColor: colors.lineStrong, borderRadius: radii.sm, borderWidth: 1, gap: 4, padding: 11 },
  holdTitle: { color: colors.coral, fontFamily: fonts.bold, fontSize: 12, lineHeight: 18 },
  guideActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  guideBlock: { gap: 11 },
  guideBlockHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  guideBlockTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 16 },
  guideCopy: { flex: 1, gap: 5, minWidth: 220 },
  guideCount: { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10, minWidth: 30, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 5, textAlign: 'center' },
  guideHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 14 },
  guideIcon: { alignItems: 'center', backgroundColor: colors.indigo, borderRadius: 15, height: 52, justifyContent: 'center', width: 52 },
  guidePanel: { backgroundColor: colors.surface, borderColor: colors.lineStrong, borderRadius: radii.lg, borderWidth: 1, gap: 17, padding: 18 },
  guideTitle: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 22, lineHeight: 29 },
  hash: { color: colors.muted, fontFamily: fonts.medium, fontSize: 10, lineHeight: 16 },
  headingCopy: { flex: 1, gap: 4, minWidth: 220 },
  hero: { alignItems: 'flex-start', backgroundColor: colors.surfaceMuted, borderRadius: radii.lg, flexDirection: 'row', gap: 15, padding: 20 },
  heroCopy: { flex: 1, gap: 7 },
  issueActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  manageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  manageCopy: { flex: 1, gap: 3, minWidth: 200 },
  manageHeading: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  manageIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 12, height: 44, justifyContent: 'center', width: 44 },
  managePanel: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 14, padding: 18 },
  noDeckCopy: { flex: 1, gap: 3, minWidth: 180 },
  noDeckPanel: { alignItems: 'center', backgroundColor: colors.warningSurface, borderRadius: radii.md, flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 14 },
  objectivePanel: { alignItems: 'center', backgroundColor: colors.warningSurface, borderRadius: radii.md, flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  objectiveText: { color: colors.inkSoft, flex: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 },
  outlineSection: { gap: 8 },
  outlineTitle: { color: colors.ink, flex: 1, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21 },
  outlineTitleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 9 },
  overviewDot: { backgroundColor: colors.slate },
  pipeline: { flexDirection: 'row', justifyContent: 'space-between' },
  pipelineIcon: { alignItems: 'center', backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.pill, borderWidth: 1, height: 32, justifyContent: 'center', width: 32 },
  pipelineIconComplete: { backgroundColor: colors.teal, borderColor: colors.teal },
  pipelineIconCurrent: { backgroundColor: colors.surfaceMuted, borderColor: colors.blue },
  pipelineLabel: { color: colors.slate, fontFamily: fonts.semibold, fontSize: 9, textAlign: 'center' },
  pipelineLabelActive: { color: colors.inkSoft },
  pipelineStep: { alignItems: 'center', flex: 1, gap: 5 },
  progressFill: { backgroundColor: colors.blue, borderRadius: radii.pill, height: '100%' },
  progressTrack: { backgroundColor: colors.line, borderRadius: radii.pill, height: 7, overflow: 'hidden' },
  progressValue: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 14 },
  question: { color: colors.ink, fontFamily: fonts.bold, fontSize: 19, lineHeight: 27 },
  qualityBadge: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.pill, flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  qualityBadgeText: { color: colors.blueDark, fontFamily: fonts.bold, fontSize: 10 },
  referenceDetail: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 },
  referenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  referenceItem: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radii.sm, borderWidth: 1, flex: 1, gap: 4, minWidth: 210, padding: 11 },
  referenceTerm: { color: colors.ink, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  safetyDot: { backgroundColor: colors.coral },
  section: { gap: 11 },
  sectionHeading: { alignItems: 'flex-end', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 20, lineHeight: 27 },
  segment: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, gap: 9, padding: 15 },
  segmentLocator: { color: colors.tealDark, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
  segmentPath: { color: colors.muted, flex: 1, fontFamily: fonts.semibold, fontSize: 11, textAlign: 'right' },
  segmentText: { color: colors.inkSoft, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21 },
  segmentTopline: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  smallText: { color: colors.muted, flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19 },
  bulletDot: { backgroundColor: colors.lineStrong, borderRadius: radii.pill, height: 5, marginTop: 8, width: 5 },
  bulletRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 9, paddingLeft: 18 },
  bulletText: { color: colors.inkSoft, flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  sourceDetailsContent: { gap: 11, padding: 15, paddingTop: 4 },
  sourceDetailsLabel: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 10 },
  sourceDetailsPanel: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.md, borderWidth: 1, overflow: 'hidden' },
  sourceDetailsToggle: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between', minHeight: 64, paddingHorizontal: 15 },
  sourceCheckCopy: { flex: 1, gap: 3, minWidth: 220 },
  sourceCheckIcon: { alignItems: 'center', backgroundColor: colors.warningSurface, borderRadius: 13, height: 46, justifyContent: 'center', width: 46 },
  sourceCheckPanel: { alignItems: 'center', backgroundColor: colors.warningSurface, borderColor: '#efd59f', borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 14 },
  statusCard: { backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, gap: 15, padding: 18 },
  statusCopy: { flex: 1, gap: 3 },
  statusHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  studySetCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.lg, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 14, padding: 18 },
  studySetCopy: { flex: 1, gap: 4, minWidth: 200 },
  studySetIcon: { alignItems: 'center', backgroundColor: colors.blue, borderRadius: 16, height: 54, justifyContent: 'center', width: 54 },
  studySetTitle: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 19, lineHeight: 26 },
  title: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 27, lineHeight: 34 },
  treatmentDot: { backgroundColor: colors.teal },
  typeBadge: { backgroundColor: colors.ink, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  typeBadgeText: { color: colors.surface, fontFamily: fonts.bold, fontSize: 10, textTransform: 'uppercase' },
});
