from __future__ import annotations

from .expert_evaluation import ExpertEvaluation

FINAL_POLICY_VERSION = "2.0.0"


def final_disposition(deterministic_decision: str, evaluation: ExpertEvaluation, *, core_supported: bool,
                      safety_failure: bool, unresolved_high_risk: bool = False) -> str:
    """Pedagogy may tighten deterministic policy, never erase source or safety failures."""
    if safety_failure or not core_supported or deterministic_decision == "REJECT":
        return "REJECT"
    if unresolved_high_risk or deterministic_decision == "REVIEW":
        return "REVIEW"
    if evaluation.quality == "UNUSABLE":
        return "REJECT"
    if evaluation.quality == "POOR":
        return "REVIEW"
    if deterministic_decision == "SANITIZE":
        return "SANITIZE"
    return "PUBLISH"
