from __future__ import annotations

import json
import subprocess
from io import BytesIO
from pathlib import Path
from typing import Any

from starworks_runner.capture import (
    CaptureProfile,
    CaptureRequest,
    CaptureSource,
    CapturingAttemptExecutor,
    FfmpegCaptureController,
)
from starworks_runner.orchestrator import ExecutionOutcome


class FakeProcess:
    def __init__(self, return_code: int | None = None) -> None:
        self.return_code = return_code
        self.stdin = BytesIO()
        self.terminated = False
        self.killed = False

    def poll(self) -> int | None:
        return self.return_code

    def wait(self, timeout: float | None = None) -> int:
        if self.return_code is None:
            self.return_code = 0
        return self.return_code

    def terminate(self) -> None:
        self.terminated = True
        self.return_code = -15

    def kill(self) -> None:
        self.killed = True
        self.return_code = -9


def test_recording_and_rtmp_workers_have_independent_sanitized_health(
    tmp_path: Path,
) -> None:
    commands: list[tuple[str, ...]] = []
    rtmp_secret = "rtmps://publisher.example/live/super-secret-stream-key"

    def launch(command: tuple[str, ...]) -> FakeProcess:
        commands.append(command)
        if command[-1] == rtmp_secret:
            raise OSError("publisher unavailable")
        return FakeProcess()

    controller = FfmpegCaptureController("ffmpeg", process_factory=launch)
    status = controller.start(
        CaptureRequest(
            source=CaptureSource("lavfi", "testsrc=size=320x180:rate=30"),
            recording_path=tmp_path / "match.mkv",
            rtmp_url=rtmp_secret,
            publish_configured=True,
        )
    )

    assert status.state == "degraded"
    assert status.recording.state == "healthy"
    assert status.publishing.state == "failed"
    assert status.heartbeat_value() == {
        "recording": "healthy",
        "publishing": "failed",
    }
    serialized = json.dumps(status.report_value())
    assert rtmp_secret not in serialized
    assert "super-secret-stream-key" not in serialized
    assert commands[0][-1] == str((tmp_path / "match.mkv").resolve())
    assert commands[1][-1] == rtmp_secret


def test_capture_profile_reads_rtmp_only_from_the_runner_environment(
    tmp_path: Path,
) -> None:
    profile = CaptureProfile(
        source=CaptureSource.native_screen(
            system="Linux", video_input=":88.0", audio_input="starworks.monitor"
        ),
        recording_directory=tmp_path,
        rtmp_url_environment="STARWORKS_RTMP_URL",
    )
    request = profile.request_for_attempt(
        "11111111-1111-4111-8111-111111111111",
        {"STARWORKS_RTMP_URL": "rtmp://localhost/live/key"},
    )

    assert (
        request.recording_path
        == (tmp_path / "11111111-1111-4111-8111-111111111111.mkv").resolve()
    )
    assert request.rtmp_url == "rtmp://localhost/live/key"
    assert "rtmp://" not in repr(profile)


class TelemetryExecutor:
    def __init__(self) -> None:
        self.prepared = False

    def prepare(self, envelope: dict[str, Any], configuration: dict[str, Any]) -> None:
        self.prepared = True

    def execute(
        self,
        envelope: dict[str, Any],
        configuration: dict[str, Any],
        *,
        recovering: bool,
        emit_telemetry: Any,
    ) -> ExecutionOutcome:
        emit_telemetry({"sequence": 1, "eventType": "synthetic"})
        return ExecutionOutcome()


def test_capture_start_failure_does_not_interrupt_match_telemetry(
    tmp_path: Path,
) -> None:
    def unavailable_ffmpeg(command: tuple[str, ...]) -> FakeProcess:
        raise FileNotFoundError("ffmpeg")

    capture = FfmpegCaptureController(process_factory=unavailable_ffmpeg)
    inner = TelemetryExecutor()
    executor = CapturingAttemptExecutor(
        inner,
        capture,
        CaptureProfile(
            source=CaptureSource("lavfi", "testsrc=size=320x180:rate=30"),
            recording_directory=tmp_path,
            rtmp_url_environment="STARWORKS_RTMP_URL",
        ),
        environment={"STARWORKS_RTMP_URL": "rtmp://localhost/live/private"},
    )
    events: list[dict[str, Any]] = []

    outcome = executor.execute(
        {"attemptId": "22222222-2222-4222-8222-222222222222"},
        {},
        recovering=False,
        emit_telemetry=events.append,
    )

    assert outcome.action == "complete"
    assert events == [{"sequence": 1, "eventType": "synthetic"}]
    assert executor.last_health.state == "failed"


class TimeoutProcess(FakeProcess):
    def wait(self, timeout: float | None = None) -> int:
        if not self.terminated:
            raise subprocess.TimeoutExpired("ffmpeg", timeout)
        return super().wait(timeout)


def test_capture_stop_escalates_after_ffmpeg_ignores_graceful_quit(
    tmp_path: Path,
) -> None:
    process = TimeoutProcess()
    controller = FfmpegCaptureController(process_factory=lambda _: process)
    controller.start(
        CaptureRequest(
            source=CaptureSource("lavfi", "testsrc=size=320x180:rate=30"),
            recording_path=tmp_path / "match.mkv",
        )
    )

    status = controller.stop(timeout_seconds=0.01)

    assert process.stdin.getvalue() == b"q\n"
    assert process.terminated is True
    assert status.state == "stopped"
