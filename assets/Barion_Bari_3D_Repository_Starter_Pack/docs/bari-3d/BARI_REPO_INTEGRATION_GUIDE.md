# Bari 3D Integration Guide for Barion

## Purpose
This guide explains how to place the Bari 3D prototype into the Barion repository.

## Recommended repository placement

```text
assets/3d/bari/
  bari_prototype_static.glb
  bari_prototype_static.obj
  bari_prototype_static.ply

docs/bari-3d/
  README.md
  BARI_3D_ASSET_MANIFEST.json
  BARI_ANIMATION_SPEC.md
  BARI_INTERACTION_SPEC.md
  BARI_REPO_INTEGRATION_GUIDE.md
  BARI_IMPLEMENTATION_CHECKLIST.md

src/components/bari3d/
  BariModel.web.tsx
  BariModel.native.tsx
  BariModel.types.ts
  README.md

src/constants/
  bariAnimationStates.ts
```

## Recommended implementation path

### Phase 1 — Repository asset landing
- add the static GLB to source control
- document the asset
- use it for experiments and product review

### Phase 2 — Web prototype
- mount Bari in the web Ask Bari experience using a simple web viewer
- confirm size, positioning, and brand appearance

### Phase 3 — Rigged character upgrade
- create a production Blender version
- rig the mesh
- add clips
- export final `.glb`

### Phase 4 — Application integration
- swap static prototype for animated GLB
- map app states to animation clips
- add performance guards and fallbacks

## Dependency note
The provided starter component uses the `@google/model-viewer` style web approach conceptually. If your stack differs, adapt accordingly.

## Native note
The included `BariModel.native.tsx` is a placeholder contract rather than a final 3D runtime integration.
It exists so the repository has the right component boundary now.
