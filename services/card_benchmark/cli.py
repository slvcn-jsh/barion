from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from dataclasses import asdict
from pathlib import Path

from services.ai_gateway.errors import GatewayError

from . import BENCHMARK_VERSION
from .analysis import analyze_system
from .blind_review import BLIND_REVIEW_VERSION, RUBRIC_VERSION, build_blind_review, review_protocol
from .coverage import COVERAGE_VERSION, DEFAULT_WEIGHT_CONFIG, evaluate_coverage
from .extraction import STRUCTURAL_EXTRACTION_VERSION, extract_source_pages, extract_structural_units, segment_pages
from .inventory import INVENTORY_VERSION, build_concept_inventory
from .claims import CLAIM_EXTRACTOR_VERSION
from .grounding import GROUNDING_VERSION
from .io_utils import canonical_json, sha256_file, sha256_text
from .kernel import claim_artifact_rows, evaluate_card
from .normalization import NORMALIZATION_VERSION, normalize_cards
from .policy import POLICY_VERSION
from .regressions import run_regression_fixtures
from .semantic_fixtures import run_semantic_fixtures
from .semantic_matching import SEMANTIC_MATCH_VERSION, pair_systems
from .validators import VALIDATOR_VERSION, validate_deck
from .production import (
    DEFAULT_BATCH_COUNT, DEFAULT_MAX_INPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS,
    DEFAULT_MAX_REQUESTS, MIN_CANDIDATES, build_batch_requests, build_request,
    configured_model, effective_settings, generate_remote_batched, read_batched_cards,
    read_cached_cards,
)
from .quizlet import parse_quizlet_pdf
from .reporting import run_id, write_artifacts

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WORKDIR = ROOT / "tmp" / "card-benchmark"


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="Reproducible same-source production-vs-Quizlet card benchmark.")
    value.add_argument("--source", type=Path, default=DEFAULT_WORKDIR / "PDF_INPUT.pdf")
    value.add_argument("--quizlet", type=Path, default=DEFAULT_WORKDIR / "QUIZLET_OUTPUT.pdf")
    value.add_argument("--output", type=Path, default=DEFAULT_WORKDIR / "runs", help="Parent directory for immutable run directories.")
    value.add_argument("--production-cache", type=Path, default=DEFAULT_WORKDIR / "cache" / "production.json")
    value.add_argument("--source-title", default="Comprehensive Psychiatric Nursing Review")
    value.add_argument("--model", default=configured_model())
    value.add_argument("--review-limit", type=int, default=60)
    value.add_argument("--allow-remote", action="store_true", help="Permit capped resumable Gemini batch generation when cache is absent.")
    value.add_argument("--generation-batches", type=int, default=DEFAULT_BATCH_COUNT)
    value.add_argument("--max-generation-requests", type=int, default=DEFAULT_MAX_REQUESTS)
    value.add_argument("--max-input-tokens", type=int, default=DEFAULT_MAX_INPUT_TOKENS)
    value.add_argument("--max-output-tokens", type=int, default=DEFAULT_MAX_OUTPUT_TOKENS)
    value.add_argument("--dry-run", action="store_true", help="Validate and print manifest without remote call or reports.")
    value.add_argument("--seed", default="phase1-deterministic", help="Recorded seed for any randomized exports.")
    return value


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return execute(args)
    except GatewayError as error:
        print(f"benchmark error: {error}", file=sys.stderr)
        if error.diagnostics:
            print(json.dumps({"providerDiagnostics": error.diagnostics}, ensure_ascii=False, sort_keys=True, indent=2), file=sys.stderr)
        return 2
    except (OSError, ValueError) as error:
        print(f"benchmark error: {error}", file=sys.stderr)
        return 2


def execute(args: argparse.Namespace) -> int:
    source = args.source.resolve(); quizlet = args.quizlet.resolve(); output = args.output.resolve()
    for path in (source, quizlet):
        if not path.is_file(): raise ValueError(f"Input does not exist: {path}")
    if args.review_limit < 1: raise ValueError("--review-limit must be positive.")
    for name in ("generation_batches", "max_generation_requests", "max_input_tokens", "max_output_tokens"):
        if getattr(args, name) < 1:
            raise ValueError(f"--{name.replace('_', '-')} must be positive.")

    source_hash, quizlet_hash = sha256_file(source), sha256_file(quizlet)
    page_count, pages = extract_source_pages(source)
    segments = segment_pages(pages, args.source_title)
    structural_units = extract_structural_units(pages, segments, args.source_title)
    concepts = build_concept_inventory(structural_units)  # Frozen before either deck is analyzed.
    quizlet_cards = parse_quizlet_pdf(quizlet)
    request = build_request(segments, args.source_title, args.model)
    batch_requests = build_batch_requests(
        segments, args.source_title, args.model, args.generation_batches, args.max_generation_requests,
    )
    generation = effective_settings(args.model)
    generation.update({
        "strategy": "deterministic-resumable-batches",
        "partitionBatchCount": min(args.generation_batches, len(segments)),
        "plannedRequestCount": len(batch_requests),
        "maxRequests": args.max_generation_requests, "maxInputTokens": args.max_input_tokens,
        "maxOutputTokensTotal": args.max_output_tokens,
        "batchRequestSha256": [sha256_text(item.userPrompt) for item in batch_requests],
    })
    extracted_text = "\n".join(page.text for page in pages)
    extracted_hash = sha256_text(extracted_text)
    segment_hash = sha256_text(canonical_json([asdict(segment) for segment in segments]))
    quizlet_deck_hash = sha256_text(canonical_json([asdict(card) for card in normalize_cards(quizlet_cards)]))
    config = {"reviewLimit": args.review_limit, "seed": args.seed, "sourceTitle": args.source_title,
              "semanticMatcherVersion": SEMANTIC_MATCH_VERSION,
              "blindReviewVersion": BLIND_REVIEW_VERSION, "rubricVersion": RUBRIC_VERSION}
    config_hash = sha256_text(canonical_json(config))
    git_commit, git_state, dependency_hash = _git_commit(), _git_state(), _dependency_lock_hash()
    provisional_run_id = run_id(source_hash, extracted_hash, segment_hash, quizlet_deck_hash,
                                config_hash, CLAIM_EXTRACTOR_VERSION, GROUNDING_VERSION,
                                VALIDATOR_VERSION, POLICY_VERSION, generation["effectiveGatewayPromptSha256"],
                                args.model, git_commit, str(git_state["statusSha256"]), dependency_hash)
    manifest = {
        "benchmarkVersion": BENCHMARK_VERSION, "runId": provisional_run_id,
        "startTimestamp": datetime.now(timezone.utc).isoformat(), "endTimestamp": None,
        "gitCommit": git_commit, "gitDirty": git_state, "dependencyLockSha256": dependency_hash,
        "randomizationSeed": args.seed,
        "versions": {"normalization": NORMALIZATION_VERSION, "claimExtractor": CLAIM_EXTRACTOR_VERSION,
                     "grounding": GROUNDING_VERSION, "validator": VALIDATOR_VERSION,
                     "policy": POLICY_VERSION, "structuralExtraction": STRUCTURAL_EXTRACTION_VERSION,
                     "conceptInventory": INVENTORY_VERSION, "coverage": COVERAGE_VERSION,
                     "coverageWeights": DEFAULT_WEIGHT_CONFIG["version"],
                     "semanticMatcher": SEMANTIC_MATCH_VERSION,
                     "blindReview": BLIND_REVIEW_VERSION, "rubric": RUBRIC_VERSION},
        "hashes": {"sourceSha256": source_hash, "extractedTextSha256": extracted_hash,
                   "segmentSha256": segment_hash, "quizletDeckSha256": quizlet_deck_hash,
                   "productionDeckSha256": None, "evaluatorConfigSha256": config_hash},
        "inputs": {"sourceFilename": source.name, "sourceSha256": source_hash,
                   "quizletFilename": quizlet.name, "quizletSha256": quizlet_hash,
                   "sourcePageCount": page_count, "textBearingPageCount": sum(bool(page.text) for page in pages),
                   "quizletCardCount": len(quizlet_cards)},
        "pipeline": {"sourceExtractor": "pymupdf text sort=True with structural diagnostics",
                     "segmentCount": len(segments), "structuralUnitCount": len(structural_units),
                     "extractionWarningCount": sum(bool(unit.warnings) for unit in structural_units),
                     "segmenter": "src/ingestion/segmenter.ts parity port", "conceptCount": len(concepts)},
        "generation": {**generation, "requestSha256": sha256_text(request.userPrompt)},
    }
    if args.dry_run:
        if args.production_cache.is_file():
            try:
                read_cached_cards(args.production_cache, request)
                cache_status = "cache-compatible"
            except (OSError, ValueError) as error:
                cache_status = "cache-incompatible"
                manifest["generation"]["cacheError"] = str(error)
        elif args.production_cache.with_suffix(args.production_cache.suffix + ".batches").is_dir():
            try:
                read_batched_cards(args.production_cache, batch_requests)
                cache_status = "batch-cache-compatible"
            except (OSError, ValueError) as error:
                cache_status = "batch-cache-partial-or-incompatible"
                manifest["generation"]["cacheError"] = str(error)
        else:
            cache_status = "remote-required"
        manifest["generation"]["status"] = cache_status
        print(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2))
        return 0

    if args.production_cache.is_file():
        production_cards, response = read_cached_cards(args.production_cache, request)
        generation_status = "cached-legacy-single-request"
    elif args.allow_remote:
        production_cards, response = generate_remote_batched(
            batch_requests, args.production_cache, args.max_generation_requests,
            args.max_input_tokens, args.max_output_tokens,
        )
        generation_status = "remote-batched"
    elif args.production_cache.with_suffix(args.production_cache.suffix + ".batches").is_dir():
        production_cards, response = read_batched_cards(args.production_cache, batch_requests)
        generation_status = "cached-batched"
    else:
        raise ValueError(f"Production cache missing: {args.production_cache}. Remote generation blocked; rerun with --allow-remote after approval.")

    manifest["generation"].update({"status": generation_status,
        "providerRequestId": response.get("requestId"), "usage": response.get("usage"),
        "batchGeneration": response.get("batchGeneration"),
        "validatedCandidateCount": len(production_cards),
        "quantityContractMet": len(production_cards) >= MIN_CANDIDATES})
    normalized_production = normalize_cards(production_cards)
    production_deck_hash = sha256_text(canonical_json([asdict(card) for card in normalized_production]))
    manifest["hashes"]["productionDeckSha256"] = production_deck_hash
    manifest["runId"] = run_id(source_hash, extracted_hash, segment_hash, quizlet_deck_hash, production_deck_hash,
                               config_hash, CLAIM_EXTRACTOR_VERSION, GROUNDING_VERSION,
                               VALIDATOR_VERSION, POLICY_VERSION, args.model, git_commit,
                               str(git_state["statusSha256"]), dependency_hash)
    run_output = output / manifest["runId"]
    evaluations = [evaluate_card(card, segments) for card in production_cards]
    claim_rows = [row for evaluation in evaluations for row in claim_artifact_rows(manifest["runId"], evaluation)]
    deck_validations = validate_deck(normalized_production, segments)
    regression_results = run_regression_fixtures()
    evaluation_summary = _evaluation_summary(evaluations, deck_validations, regression_results[0])
    manifest["endTimestamp"] = datetime.now(timezone.utc).isoformat()
    prod_summary, prod_rows = analyze_system(production_cards, concepts, extracted_text)
    quiz_summary, quiz_rows = analyze_system(quizlet_cards, concepts, extracted_text)
    coverage = {"production": evaluate_coverage(production_cards, concepts, page_count),
                "quizlet": evaluate_coverage(quizlet_cards, concepts, page_count)}
    prod_summary["phase2Coverage"] = coverage["production"]
    quiz_summary["phase2Coverage"] = coverage["quizlet"]
    summaries = {"production": prod_summary, "quizlet": quiz_summary}
    cards = {"production": normalized_production, "quizlet": normalize_cards(quizlet_cards)}
    semantic_calibration = run_semantic_fixtures()
    if not semantic_calibration[0]["passed"]:
        raise ValueError("Semantic matcher calibration fixtures failed; refusing comparative pair export.")
    matches = pair_systems(production_cards, quizlet_cards, concepts)
    blind_rows, blind_key = build_blind_review(
        matches, production_cards, quizlet_cards, concepts, args.seed, args.review_limit,
    )
    blind_review = (blind_rows, blind_key, review_protocol(len(blind_rows)))
    grounding_audit = None  # Compatibility audit remains callable; claim JSONL is canonical.
    warnings = []
    if len(production_cards) < MIN_CANDIDATES:
        warnings.append(
            f"SEVERE UNDERPRODUCTION: production returned {len(production_cards)} validated cards; "
            f"minimum contract is {MIN_CANDIDATES}. Results are diagnostic only."
        )
    elif len(production_cards) < request.maxCandidates:
        warnings.append(
            f"Production returned {len(production_cards)} validated cards below {request.maxCandidates}-card target."
        )
    warnings.append("Comparative pedagogical-quality conclusions require calibrated blind human review.")
    if len(blind_rows) < 30:
        warnings.append(
            f"BLIND REVIEW BLOCKED: only {len(blind_rows)} source-constrained pairs available; minimum is 30."
        )
    if regression_results[0]["failed"]:
        warnings.append(f"CRITICAL: {regression_results[0]['failed']} known regression fixture(s) failed.")
    write_artifacts(run_output, manifest, concepts, cards,
                    {"production": prod_rows, "quizlet": quiz_rows}, summaries, matches, warnings,
                    args.review_limit, grounding_audit, claim_rows, evaluation_summary, regression_results,
                    structural_units, coverage, semantic_calibration, blind_review)
    print(json.dumps({"runId": manifest["runId"], "output": str(run_output),
                      "phase1Evaluation": evaluation_summary}, sort_keys=True, indent=2))
    return 0



def _evaluation_summary(evaluations: list[dict[str, object]], deck_validations: list[object],
                        regression_summary: dict[str, object]) -> dict[str, object]:
    claims = [claim for evaluation in evaluations for claim in evaluation["claims"]]
    grounding = [item for evaluation in evaluations for item in evaluation["grounding"]]
    validations = [item for evaluation in evaluations for item in evaluation["validations"]] + deck_validations
    return {
        "claimCount": len(claims),
        "groundingStatuses": dict(sorted(Counter(item.sourceSupport for item in grounding).items())),
        "citationStatuses": dict(sorted(Counter(item.citationStatus for item in grounding).items())),
        "riskCounts": dict(sorted(Counter(item.riskLevel for item in claims).items())),
        "decisions": dict(sorted(Counter(evaluation["policy"].decision for evaluation in evaluations).items())),
        "contradictions": sum(item.sourceSupport == "contradicted" for item in grounding),
        "criticalFailures": sum(item.severity == "critical" and item.policyConsequence in {"REVIEW", "REJECT"} for item in validations),
        "validationCodes": dict(sorted(Counter(item.code for item in validations).items())),
        "knownRegressions": regression_summary,
    }


def _git_state() -> dict[str, object]:
    result = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, check=False)
    status = result.stdout if result.returncode == 0 else "unknown"
    return {"dirty": bool(status.strip()), "statusSha256": sha256_text(status)}


def _dependency_lock_hash() -> str:
    files = [ROOT / "package-lock.json", ROOT / "services" / "ai_gateway" / "requirements.txt",
             ROOT / "services" / "card_benchmark" / "requirements.txt"]
    payload = "".join(f"{path.relative_to(ROOT)}\0{sha256_file(path)}\n" for path in files if path.is_file())
    return sha256_text(payload)


def _git_commit() -> str:
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else "unknown"


if __name__ == "__main__":
    raise SystemExit(main())
