# Bari Interaction & Behavior Specification

## Product goal
Bari should feel like a calm, trustworthy, encouraging medical learning companion.

## Main contexts

### 1. Ask Bari modal
- opens with `wave`
- rests in `idle`
- enters `thinking` while model is generating
- transitions to `explaining` while showing answer
- occasional `blink`

### 2. Study / answer feedback
- correct answer -> `celebrate`
- partial understanding -> `encourage`
- wrong answer -> `encourage` or calm coaching state

### 3. Dashboard / welcome
- optional small idle Bari
- gentle motion only
- should not distract from study tasks

## State mapping
- `idle`
- `greeting`
- `thinking`
- `explaining`
- `celebrating`
- `encouraging`
- `offline`
- `error`

## Design rules
- motion should be soft, not hyperactive
- no excessive bouncing during study
- preserve trust and clarity
- Bari should support learning, not steal attention
