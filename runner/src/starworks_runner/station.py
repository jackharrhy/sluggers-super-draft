from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Self

from starworks_runner.capture import (
    CaptureProfile,
    CaptureSource,
    CapturingAttemptExecutor,
    FfmpegCaptureController,
)
from starworks_runner.control import RunnerControlClient
from starworks_runner.games.sluggers.live_executor import LiveSluggersExecutor
from starworks_runner.orchestrator import AttemptExecutor, RunnerStation, RunOnceResult
from starworks_runner.state import RunnerStateStore, StationRegistration


@dataclass(frozen=True)
class SluggersStationConfig:
    base_url: str
    credential: str
    station_name: str
    state_path: Path
    cache_root: Path
    dolphin_executable: Path
    profile_root: Path
    capabilities: dict[str, Any]
    game_image: Path | None = None
    dtk_executable: Path | None = None
    checkpoint_manifest: Path | None = None
    seed_profile_directory: Path | None = None
    recording_directory: Path | None = None
    ffmpeg_executable: Path | str = "ffmpeg"
    capture_video_input: str | None = None
    capture_audio_input: str | None = None
    timeout_seconds: float = 10.0


@dataclass(frozen=True)
class StationSnapshot:
    """Small, UI-safe view of the locally persisted station state."""

    registered: bool
    runner_id: str | None
    attempt_id: str | None
    match_id: str | None
    stage: str | None
    live_stage: str | None
    lease_expires_at: str | None
    fresh_attempt_limit: int | None
    process_id: int | None
    last_captured_sequence: int
    pending_telemetry: int
    pending_updates: int
    last_tick_status: str | None


class StationService:
    """Own the runner state and execution loop shared by CLI and Qt.

    This class intentionally has no Qt, argparse, or Dolphin setup code. Front ends
    construct it once, call its synchronous methods from their preferred event loop,
    and render :class:`StationSnapshot` however they like.
    """

    def __init__(
        self,
        station: RunnerStation,
        state: RunnerStateStore,
        executor: AttemptExecutor,
    ) -> None:
        self.station = station
        self.state = state
        self.executor = executor
        self._lock = threading.RLock()
        self._last_result: RunOnceResult | None = None
        self._closed = False

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def ensure_registered(self) -> tuple[StationRegistration, bool]:
        """Return the local registration, creating it when necessary."""

        with self._lock:
            self._require_open()
            existing = self.state.load_registration()
            if existing is not None:
                return existing, False
            return self.station.register(), True

    def register(self) -> StationRegistration:
        with self._lock:
            self._require_open()
            return self.station.register()

    def heartbeat(self, runtime_state: str = "idle") -> dict[str, Any]:
        with self._lock:
            self._require_open()
            return self.station.heartbeat(runtime_state)

    def tick(self) -> RunOnceResult:
        with self._lock:
            self._require_open()
            self._last_result = self.station.run_once(self.executor)
            return self._last_result

    def snapshot(self) -> StationSnapshot:
        with self._lock:
            self._require_open()
            registration = self.state.load_registration()
            active = self.state.load_active_run()
            pending_updates = self.state.list_pending_updates()
            pending_telemetry = (
                self.state.list_pending_telemetry(active.envelope["attemptId"])
                if active is not None
                else []
            )
            metadata = active.runtime_metadata if active else None
            return StationSnapshot(
                registered=registration is not None,
                runner_id=registration.runner_id if registration else None,
                attempt_id=active.envelope["attemptId"] if active else None,
                match_id=active.envelope["matchId"] if active else None,
                stage=active.stage if active else None,
                live_stage=(
                    str(metadata["liveStage"])
                    if metadata and metadata.get("liveStage") is not None
                    else None
                ),
                lease_expires_at=(
                    str(active.envelope["lease"]["expiresAt"]) if active else None
                ),
                fresh_attempt_limit=(
                    int(active.envelope["execution"]["recovery"]["freshAttemptLimit"])
                    if active
                    else None
                ),
                process_id=(
                    int(metadata["processId"])
                    if metadata and metadata.get("processId") is not None
                    else None
                ),
                last_captured_sequence=(active.last_captured_sequence or 0)
                if active
                else 0,
                pending_telemetry=len(pending_telemetry),
                pending_updates=len(pending_updates),
                last_tick_status=(
                    self._last_result.status if self._last_result is not None else None
                ),
            )

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            error: Exception | None = None
            active = self.state.load_active_run()
            release = getattr(
                self.executor,
                "detach"
                if active is not None and active.runtime_metadata is not None
                else "stop",
                None,
            )
            if callable(release):
                try:
                    release()
                except Exception as caught:  # noqa: BLE001 - still close the database
                    error = caught
            try:
                self.state.close()
            finally:
                self._closed = True
            if error is not None:
                raise error

    def _require_open(self) -> None:
        if self._closed:
            raise RuntimeError("Station service is closed")


def create_sluggers_station_service(config: SluggersStationConfig) -> StationService:
    """Compose the real station once for either the CLI or Qt front end."""

    live_executor = LiveSluggersExecutor(
        cache_root=config.cache_root,
        dolphin_executable=config.dolphin_executable,
        profile_root=config.profile_root,
        game_image=config.game_image,
        dtk_executable=config.dtk_executable,
        checkpoint_manifest=config.checkpoint_manifest,
        seed_profile_directory=config.seed_profile_directory,
        timeout_seconds=config.timeout_seconds,
    )
    executor = CapturingAttemptExecutor(
        live_executor,
        FfmpegCaptureController(config.ffmpeg_executable),
        CaptureProfile(
            source=CaptureSource.native_screen(
                video_input=config.capture_video_input,
                audio_input=config.capture_audio_input,
            ),
            recording_directory=config.recording_directory,
        ),
    )
    state = RunnerStateStore(config.state_path)
    station = RunnerStation(
        RunnerControlClient(config.base_url, config.credential),
        state,
        station_name=config.station_name,
        capabilities=config.capabilities,
        content_cache=config.cache_root / "content",
        component_health=executor.component_health,
    )
    return StationService(station, state, executor)
