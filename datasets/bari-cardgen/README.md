# Bari card-generation datasets

This directory defines Barion's card-generation dataset contract. It intentionally contains no user uploads or production source content.

## Layout

- `schema/`: JSON Schemas for dataset records and feedback signals.
- `train/`: approved training records only.
- `validation/`: prompt/model-development checks.
- `test/`: frozen promotion benchmark; never used for training or routine prompt optimization.
- `adversarial/`: frozen difficult cases such as tables, negation, numerical values, exceptions, and poor extraction.
- `rejected/`: redacted rejection metadata or safe synthetic fixtures; never training truth.
- `registries/`: content-free identities and authorization state for controlled evaluation sources.

Real records may live in controlled storage outside Git. Every exported record must pass `services.card_benchmark.dataset_governance.validate_dataset_record`. User uploads remain inference data unless explicit consent, usage rights, privacy review, and human approval make a specific record eligible.

No secrets, personal information, patient data, private documents, or unlicensed source content belong here.

Owner authorization may make a source a training-data candidate. It does not make model-generated cards eligible training records. Raw artifacts remain outside Git; tracked registries preserve exact hashes and policy state without redistributing source content.

## Human review requirement

Repository fixtures cover eight project-authored medical domains but do not become human gold automatically. New comparative runs export `blind_review.csv` using rubric version 2. Each run requires independent pseudonymous reviews from at least one medical student and one clinician, medical educator, or subject-matter expert. The scorer emits human acceptance only from completed review files; absent review remains missing evidence.
