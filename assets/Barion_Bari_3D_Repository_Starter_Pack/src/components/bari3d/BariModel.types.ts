import type { BariAnimationState } from '../../constants/bariAnimationStates';

export type BariModelProps = {
  state?: BariAnimationState;
  size?: number | string;
  autoRotate?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onLoaded?: () => void;
  onError?: (error: unknown) => void;
};
