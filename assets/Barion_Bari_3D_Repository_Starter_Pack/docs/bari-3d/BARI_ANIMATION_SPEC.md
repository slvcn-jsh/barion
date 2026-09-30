# Bari Animation Specification

## Goal
Convert Bari from a static mascot into an interactive, emotionally readable 3D assistant for Barion.

## Required animation clips

### Core clips
1. `idle`
   - subtle breathing
   - slight sway
   - occasional eye movement
   - loopable

2. `blink`
   - short facial blink
   - playable as overlay or intermittent state

3. `wave`
   - warm onboarding greeting
   - used when Ask Bari opens or welcomes a user

4. `thinking`
   - hand-to-chin or reflective gesture
   - used while generating or reasoning

5. `explaining`
   - open-hand gesture / confident teaching pose
   - used while presenting an answer

6. `celebrate`
   - cheerful two-hand raise or bounce
   - used for success, progress, streak, mastery

7. `talk`
   - subtle speaking loop
   - synced or loosely paired with answer rendering

8. `encourage`
   - reassuring pose for difficult moments
   - used after wrong answers or low confidence

## Optional clips
- `point_left`
- `point_right`
- `listening`
- `loading`
- `confused`
- `sad_soft`
- `thumbs_up`

## Rig requirements
- root
- spine
- head
- leftArm
- rightArm
- leftHand
- rightHand
- leftLeg
- rightLeg
- eyes

## Face requirements
At minimum:
- blink left/right
- smile open
- smile closed
- talk A/E/O approximation or simple mouth-open loop
- curious / thinking look

## Export target
Final delivery should be a single production `.glb` with named animation clips.
