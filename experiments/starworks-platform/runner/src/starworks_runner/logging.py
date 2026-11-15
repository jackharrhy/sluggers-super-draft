from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4


@dataclass(frozen=True, slots=True)
class LogContext:
    correlation_id: str
    actor_id: str | None = None
    league_id: str | None = None
    match_attempt_id: str | None = None
    runner_id: str | None = None

    @classmethod
    def create(cls) -> LogContext:
        return cls(correlation_id=str(uuid4()))

    def bind(
        self,
        *,
        actor_id: str | None = None,
        league_id: str | None = None,
        match_attempt_id: str | None = None,
        runner_id: str | None = None,
    ) -> LogContext:
        return replace(
            self,
            actor_id=actor_id if actor_id is not None else self.actor_id,
            league_id=league_id if league_id is not None else self.league_id,
            match_attempt_id=(
                match_attempt_id
                if match_attempt_id is not None
                else self.match_attempt_id
            ),
            runner_id=runner_id if runner_id is not None else self.runner_id,
        )

    def as_json_fields(self) -> dict[str, str | None]:
        fields = asdict(self)
        return {
            "actorId": fields["actor_id"],
            "correlationId": fields["correlation_id"],
            "leagueId": fields["league_id"],
            "matchAttemptId": fields["match_attempt_id"],
            "runnerId": fields["runner_id"],
        }


class StructuredLogger:
    def __init__(
        self,
        context: LogContext,
        *,
        sink: Callable[[str], None] = print,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._clock = clock
        self._context = context
        self._sink = sink

    def bind(
        self,
        *,
        actor_id: str | None = None,
        league_id: str | None = None,
        match_attempt_id: str | None = None,
        runner_id: str | None = None,
    ) -> StructuredLogger:
        return StructuredLogger(
            self._context.bind(
                actor_id=actor_id,
                league_id=league_id,
                match_attempt_id=match_attempt_id,
                runner_id=runner_id,
            ),
            sink=self._sink,
            clock=self._clock,
        )

    def info(self, event: str, **fields: Any) -> None:
        self._write("info", event, fields)

    def error(self, event: str, **fields: Any) -> None:
        self._write("error", event, fields)

    def _write(self, level: str, event: str, fields: dict[str, Any]) -> None:
        self._sink(
            json.dumps(
                {
                    **fields,
                    "timestamp": self._clock().isoformat().replace("+00:00", "Z"),
                    "level": level,
                    "event": event,
                    **self._context.as_json_fields(),
                },
                separators=(",", ":"),
                sort_keys=True,
            )
        )
