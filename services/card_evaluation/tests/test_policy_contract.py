import json
from pathlib import Path
from services.card_evaluation.policy import POLICY_VERSION, decide_facts

def test_shared_policy_contract_python():
    payload=json.loads((Path(__file__).parents[1]/"policy_contract.json").read_text(encoding="utf-8"))
    assert payload["policyVersion"] == POLICY_VERSION
    for case in payload["cases"]:
        assert decide_facts(case["facts"]) == case["expected"], case["id"]
