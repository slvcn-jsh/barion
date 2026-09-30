import { Canvas, useFrame, useLoader } from '@react-three/fiber/native';
import React, {
  Component,
  type ErrorInfo,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinnedScene } from 'three/examples/jsm/utils/SkeletonUtils.js';

import { BariMascot, type BariExpression } from '@/components/BariMascot';

import type { Bari3DState, BariModelProps } from './BariModel.types';
import { animationPlanForState } from './bariAnimation';

const bariAsset = require('../../../assets/3d/bari/bari_animated.glb');
const MODEL_BASE_Y = -1.9;
const CLIP_FADE_SECONDS = 0.2;
const FIRST_BLINK_SECONDS = 2.8;
const BLINK_INTERVAL_SECONDS = 4.6;

type BoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  onError?: (error: unknown) => void;
};

type BoundaryState = { failed: boolean };

class BariModelBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError?.(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function expressionForState(state: Bari3DState): BariExpression {
  if (state === 'thinking') return 'thinking';
  if (state === 'explaining') return 'explaining';
  if (state === 'greeting' || state === 'celebrating') return 'happy';
  return 'idle';
}

function BariScene({
  state,
  animated,
  onLoaded,
}: {
  state: Bari3DState;
  animated: boolean;
  onLoaded: () => void;
}) {
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const blinkActionRef = useRef<THREE.AnimationAction | null>(null);
  const blinkCountdownRef = useRef(FIRST_BLINK_SECONDS);
  const gltf = useLoader(GLTFLoader, bariAsset) as GLTF;

  const scene = useMemo(() => {
    const clone = cloneSkinnedScene(gltf.scene) as THREE.Group;

    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!object.geometry.getAttribute('normal')) {
        object.geometry.computeVertexNormals();
      }
      object.frustumCulled = true;
    });

    return clone;
  }, [gltf.scene]);

  useEffect(() => {
    onLoaded();
  }, [onLoaded]);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(scene);
    mixerRef.current = mixer;
    const plan = animationPlanForState(state);
    const clip = THREE.AnimationClip.findByName(gltf.animations, plan.clip);
    const idleClip = THREE.AnimationClip.findByName(gltf.animations, 'idle');
    const blinkClip = THREE.AnimationClip.findByName(gltf.animations, 'blink');
    const talkClip = THREE.AnimationClip.findByName(gltf.animations, 'talk');

    if (!clip) {
      return () => {
        mixer.stopAllAction();
        mixer.uncacheRoot(scene);
        mixerRef.current = null;
      };
    }

    const action = mixer.clipAction(clip, scene);
    action.reset();
    action.clampWhenFinished = !plan.loop;
    action.setLoop(plan.loop ? THREE.LoopRepeat : THREE.LoopOnce, plan.loop ? Infinity : 1);
    action.play();

    if (animated && state !== 'offline' && state !== 'error' && blinkClip) {
      const blinkAction = mixer.clipAction(blinkClip, scene);
      blinkAction.clampWhenFinished = false;
      blinkAction.setLoop(THREE.LoopOnce, 1);
      blinkActionRef.current = blinkAction;
      blinkCountdownRef.current = FIRST_BLINK_SECONDS;
    }

    if (animated && state === 'explaining' && talkClip) {
      mixer.clipAction(talkClip, scene).reset().setLoop(THREE.LoopRepeat, Infinity).play();
    }

    if (!animated) {
      mixer.setTime(0);
      action.paused = true;
    }

    const handleFinished = ({ action: finishedAction }: { action: THREE.AnimationAction }) => {
      if (!animated || !plan.settleToIdle || finishedAction !== action || !idleClip) return;
      const idleAction = mixer.clipAction(idleClip, scene);
      action.fadeOut(CLIP_FADE_SECONDS);
      idleAction.reset().fadeIn(CLIP_FADE_SECONDS).play();
    };

    mixer.addEventListener('finished', handleFinished);
    return () => {
      mixer.removeEventListener('finished', handleFinished);
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      mixerRef.current = null;
      blinkActionRef.current = null;
    };
  }, [animated, gltf.animations, onLoaded, scene, state]);

  useFrame((_, delta) => {
    if (!animated) return;
    mixerRef.current?.update(delta);
    const blinkAction = blinkActionRef.current;
    if (!blinkAction) return;
    blinkCountdownRef.current -= delta;
    if (blinkCountdownRef.current <= 0) {
      blinkAction.reset().play();
      blinkCountdownRef.current = BLINK_INTERVAL_SECONDS;
    }
  });

  return (
    <group position={[0, MODEL_BASE_Y, 0]}>
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <primitive dispose={null} object={scene} />
      </group>
    </group>
  );
}

function useReduceMotionPreference() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

export function BariModel({
  state = 'idle',
  size = 96,
  animated = true,
  fallback,
  onLoaded,
  onError,
  style,
  testID,
}: BariModelProps) {
  const [loaded, setLoaded] = useState(false);
  const reduceMotion = useReduceMotionPreference();
  const shouldAnimate = animated && !reduceMotion;
  const fallbackNode = fallback ?? (
    <BariMascot
      animated={shouldAnimate}
      expression={expressionForState(state)}
      showBadge
      size={Math.min(size * 0.7, 72)}
    />
  );

  const handleLoaded = React.useCallback(() => {
    setLoaded(true);
    onLoaded?.();
  }, [onLoaded]);

  return (
    <View
      accessibilityLabel={`3D Bari companion (${state})`}
      accessibilityRole="image"
      pointerEvents="none"
      style={[styles.container, { width: size, height: size }, style]}
      testID={testID}
    >
      {!loaded ? <View style={styles.fallback}>{fallbackNode}</View> : null}
      <BariModelBoundary fallback={<View style={styles.fallback}>{fallbackNode}</View>} onError={onError}>
        <Canvas
          camera={{ fov: 30, near: 0.1, far: 100, position: [0, 0, -9.5] }}
          frameloop={shouldAnimate ? 'always' : 'demand'}
          gl={{ alpha: true, antialias: true }}
          onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
          style={styles.canvas}
        >
          <ambientLight intensity={1.7} />
          <directionalLight intensity={2.4} position={[-3, 6, -5]} />
          <directionalLight intensity={0.8} position={[4, 2, 3]} />
          <Suspense fallback={null}>
            <BariScene animated={shouldAnimate} onLoaded={handleLoaded} state={state} />
          </Suspense>
        </Canvas>
      </BariModelBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  canvas: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  fallback: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
