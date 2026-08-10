from __future__ import annotations

import os
import platform
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from starworks_runner.control import RunnerControlClient
from starworks_runner.diagnostics import inspect_local_prerequisites
from starworks_runner.orchestrator import RunnerStation
from starworks_runner.state import RunnerStateStore


@dataclass(frozen=True)
class DesktopDefaults:
    base_url: str
    credential: str
    station_name: str
    state_path: Path
    game_image: Path | None = None
    dolphin_executable: Path | None = None
    dtk_executable: Path | None = None


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
            "runtime-bridge-v1",
            "telemetry-spool-v1",
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
        def __init__(self, operation: object) -> None:
            super().__init__()
            self.operation = operation
            self.signals = WorkerSignals()

        def run(self) -> None:
            try:
                result = self.operation()  # type: ignore[operator]
            except Exception as error:  # noqa: BLE001 - report worker failures in Qt
                self.signals.failed.emit(str(error))
            else:
                self.signals.completed.emit(result)

    class RunnerWindow(QMainWindow):
        def __init__(self) -> None:
            super().__init__()
            self.pool = QThreadPool.globalInstance()
            self.setWindowTitle("Starworks Runner")
            self.setMinimumSize(680, 720)

            heading = QLabel("Starworks Runner")
            heading.setObjectName("heading")
            subtitle = QLabel(
                "Register this computer as a private Mario Super Sluggers station."
            )
            subtitle.setWordWrap(True)

            self.url = QLineEdit(defaults.base_url)
            self.url.setPlaceholderText("https://starworks.example")
            self.credential = QLineEdit(defaults.credential)
            self.credential.setEchoMode(QLineEdit.EchoMode.Password)
            self.credential.setPlaceholderText("One-time runner credential")
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

            form = QFormLayout()
            form.addRow("Starworks URL", self.url)
            form.addRow("Runner credential", self.credential)
            form.addRow("Station name", self.station_name)
            form.addRow(
                "Game dump",
                self.path_selector(
                    self.game_image,
                    "Select a user-owned Mario Super Sluggers dump",
                    "Wii images (*.rvz *.iso *.wbfs);;All files (*)",
                ),
            )
            form.addRow(
                "Dolphin",
                self.path_selector(
                    self.dolphin_executable,
                    "Select the pinned Dolphin executable",
                    "All files (*)",
                ),
            )
            form.addRow(
                "decomp-toolkit",
                self.path_selector(
                    self.dtk_executable,
                    "Select the pinned decomp-toolkit executable",
                    "All files (*)",
                ),
            )

            self.register_button = QPushButton("Register station")
            self.register_button.clicked.connect(self.register_station)
            self.heartbeat_button = QPushButton("Send heartbeat")
            self.heartbeat_button.clicked.connect(self.send_heartbeat)
            buttons = QHBoxLayout()
            buttons.addWidget(self.register_button)
            buttons.addWidget(self.heartbeat_button)
            buttons.addStretch()

            status_card = QFrame()
            status_card.setObjectName("statusCard")
            status_layout = QVBoxLayout(status_card)
            status_label = QLabel("Station status")
            status_label.setObjectName("statusLabel")
            self.status = QLabel("Not registered on this computer")
            self.status.setWordWrap(True)
            self.active_run = QLabel("No locally journaled match attempt")
            self.active_run.setWordWrap(True)
            self.prerequisites = QLabel()
            self.prerequisites.setWordWrap(True)
            status_layout.addWidget(status_label)
            status_layout.addWidget(self.status)
            status_layout.addWidget(self.active_run)
            status_layout.addWidget(self.prerequisites)

            privacy = QLabel(
                "The credential is held only in this window. It is never saved to the local runner database."
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
                            min-height: 22px;
                            border-radius: 7px; padding: 9px; }
                QPushButton { background: #f4b942; color: #17130a; border: 0;
                              border-radius: 7px; font-weight: 700; min-height: 22px;
                              padding: 10px 15px; }
                QPushButton:disabled { background: #69645a; }
                #statusCard { background: #1b202a; border: 1px solid #343e50;
                              border-radius: 10px; padding: 8px; }
                #statusCard QLabel { background: transparent; }
                #statusLabel { color: #9eb5d7; font-weight: 700; }
                #privacy { color: #9aa3b1; font-size: 12px; }
                """
            )
            self.refresh_local_status()

        def path_selector(
            self, field: QLineEdit, caption: str, file_filter: str
        ) -> QWidget:
            container = QWidget()
            container.setMinimumHeight(44)
            layout = QHBoxLayout(container)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(8)
            browse = QPushButton("Browse…")
            browse.clicked.connect(
                lambda: self.select_file(field, caption, file_filter)
            )
            layout.addWidget(field)
            layout.addWidget(browse)
            return container

        def select_file(self, field: QLineEdit, caption: str, file_filter: str) -> None:
            selected, _ = QFileDialog.getOpenFileName(
                self, caption, field.text(), file_filter
            )
            if selected:
                field.setText(selected)
                self.refresh_local_status()

        def runner_station(self) -> tuple[RunnerStation, RunnerStateStore]:
            credential = self.credential.text().strip()
            if not credential:
                raise RuntimeError("Paste a runner credential before connecting")
            state = RunnerStateStore(defaults.state_path)
            client = RunnerControlClient(self.url.text().strip(), credential)
            station = RunnerStation(
                client,
                state,
                station_name=self.station_name.text().strip(),
                capabilities=native_capabilities(),
            )
            return station, state

        def register_station(self) -> None:
            try:
                station, state = self.runner_station()
            except Exception as error:  # noqa: BLE001 - surface setup failures in UI
                self.show_error(str(error))
                return

            def operation() -> object:
                try:
                    return station.register()
                finally:
                    state.close()

            self.start_work(
                operation,
                lambda registration: self.status.setText(
                    f"Registered as {registration.runner_id} · heartbeat every "
                    f"{registration.heartbeat_seconds}s"
                ),
            )

        def send_heartbeat(self) -> None:
            try:
                station, state = self.runner_station()
            except Exception as error:  # noqa: BLE001 - surface setup failures in UI
                self.show_error(str(error))
                return

            def operation() -> object:
                try:
                    return station.heartbeat("idle")
                finally:
                    state.close()

            self.start_work(
                operation,
                lambda response: self.status.setText(
                    f"Heartbeat accepted · server time {response['serverTime']}"
                ),
            )

        def start_work(self, operation: object, completed: object) -> None:
            self.register_button.setDisabled(True)
            self.heartbeat_button.setDisabled(True)
            worker = Worker(operation)
            worker.signals.completed.connect(completed)
            worker.signals.completed.connect(lambda _: self.finish_work())
            worker.signals.failed.connect(self.show_error)
            self.pool.start(worker)

        def finish_work(self) -> None:
            self.register_button.setDisabled(False)
            self.heartbeat_button.setDisabled(False)
            self.refresh_local_status()

        def show_error(self, message: str) -> None:
            self.finish_work()
            QMessageBox.critical(self, "Runner connection failed", message)

        def refresh_local_status(self) -> None:
            with RunnerStateStore(defaults.state_path) as state:
                registration = state.load_registration()
                active = state.load_active_run()
            if registration:
                self.status.setText(f"Registered locally as {registration.runner_id}")
            if active:
                self.active_run.setText(
                    f"Attempt {active.envelope['attemptId']} · stage {active.stage}"
                )
            else:
                self.active_run.setText("No locally journaled match attempt")
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

        @staticmethod
        def optional_path(value: str) -> Path | None:
            return Path(value.strip()) if value.strip() else None

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
