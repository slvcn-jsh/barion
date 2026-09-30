# Bari 3D Implementation Checklist

## Repository / asset
- [ ] Add `assets/3d/bari/bari_prototype_static.glb`
- [ ] Add docs under `docs/bari-3d/`
- [ ] Review asset in a GLB viewer
- [ ] Confirm Bari proportions and branding are acceptable

## Engineering
- [ ] Decide web 3D viewer approach
- [ ] Decide native 3D strategy
- [ ] Add component boundary in `src/components/bari3d/`
- [ ] Define animation state contract

## Product
- [ ] Decide where Bari appears by default
- [ ] Decide whether Ask Bari is the first production surface
- [ ] Decide how much motion is acceptable during study

## Character production
- [ ] Rig Bari
- [ ] Add facial expressions
- [ ] Create animation clips
- [ ] Export production animated GLB

## QA
- [ ] Verify model loads
- [ ] Verify no blocking performance issue
- [ ] Verify graceful fallback if 3D unavailable
- [ ] Verify brand consistency
