import type { StudyQueueEmptyReason } from '@/domain/types';

export function studyQueueEmptyCopy(reason: StudyQueueEmptyReason) {
  switch (reason) {
    case 'daily-review-limit':
      return {
        title: 'Daily review limit reached',
        body: 'Scheduled review is complete for today. You can still browse this set without changing its schedule.',
      };
    case 'daily-new-limit':
      return {
        title: 'Daily new-card limit reached',
        body: 'No more new cards are scheduled today. You can still browse this set or change the limit in Study Profile.',
      };
    case 'not-due':
      return {
        title: 'Review is complete for now',
        body: 'These cards are scheduled for a later review. Browse the set if you want an extra pass now.',
      };
    case 'no-weak-cards':
      return {
        title: 'No weak cards yet',
        body: 'Nothing in this set is currently marked weak. Start a regular session or browse all cards.',
      };
    case 'suspended':
      return {
        title: 'Cards are suspended',
        body: 'This set has cards, but all available cards are suspended from study.',
      };
    case 'buried':
      return {
        title: 'Cards are temporarily buried',
        body: 'Buried cards will return automatically. Browse the set if you need to see them now.',
      };
    case 'needs-review':
      return {
        title: 'Cards need source confirmation',
        body: 'Cards requiring source confirmation stay out of normal study until resolved.',
      };
    default:
      return {
        title: 'No cards available',
        body: 'This set has no safe, active cards to study yet.',
      };
  }
}
