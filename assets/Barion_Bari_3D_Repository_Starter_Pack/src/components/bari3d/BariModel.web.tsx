import React from 'react';
import type { BariModelProps } from './BariModel.types';

/**
 * BariModel.web.tsx
 *
 * Repository starter component for Bari on web.
 * This is intentionally lightweight and designed as a clear integration boundary.
 *
 * Suggested next step:
 * - install and register a proper model-viewer or R3F-based renderer
 * - map `state` to animation clips once the animated GLB exists
 */
export default function BariModelWeb({
  size = 280,
  className,
  style,
  onLoaded,
}: BariModelProps) {
  const src = '/assets/3d/bari/bari_prototype_static.glb';

  const mergedStyle: React.CSSProperties = {
    width: typeof size === 'number' ? `${size}px` : size,
    height: typeof size === 'number' ? `${size}px` : size,
    display: 'block',
    border: 'none',
    background: 'transparent',
    ...style,
  };

  React.useEffect(() => {
    onLoaded?.();
  }, [onLoaded]);

  return (
    <div className={className} style={{ display: 'inline-block' }}>
      {/*
        Replace this with your preferred 3D web runtime.
        Example approaches:
        - <model-viewer>
        - Three.js / React Three Fiber
      */}
      <model-viewer
        src={src}
        autoplay={false}
        camera-controls
        disable-zoom={false}
        interaction-prompt="none"
        shadow-intensity="0.8"
        style={mergedStyle as any}
      />
    </div>
  );
}
