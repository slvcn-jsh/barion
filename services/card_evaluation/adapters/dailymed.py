from __future__ import annotations
import hashlib, json, re
from datetime import datetime, timedelta, timezone
from time import monotonic
from urllib.parse import quote
from xml.etree import ElementTree as ET
from ..models import RiskRoute, SourceVerificationContext, VerificationResult
from ..network import AllowlistedHttpClient, SecureRetrievalError

DAILYMED_ADAPTER_VERSION = "1.0.0"
_HOST = "dailymed.nlm.nih.gov"
_NS = {"v3": "urn:hl7-org:v3"}

class DailyMedAdapter:
    id = "dailymed"
    version = DAILYMED_ADAPTER_VERSION
    authority_type = "official_drug_label"
    authority_name = "NIH National Library of Medicine DailyMed"

    def __init__(self, client: AllowlistedHttpClient | None = None, now=lambda: datetime.now(timezone.utc),
                 clock=monotonic) -> None:
        self.client = client or AllowlistedHttpClient((_HOST,))
        self._owns_client = client is None
        self._now = now
        self._clock = clock

    def close(self) -> None:
        if self._owns_client: self.client.close()

    def supports(self, claim: str, route: RiskRoute, context: SourceVerificationContext) -> bool:
        return bool(context.authorityQuery.strip()) and route.category in {
            "dose", "serum_or_lab_threshold", "medication_timing", "frequency_or_duration",
            "contraindication_or_interaction", "medication_action", "numeric_clinical_criterion",
            "diagnostic_threshold", "emergency_management",
        }

    def verify_claim(self, claim_id: str, claim: str, route: RiskRoute,
                     context: SourceVerificationContext, cache_key: str,
                     *, deadline: float | None = None) -> VerificationResult:
        retrieved = self._now()
        try:
            query = quote(context.authorityQuery.strip(), safe="")
            search_url = f"https://{_HOST}/dailymed/services/v2/spls.json?drug_name={query}&pagesize=20"
            search = json.loads(self.client.get(search_url, timeout_seconds=self._remaining(deadline)).decode("utf-8"))
            candidates = [item for item in search.get("data", []) if isinstance(item, dict)]
            if not candidates:
                return self._unavailable(claim_id, claim, route, context, cache_key, "No matching official label was found.")
            label = candidates[0]
            set_id = str(label["setid"])
            label_url = f"https://{_HOST}/dailymed/services/v2/spls/{quote(set_id, safe='')}.xml"
            location, evidence, score = _best_evidence(
                claim,
                _sections(ET.fromstring(self.client.get(label_url, timeout_seconds=self._remaining(deadline)))),
            )
            if not evidence:
                return self._unavailable(claim_id, claim, route, context, cache_key, "Official label contained no comparable text.")
            status, confidence, reason = _compare(claim, evidence)
            return VerificationResult(
                claimId=claim_id, claimNormalized=_normalize(claim), verificationStatus=status,
                triggerReason=route.reason, riskCategory=route.category,
                authorityType=self.authority_type, authorityName=self.authority_name,
                authorityDocumentId=set_id, authorityVersion=str(label.get("spl_version", "")),
                authorityDate=str(label.get("published_date", "")), retrievedAt=retrieved.isoformat(),
                evidenceText=evidence, evidenceLocation=location, evidenceUrl=label_url,
                evidenceHash=hashlib.sha256(evidence.encode()).hexdigest(), sourceClaim=context.sourceClaim,
                sourceEvidence=context.sourceEvidence, sourceSupport=context.sourceSupport,
                agreesWithSource=status in {"verified", "likely_correct"}, confidence=confidence,
                reason=reason, cacheKey=cache_key, adapterVersion=self.version, schemaVersion="1.0.0",
                routerVersion=route.routerVersion, cacheExpiresAt=(retrieved + timedelta(days=30)).isoformat(),
                diagnostic={"lexicalScore": round(score, 4)},
            )
        except (SecureRetrievalError, ValueError, KeyError, TypeError, ET.ParseError, UnicodeDecodeError):
            return self._unavailable(claim_id, claim, route, context, cache_key, "Official authority was unavailable or malformed.")

    def _remaining(self, deadline: float | None) -> float | None:
        if deadline is None:
            return None
        remaining = deadline - self._clock()
        if remaining <= 0:
            raise SecureRetrievalError("Authority request budget exhausted.")
        return remaining

    def _unavailable(self, claim_id, claim, route, context, cache_key, reason):
        return VerificationResult(
            claimId=claim_id, claimNormalized=_normalize(claim), verificationStatus="authority_unavailable",
            triggerReason=route.reason, riskCategory=route.category, authorityType=self.authority_type,
            authorityName=self.authority_name, sourceClaim=context.sourceClaim,
            sourceEvidence=context.sourceEvidence, sourceSupport=context.sourceSupport,
            reason=reason, cacheKey=cache_key, adapterVersion=self.version, schemaVersion="1.0.0",
            routerVersion=route.routerVersion,
        )

def _sections(root: ET.Element) -> list[tuple[str, str]]:
    output = []
    for section in root.findall(".//v3:section", _NS):
        title_node, text_node = section.find("v3:title", _NS), section.find("v3:text", _NS)
        title = " ".join("".join(title_node.itertext()).split()) if title_node is not None else "Official label"
        text = " ".join("".join(text_node.itertext()).split()) if text_node is not None else ""
        if text: output.append((title, text))
    return output

def _compare(claim: str, evidence: str) -> tuple[str, float, str]:
    claim_numbers, evidence_numbers = _numbers(claim), _numbers(evidence)
    overlap = len(_tokens(claim) & _tokens(evidence)) / max(1, len(_tokens(claim)))
    if claim_numbers and evidence_numbers and not claim_numbers <= evidence_numbers and overlap >= 0.35:
        return "conflict", 0.95, "Official label discusses same claim but has conflicting numeric value."
    claim_negated = bool(re.search(r"\b(no|not|never|must not|avoid)\b", claim, re.I))
    evidence_negated = bool(re.search(r"\b(no|not|never|must not|avoid)\b", evidence, re.I))
    if claim_negated != evidence_negated and overlap >= 0.6:
        return "incorrect", 0.9, "Official label has conflicting proposition polarity."
    if overlap >= 0.7 and (not claim_numbers or claim_numbers <= evidence_numbers):
        return "verified", min(0.99, 0.72 + overlap / 4), "Official label directly supports normalized claim."
    if overlap >= 0.5:
        return "likely_correct", 0.72, "Official label is compatible but not an exact proposition match."
    return "uncertain", 0.4, "Official label evidence was insufficient for deterministic agreement."

def _normalize(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9.%/]+", value.lower()))

def _tokens(value: str) -> set[str]:
    stop = {"the", "and", "for", "with", "after", "before", "from", "should", "must", "least"}
    return {token for token in re.findall(r"[a-z]+|\d+(?:\.\d+)?", value.lower()) if len(token) > 2 and token not in stop}

def _entity_tokens(value: str) -> set[str]:
    return {token for token in _tokens(value) if len(token) >= 6}

def _numbers(value: str) -> set[str]:
    return set(re.findall(r"\b\d+(?:\.\d+)?\b", value))


def _best_evidence(claim, sections):
    claim_tokens, best = _tokens(claim), ("", "", 0.0)
    for location, text in sections:
        sentences = re.split(r"(?<=[.!?])\s+", text)
        for index in range(len(sentences)):
            window = " ".join(sentences[max(0, index - 1):index + 2])[:1800]
            tokens = _tokens(window)
            score = len(claim_tokens & tokens) / max(1, len(claim_tokens))
            score += 0.2 if _entity_tokens(claim) & tokens else 0.0
            if score > best[2]: best = (location, window, score)
    return best
