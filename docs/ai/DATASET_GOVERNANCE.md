# Bari AI dataset governance

## Data classes

- **Inference data:** user-provided source used to answer current request. Not training data.
- **Training-eligible data:** individually authorized, privacy-cleared, licensed, human/expert-approved record satisfying schema and validator.
- **Behavioral analytics:** acceptance, edit, delete, study, incorrect answer, regeneration, flag, and similar events. Signals only; not labels.
- **Supervised labels:** explicit reviewed corrections or gold outputs with documented eligibility.

## Evidence hierarchy

1. human-authored gold output;
2. human-corrected AI output;
3. expert-reviewed AI output;
4. independently program-validated output;
5. synthetic output with independent validation.

Unreviewed model output and rejected candidates never become training truth.

Automated check scores are not human medical-quality percentages and cannot establish gold status. Human review must use the versioned blind-review protocol, include target-learner and clinical/education authority perspectives, and retain licensing, provenance, privacy, and consent evidence before any accepted card becomes training eligible.

## Eligibility gate

`validate_dataset_record` requires training records to have high-confidence provenance, gold/accepted quality, human/expert approval, approved usage rights, resolved consent, authorized source use, and no sensitive data. User uploads additionally require explicit consent. Test, adversarial, and rejected splits are never training eligible.

Never export credentials, personal information, patient data, private documents, or unlicensed content. Store protected records in controlled infrastructure outside Git; repository contains schemas and safe project-authored fixtures only.

## Owner-authorized benchmark sources

Owner authorization now covers `tmp/card-benchmark/PDF_INPUT.pdf` and the ten-source `tmp/barion_quizlet_benchmark_v1` pack for permanent evaluation and training-data curation. Content-free tracked registries preserve hashes and authorization state under `datasets/bari-cardgen/registries/`; raw sources and hidden evaluation content remain outside Git.

Authorization changes only source eligibility. Generated evaluator fixtures remain `inference-only`. A card becomes training eligible only after record-level privacy and rights checks, split assignment, and required human/expert review. Public redistribution remains unauthorized.

## Feedback flywheel

`validate_feedback_event` separates behavioral signals from supervised labels. Incorrect study answers may indicate difficulty, not bad content. Only human-reviewed correction events may become eligible labels, and dataset eligibility is rechecked before export.
