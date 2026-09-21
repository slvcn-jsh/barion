from __future__ import annotations
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import httpx, pytest
from services.card_evaluation.adapters.dailymed import DailyMedAdapter
from services.card_evaluation.adapters.fixture import FixtureAuthorityAdapter
from services.card_evaluation.cache import VerificationCache
from services.card_evaluation.models import SourceVerificationContext
from services.card_evaluation.network import AllowlistedHttpClient, RetrievalLimits, SecureRetrievalError
from services.card_evaluation.risk import route_claim
from services.card_evaluation.verification import VerificationCoordinator
from services.card_benchmark.claims import extract_text_claims
from services.card_benchmark.kernel import evaluate_card
from services.card_benchmark.models import Card, Segment

FIXTURES = Path(__file__).parents[2] / "card_evaluation" / "fixtures" / "authorities.json"

def claim(text, location="core_answer"):
    return extract_text_claims("card", location, text)[0]

def context(text, support="supported_by_citation", query=""):
    return SourceVerificationContext(text, text, support, "fully_grounded", query)

def fixture_coordinator(*, offline=False, cache=None):
    return VerificationCoordinator([FixtureAuthorityAdapter(FIXTURES)], cache, offline=offline)

def public_resolver(*_args, **_kwargs):
    return [(2, 1, 6, "", ("93.184.216.34", 443))]

def test_selective_versioned_risk_routing_and_not_required():
    low, dose = claim("Glucose is a monosaccharide"), claim("Lithium dose is 300 mg")
    assert not route_claim(low).required
    assert route_claim(dose).category == "dose" and route_claim(dose).routerVersion
    result = VerificationCoordinator().verify(low, context(low.claimText))
    assert result.verificationStatus == "verification_not_required"


def test_fixture_evidence_hashes_are_valid():
    import hashlib
    payload = json.loads(FIXTURES.read_text(encoding="utf-8"))
    for case in payload["cases"]:
        evidence = case["result"]["evidenceText"].encode("utf-8")
        assert hashlib.sha256(evidence).hexdigest() == case["result"]["evidenceHash"]

def test_verified_conflict_and_external_only_preserve_source_truth():
    lithium = claim("Patients taking lithium should maintain adequate salt and fluid intake.")
    assert fixture_coordinator().verify(lithium, context(lithium.claimText)).verificationStatus == "verified"
    text = "Disulfiram may be administered at least 8 hours after the last alcohol intake."
    conflict = fixture_coordinator().verify(claim(text), context(text))
    assert conflict.verificationStatus == "conflict"
    assert "8 hours" in conflict.sourceClaim and "12 hours" in conflict.evidenceText
    absent = "Disulfiram reactions may occur with alcohol up to 14 days after ingesting disulfiram."
    external = fixture_coordinator().verify(claim(absent), context(absent, "unsupported"))
    assert external.verificationStatus == "verified" and external.sourceSupport == "unsupported"

def test_offline_cache_hit_and_stale_invalidation(tmp_path):
    now = datetime(2026, 9, 21, tzinfo=timezone.utc)
    path = tmp_path / "cache.json"
    item = claim("Patients taking lithium should maintain adequate salt and fluid intake.")
    fixture_coordinator(cache=VerificationCache(path, now=lambda: now)).verify(item, context(item.claimText))
    cached = fixture_coordinator(offline=True, cache=VerificationCache(path, now=lambda: now)).verify(item, context(item.claimText))
    assert cached.fromCache
    stale = fixture_coordinator(offline=True, cache=VerificationCache(path, now=lambda: now + timedelta(days=60))).verify(item, context(item.claimText))
    assert stale.verificationStatus == "not_performed_offline"
    uncached = VerificationCoordinator(offline=True).verify(claim("Lithium dose is 300 mg"), context("Lithium dose is 300 mg", query="lithium"))
    assert uncached.verificationStatus == "not_performed_offline"

def test_authority_unavailable_and_malformed_response():
    item = claim("Lithium dose is 300 mg")
    assert VerificationCoordinator().verify(item, context(item.claimText, query="lithium")).verificationStatus == "authority_unavailable"
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, headers={"content-type": "application/json"}, content=b"{"))
    client = AllowlistedHttpClient(("dailymed.nlm.nih.gov",), transport=transport, resolver=public_resolver)
    assert VerificationCoordinator([DailyMedAdapter(client)]).verify(item, context(item.claimText, query="lithium")).verificationStatus == "authority_unavailable"

def test_network_rejects_ssrf_redirect_mime_and_size():
    safe = "https://dailymed.nlm.nih.gov/test"
    client = AllowlistedHttpClient(("dailymed.nlm.nih.gov",), resolver=public_resolver)
    for url in ("http://dailymed.nlm.nih.gov/test", "https://localhost/test", "file:///etc/passwd", "https://user:secret@dailymed.nlm.nih.gov/test"):
        with pytest.raises(SecureRetrievalError): client.get(url)
    client.close()
    scenarios = [httpx.Response(302, headers={"location": safe}), httpx.Response(200, headers={"content-type": "text/html"}, content=b"no"), httpx.Response(200, headers={"content-type": "application/xml"}, content=b"x" * 9)]
    for response in scenarios:
        mocked = AllowlistedHttpClient(("dailymed.nlm.nih.gov",), RetrievalLimits(maximumBytes=8), httpx.MockTransport(lambda _request, r=response: r), public_resolver)
        with pytest.raises(SecureRetrievalError): mocked.get(safe)

def test_minimized_request_excludes_private_source_material():
    requests = []
    search = {"data": [{"setid": "abc", "spl_version": 1, "published_date": "today"}]}
    xml = b'<document xmlns="urn:hl7-org:v3"><component><structuredBody><component><section><title>DOSAGE</title><text>Lithium dose is 300 mg.</text></section></component></structuredBody></component></document>'
    def handler(request):
        requests.append(str(request.url))
        payload = json.dumps(search).encode() if "spls.json" in str(request.url) else xml
        mime = "application/json" if "spls.json" in str(request.url) else "application/xml"
        return httpx.Response(200, headers={"content-type": mime}, content=payload)
    client = AllowlistedHttpClient(("dailymed.nlm.nih.gov",), transport=httpx.MockTransport(handler), resolver=public_resolver)
    item, private = claim("Lithium dose is 300 mg"), "Student Jane private deck notes"
    result = VerificationCoordinator([DailyMedAdapter(client)]).verify(
        item, SourceVerificationContext(item.claimText, private, "supported_by_citation", "fully_grounded", "lithium"))
    assert result.verificationStatus == "verified"
    assert all(private not in url and "300" not in url for url in requests)

def test_policy_holds_conflict_and_rejects_externally_supported_source_absence():
    text = "Disulfiram may be administered at least 8 hours after the last alcohol intake."
    source = Segment("s", "Page 1", "Medication", text, 0, len(text))
    card = Card("c", "When may disulfiram be administered?", f"Answer: {text}", "production", "s", "Page 1", "medication-timing", "Recall timing.", text)
    conflict = evaluate_card(card, [source], fixture_coordinator())
    assert conflict["policy"].decision == "REVIEW" and "SOURCE_CONFLICT" in conflict["policy"].reasonCodes
    absent_text = "Disulfiram reactions may occur with alcohol up to 14 days after ingesting disulfiram."
    absent = Card("u", "What is the delayed reaction window?", f"Answer: {absent_text}", "production", "s", "Page 1", "medication-timing", "Recall timing.", text)
    result = evaluate_card(absent, [source], fixture_coordinator())
    assert any(item.verificationStatus == "verified" for item in result["verification"])
    assert result["policy"].decision == "REJECT"
