# Bari card-generation SFT plan

## Current provider finding

Verified 2026-09-29 from official Google documentation:

- Gemini API and AI Studio currently expose no model supporting fine-tuning after Gemini 1.5 Flash-001 deprecation. Google states no immediate plan to restore it.
- Gemini Enterprise Agent Platform supports supervised fine-tuning for Gemini 3.5 Flash, Gemini 3.1 Flash-Lite, Gemini 2.5 Pro, Gemini 2.5 Flash-Lite, and Gemini 2.5 Flash.
- Gemini 3.8 Flash is not listed as an SFT-supported model.
- Google recommends zero/minimal thinking for tuned tasks and warns controlled/structured generation can reduce tuned-model quality because tuning did not apply controlled generation.

Sources:

- https://ai.google.dev/gemini-api/docs/model-tuning
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tuning/supervised-tuning

Therefore no Gemini 3.8 Flash tuning job should be implemented or purchased now.

## Readiness gates

Before any SFT experiment:

1. enough training-eligible gold records exist across train/validation splits;
2. frozen test and adversarial sets are sealed;
3. baseline prompt/retrieval/few-shot experiments are complete;
4. evaluation harness records full quality, latency, token, cost, and reliability metrics;
5. product/legal/privacy review authorizes dataset and provider destination;
6. supported base model and regional/data-residency constraints are reverified from current docs.

## Controlled experiment

If gates pass, train `bari-cardgen-sft-v1` on supported candidate such as Gemini 3.5 Flash through Enterprise Agent Platform. Benchmark minimal thinking and both native structured output and application parsing because structured output may regress quality. Keep retrieval, claim grounding, provenance, and publication gates unchanged.

Register lineage, base model, dataset version, training configuration, date, evaluation run, and limitations. Candidate remains non-production until frozen benchmark, bounded shadow, and canary gates pass.
