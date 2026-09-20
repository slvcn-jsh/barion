from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from services.ai_gateway.errors import GatewayError

from . import BENCHMARK_VERSION
from .analysis import analyze_system, audit_production_grounding, freeze_concepts, match_systems
from .extraction import extract_source_pages, segment_pages
from .io_utils import sha256_file, sha256_text
from .production import (MIN_CANDIDATES, build_request, configured_model, effective_settings,
                         generate_remote, read_cached_cards)
from .quizlet import parse_quizlet_pdf
from .reporting import run_id, write_artifacts

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WORKDIR = ROOT / "tmp" / "card-benchmark"


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="Reproducible same-source production-vs-Quizlet card benchmark.")
    value.add_argument("--source", type=Path, default=DEFAULT_WORKDIR / "PDF_INPUT.pdf")
    value.add_argument("--quizlet", type=Path, default=DEFAULT_WORKDIR / "QUIZLET_OUTPUT.pdf")
    value.add_argument("--output", type=Path, default=DEFAULT_WORKDIR / "report")
    value.add_argument("--production-cache", type=Path, default=DEFAULT_WORKDIR / "cache" / "production.json")
    value.add_argument("--source-title", default="Comprehensive Psychiatric Nursing Review")
    value.add_argument("--model", default=configured_model())
    value.add_argument("--review-limit", type=int, default=60)
    value.add_argument("--allow-remote", action="store_true", help="Permit one Gemini request when cache is absent.")
    value.add_argument("--dry-run", action="store_true", help="Validate and print manifest without remote call or reports.")
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

    source_hash, quizlet_hash = sha256_file(source), sha256_file(quizlet)
    page_count, pages = extract_source_pages(source)
    segments = segment_pages(pages, args.source_title)
    quizlet_cards = parse_quizlet_pdf(quizlet)
    concepts = freeze_concepts(segments)
    request = build_request(segments, args.source_title, args.model)
    generation = effective_settings(args.model)
    manifest = {
        "benchmarkVersion": BENCHMARK_VERSION,
        "runId": run_id(source_hash, quizlet_hash, generation["effectiveGatewayPromptSha256"], args.model),
        "gitCommit": _git_commit(),
        "inputs": {"sourceFilename": source.name, "sourceSha256": source_hash,
                   "quizletFilename": quizlet.name, "quizletSha256": quizlet_hash,
                   "sourcePageCount": page_count, "textBearingPageCount": len(pages),
                   "quizletCardCount": len(quizlet_cards)},
        "pipeline": {"sourceExtractor": "pymupdf text sort=True", "segmentCount": len(segments),
                     "segmenter": "src/ingestion/segmenter.ts parity port", "conceptCount": len(concepts)},
        "generation": {**generation, "requestSha256": sha256_text(request.userPrompt)},
    }
    if args.dry_run:
        manifest["generation"]["status"] = "cache-ready" if args.production_cache.is_file() else "remote-required"
        print(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2))
        return 0

    if args.production_cache.is_file():
        production_cards, response = read_cached_cards(args.production_cache, request)
        generation_status = "cached"
    elif args.allow_remote:
        production_cards, response = generate_remote(request, args.production_cache)
        generation_status = "remote"
    else:
        raise ValueError(f"Production cache missing: {args.production_cache}. Remote generation blocked; rerun with --allow-remote after approval.")

    manifest["generation"].update({"status": generation_status,
        "providerRequestId": response.get("requestId"), "usage": response.get("usage"),
        "validatedCandidateCount": len(production_cards),
        "quantityContractMet": len(production_cards) >= MIN_CANDIDATES})
    source_text = "\n".join(page.text for page in pages)
    prod_summary, prod_rows = analyze_system(production_cards, concepts, source_text)
    quiz_summary, quiz_rows = analyze_system(quizlet_cards, concepts, source_text)
    summaries = {"production": prod_summary, "quizlet": quiz_summary}
    cards = {"production": production_cards, "quizlet": quizlet_cards}
    matches = match_systems(production_cards, quizlet_cards)
    grounding_audit = audit_production_grounding(production_cards, segments)
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
    write_artifacts(output, manifest, concepts, cards,
                    {"production": prod_rows, "quizlet": quiz_rows}, summaries, matches, warnings,
                    args.review_limit, grounding_audit)
    print(json.dumps({"runId": manifest["runId"], "output": str(output), "systems": summaries}, sort_keys=True, indent=2))
    return 0


def _git_commit() -> str:
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else "unknown"


if __name__ == "__main__":
    raise SystemExit(main())
