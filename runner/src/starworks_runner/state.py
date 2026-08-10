from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Self, cast

from starworks_runner.contracts import validate_contract

RunStage = Literal["claimed", "preparing", "running"]


class ActiveRunConflict(RuntimeError):
    pass


@dataclass(frozen=True)
class StationRegistration:
    runner_id: str
    heartbeat_seconds: int
    lease_seconds: int


@dataclass(frozen=True)
class ActiveRun:
    envelope: dict[str, Any]
    configuration: dict[str, Any] | None
    stage: RunStage
    last_captured_sequence: int | None
    pending_outcome: Literal["complete", "cancel"] | None


@dataclass(frozen=True)
class PendingUpdate:
    event_id: str
    message: dict[str, Any]


@dataclass(frozen=True)
class PendingTelemetry:
    attempt_id: str
    sequence: int
    envelope: dict[str, Any]


class RunnerStateStore:
    def __init__(self, path: Path) -> None:
        resolved = path.expanduser().resolve()
        resolved.parent.mkdir(parents=True, exist_ok=True)
        self.path = resolved
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(resolved, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("pragma journal_mode = wal")
        self._connection.execute("pragma foreign_keys = on")
        self._migrate()

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def save_registration(self, registration: StationRegistration) -> None:
        values = {
            "runner_id": registration.runner_id,
            "heartbeat_seconds": str(registration.heartbeat_seconds),
            "lease_seconds": str(registration.lease_seconds),
        }
        with self._lock, self._connection:
            self._connection.executemany(
                """
                insert into station_metadata (key, value) values (?, ?)
                on conflict (key) do update set value = excluded.value
                """,
                values.items(),
            )

    def load_registration(self) -> StationRegistration | None:
        with self._lock:
            rows = self._connection.execute(
                "select key, value from station_metadata"
            ).fetchall()
        values = {row["key"]: row["value"] for row in rows}
        if "runner_id" not in values:
            return None
        return StationRegistration(
            runner_id=values["runner_id"],
            heartbeat_seconds=int(values["heartbeat_seconds"]),
            lease_seconds=int(values["lease_seconds"]),
        )

    def accept_run(self, envelope: dict[str, Any]) -> ActiveRun:
        validate_contract("run-envelope", envelope)
        attempt_id = cast(str, envelope["attemptId"])
        attempt_nonce = cast(str, envelope["attemptNonce"])
        lease_id = cast(str, cast(dict[str, Any], envelope["lease"])["leaseId"])
        encoded = json.dumps(envelope, separators=(",", ":"), sort_keys=True)
        with self._lock, self._connection:
            current = self._connection.execute(
                "select attempt_id, attempt_nonce, lease_id from active_run where singleton = 1"
            ).fetchone()
            if current:
                if (
                    current["attempt_id"] != attempt_id
                    or current["attempt_nonce"] != attempt_nonce
                    or current["lease_id"] != lease_id
                ):
                    raise ActiveRunConflict(
                        "Refusing a second run while another attempt is active"
                    )
            else:
                self._connection.execute(
                    """
                    insert into active_run (
                      singleton, attempt_id, attempt_nonce, lease_id, envelope_json, stage
                    ) values (1, ?, ?, ?, ?, 'claimed')
                    """,
                    (attempt_id, attempt_nonce, lease_id, encoded),
                )
        active = self.load_active_run()
        assert active is not None
        return active

    def load_active_run(self) -> ActiveRun | None:
        with self._lock:
            row = self._connection.execute(
                """
                select envelope_json, configuration_json, stage, last_captured_sequence,
                       pending_outcome
                from active_run where singleton = 1
                """
            ).fetchone()
        if not row:
            return None
        envelope = json.loads(row["envelope_json"])
        validate_contract("run-envelope", envelope)
        return ActiveRun(
            envelope=cast(dict[str, Any], envelope),
            configuration=(
                cast(dict[str, Any], json.loads(row["configuration_json"]))
                if row["configuration_json"]
                else None
            ),
            stage=cast(RunStage, row["stage"]),
            last_captured_sequence=row["last_captured_sequence"],
            pending_outcome=cast(
                Literal["complete", "cancel"] | None, row["pending_outcome"]
            ),
        )

    def save_configuration(
        self, attempt_id: str, configuration: dict[str, Any]
    ) -> None:
        validate_contract("match-configuration-package", configuration)
        if configuration["attemptId"] != attempt_id:
            raise ActiveRunConflict("Configuration belongs to a different attempt")
        encoded = json.dumps(configuration, separators=(",", ":"), sort_keys=True)
        with self._lock, self._connection:
            row = self._connection.execute(
                "select envelope_json from active_run where singleton = 1 and attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            if not row:
                raise ActiveRunConflict("Attempt is no longer active")
            envelope = json.loads(row["envelope_json"])
            for field in ("attemptNonce", "leagueId", "matchId"):
                if configuration[field] != envelope[field]:
                    raise ActiveRunConflict(
                        f"Configuration {field} does not match the active attempt"
                    )
            updated = self._connection.execute(
                """
                update active_run set configuration_json = ?
                where singleton = 1 and attempt_id = ? and attempt_nonce = ?
                """,
                (encoded, attempt_id, configuration["attemptNonce"]),
            )
            if updated.rowcount != 1:
                raise ActiveRunConflict(
                    "Configuration nonce does not match the active attempt"
                )

    def update_stage(
        self,
        attempt_id: str,
        stage: RunStage,
        *,
        last_captured_sequence: int | None = None,
    ) -> None:
        with self._lock, self._connection:
            updated = self._connection.execute(
                """
                update active_run
                set stage = ?, last_captured_sequence = coalesce(?, last_captured_sequence)
                where singleton = 1 and attempt_id = ?
                """,
                (stage, last_captured_sequence, attempt_id),
            )
            if updated.rowcount != 1:
                raise ActiveRunConflict(
                    "Active attempt changed before its stage update"
                )

    def queue_update(self, event_id: str, message: dict[str, Any]) -> None:
        validate_contract("runner-control", message)
        with self._lock, self._connection:
            self._connection.execute(
                """
                insert into pending_updates (event_id, attempt_id, action, message_json)
                values (?, ?, ?, ?)
                on conflict (event_id) do nothing
                """,
                (
                    event_id,
                    message["attemptId"],
                    message["action"],
                    json.dumps(message, separators=(",", ":"), sort_keys=True),
                ),
            )

    def list_pending_updates(self) -> list[PendingUpdate]:
        with self._lock:
            rows = self._connection.execute(
                "select event_id, message_json from pending_updates order by created_at, event_id"
            ).fetchall()
        return [
            PendingUpdate(
                event_id=row["event_id"],
                message=cast(dict[str, Any], json.loads(row["message_json"])),
            )
            for row in rows
        ]

    def acknowledge_update(self, event_id: str) -> None:
        with self._lock, self._connection:
            row = self._connection.execute(
                "select attempt_id, action from pending_updates where event_id = ?",
                (event_id,),
            ).fetchone()
            if not row:
                return
            self._connection.execute(
                "delete from pending_updates where event_id = ?", (event_id,)
            )
            if row["action"] == "started":
                self._connection.execute(
                    "update active_run set stage = 'running' where singleton = 1 and attempt_id = ?",
                    (row["attempt_id"],),
                )
            elif row["action"] in ("complete", "cancel", "fail"):
                active = self._connection.execute(
                    "select envelope_json from active_run where singleton = 1 and attempt_id = ?",
                    (row["attempt_id"],),
                ).fetchone()
                if active:
                    self._connection.execute(
                        """
                        insert into run_history (attempt_id, outcome, envelope_json)
                        values (?, ?, ?)
                        on conflict (attempt_id) do nothing
                        """,
                        (row["attempt_id"], row["action"], active["envelope_json"]),
                    )
                    self._connection.execute(
                        "delete from active_run where singleton = 1"
                    )

    def queue_telemetry(self, envelope: dict[str, Any]) -> None:
        validate_contract("telemetry-envelope", envelope)
        attempt_id = cast(str, envelope["attemptId"])
        attempt_nonce = cast(str, envelope["attemptNonce"])
        sequence = cast(int, envelope["sequence"])
        encoded = json.dumps(envelope, separators=(",", ":"), sort_keys=True)
        with self._lock, self._connection:
            active = self._connection.execute(
                "select attempt_nonce from active_run where singleton = 1 and attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            if not active or active["attempt_nonce"] != attempt_nonce:
                raise ActiveRunConflict(
                    "Telemetry does not belong to the active attempt"
                )
            prior = self._connection.execute(
                "select envelope_json from telemetry_spool where attempt_id = ? and sequence = ?",
                (attempt_id, sequence),
            ).fetchone()
            if prior and prior["envelope_json"] != encoded:
                raise ActiveRunConflict(
                    f"Telemetry sequence {sequence} changed after it was captured"
                )
            self._connection.execute(
                """
                insert into telemetry_spool (attempt_id, sequence, envelope_json)
                values (?, ?, ?)
                on conflict (attempt_id, sequence) do nothing
                """,
                (attempt_id, sequence, encoded),
            )
            self._connection.execute(
                """
                update active_run set last_captured_sequence = max(
                  coalesce(last_captured_sequence, 0), ?
                ) where singleton = 1 and attempt_id = ?
                """,
                (sequence, attempt_id),
            )

    def mark_execution_outcome(
        self, attempt_id: str, outcome: Literal["complete", "cancel"]
    ) -> None:
        with self._lock, self._connection:
            updated = self._connection.execute(
                """
                update active_run set pending_outcome = ?
                where singleton = 1 and attempt_id = ?
                """,
                (outcome, attempt_id),
            )
            if updated.rowcount != 1:
                raise ActiveRunConflict("Attempt changed before outcome was persisted")

    def list_pending_telemetry(
        self, attempt_id: str, *, limit: int = 256
    ) -> list[PendingTelemetry]:
        if not 1 <= limit <= 256:
            raise ValueError("Telemetry batch limit must be between 1 and 256")
        with self._lock:
            rows = self._connection.execute(
                """
                select attempt_id, sequence, envelope_json from telemetry_spool
                where attempt_id = ? order by sequence limit ?
                """,
                (attempt_id, limit),
            ).fetchall()
        return [
            PendingTelemetry(
                attempt_id=row["attempt_id"],
                sequence=row["sequence"],
                envelope=cast(dict[str, Any], json.loads(row["envelope_json"])),
            )
            for row in rows
        ]

    def acknowledge_telemetry(self, attempt_id: str, sequences: list[int]) -> None:
        if not sequences:
            return
        with self._lock, self._connection:
            self._connection.executemany(
                "delete from telemetry_spool where attempt_id = ? and sequence = ?",
                ((attempt_id, sequence) for sequence in sequences),
            )

    def _migrate(self) -> None:
        with self._lock, self._connection:
            self._connection.executescript(
                """
                create table if not exists station_metadata (
                  key text primary key,
                  value text not null
                );
                create table if not exists active_run (
                  singleton integer primary key check (singleton = 1),
                  attempt_id text not null unique,
                  attempt_nonce text not null,
                  lease_id text not null,
                  envelope_json text not null,
                  configuration_json text,
                  stage text not null check (stage in ('claimed', 'preparing', 'running')),
                  last_captured_sequence integer
                  ,pending_outcome text check (pending_outcome in ('complete', 'cancel'))
                );
                create table if not exists pending_updates (
                  event_id text primary key,
                  attempt_id text not null,
                  action text not null,
                  message_json text not null,
                  created_at text not null default current_timestamp
                );
                create table if not exists run_history (
                  attempt_id text primary key,
                  outcome text not null,
                  envelope_json text not null,
                  finished_at text not null default current_timestamp
                );
                create table if not exists telemetry_spool (
                  attempt_id text not null,
                  sequence integer not null check (sequence > 0),
                  envelope_json text not null,
                  captured_at text not null default current_timestamp,
                  primary key (attempt_id, sequence)
                );
                """
            )
            columns = {
                row[1]
                for row in self._connection.execute("pragma table_info(active_run)")
            }
            if "configuration_json" not in columns:
                self._connection.execute(
                    "alter table active_run add column configuration_json text"
                )
            if "pending_outcome" not in columns:
                self._connection.execute(
                    "alter table active_run add column pending_outcome text"
                )
