import {
  animationPlanForState,
  BARI_CLIP_NAMES,
} from '@/components/bari3d/bariAnimation';
import { BARI_3D_STATES } from '@/components/bari3d/BariModel.types';

describe('Bari animation state mapping', () => {
  it('maps every public Bari state to an exported clip', () => {
    for (const state of Object.values(BARI_3D_STATES)) {
      expect(BARI_CLIP_NAMES).toContain(animationPlanForState(state).clip);
    }
  });

  it('plays transient emotional gestures once, then rests', () => {
    for (const state of ['greeting', 'celebrating', 'encouraging'] as const) {
      expect(animationPlanForState(state)).toEqual(expect.objectContaining({
        loop: false,
        settleToIdle: true,
      }));
    }
  });

  it('loops working states without repeatedly replaying greetings', () => {
    expect(animationPlanForState('thinking').loop).toBe(true);
    expect(animationPlanForState('explaining').loop).toBe(true);
    expect(animationPlanForState('greeting').loop).toBe(false);
  });
});
