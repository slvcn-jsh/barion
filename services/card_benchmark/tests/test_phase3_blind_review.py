import csv
from services.card_benchmark.blind_review import build_blind_review, score_review_files
from services.card_benchmark.io_utils import write_json
from services.card_benchmark.models import Card, Concept


def test_blind_export_is_seeded_balanced_and_keyed_separately():
    concepts = [Concept("c1", "Topic", "Topic improves outcome.", (), "Section", (), "high", "none", "other",
                        (), 1.0, 1.0, "reviewed", "test")]
    production = [Card("p1", "What improves outcome?", "Topic improves outcome.", "production")]
    quizlet = [Card("q1", "Which topic improves outcome?", "Topic.", "quizlet")]
    matches = [{"conceptId": "c1", "productionCardId": "p1", "quizletCardId": "q1"}]
    rows, key = build_blind_review(matches, production, quizlet, concepts, "seed", 10)
    assert len(rows) == len(key) == 1
    assert "system" not in " ".join(rows[0])
    assert {key[0]["systemA"], key[0]["systemB"]} == {"production", "quizlet"}
    assert rows[0]["sourceProposition"] == concepts[0].atomicProposition
    assert "Why it matters:" not in rows[0]["cardAAnswer"] + rows[0]["cardBAnswer"]


def test_scoring_enforces_gates_and_computes_reviewer_agreement(tmp_path):
    run = tmp_path / "run"; private = run / "private"; private.mkdir(parents=True)
    key = []
    for index in range(30):
        key.append({"pairId": f"pair-{index:03d}", "conceptId": f"c{index}",
                    "cardAId": f"p{index}", "systemA": "production",
                    "cardBId": f"q{index}", "systemB": "quizlet"})
    write_json(private / "blind_review_key.json", key)
    write_json(run / "metrics.json", {"phase1Evaluation": {"contradictions": 0, "criticalFailures": 0}})
    write_json(run / "manifest.json", {"generation": {"quantityContractMet": True},
                                       "versions": {"blindReview": "2.0.0", "rubric": "2.0.0"}})
    write_json(run / "blind_review_protocol.json", {"blindReviewVersion": "2.0.0", "rubricVersion": "2.0.0"})
    paths = []
    for reviewer, role in (("r1", "medical_student"), ("r2", "clinician")):
        path = tmp_path / f"{reviewer}.csv"; paths.append(path)
        with path.open("w", encoding="utf-8", newline="") as handle:
            score_fields = ["accuracy", "sourceFaithfulness", "atomicity", "clarity",
                            "answerSpecificity", "learningValue"]
            fields = ["pairId", "reviewerId", "reviewerRole",
                      *(f"{field}{side}" for field in score_fields for side in ("A", "B")),
                      "preference", "exclusionReason", "notes"]
            writer = csv.DictWriter(handle, fieldnames=fields); writer.writeheader()
            for item in key:
                writer.writerow({
                    "pairId": item["pairId"], "reviewerId": reviewer, "reviewerRole": role,
                    **{f"{field}A": 5 for field in score_fields},
                    **{f"{field}B": 4 for field in score_fields},
                    "preference": "A", "exclusionReason": "", "notes": "",
                })
    result = score_review_files(run, paths)
    assert result["status"] == "PASS"
    assert result["productionSuperior"] is True
    assert result["preferenceAgreement"] == result["preferenceKappa"] == 1.0
    assert result["humanAcceptanceRate"] == 1.0
    assert result["reviewerRoles"] == {"r1": "medical_student", "r2": "clinician"}
    assert all(result["gates"].values())
