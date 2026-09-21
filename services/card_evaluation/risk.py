from __future__ import annotations

import re
from typing import Protocol

from .models import RiskRoute

RISK_ROUTER_VERSION = "1.0.0"

_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("emergency_management", re.compile(r"\b(emergency|airway|breathing|circulation|resuscitat|anaphylaxis|overdose|respiratory arrest)\b", re.I)),
    ("dose", re.compile(r"\b(dose|dosage|\d+(?:\.\d+)?\s*(?:mg|mcg|g)(?:/day)?)\b", re.I)),
    ("serum_or_lab_threshold", re.compile(r"\b(serum|lab|therapeutic level|toxic(?:ity)? threshold|\d+(?:\.\d+)?\s*(?:mEq/L|mmol/L|mg/dL))\b", re.I)),
    ("diagnostic_threshold", re.compile(r"\b(diagnostic|criterion|criteria|threshold|at least\s+\d+|more than\s+\d+|less than\s+\d+)\b", re.I)),
    ("medication_timing", re.compile(r"\b(before|after|wait|timing|within)\b.*\b(dose|administer|medication|drug|disulfiram|lithium)\b|\b(dose|administer|medication|drug|disulfiram|lithium)\b.*\b(before|after|wait|timing|within)\b", re.I)),
    ("frequency_or_duration", re.compile(r"\b(every|daily|twice|three times|duration|for\s+\d+\s*(?:hours?|days?|weeks?|months?))\b", re.I)),
    ("contraindication_or_interaction", re.compile(r"\b(contraindicat|interaction|must not|avoid alcohol|pregnan|pediatric|infant|child)\b", re.I)),
    ("medication_action", re.compile(r"\b(initiat|discontinu|stop taking|start taking|taper|monitor(?:ing)?|administ(?:er|ration)|route|maintain)\b", re.I)),
    ("numeric_clinical_criterion", re.compile(r"\b\d+(?:\.\d+)?\s*(?:%|hours?|days?|weeks?|months?|years?|y/o)\b", re.I)),
)


class ClaimLike(Protocol):
    claimText: str
    claimType: str
    riskLevel: str


def route_claim(claim: ClaimLike) -> RiskRoute:
    text = claim.claimText.strip()
    category = next((name for name, pattern in _PATTERNS if pattern.search(text)), "general_medical")
    required = claim.riskLevel in {"critical", "high"} or category != "general_medical"
    reason = (
        f"Selective verification required: {category} is clinically consequential."
        if required else "No elevated medical-risk trigger matched."
    )
    return RiskRoute(required, category, claim.riskLevel, reason, RISK_ROUTER_VERSION)
