# Bari 3D runtime asset

`bari_animated.glb` is Barion's runtime Bari character. It is generated from
`bari_prototype_static.glb` by `scripts/build-bari-3d.ps1`.

- GLB 2.0, approximately 536 KB
- 9,566 vertices and 18,976 triangles
- vertex colors; no texture memory
- 17-joint rigid-segment armature
- 13 facial morph targets for blinking, smiles, and basic visemes
- named clips: idle, blink, wave, thinking, explaining, celebrate, talk,
  encourage, offline, and error

Generated source lives at `source/bari_rigged.blend`. Rebuild after changing
rig or animation script, then verify `bari_animated.report.json` before
committing generated assets.
