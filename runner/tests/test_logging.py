from __future__ import annotations

import json
from datetime import UTC, datetime

from starworks_runner.logging import LogContext, StructuredLogger


def test_structured_logger_includes_all_operational_identifiers() -> None:
    lines: list[str] = []
    context = LogContext(
        correlation_id="11111111-1111-4111-8111-111111111111",
        actor_id="22222222-2222-4222-8222-222222222222",
        league_id="33333333-3333-4333-8333-333333333333",
        match_attempt_id="44444444-4444-4444-8444-444444444444",
        runner_id="55555555-5555-4555-8555-555555555555",
    )
    logger = StructuredLogger(
        context,
        sink=lines.append,
        clock=lambda: datetime(2026, 8, 10, 12, 0, tzinfo=UTC),
    )

    logger.info("runner.ready", capabilityCount=3)

    assert len(lines) == 1
    record = json.loads(lines[0])
    assert record == {
        "actorId": context.actor_id,
        "capabilityCount": 3,
        "correlationId": context.correlation_id,
        "event": "runner.ready",
        "leagueId": context.league_id,
        "level": "info",
        "matchAttemptId": context.match_attempt_id,
        "runnerId": context.runner_id,
        "timestamp": "2026-08-10T12:00:00Z",
    }
