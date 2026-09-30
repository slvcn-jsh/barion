from __future__ import annotations

import json

from services.card_evaluation.models import Card as EvaluationCard
from services.card_evaluation.models import Segment as EvaluationSegment
from services.card_evaluation.pipeline import evaluate_production_candidate
from services.card_evaluation.verification import VerificationCoordinator
from .errors import GatewayError
from services.source_span import resolve_source_span

from .models import CandidateEvaluation, CardGenerationRequest, GeneratedCard, GeneratedCardOutput, SourceSegment


def validate_grounded_output(
    request: CardGenerationRequest,
    output: GeneratedCardOutput,
    verifier: VerificationCoordinator | None = None,
    *,
    verification_deadline: float | None = None,
) -> GeneratedCardOutput:
    segments = _read_segments(request.userPrompt)
    by_id = {segment.segmentId: segment for segment in segments}
    targets = _read_targets(request.userPrompt)
    evaluation_segments = [
        EvaluationSegment(segment.segmentId, segment.locator, segment.sectionPath, segment.text, 0, len(segment.text))
        for segment in segments
    ]
    evaluator = verifier or VerificationCoordinator()
    seen: set[str] = set()
    valid = []

    for index, candidate in enumerate(output.candidates[: request.maxCandidates]):
        segment = by_id.get(candidate.segmentId)
        if segment is None:
            continue
        if targets:
            matched_id, target = _match_target(candidate, targets)
            if target:
                candidate = candidate.model_copy(update={
                    "targetId": matched_id,
                    "frontStyle": target["frontStyle"],
                    "question": target["term"] if target["frontStyle"] == "term" else candidate.question,
                })
        span = resolve_source_span(segment.text, candidate.evidenceText)
        original = EvaluationCard(
            cardId=f"{request.requestId}:{index}",
            question=candidate.question,
            answer=candidate.answer,
            system="production",
            segmentId=candidate.segmentId,
            locator=segment.locator,
            cardType=candidate.cardType,
            learningObjective=candidate.learningObjective,
            evidenceText=candidate.evidenceText,
            evidenceSpan=span.to_dict(),
        )
        effective, evaluation = evaluate_production_candidate(
            original,
            evaluation_segments,
            evaluator,
            verification_deadline=verification_deadline,
        )
        candidate = GeneratedCard(**{
            **candidate.model_dump(exclude={"evidenceSpan", "evaluation"}),
            "question": effective.question,
            "answer": effective.answer,
            "learningObjective": effective.learningObjective,
            "evidenceSpan": span.to_dict(),
            "evaluation": CandidateEvaluation.model_validate(evaluation),
        })
        duplicate_key = _normalize(f"{candidate.question}\n{candidate.answer}")
        if duplicate_key in seen:
            continue
        seen.add(duplicate_key)
        valid.append(candidate)

    return GeneratedCardOutput(candidates=valid)


def _read_segments(user_prompt: str) -> list[SourceSegment]:
    try:
        payload = json.loads(user_prompt)
        raw_segments = payload["segments"]
        if not isinstance(raw_segments, list) or not raw_segments:
            raise ValueError("segments")
        return [SourceSegment.model_validate(segment) for segment in raw_segments]
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
        raise GatewayError("invalid_request", "userPrompt must contain valid source segments.", 422) from error


def _read_targets(user_prompt: str) -> dict[str, dict[str, object]]:
    try:
        payload = json.loads(user_prompt)
    except json.JSONDecodeError:
        return {}
    raw_targets = payload.get("conceptTargets") if isinstance(payload, dict) else None
    if not isinstance(raw_targets, list):
        return {}
    targets: dict[str, dict[str, object]] = {}
    for raw in raw_targets:
        if not isinstance(raw, dict):
            continue
        target_id = raw.get("targetId")
        term = raw.get("term")
        front_style = raw.get("frontStyle")
        segment_ids = raw.get("segmentIds")
        if (isinstance(target_id, str) and isinstance(term, str)
                and front_style in {"term", "question"} and isinstance(segment_ids, list)
                and all(isinstance(item, str) for item in segment_ids)):
            targets[target_id] = {"term": term, "frontStyle": front_style, "segmentIds": segment_ids}
    return targets


def _match_target(candidate: GeneratedCard, targets: dict[str, dict[str, object]]) -> tuple[str | None, dict[str, object] | None]:
    if candidate.targetId and candidate.targetId in targets:
        return candidate.targetId, targets[candidate.targetId]
    cand_target_norm = _normalize(candidate.targetId or "")
    cand_q_norm = _normalize(candidate.question)
    cand_obj_norm = _normalize(candidate.learningObjective)
    for target_id, info in targets.items():
        term_norm = _normalize(str(info["term"]))
        id_norm = _normalize(target_id)
        if cand_target_norm and (cand_target_norm == term_norm or cand_target_norm == id_norm):
            return target_id, info
        if term_norm and (term_norm in cand_q_norm or term_norm in cand_obj_norm):
            return target_id, info
    return None, None


def _normalize(value: str) -> str:
    return " ".join("".join(character if character.isalnum() else " " for character in value.lower()).split())
