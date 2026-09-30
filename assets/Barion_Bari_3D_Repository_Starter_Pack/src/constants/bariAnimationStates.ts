export const BARI_ANIMATION_STATES = {
  IDLE: 'idle',
  GREETING: 'greeting',
  THINKING: 'thinking',
  EXPLAINING: 'explaining',
  CELEBRATING: 'celebrating',
  ENCOURAGING: 'encouraging',
  OFFLINE: 'offline',
  ERROR: 'error',
} as const;

export type BariAnimationState =
  (typeof BARI_ANIMATION_STATES)[keyof typeof BARI_ANIMATION_STATES];
