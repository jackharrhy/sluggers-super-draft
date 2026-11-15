from __future__ import annotations

import os
import platform
from collections.abc import Callable
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from starworks_runner.diagnostics import inspect_local_prerequisites
from starworks_runner.station import (
    SluggersStationConfig,
    StationService,
    create_sluggers_station_service,
)


@dataclass(frozen=True)
class DesktopDefaults:
    base_url: str
    credential: str
    station_name: str
    state_path: Path
    game_image: Path | None = None
    dolphin_executable: Path | None = None
    dtk_executable: Path | None = None
    seed_profile_directory: Path | None = None
    checkpoint_manifest: Path | None = None


def default_state_path() -> Path:
    system = platform.system().lower()
    if system == "windows":
        root = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        return root / "Starworks" / "runner.sqlite3"
    if system == "darwin":
        return (
            Path.home()
            / "Library"
            / "Application Support"
            / "Starworks"
            / "runner.sqlite3"
        )
    root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return root / "starworks" / "runner.sqlite3"


def native_capabilities(*, dolphin_version: str | None = None) -> dict[str, Any]:
    architecture = platform.machine().lower()
    if architecture in ("aarch64", "arm64"):
        normalized_architecture = "arm64"
    elif architecture in ("amd64", "x86_64"):
        normalized_architecture = "x64"
    else:
        raise RuntimeError(f"Unsupported runner architecture: {architecture}")
    operating_system = {
        "darwin": "macos",
        "linux": "linux",
        "windows": "windows",
    }.get(platform.system().lower())
    if operating_system is None:
        raise RuntimeError(f"Unsupported runner operating system: {platform.system()}")
    try:
        runner_version = version("starworks-runner")
    except PackageNotFoundError:
        runner_version = "0.1.0"
    return {
        "architecture": normalized_architecture,
        "operatingSystem": operating_system,
        "runnerVersion": runner_version,
        "adapterIds": ["sluggers-rmbe01"],
        "features": [
            "build-sluggers",
            "launch-dolphin",
            "runtime-bridge",
            "telemetry-spool",
            "capture-ffmpeg",
        ],
        "dolphinVersion": dolphin_version,
    }


def launch_desktop(
    defaults: DesktopDefaults,
    *,
    smoke_screenshot: Path | None = None,
    auto_close_ms: int | None = None,
) -> int:
    try:
        from PySide6.QtCore import QObject, QRunnable, Qt, QThreadPool, QTimer, Signal
        from PySide6.QtWidgets import (
            QApplication,
            QFileDialog,
            QFormLayout,
            QFrame,
            QHBoxLayout,
            QLabel,
            QLineEdit,
            QMainWindow,
            QMessageBox,
            QPushButton,
            QVBoxLayout,
            QWidget,
        )
    except ImportError as error:
        raise RuntimeError(
            "The native UI requires the gui extra: uv sync --extra gui"
        ) from error

    class WorkerSignals(QObject):
        completed = Signal(object)
        failed = Signal(str)

    class Worker(QRunnable):
        def __init__(self, operation: Callable[[], object]) -> None:
            super().__init__()
            self.operation = operation
            self.signals = WorkerSignals()

        def run(self) -> None:
            try:
                result = self.operation()
            except Exception as error:  # noqa: BLE001 - surface failures in Qt
                self.signals.failed.emit(str(error))
            else:
                self.signals.completed.emit(result)

    class RunnerWindow(QMainWindow):
        def __init__(self) -> None:
            super().__init__()
            self.pool = QThreadPool.globalInstance()
            self.service: StationService | None = None
            self.service_config: SluggersStationConfig | None = None
            self.station_running = False
            self.tick_in_flight = False
            self.setWindowTitle("Starworks Runner")
            self.setMinimumSize(760, 900)

            heading = QLabel("Starworks Runner")
            heading.setObjectName("heading")
            subtitle = QLabel(
                "Configure this computer once, then let it claim and run scheduled "
                "Mario Super Sluggers matches."
            )
            subtitle.setWordWrap(True)

            self.url = QLineEdit(defaults.base_url)
            self.url.setPlaceholderText("https://starworks.example")
            self.credential = QLineEdit(defaults.credential)
            self.credential.setEchoMode(QLineEdit.EchoMode.Password)
            self.credential.setPlaceholderText("Runner credential from a site admin")
            self.station_name = QLineEdit(defaults.station_name)
            self.game_image = QLineEdit(
                str(defaults.game_image) if defaults.game_image else ""
            )
            self.dolphin_executable = QLineEdit(
                str(defaults.dolphin_executable) if defaults.dolphin_executable else ""
            )
            self.dtk_executable = QLineEdit(
                str(defaults.dtk_executable) if defaults.dtk_executable else ""
            )
            self.seed_profile = QLineEdit(
                str(defaults.seed_profile_directory)
                if defaults.seed_profile_directory
                else ""
            )
            self.checkpoint_manifest = QLineEdit(
                str(defaults.checkpoint_manifest)
                if defaults.checkpoint_manifest
                else ""
            )

            form = QFormLayout()
            form.addRow("Starworks URL", self.url)
            form.addRow("Runner credential", self.credential)
            form.addRow("Station name", self.station_name)
            form.addRow(
                "Game dump",
                self.file_selector(
                    self.game_image,
                    "Select a user-owned Mario Super Sluggers dump",
                    "Wii images (*.rvz *.iso *.wbfs);;All files (*)",
                ),
            )
            form.addRow(
                "Dolphin",
                self.file_selector(
                    self.dolphin_executable,
                    "Select Dolphin 2606",
                    "All files (*)",
                ),
            )
            form.addRow(
                "decomp-toolkit",
                self.file_selector(
                    self.dtk_executable,
                    "Select decomp-toolkit",
                    "All files (*)",
                ),
            )
            form.addRow(
                "Unlocked seed profile",
                self.directory_selector(
                    self.seed_profile,
                    "Select the immutable Dolphin seed profile",
                ),
            )
            form.addRow(
                "Pre-roster checkpoint",
                self.file_selector(
                    self.checkpoint_manifest,
                    "Select the reviewed checkpoint manifest",
                    "JSON (*.json);;All files (*)",
                ),
            )

            self.connect_button = QPushButton("Connect station")
            self.connect_button.clicked.connect(self.connect_station)
            self.start_button = QPushButton("Start station")
            self.start_button.clicked.connect(self.start_station)
            self.stop_button = QPushButton("Stop while idle")
            self.stop_button.clicked.connect(self.stop_station)
            self.stop_button.setDisabled(True)
            buttons = QHBoxLayout()
            buttons.addWidget(self.connect_button)
            buttons.addWidget(self.start_button)
            buttons.addWidget(self.stop_button)
            buttons.addStretch()

            status_card = QFrame()
            status_card.setObjectName("statusCard")
            status_layout = QVBoxLayout(status_card)
            status_label = QLabel("Station status")
            status_label.setObjectName("statusLabel")
            self.status = QLabel("Not connected on this computer")
            self.active_run = QLabel("No locally journaled match attempt")
            self.lease_status = QLabel("No active lease")
            self.telemetry_status = QLabel("Telemetry spool is idle")
            self.recovery_status = QLabel("No live Dolphin session")
            self.artifact_status = QLabel("Managed build cache has not been inspected")
            self.last_error = QLabel("No operator action is required")
            self.last_error.setObjectName("operatorError")
            self.prerequisites = QLabel()
            for label in (
                self.status,
                self.active_run,
                self.lease_status,
                self.telemetry_status,
                self.recovery_status,
                self.artifact_status,
                self.last_error,
                self.prerequisites,
            ):
                label.setWordWrap(True)
                status_layout.addWidget(label)
            status_layout.insertWidget(0, status_label)

            privacy = QLabel(
                "The runner credential stays in this process. The local database "
                "contains match recovery state, not the credential."
            )
            privacy.setObjectName("privacy")
            privacy.setWordWrap(True)

            content = QWidget()
            layout = QVBoxLayout(content)
            layout.setContentsMargins(28, 24, 28, 24)
            layout.setSpacing(16)
            layout.addWidget(heading)
            layout.addWidget(subtitle)
            layout.addLayout(form)
            layout.addLayout(buttons)
            layout.addWidget(status_card)
            layout.addWidget(privacy)
            layout.addStretch()
            self.setCentralWidget(content)
            self.setStyleSheet(
                """
                QWidget { background: #11141a; color: #f4f1e8; font-size: 14px; }
                #heading { font-size: 28px; font-weight: 700; color: #ffd45c; }
                QLineEdit { background: #202631; border: 1px solid #465064;
                            min-height: 22px; border-radius: 7px; padding: 9px; }
                QPushButton { background: #f4b942; color: #17130a; border: 0;
                              border-radius: 7px; font-weight: 700; min-height: 22px;
                              padding: 10px 15px; }
                QPushButton:disabled { background: #69645a; }
                #statusCard { background: #1b202a; border: 1px solid #343e50;
                              border-radius: 10px; padding: 8px; }
                #statusCard QLabel { background: transparent; }
                #statusLabel { color: #9eb5d7; font-weight: 700; }
                #operatorError { color: #f5a3a3; }
                #privacy { color: #9aa3b1; font-size: 12px; }
                """
            )
            self.refresh_local_status()
            self.status_timer = QTimer(self)
            self.status_timer.timeout.connect(self.refresh_local_status)
            self.status_timer.start(2_000)

        def file_selector(
            self, field: QLineEdit, caption: str, file_filter: str
        ) -> QWidget:
            return self.path_selector(
                field,
                lambda: QFileDialog.getOpenFileName(
                    self, caption, field.text(), file_filter
                )[0],
            )

        def directory_selector(self, field: QLineEdit, caption: str) -> QWidget:
            return self.path_selector(
                field,
                lambda: QFileDialog.getExistingDirectory(self, caption, field.text()),
            )

        def path_selector(self, field: QLineEdit, choose: Callable[[], str]) -> QWidget:
            container = QWidget()
            container.setMinimumHeight(44)
            layout = QHBoxLayout(container)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(8)
            browse = QPushButton("Browse…")

            def select() -> None:
                selected = choose()
                if selected:
                    field.setText(selected)
                    self.refresh_local_status()

            browse.clicked.connect(select)
            layout.addWidget(field)
            layout.addWidget(browse)
            return container

        def desired_config(self) -> SluggersStationConfig:
            credential = self.credential.text().strip()
            if not credential:
                raise RuntimeError("Paste a runner credential before connecting")
            dolphin = self.required_path(self.dolphin_executable.text(), "Dolphin")
            seed_profile = self.optional_path(self.seed_profile.text())
            checkpoint = self.optional_path(self.checkpoint_manifest.text())
            if (seed_profile is None) != (checkpoint is None):
                raise RuntimeError(
                    "Select both the unlocked seed profile and pre-roster checkpoint"
                )
            data_root = defaults.state_path.expanduser().resolve().parent
            return SluggersStationConfig(
                base_url=self.url.text().strip(),
                credential=credential,
                station_name=self.station_name.text().strip(),
                state_path=defaults.state_path,
                cache_root=data_root / "cache",
                dolphin_executable=dolphin,
                profile_root=data_root / "profiles",
                capabilities=native_capabilities(dolphin_version="2606"),
                game_image=self.optional_path(self.game_image.text()),
                dtk_executable=self.optional_path(self.dtk_executable.text()),
                seed_profile_directory=seed_profile,
                checkpoint_manifest=checkpoint,
                recording_directory=data_root / "artifacts",
            )

        def runner_service(self) -> StationService:
            config = self.desired_config()
            if self.service is not None and config != self.service_config:
                if self.station_running or self.tick_in_flight:
                    raise RuntimeError("Stop the station before changing its setup")
                self.service.close()
                self.service = None
            if self.service is None:
                self.service = create_sluggers_station_service(config)
                self.service_config = config
            return self.service

        def connect_station(self) -> None:
            try:
                service = self.runner_service()
            except Exception as error:  # noqa: BLE001 - show setup failure
                self.show_error(str(error))
                return
            self.start_work(
                lambda: service.ensure_registered()[0],
                lambda registration: self.status.setText(
                    f"Connected as {registration.runner_id}"
                ),
            )

        def start_station(self) -> None:
            try:
                service = self.runner_service()
                service.ensure_registered()
            except Exception as error:  # noqa: BLE001 - show setup failure
                self.show_error(str(error))
                return
            self.station_running = True
            self.last_error.setText("No operator action is required")
            self.update_buttons()
            self.run_station_tick()

        def run_station_tick(self) -> None:
            if not self.station_running or self.tick_in_flight:
                return
            assert self.service is not None
            self.tick_in_flight = True
            self.update_buttons()
            worker = Worker(self.service.tick)
            worker.signals.completed.connect(self.tick_completed)
            worker.signals.failed.connect(self.tick_failed)
            self.pool.start(worker)

        def tick_completed(self, result: object) -> None:
            self.tick_in_flight = False
            self.refresh_local_status()
            self.update_buttons()
            if self.station_running:
                QTimer.singleShot(1_000, self.run_station_tick)

        def tick_failed(self, message: str) -> None:
            self.tick_in_flight = False
            self.station_running = False
            self.update_buttons()
            self.show_error(message)

        def stop_station(self) -> None:
            if self.service is None:
                return
            snapshot = self.service.snapshot()
            if snapshot.attempt_id is not None:
                self.show_error(
                    "An attempt is active. Let it finish; abort semantics are not "
                    "implemented yet."
                )
                return
            self.station_running = False
            self.service.close()
            self.service = None
            self.service_config = None
            self.status.setText("Station stopped while idle")
            self.update_buttons()
            self.refresh_local_status()

        def start_work(
            self, operation: Callable[[], object], completed: Callable[[Any], None]
        ) -> None:
            self.connect_button.setDisabled(True)
            self.start_button.setDisabled(True)
            worker = Worker(operation)
            worker.signals.completed.connect(completed)
            worker.signals.completed.connect(lambda _: self.finish_work())
            worker.signals.failed.connect(self.show_error)
            self.pool.start(worker)

        def finish_work(self) -> None:
            self.update_buttons()
            self.refresh_local_status()

        def update_buttons(self) -> None:
            busy = self.tick_in_flight
            self.connect_button.setDisabled(busy or self.station_running)
            self.start_button.setDisabled(busy or self.station_running)
            self.stop_button.setDisabled(
                busy or (not self.station_running and self.service is None)
            )

        def show_error(self, message: str) -> None:
            self.update_buttons()
            self.last_error.setText(f"Action required: {message}")
            QMessageBox.critical(self, "Starworks Runner", message)

        def refresh_local_status(self) -> None:
            snapshot = self.service.snapshot() if self.service is not None else None
            if snapshot is not None and snapshot.registered:
                state = "running" if self.station_running else "connected"
                self.status.setText(
                    f"Station {state} as {snapshot.runner_id}"
                    + (
                        f" · last tick {snapshot.last_tick_status}"
                        if snapshot.last_tick_status
                        else ""
                    )
                )
            if snapshot is not None and snapshot.attempt_id is not None:
                live_stage = (
                    f" · game {snapshot.live_stage}" if snapshot.live_stage else ""
                )
                self.active_run.setText(
                    f"Attempt {snapshot.attempt_id} · match {snapshot.match_id} · "
                    f"stage {snapshot.stage}{live_stage}"
                )
                self.lease_status.setText(
                    f"Lease expires {snapshot.lease_expires_at} · "
                    f"fresh retries allowed {snapshot.fresh_attempt_limit}"
                )
                self.telemetry_status.setText(
                    f"Telemetry · last captured {snapshot.last_captured_sequence} · "
                    f"{snapshot.pending_telemetry} waiting to upload · "
                    f"{snapshot.pending_updates} control updates waiting"
                )
                self.recovery_status.setText(
                    f"Dolphin PID {snapshot.process_id} is journaled"
                    if snapshot.process_id is not None
                    else "No verified live Dolphin identity yet"
                )
            else:
                self.active_run.setText("No locally journaled match attempt")
                self.lease_status.setText("No active lease")
                self.telemetry_status.setText(
                    "Telemetry spool is idle"
                    + (
                        f" · {snapshot.pending_updates} control updates waiting"
                        if snapshot and snapshot.pending_updates
                        else ""
                    )
                )
                self.recovery_status.setText("No live Dolphin session")

            cache = defaults.state_path.expanduser().resolve().parent / "cache"
            builds = cache / "builds"
            build_count = (
                sum(1 for item in builds.iterdir() if item.is_dir())
                if builds.is_dir()
                else 0
            )
            recordings = defaults.state_path.expanduser().resolve().parent / "artifacts"
            recording_count = (
                sum(1 for item in recordings.glob("*.mkv") if item.is_file())
                if recordings.is_dir()
                else 0
            )
            self.artifact_status.setText(
                f"Managed artifacts · {build_count} game builds · "
                f"{recording_count} local recordings"
            )
            checks = inspect_local_prerequisites(
                game_image=self.optional_path(self.game_image.text()),
                dolphin_executable=self.optional_path(self.dolphin_executable.text()),
                dtk_executable=self.optional_path(self.dtk_executable.text()),
            )
            symbols = {"ready": "✓", "missing": "!", "not-configured": "○"}
            self.prerequisites.setText(
                "\n".join(
                    f"{symbols[check.status]} {check.label}: {check.detail}"
                    for check in checks
                )
            )

        def closeEvent(self, event: Any) -> None:
            if self.tick_in_flight:
                QMessageBox.information(
                    self,
                    "Starworks Runner",
                    "The station is finishing a control tick. Try closing again in a moment.",
                )
                event.ignore()
                return
            if self.service is not None:
                snapshot = self.service.snapshot()
                if snapshot.attempt_id is not None:
                    QMessageBox.warning(
                        self,
                        "Starworks Runner",
                        "A match attempt is active. Leave the runner open until the "
                        "match finishes; safe operator abort is not implemented yet.",
                    )
                    event.ignore()
                    return
            self.station_running = False
            if self.service is not None:
                try:
                    self.service.close()
                except Exception as error:  # noqa: BLE001 - app is closing
                    self.last_error.setText(f"Shutdown warning: {error}")
            event.accept()

        @staticmethod
        def optional_path(value: str) -> Path | None:
            return Path(value.strip()) if value.strip() else None

        @staticmethod
        def required_path(value: str, label: str) -> Path:
            path = RunnerWindow.optional_path(value)
            if path is None:
                raise RuntimeError(f"Select {label} before connecting")
            return path

    application = QApplication.instance() or QApplication([])
    application.setApplicationName("Starworks Runner")
    window = RunnerWindow()
    window.show()
    window.raise_()
    window.activateWindow()
    window.setWindowState(window.windowState() & ~Qt.WindowState.WindowMinimized)
    if smoke_screenshot is not None:
        smoke_screenshot.parent.mkdir(parents=True, exist_ok=True)

        def capture_and_close() -> None:
            if not window.grab().save(str(smoke_screenshot)):
                raise RuntimeError(f"Unable to save Qt screenshot: {smoke_screenshot}")
            application.quit()

        QTimer.singleShot(auto_close_ms or 250, capture_and_close)
    elif auto_close_ms is not None:
        QTimer.singleShot(auto_close_ms, application.quit)
    return application.exec()
