import type { Bari3DState } from './BariModel.types';

export const BARI_CLIP_NAMES = [
  'idle',
  'blink',
  'wave',
  'thinking',
  'explaining',
  'celebrate',
  'talk',
  'encourage',
  'offline',
  'error',
] as const;

export type BariClipName = (typeof BARI_CLIP_NAMES)[number];

export type BariAnimationPlan = {
  clip: BariClipName;
  loop: boolean;
  settleToIdle: boolean;
};

const STATE_ANIMATION: Record<Bari3DState, BariAnimationPlan> = {
  idle: { clip: 'idle', loop: true, settleToIdle: false },
  greeting: { clip: 'wave', loop: false, settleToIdle: true },
  thinking: { clip: 'thinking', loop: true, settleToIdle: false },
  explaining: { clip: 'explaining', loop: true, settleToIdle: false },
  celebrating: { clip: 'celebrate', loop: false, settleToIdle: true },
  encouraging: { clip: 'encourage', loop: false, settleToIdle: true },
  offline: { clip: 'offline', loop: false, settleToIdle: false },
  error: { clip: 'error', loop: false, settleToIdle: false },
};

export function animationPlanForState(state: Bari3DState): BariAnimationPlan {
  return STATE_ANIMATION[state];
}
