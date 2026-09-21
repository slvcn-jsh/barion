import json, re
from pathlib import Path

def test_multi_domain_dataset_registry_is_governed_and_complete():
    path=Path(__file__).parents[1]/"fixtures"/"dataset_registry.json"
    payload=json.loads(path.read_text(encoding="utf-8"))
    required={"datasetId","domain","sourceOrigin","license","sourceHash","documentVersion","difficulty","documentStructure","tablePresence","numericDensity","medicationDensity","riskProfile","conceptInventoryVersion","referenceDeckAvailability"}
    domains={item["domain"] for item in payload["datasets"]}
    assert {"psychiatric nursing","general nursing","pharmacology","dentistry","anatomy","physiology","pathology","microbiology"} <= domains
    assert all(required <= set(item) and re.fullmatch(r"[a-f0-9]{64}",item["sourceHash"]) for item in payload["datasets"])
