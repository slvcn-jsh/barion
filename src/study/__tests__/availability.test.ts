import { studyQueueEmptyCopy } from '@/study/availability';

describe('study queue empty copy', () => {
  it('explains daily new-card limits without claiming cards are missing', () => {
    expect(studyQueueEmptyCopy('daily-new-limit')).toEqual({
      title: 'Daily new-card limit reached',
      body: expect.stringContaining('browse this set'),
    });
  });

  it('explains future scheduling', () => {
    expect(studyQueueEmptyCopy('not-due').title).toBe('Review is complete for now');
  });
});

