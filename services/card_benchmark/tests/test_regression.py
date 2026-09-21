from services.card_benchmark.regressions import run_regression_fixtures


REQUIRED_DECK_CASES = {
    "exact_duplicate_deck",
    "near_duplicate_deck",
    "source_start_concentrated_deck",
    "distributed_valid_deck",
}


def test_phase1_regression_fixtures_all_pass():
    summary, rows = run_regression_fixtures()
    assert summary["failed"] == 0, rows
    assert summary["passed"] == summary["caseCount"]
    assert REQUIRED_DECK_CASES <= {row["caseId"] for row in rows}


def test_phase1_regression_results_are_deterministic():
    assert run_regression_fixtures() == run_regression_fixtures()
