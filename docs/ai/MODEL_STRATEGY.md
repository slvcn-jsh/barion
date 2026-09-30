# Bari AI model strategy

## Baseline

`gemini-3.8-flash` remains card-generation baseline. Code refers to logical record `gemini-3.8-flash/base` through task policy `bari-cardgen-v1`; provider model ID remains deployment configuration.

Baseline stays production default until candidate evidence meets promotion gates. Candidate comparisons must use same frozen inputs and record quality, latency, token use, estimated cost, and provider reliability.

## Task policies

Current implemented policies:

| Task | Policy | Prompt | Schema | Preferred logical model | Evaluation suite |
| --- | --- | --- | --- | --- | --- |
| Card generation | `bari-cardgen-v1` | `grounded-card-generation@1.4.0` | `gateway-card-schema-1.2.0` | `gemini-3.8-flash/base` | `bari-cardgen-eval-v1` |
| Bari Chat | `bari-chat-v1` | `bari-chat@1.0.0` | `bari-chat-schema-1.0.0` | `gemini-3.8-flash/base` | `bari-chat-eval-v1` |

Add a policy only when task has implemented runtime behavior. Study-guide, question-generation, classification, extraction, rewrite, validation, and grounding policies remain future work rather than placeholder production configuration.

Runtime overrides are task-scoped. `PRIMARY_GENERATION_MODEL`, `FALLBACK_GENERATION_MODEL`, and `BARION_AI_PROVIDER_*` configure card generation. `BARI_CHAT_MODEL`, `BARI_CHAT_FALLBACK_MODEL`, and `BARI_CHAT_PROVIDER_*` independently configure chat and inherit generation values only when omitted. Startup rejects either effective policy if its worst-case retries plus fallback exceed client deadline.

## Comparison ladder

Evaluate in order:

1. baseline model plus current prompt;
2. optimized prompt;
3. few-shot examples;
4. improved retrieval/context selection;
5. structured-output configuration;
6. tuned candidate, only after eligible gold data exists.

One experiment changes one intervention. Safety, grounding, critical coverage, citation, or holdout regression vetoes promotion.

Production promotion uses a separate fail-closed decision. Baseline and candidate must share frozen dataset and schema versions, contain every required metric, meet owner-approved absolute thresholds, and avoid quality/reliability regressions. Absent human, cost, latency, or reliability evidence yields `INCONCLUSIVE`, never implied approval.

## Cost-aware routing

Future cascades may route deterministic work locally, routine generation to a specialist, and difficult/low-confidence sources to frontier inference. Escalation requires measurable confidence and quality signals. Local fallback always remains available.
