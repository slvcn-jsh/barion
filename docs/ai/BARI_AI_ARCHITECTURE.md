# Bari AI architecture

## Purpose

Bari AI is Barion's model-agnostic intelligence layer. Providers supply inference; Bari owns source retrieval, prompts, schemas, validation, provenance, quality gates, task policies, evaluation, datasets, retries, and observability.

## Current card-generation path

```text
source import
-> local source-matched cards
-> studyable deck
-> durable Smart Enhancement job
-> Bari AI Gateway
-> configured provider
-> structured candidates
-> gateway grounding and publication policy
-> client revalidation and selection
-> short serialized SQLite publication transaction
-> terminal persisted state
```

Network inference never owns local usability. Provider, network, quota, or tuned-model failure leaves local cards available and moves enhancement to deferred or failed state.

## Ownership

- `services/ai_gateway/policies.py`: logical models and versioned task policies.
- `services/ai_gateway/`: authentication, routing, provider adapters, retrieval, validation, retries, and content-free telemetry.
- `services/card_evaluation/`: claim grounding, verification, and publication decisions.
- `services/card_benchmark/`: frozen datasets, deterministic metrics, immutable evaluation runs, experiments, and promotion gates.
- `datasets/bari-cardgen/`: public dataset contracts only; protected records may remain outside Git.
- `src/ai/`: client request contracts, revalidation, local fallback, selection, and learner-safe copy.

## Invariants

1. Source retrieval supplies facts; model weights supply behavior. Tuning never replaces grounding.
2. Provider schema compliance never replaces application validation.
3. Logical task policies identify prompt, schema, model preference, retry, and evaluation suite.
4. Every remote artifact records provider/model/request and prompt/schema policy provenance.
5. Behavioral feedback is analytics until reviewed and explicitly converted into an eligible label.
6. Test/adversarial examples never enter training.
7. Model promotion requires frozen-benchmark proof, then bounded shadow and canary stages.

## Runtime policy resolution

Card generation and Bari Chat resolve separate effective policies at gateway startup. Each policy owns physical primary/fallback model IDs, temperature, thinking level, timeout, retry bounds, prompt/schema versions, and evaluation-suite identity. Gateway builds and closes independent provider chains so chat configuration cannot silently alter card-generation behavior.

Deployment overrides remain provider-neutral at policy boundary. Registered physical models map to durable logical IDs; an unregistered override receives stable `provider:model` identity instead of losing provenance. Health output reports effective policy without secrets. Telemetry records logical and physical model, policy, prompt, schema, and non-sensitive configuration while excluding prompts, source text, credentials, and authorization headers.
