import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export const BARI_3D_STATES = {
  idle: 'idle',
  greeting: 'greeting',
  thinking: 'thinking',
  explaining: 'explaining',
  celebrating: 'celebrating',
  encouraging: 'encouraging',
  offline: 'offline',
  error: 'error',
} as const;

export type Bari3DState = (typeof BARI_3D_STATES)[keyof typeof BARI_3D_STATES];

export type BariModelProps = {
  state?: Bari3DState;
  size?: number;
  animated?: boolean;
  fallback?: ReactNode;
  onLoaded?: () => void;
  onError?: (error: unknown) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};
