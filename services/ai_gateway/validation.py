from __future__ import annotations

import json

from .errors import GatewayError
from .models import CardGenerationRequest, GeneratedCardOutput, SourceSegment


def validate_grounded_output(
    request: CardGenerationRequest,
    output: GeneratedCardOutput,
) -> GeneratedCardOutput:
    segments = _read_segments(request.userPrompt)
    by_id = {segment.segmentId: segment for segment in segments}
    seen: set[str] = set()
    valid = []

    for candidate in output.candidates[: request.maxCandidates]:
        segment = by_id.get(candidate.segmentId)
        if segment is None or candidate.evidenceText not in segment.text:
            continue
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


def _normalize(value: str) -> str:
    return " ".join("".join(character if character.isalnum() else " " for character in value.lower()).split())
