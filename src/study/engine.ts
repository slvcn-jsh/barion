import type {
  ReviewRating,
  StudyActivityOutcome,
  StudyCard,
  StudyEngineMode,
  StudyLearningGoal,
  StudyModeDefinition,
  StudyProfile,
} from '@/domain/types';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const STUDY_MODES: StudyModeDefinition[] = [
  {
    id: 'fsrs',
    title: 'Long-term review',
    description: 'Recall due cards and let Barion schedule the next useful review.',
    memoryPolicy: 'fsrs',
    recommendedFor: 'Durable memory and everyday study',
  },
  {
    id: 'learn',
    title: 'Guided Learn',
    description: 'Barion chooses a recall approach from the card and your Study Profile.',
    memoryPolicy: 'fsrs',
    recommendedFor: 'A guided mix with minimal setup',
  },
  {
    id: 'loop-sort',
    title: 'Learn until clear',
    description: 'Still-learning cards return until every card is confidently known.',
    memoryPolicy: 'short-term',
    recommendedFor: 'Preparing new material for an upcoming test',
  },
  {
    id: 'spaced-sort',
    title: 'Quick spacing',
    description: 'Use fixed short intervals for a focused early-learning pass.',
    memoryPolicy: 'short-term',
    recommendedFor: 'Cram sessions without changing FSRS history',
  },
  {
    id: 'basic-sort',
    title: 'Know / Still learning',
    description: 'Sort every card once to see what needs more work.',
    memoryPolicy: 'short-term',
    recommendedFor: 'A quick baseline check',
  },
  {
    id: 'browse',
    title: 'Browse cards',
    description: 'Read through the set without changing memory scheduling.',
    memoryPolicy: 'none',
    recommendedFor: 'Previewing or checking card wording',
  },
  {
    id: 'audio',
    title: 'Audio review',
    description: 'Hear the question and answer while keeping full rating control.',
    memoryPolicy: 'fsrs',
    recommendedFor: 'Hands-light review with the source safety gate intact',
  },
];

export const SPACED_SORT_INTERVALS: Record<ReviewRating, number> = {
  again: MINUTE,
  hard: 5 * MINUTE,
  good: 10 * MINUTE,
  easy: 4 * DAY,
};

export function parseStudyEngineMode(value?: string): StudyEngineMode {
  return STUDY_MODES.some((mode) => mode.id === value) ? (value as StudyEngineMode) : 'fsrs';
}

export function parseStudyLearningGoal(value?: string): StudyLearningGoal {
  return value === 'cram' ? 'cram' : 'long-term';
}

export function effectiveMemoryPolicy(mode: StudyEngineMode, goal: StudyLearningGoal) {
  if (mode === 'learn' && goal === 'cram') return 'short-term' as const;
  return STUDY_MODES.find((item) => item.id === mode)?.memoryPolicy ?? 'fsrs';
}

export function nextShortTermDue(outcome: StudyActivityOutcome, now = new Date()) {
  const interval =
    outcome === 'learning'
      ? MINUTE
      : outcome === 'known'
        ? 10 * MINUTE
        : outcome === 'viewed'
          ? 0
          : SPACED_SORT_INTERVALS[outcome];
  return interval ? new Date(now.getTime() + interval).toISOString() : null;
}

export function spacedSortLabel(rating: ReviewRating) {
  switch (rating) {
    case 'again': return '≤ 1 min';
    case 'hard': return '5 min';
    case 'good': return '10 min';
    case 'easy': return '4 days';
  }
}

export function formatFsrsInterval(dueAt: string, now = new Date()) {
  const milliseconds = Math.max(0, new Date(dueAt).getTime() - now.getTime());
  const minutes = Math.max(1, Math.round(milliseconds / MINUTE));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30);
  return `${months} mo`;
}

export function recommendedStudyMode(profile: StudyProfile, goal: StudyLearningGoal = 'long-term'): StudyEngineMode {
  if (goal === 'cram') return 'learn';
  if (profile.reviewStyle === 'test-first') return 'learn';
  return 'fsrs';
}

export type LearnActivity = 'written recall' | 'clinical reasoning' | 'compare and contrast' | 'ordered recall' | 'active recall';

export function chooseLearnActivity(card: StudyCard): LearnActivity {
  const type = card.cardType.toLowerCase();
  if (/clinical|diagnos|treatment|contraindication|safety|risk/.test(type)) return 'clinical reasoning';
  if (/comparison|compare/.test(type)) return 'compare and contrast';
  if (/algorithm|sequence|step/.test(type)) return 'ordered recall';
  if (/mechanism|cloze|list/.test(type)) return 'written recall';
  return 'active recall';
}

export function modeUsesAllActiveCards(mode: StudyEngineMode, goal: StudyLearningGoal) {
  return mode === 'browse' || mode === 'basic-sort' || mode === 'loop-sort' || mode === 'spaced-sort' || (mode === 'learn' && goal === 'cram');
}

export function modeCanRepeatMisses(mode: StudyEngineMode, goal: StudyLearningGoal) {
  return mode === 'loop-sort' || (mode === 'learn' && goal === 'cram');
}
