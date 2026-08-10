from __future__ import annotations

import os
import platform
import subprocess
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Literal, Protocol
from urllib.parse import urlsplit

CaptureBackend = Literal["avfoundation", "gdigrab", "x11grab", "lavfi"]
AudioBackend = Literal["avfoundation", "dshow", "pulse", "lavfi"]
DestinationState = Literal["disabled", "starting", "healthy", "failed", "stopped"]
CaptureState = Literal[
    "disabled", "starting", "running", "degraded", "failed", "stopped"
]


@dataclass(frozen=True)
class CaptureSource:
    video_backend: CaptureBackend
    video_input: str
    audio_backend: AudioBackend | None = None
    audio_input: str | None = None
    frame_rate: int = 60
    video_size: str = "1920x1080"

    def __post_init__(self) -> None:
        if not self.video_input.strip():
            raise ValueError("A capture video input is required")
        if not 1 <= self.frame_rate <= 240:
            raise ValueError("Capture frame rate must be between 1 and 240")
        if self.audio_backend is None and self.audio_input is not None:
            raise ValueError("An audio input requires an audio backend")
        if self.audio_backend is not None and not self.audio_input:
            raise ValueError("An audio backend requires an audio input")
        if self.video_backend == "avfoundation" and self.audio_backend not in (
            None,
            "avfoundation",
        ):
            raise ValueError("AVFoundation video can only pair with AVFoundation audio")

    @classmethod
    def native_screen(
        cls,
        *,
        video_input: str | None = None,
        audio_input: str | None = None,
        frame_rate: int = 60,
        video_size: str = "1920x1080",
        system: str | None = None,
    ) -> CaptureSource:
        current = (system or platform.system()).lower()
        if current == "darwin":
            return cls(
                "avfoundation",
                video_input or "Capture screen 0",
                "avfoundation" if audio_input else None,
                audio_input,
                frame_rate,
                video_size,
            )
        if current == "windows":
            return cls(
                "gdigrab",
                video_input or "desktop",
                "dshow" if audio_input else None,
                audio_input,
                frame_rate,
                video_size,
            )
        if current == "linux":
            return cls(
                "x11grab",
                video_input or os.environ.get("DISPLAY", ":0.0"),
                "pulse" if audio_input else None,
                audio_input,
                frame_rate,
                video_size,
            )
        raise ValueError(f"Unsupported capture platform: {system or platform.system()}")


@dataclass(frozen=True)
class CaptureProfile:
    source: CaptureSource
    recording_directory: Path | None = None
    rtmp_url_environment: str | None = None

    def request_for_attempt(
        self,
        attempt_id: str,
        environment: Mapping[str, str] | None = None,
    ) -> CaptureRequest:
        values = os.environ if environment is None else environment
        recording_path = (
            self.recording_directory.expanduser().resolve() / f"{attempt_id}.mkv"
            if self.recording_directory
            else None
        )
        return CaptureRequest(
            source=self.source,
            recording_path=recording_path,
            rtmp_url=(
                values.get(self.rtmp_url_environment)
                if self.rtmp_url_environment
                else None
            ),
            publish_configured=self.rtmp_url_environment is not None,
        )


@dataclass(frozen=True)
class CaptureRequest:
    source: CaptureSource
    recording_path: Path | None = None
    rtmp_url: str | None = None
    publish_configured: bool = False


@dataclass(frozen=True)
class DestinationHealth:
    state: DestinationState
    detail: str
    exit_code: int | None = None

    def report_value(self) -> dict[str, str | int | None]:
        return {
            "state": self.state,
            "detail": self.detail,
            "exitCode": self.exit_code,
        }


@dataclass(frozen=True)
class CaptureHealth:
    state: CaptureState
    recording: DestinationHealth
    publishing: DestinationHealth

    def report_value(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "recording": self.recording.report_value(),
            "publishing": self.publishing.report_value(),
        }

    def heartbeat_value(self) -> dict[str, str]:
        return {
            "recording": self.recording.state,
            "publishing": self.publishing.state,
        }


class CaptureProcess(Protocol):
    stdin: BinaryIO | None

    def poll(self) -> int | None: ...

    def wait(self, timeout: float | None = None) -> int: ...

    def terminate(self) -> None: ...

    def kill(self) -> None: ...


ProcessFactory = Callable[[tuple[str, ...]], CaptureProcess]


@dataclass
class _CaptureWorker:
    process: CaptureProcess | None
    health: DestinationHealth


class FfmpegCaptureController:
    """Own independent recording and RTMP workers without retaining their secret URL."""

    def __init__(
        self,
        executable: Path | str = "ffmpeg",
        *,
        process_factory: ProcessFactory | None = None,
    ) -> None:
        self.executable = str(executable)
        self._process_factory = process_factory or self._launch
        self._recording = _CaptureWorker(
            None, DestinationHealth("disabled", "recording not configured")
        )
        self._publishing = _CaptureWorker(
            None, DestinationHealth("disabled", "RTMP publishing not configured")
        )

    def start(self, request: CaptureRequest) -> CaptureHealth:
        if self._has_active_worker():
            raise RuntimeError("Capture is already running")
        self._recording = self._start_recording(request)
        self._publishing = self._start_publishing(request)
        return self.health()

    def health(self) -> CaptureHealth:
        self._recording = self._refresh(self._recording, "recording")
        self._publishing = self._refresh(self._publishing, "RTMP publishing")
        required = [
            worker.health
            for worker in (self._recording, self._publishing)
            if worker.health.state != "disabled"
        ]
        if not required:
            state: CaptureState = "disabled"
        elif any(item.state == "failed" for item in required):
            state = (
                "degraded"
                if any(item.state in ("starting", "healthy") for item in required)
                else "failed"
            )
        elif any(item.state == "starting" for item in required):
            state = "starting"
        elif any(item.state == "healthy" for item in required):
            state = "running"
        else:
            state = "stopped"
        return CaptureHealth(state, self._recording.health, self._publishing.health)

    def stop(self, timeout_seconds: float = 5.0) -> CaptureHealth:
        self._recording = self._stop(self._recording, "recording", timeout_seconds)
        self._publishing = self._stop(
            self._publishing, "RTMP publishing", timeout_seconds
        )
        return self.health()

    def _start_recording(self, request: CaptureRequest) -> _CaptureWorker:
        if request.recording_path is None:
            return _CaptureWorker(
                None, DestinationHealth("disabled", "recording not configured")
            )
        try:
            request.recording_path.parent.mkdir(parents=True, exist_ok=True)
            command = self.command_for_recording(request.source, request.recording_path)
            return _CaptureWorker(
                self._process_factory(command),
                DestinationHealth("starting", "recording process started"),
            )
        except Exception as error:  # noqa: BLE001 - capture must not stop a match
            return _CaptureWorker(
                None,
                DestinationHealth(
                    "failed", f"recording could not start ({type(error).__name__})"
                ),
            )

    def _start_publishing(self, request: CaptureRequest) -> _CaptureWorker:
        if not request.publish_configured and not request.rtmp_url:
            return _CaptureWorker(
                None, DestinationHealth("disabled", "RTMP publishing not configured")
            )
        if not request.rtmp_url:
            return _CaptureWorker(
                None,
                DestinationHealth("failed", "runner-local RTMP secret is missing"),
            )
        try:
            command = self.command_for_rtmp(request.source, request.rtmp_url)
            return _CaptureWorker(
                self._process_factory(command),
                DestinationHealth("starting", "RTMP publishing process started"),
            )
        except Exception as error:  # noqa: BLE001 - capture must not stop a match
            return _CaptureWorker(
                None,
                DestinationHealth(
                    "failed",
                    f"RTMP publishing could not start ({type(error).__name__})",
                ),
            )

    def command_for_recording(
        self, source: CaptureSource, destination: Path
    ) -> tuple[str, ...]:
        return (
            self._base_command(source)
            + self._encoding(source)
            + (
                "-f",
                "matroska",
                str(destination.expanduser().resolve()),
            )
        )

    def command_for_rtmp(
        self, source: CaptureSource, destination: str
    ) -> tuple[str, ...]:
        parsed = urlsplit(destination)
        if parsed.scheme not in ("rtmp", "rtmps") or not parsed.hostname:
            raise ValueError("RTMP destination must use rtmp:// or rtmps://")
        return (
            self._base_command(source)
            + self._encoding(source)
            + (
                "-f",
                "flv",
                destination,
            )
        )

    def _base_command(self, source: CaptureSource) -> tuple[str, ...]:
        command = [self.executable, "-hide_banner", "-loglevel", "warning", "-y"]
        if source.video_backend == "avfoundation":
            capture_input = source.video_input
            if source.audio_input:
                capture_input += f":{source.audio_input}"
            command.extend(
                [
                    "-f",
                    "avfoundation",
                    "-framerate",
                    str(source.frame_rate),
                    "-i",
                    capture_input,
                ]
            )
        elif source.video_backend == "gdigrab":
            command.extend(
                [
                    "-f",
                    "gdigrab",
                    "-framerate",
                    str(source.frame_rate),
                    "-i",
                    source.video_input,
                ]
            )
        elif source.video_backend == "x11grab":
            command.extend(
                [
                    "-f",
                    "x11grab",
                    "-framerate",
                    str(source.frame_rate),
                    "-video_size",
                    source.video_size,
                    "-i",
                    source.video_input,
                ]
            )
        else:
            command.extend(["-re", "-f", "lavfi", "-i", source.video_input])
        if source.audio_input and source.video_backend != "avfoundation":
            command.extend(
                ["-f", source.audio_backend or "pulse", "-i", source.audio_input]
            )
        return tuple(command)

    @staticmethod
    def _encoding(source: CaptureSource) -> tuple[str, ...]:
        command = [
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-tune",
            "zerolatency",
            "-pix_fmt",
            "yuv420p",
        ]
        if source.audio_input:
            command.extend(["-c:a", "aac", "-b:a", "160k"])
        else:
            command.append("-an")
        return tuple(command)

    @staticmethod
    def _refresh(worker: _CaptureWorker, label: str) -> _CaptureWorker:
        if worker.process is None or worker.health.state not in ("starting", "healthy"):
            return worker
        return_code = worker.process.poll()
        if return_code is None:
            return _CaptureWorker(
                worker.process, DestinationHealth("healthy", f"{label} is running")
            )
        return _CaptureWorker(
            None,
            DestinationHealth(
                "failed", f"{label} exited unexpectedly", exit_code=return_code
            ),
        )

    @staticmethod
    def _stop(
        worker: _CaptureWorker, label: str, timeout_seconds: float
    ) -> _CaptureWorker:
        if worker.process is None:
            return worker
        process = worker.process
        try:
            if process.poll() is None and process.stdin:
                process.stdin.write(b"q\n")
                process.stdin.flush()
            process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                process.wait(timeout=timeout_seconds)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=timeout_seconds)
        except (BrokenPipeError, OSError):
            process.terminate()
            process.wait(timeout=timeout_seconds)
        return _CaptureWorker(None, DestinationHealth("stopped", f"{label} stopped"))

    def _has_active_worker(self) -> bool:
        return any(
            worker.process is not None and worker.process.poll() is None
            for worker in (self._recording, self._publishing)
        )

    @staticmethod
    def _launch(command: tuple[str, ...]) -> CaptureProcess:
        return subprocess.Popen(  # type: ignore[return-value]
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


class CapturingAttemptExecutor:
    """Add best-effort capture to an executor without joining their failure paths."""

    def __init__(
        self,
        executor: Any,
        capture: FfmpegCaptureController,
        profile: CaptureProfile,
        *,
        environment: Mapping[str, str] | None = None,
    ) -> None:
        self.executor = executor
        self.capture = capture
        self.profile = profile
        self.environment = environment
        self.last_health = capture.health()

    def prepare(self, envelope: dict[str, Any], configuration: dict[str, Any]) -> None:
        self.executor.prepare(envelope, configuration)

    def component_health(self) -> dict[str, str]:
        self.last_health = self.capture.health()
        return self.last_health.heartbeat_value()

    def execute(
        self,
        envelope: dict[str, Any],
        configuration: dict[str, Any],
        *,
        recovering: bool,
        emit_telemetry: Callable[[dict[str, Any]], None],
    ) -> Any:
        try:
            request = self.profile.request_for_attempt(
                envelope["attemptId"], self.environment
            )
            self.last_health = self.capture.start(request)
        except Exception:  # noqa: BLE001 - a bad capture profile must not lose telemetry
            self.last_health = self.capture.health()
        try:
            return self.executor.execute(
                envelope,
                configuration,
                recovering=recovering,
                emit_telemetry=emit_telemetry,
            )
        finally:
            try:
                self.last_health = self.capture.stop()
            except Exception:  # noqa: BLE001 - game outcome remains authoritative
                self.last_health = self.capture.health()
