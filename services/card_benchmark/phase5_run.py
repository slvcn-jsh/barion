from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from services.card_evaluation.adapters.fixture import FixtureAuthorityAdapter
from services.card_evaluation.cache import CACHE_VERSION, VerificationCache
from services.card_evaluation.models import SourceVerificationContext
from services.card_evaluation.risk import RISK_ROUTER_VERSION
from services.card_evaluation.verification import VERIFICATION_SCHEMA_VERSION, VerificationCoordinator

from .claims import extract_text_claims
from .io_utils import canonical_json, read_json, sha256_file, sha256_text, write_json
from .phase3_run import _tree_hash

PHASE5_RUN_VERSION = "1.0.0"


def run(parent: Path, output_root: Path, fixture_path: Path) -> Path:
    parent = parent.resolve()
    fixture_path = fixture_path.resolve()
    parent_hash = _tree_hash(parent)
    fixture_hash = sha256_file(fixture_path)
    run_id = sha256_text("\0".join((parent_hash, fixture_hash, PHASE5_RUN_VERSION,
                                      RISK_ROUTER_VERSION, VERIFICATION_SCHEMA_VERSION)))[:24]
    output = output_root.resolve() / run_id
    if output.exists():
        raise ValueError(f"Phase 5 run already exists and is immutable: {output}")
    fixture = read_json(fixture_path)
    coordinator = VerificationCoordinator([FixtureAuthorityAdapter(fixture_path)], VerificationCache())
    results = []
    source_support = {
        "externally-correct-source-absent": "unsupported",
        "disulfiram-timing-conflict": "supported_by_citation",
        "lithium-fluid-guidance": "supported_by_citation",
    }
    for case in fixture["cases"]:
        extracted = extract_text_claims(case["id"], "core_answer", case["claim"])
        if not extracted:
            raise ValueError(f"Fixture did not yield an atomic claim: {case['id']}")
        claim = extracted[0]
        support = source_support.get(case["id"], "supported_by_citation")
        context = SourceVerificationContext(case["claim"], f"Frozen source evidence: {case['claim']}",
                                            support, "unsupported" if support == "unsupported" else "fully_grounded")
        results.append({"caseId": case["id"], **asdict(coordinator.verify(claim, context))})
    statuses = Counter(item["verificationStatus"] for item in results)
    manifest = {
        "runId": run_id, "phase5RunVersion": PHASE5_RUN_VERSION, "parentRunId": read_json(parent / "manifest.json")["runId"],
        "parentRunSha256": parent_hash, "authorityFixtureSha256": fixture_hash,
        "riskRouterVersion": RISK_ROUTER_VERSION, "verificationSchemaVersion": VERIFICATION_SCHEMA_VERSION,
        "cacheVersion": CACHE_VERSION, "createdAt": datetime.now(timezone.utc).isoformat(),
        "immutable": True, "networkUsed": False, "paidGeneration": False,
    }
    summary = {
        "caseCount": len(results), "statuses": dict(sorted(statuses.items())),
        "sourceTruthPreserved": all(item["sourceSupport"] == source_support[item["caseId"]] for item in results),
        "conflictPreservesBothSides": any(item["verificationStatus"] == "conflict" and item["sourceClaim"] and item["evidenceText"] for item in results),
        "externalTruthDoesNotCreateGrounding": any(item["verificationStatus"] == "verified" and item["sourceSupport"] == "unsupported" for item in results),
    }
    output.mkdir(parents=True, exist_ok=False)
    write_json(output / "manifest.json", manifest)
    write_json(output / "verification_results.json", results)
    write_json(output / "summary.json", summary)
    (output / "report.md").write_text(
        "# Phase 5 selective authority verification\n\n" +
        f"- Parent run: `{manifest['parentRunId']}`\n- Cases: {len(results)}\n" +
        f"- Statuses: `{canonical_json(summary['statuses'])}`\n" +
        "- Frozen authoritative fixtures only; no card regeneration or provider billing.\n",
        encoding="utf-8",
    )
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create immutable Phase 5 verification evidence run.")
    parser.add_argument("--parent", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, default=Path(__file__).parents[1] / "card_evaluation" / "fixtures" / "authorities.json")
    args = parser.parse_args(argv)
    print(run(args.parent, args.output, args.fixtures))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
