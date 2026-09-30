import json

from services.card_benchmark.phase6_run import run


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_phase6_persists_logical_model_evaluation_envelope(tmp_path):
    generation = tmp_path / "generation"
    baseline = tmp_path / "baseline"
    candidate = tmp_path / "candidate"
    verification = tmp_path / "verification"
    card_ids = [f"card-{index}" for index in range(6)]
    manifest = {
        "runId": "generation-run",
        "benchmarkVersion": "dataset-v1",
        "inputs": {"sourceSha256": "a" * 64},
        "versions": {"conceptInventory": "inventory-v1", "grounding": "grounding-v1"},
        "gitCommit": "b" * 40,
        "generation": {
            "provider": "gemini",
            "model": "gemini-3.8-flash",
            "promptVersion": "1.4.0",
            "temperature": .2,
            "thinkingLevel": "low",
            "strategy": "bounded-batches",
            "plannedRequestCount": 2,
            "usage": {"inputTokens": 100, "outputTokens": 50},
        },
    }
    cards = [
        {"cardId": card_id, "cardType": "definition", "question": f"Question {index}?"}
        for index, card_id in enumerate(card_ids)
    ]
    dispositions = {card_id: "PUBLISH" for card_id in card_ids}
    spans = [{"cardId": card_id, "status": "exact"} for card_id in card_ids]
    verification_rows = [{"verificationStatus": "verified"} for _ in card_ids]

    _write(generation / "manifest.json", manifest)
    _write(generation / "production_cards.json", cards)
    _write(generation / "coverage_map.json", {"production": {"sourceCoverage": .8, "duplicateRate": 0}})
    _write(baseline / "manifest.json", {"runId": "baseline-run"})
    _write(baseline / "final_dispositions.json", dispositions)
    _write(candidate / "manifest.json", {"runId": "candidate-run"})
    _write(candidate / "final_dispositions.json", dispositions)
    _write(candidate / "source_spans.json", spans)
    _write(verification / "verification_results.json", verification_rows)

    output = run(generation, baseline, candidate, verification, tmp_path / "output")
    evaluation = json.loads((output / "evaluation_run.json").read_text(encoding="utf-8"))

    assert evaluation["identity"]["model"] == "gemini-3.8-flash/base"
    assert evaluation["identity"]["modelVersion"] == "gemini-3.8-flash"
    assert evaluation["identity"]["promptVersion"] == "1.4.0"
    assert evaluation["identity"]["configuration"]["evaluationSuite"] == "bari-cardgen-eval-v1"
