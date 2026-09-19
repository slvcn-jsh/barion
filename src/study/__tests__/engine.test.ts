import type { StudyCard, StudyProfile } from '@/domain/types';
import {
  chooseLearnActivity,
  effectiveMemoryPolicy,
  formatFsrsInterval,
  nextShortTermDue,
  parseStudyEngineMode,
  recommendedStudyMode,
  spacedSortLabel,
} from '@/study/engine';

const profile: StudyProfile = {
  reviewStyle: 'clinical-reasoning',
  difficulty: 'standard',
  sessionLength: 10,
  feedbackTiming: 'immediate',
  evidenceDisplay: 'compact',
  dailyNewLimit: 10,
  dailyReviewLimit: 40,
  examGoal: 'clinical-recall',
  workspaceMode: 'learner',
  weeklyStudyDays: [1, 2, 3, 4, 5],
  reminderEnabled: false,
  reminderHour: 19,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const card = { cardType: 'clinical-treatment' } as StudyCard;

describe('study engine policy', () => {
  it('keeps cram learning out of FSRS while long-term learning uses it', () => {
    expect(effectiveMemoryPolicy('learn', 'cram')).toBe('short-term');
    expect(effectiveMemoryPolicy('learn', 'long-term')).toBe('fsrs');
    expect(effectiveMemoryPolicy('browse', 'long-term')).toBe('none');
  });

  it('uses explicit short intervals without pretending they are FSRS', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(nextShortTermDue('hard', now)).toBe('2026-01-01T00:05:00.000Z');
    expect(nextShortTermDue('easy', now)).toBe('2026-01-05T00:00:00.000Z');
    expect(spacedSortLabel('again')).toBe('≤ 1 min');
  });

  it('chooses grounded activity labels from existing card types', () => {
    expect(chooseLearnActivity(card)).toBe('clinical reasoning');
    expect(chooseLearnActivity({ ...card, cardType: 'algorithm' })).toBe('ordered recall');
  });

  it('falls back safely and formats scheduler previews', () => {
    expect(parseStudyEngineMode('unknown')).toBe('fsrs');
    expect(recommendedStudyMode(profile)).toBe('fsrs');
    expect(formatFsrsInterval('2026-01-01T00:10:00.000Z', new Date('2026-01-01T00:00:00.000Z'))).toBe('10 min');
  });
});
