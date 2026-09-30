from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


MODEL_REGISTRY_VERSION = "1.0.0"
TASK_POLICY_REGISTRY_VERSION = "1.0.0"
DEFAULT_GENERATION_MODEL = "gemini-3.8-flash"

ModelStatus = Literal["baseline", "candidate", "retired"]
FineTuningSupport = Literal["unsupported", "enterprise-agent-platform", "not-evaluated"]


@dataclass(frozen=True, slots=True)
class ModelRecord:
    logical_id: str
    provider: str
    model_id: str
    status: ModelStatus
    purposes: tuple[str, ...]
    structured_output: bool
    tuned: bool
    fine_tuning: FineTuningSupport
    dataset_lineage: str | None = None
    cost_class: Literal["low", "medium", "high", "unknown"] = "unknown"


@dataclass(frozen=True, slots=True)
class TaskPolicy:
    task_id: str
    policy_id: str
    prompt_id: str
    prompt_version: str
    schema_version: str
    preferred_model: str
    fallback_model: str | None
    temperature: float
    thinking: str
    timeout_seconds: float
    max_attempts: int
    retry_base_delay_seconds: float
    retry_max_delay_seconds: float
    quality_gates: tuple[str, ...]
    evaluation_suite: str


@dataclass(frozen=True, slots=True)
class EffectiveTaskPolicy:
    task_id: str
    policy_id: str
    prompt_id: str
    prompt_version: str
    schema_version: str
    provider: str
    logical_model_id: str
    model_id: str
    fallback_logical_model_id: str | None
    fallback_model_id: str | None
    temperature: float
    thinking: str
    timeout_seconds: float
    max_attempts: int
    retry_base_delay_seconds: float
    retry_max_delay_seconds: float
    quality_gates: tuple[str, ...]
    evaluation_suite: str


MODEL_REGISTRY = (
    ModelRecord(
        logical_id="gemini-3.8-flash/base",
        provider="gemini",
        model_id=DEFAULT_GENERATION_MODEL,
        status="baseline",
        purposes=("CARD_GENERATION", "BARI_CHAT"),
        structured_output=True,
        tuned=False,
        fine_tuning="unsupported",
        cost_class="low",
    ),
    ModelRecord(
        logical_id="gemini-3.5-flash/base",
        provider="gemini-enterprise-agent-platform",
        model_id="gemini-3.5-flash",
        status="candidate",
        purposes=("CARD_GENERATION",),
        structured_output=True,
        tuned=False,
        fine_tuning="enterprise-agent-platform",
        cost_class="unknown",
    ),
    ModelRecord(
        logical_id="gemini-3.5-flash-lite/base",
        provider="gemini",
        model_id="gemini-3.5-flash-lite",
        status="candidate",
        purposes=("CARD_GENERATION", "BARI_CHAT"),
        structured_output=True,
        tuned=False,
        fine_tuning="unsupported",
        cost_class="low",
    ),
)

CARD_GENERATION_POLICY = TaskPolicy(
    task_id="CARD_GENERATION",
    policy_id="bari-cardgen-v1",
    prompt_id="grounded-card-generation",
    prompt_version="1.4.0",
    schema_version="gateway-card-schema-1.2.0",
    preferred_model="gemini-3.8-flash/base",
    fallback_model="gemini-3.5-flash-lite/base",
    temperature=0.2,
    thinking="low",
    timeout_seconds=20,
    max_attempts=3,
    retry_base_delay_seconds=1,
    retry_max_delay_seconds=16,
    quality_gates=(
        "schema-valid",
        "source-span-resolved",
        "claim-grounded",
        "publication-policy-publish",
        "client-quality-gate",
    ),
    evaluation_suite="bari-cardgen-eval-v1",
)

BARI_CHAT_POLICY = TaskPolicy(
    task_id="BARI_CHAT",
    policy_id="bari-chat-v1",
    prompt_id="bari-chat",
    prompt_version="1.0.0",
    schema_version="bari-chat-schema-1.0.0",
    preferred_model="gemini-3.8-flash/base",
    fallback_model="gemini-3.5-flash-lite/base",
    temperature=0.7,
    thinking="low",
    timeout_seconds=20,
    max_attempts=3,
    retry_base_delay_seconds=1,
    retry_max_delay_seconds=16,
    quality_gates=("source-grounded", "citation-resolved", "privacy-safe"),
    evaluation_suite="bari-chat-eval-v1",
)

TASK_POLICIES = (CARD_GENERATION_POLICY, BARI_CHAT_POLICY)


def validate_registry(
    models: tuple[ModelRecord, ...] = MODEL_REGISTRY,
    policies: tuple[TaskPolicy, ...] = TASK_POLICIES,
) -> None:
    model_ids = [record.logical_id for record in models]
    if len(model_ids) != len(set(model_ids)):
        raise ValueError("Logical model IDs must be unique.")
    if any(record.tuned and not record.dataset_lineage for record in models):
        raise ValueError("Tuned model records require dataset lineage.")
    policy_ids = [policy.policy_id for policy in policies]
    if len(policy_ids) != len(set(policy_ids)):
        raise ValueError("Task policy IDs must be unique.")

    by_id = {record.logical_id: record for record in models}
    for policy in policies:
        for logical_id in (policy.preferred_model, policy.fallback_model):
            if logical_id is None:
                continue
            record = by_id.get(logical_id)
            if record is None:
                raise ValueError(f"Task policy references unknown model: {logical_id}.")
            if policy.task_id not in record.purposes:
                raise ValueError(f"Model {logical_id} does not support task {policy.task_id}.")
        if not (0 <= policy.temperature <= 2):
            raise ValueError("Task policy temperature must be between 0 and 2.")
        if policy.timeout_seconds <= 0 or policy.max_attempts < 1:
            raise ValueError("Task policy timeout and retry settings must be positive.")
        if policy.retry_base_delay_seconds < 0 or policy.retry_max_delay_seconds < policy.retry_base_delay_seconds:
            raise ValueError("Task policy retry delays are invalid.")


def logical_model_id(provider: str, model_id: str) -> str:
    match = next(
        (
            record
            for record in MODEL_REGISTRY
            if record.provider == provider and record.model_id == model_id
        ),
        None,
    )
    return match.logical_id if match else f"{provider}:{model_id}"


def resolve_task_policy(
    policy: TaskPolicy,
    *,
    provider: str,
    model_id: str,
    fallback_model_id: str | None,
    timeout_seconds: float | None = None,
    max_attempts: int | None = None,
    retry_base_delay_seconds: float | None = None,
    retry_max_delay_seconds: float | None = None,
) -> EffectiveTaskPolicy:
    return EffectiveTaskPolicy(
        task_id=policy.task_id,
        policy_id=policy.policy_id,
        prompt_id=policy.prompt_id,
        prompt_version=policy.prompt_version,
        schema_version=policy.schema_version,
        provider=provider,
        logical_model_id=logical_model_id(provider, model_id),
        model_id=model_id,
        fallback_logical_model_id=(
            logical_model_id(provider, fallback_model_id) if fallback_model_id else None
        ),
        fallback_model_id=fallback_model_id,
        temperature=policy.temperature,
        thinking=policy.thinking,
        timeout_seconds=timeout_seconds if timeout_seconds is not None else policy.timeout_seconds,
        max_attempts=max_attempts if max_attempts is not None else policy.max_attempts,
        retry_base_delay_seconds=(
            retry_base_delay_seconds
            if retry_base_delay_seconds is not None
            else policy.retry_base_delay_seconds
        ),
        retry_max_delay_seconds=(
            retry_max_delay_seconds
            if retry_max_delay_seconds is not None
            else policy.retry_max_delay_seconds
        ),
        quality_gates=policy.quality_gates,
        evaluation_suite=policy.evaluation_suite,
    )


validate_registry()
