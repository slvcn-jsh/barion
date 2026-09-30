from dataclasses import replace

import pytest

from services.ai_gateway.policies import (
    CARD_GENERATION_POLICY,
    MODEL_REGISTRY,
    TASK_POLICIES,
    ModelRecord,
    logical_model_id,
    resolve_task_policy,
    validate_registry,
)


def test_card_generation_policy_uses_logical_models_and_versioned_contracts():
    assert CARD_GENERATION_POLICY.policy_id == "bari-cardgen-v1"
    assert CARD_GENERATION_POLICY.prompt_version == "1.4.0"
    assert CARD_GENERATION_POLICY.schema_version == "gateway-card-schema-1.2.0"
    assert CARD_GENERATION_POLICY.preferred_model == "gemini-3.8-flash/base"
    assert CARD_GENERATION_POLICY.evaluation_suite == "bari-cardgen-eval-v1"


def test_registry_is_model_agnostic_and_policies_reference_compatible_models():
    validate_registry(MODEL_REGISTRY, TASK_POLICIES)
    assert next(record for record in MODEL_REGISTRY if record.status == "baseline").provider == "gemini"
    assert all("/" in policy.preferred_model for policy in TASK_POLICIES)
    assert next(record for record in MODEL_REGISTRY if record.logical_id == "gemini-3.8-flash/base").fine_tuning == "unsupported"


def test_effective_policy_resolves_logical_and_physical_configuration():
    effective = resolve_task_policy(
        CARD_GENERATION_POLICY,
        provider="gemini",
        model_id="gemini-3.8-flash",
        fallback_model_id="gemini-3.5-flash-lite",
        timeout_seconds=12,
        max_attempts=2,
        retry_base_delay_seconds=.5,
        retry_max_delay_seconds=3,
    )

    assert effective.logical_model_id == "gemini-3.8-flash/base"
    assert effective.fallback_logical_model_id == "gemini-3.5-flash-lite/base"
    assert effective.model_id == "gemini-3.8-flash"
    assert effective.timeout_seconds == 12
    assert effective.max_attempts == 2
    assert logical_model_id("gemini", "unregistered-model") == "gemini:unregistered-model"


def test_registry_rejects_duplicate_models_and_incompatible_task_policy():
    duplicate = ModelRecord(
        logical_id=MODEL_REGISTRY[0].logical_id,
        provider="gemini",
        model_id="duplicate",
        status="candidate",
        purposes=("CARD_GENERATION",),
        structured_output=True,
        tuned=False,
        fine_tuning="unsupported",
    )
    with pytest.raises(ValueError, match="unique"):
        validate_registry((*MODEL_REGISTRY, duplicate), TASK_POLICIES)

    incompatible = replace(
        CARD_GENERATION_POLICY,
        task_id="UNSUPPORTED_TASK",
        policy_id="invalid-task-policy",
    )
    with pytest.raises(ValueError, match="does not support"):
        validate_registry(MODEL_REGISTRY, (incompatible,))

    tuned_without_lineage = replace(
        MODEL_REGISTRY[0],
        logical_id="bari-cardgen-sft-invalid",
        model_id="tunedModels/invalid",
        tuned=True,
    )
    with pytest.raises(ValueError, match="dataset lineage"):
        validate_registry((*MODEL_REGISTRY, tuned_without_lineage), TASK_POLICIES)
