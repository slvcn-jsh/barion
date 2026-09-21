from __future__ import annotations
POLICY_VERSION = "3.0.0"

def decide_facts(facts: dict[str, object]) -> str:
    core = facts.get("coreSource")
    optional = facts.get("optionalSource")
    citation = facts.get("citation")
    risk = facts.get("risk")
    verification = facts.get("verification")
    if core in {"unsupported", "contradicted"}: return "REJECT"
    if optional == "unsupported" and not facts.get("sanitized"): return "SANITIZE"
    if citation in {"uncertain", "wrong_segment", "missing", "stale"}: return "REVIEW"
    if verification in {"conflict", "incorrect", "outdated"}: return "REVIEW"
    if risk in {"critical", "high"} and verification in {"uncertain", "not_performed_offline", "authority_unavailable"}: return "REVIEW"
    return "PUBLISH"
