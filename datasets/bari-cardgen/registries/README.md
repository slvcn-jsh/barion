# Authorized evaluation-source registries

This directory stores content-free identities for owner-authorized Barion evaluation sources. Registries may contain hashes, provenance, authorization state, and benchmark structure, but never raw source text, hidden gold answers, reviewer packets, or model outputs.

Raw artifacts remain under git-ignored controlled storage. A registry entry means the source may be used for evaluation and may enter training-data curation when explicitly authorized. It does not make any generated card training truth. Record-level privacy, quality, split, and human-review gates still apply before training export.

- `barion-quizlet-benchmark-v1.json` identifies ten authorized benchmark inputs and separately hashes eight hidden evaluation artifacts.
- `owner-authorized-psychiatric-review-v1.json` identifies the psychiatric-nursing benchmark source used by the immutable 50-card generation run.

Regenerate the pack registry only from the exact local artifacts and authorization declaration. The registry writer refuses overwrite so evidence changes remain deliberate and reviewable.
