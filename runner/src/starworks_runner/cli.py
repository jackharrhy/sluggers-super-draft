from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path, PurePosixPath

from starworks_runner.capture import (
    CaptureRequest,
    CaptureSource,
    FfmpegCaptureController,
    resolve_local_secret,
)
from starworks_runner.contracts import CONTRACT_NAMES, validate_contract
from starworks_runner.desktop import default_state_path
from starworks_runner.games.sluggers.bridge.client import BridgeClient
from starworks_runner.games.sluggers.bridge.layout import BridgeLayout
from starworks_runner.games.sluggers.bridge.memory import (
    ByteArrayMemoryTransport,
    DolphinMemoryEngineTransport,
)
from starworks_runner.games.sluggers.bridge.synthetic import SyntheticGameBridge
from starworks_runner.games.sluggers.builder import BuildRequest, GameBuildService
from starworks_runner.games.sluggers.content import ContentPackInput
from starworks_runner.games.sluggers.dolphin import DolphinLauncher
from starworks_runner.games.sluggers.errors import SluggersAdapterError
from starworks_runner.games.sluggers.fingerprints import (
    SupportedBaseRegistry,
    fingerprint_extraction,
)
from starworks_runner.games.sluggers.patching import (
    GuardedWrite,
    PrecompiledPatchApplier,
    PrecompiledPatchPlan,
    encode_ppc_branch,
)
from starworks_runner.games.sluggers.tools import (
    DtkDiscTool,
    dtk_asset_for_current_platform,
    install_dtk,
    load_dtk_release,
)


def validate_contract_fixtures(contracts_directory: Path) -> None:
    fixture_directory = contracts_directory / "fixtures" / "valid"
    for name in CONTRACT_NAMES:
        fixture_path = fixture_directory / f"{name}.json"
        with fixture_path.open(encoding="utf-8") as fixture_file:
            validate_contract(name, json.load(fixture_file), contracts_directory)
        print(f"validated {fixture_path}")


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="starworks-runner")
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate_parser = subparsers.add_parser(
        "validate-contracts", help="validate the shared contract fixtures"
    )
    validate_parser.add_argument(
        "--contracts-directory",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "contracts",
    )

    install_parser = subparsers.add_parser(
        "install-dtk", help="install the pinned decomp-toolkit release"
    )
    install_parser.add_argument("--tool-directory", type=Path, required=True)

    build_parser = subparsers.add_parser(
        "build-sluggers", help="verify a user-owned image and create a managed build"
    )
    build_parser.add_argument("--image", type=Path, required=True)
    build_parser.add_argument("--cache", type=Path, required=True)
    build_parser.add_argument("--dtk", type=Path)
    build_parser.add_argument("--supported-bases", type=Path)
    build_parser.add_argument(
        "--content-pack-sha256",
        default="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    )
    build_parser.add_argument("--content-pack-manifest", type=Path)
    build_parser.add_argument("--adapter-operations", type=Path)
    build_parser.add_argument("--content-assets", type=Path)
    build_parser.add_argument("--static-targets", type=Path)
    build_parser.add_argument("--adapter-version", default="0.1.0")
    build_parser.add_argument("--compiler-version", default="0.1.0")

    fingerprint_parser = subparsers.add_parser(
        "fingerprint-sluggers",
        help="inspect a clean image and print a candidate supported-base fingerprint",
    )
    fingerprint_parser.add_argument("--image", type=Path, required=True)
    fingerprint_parser.add_argument("--dtk", type=Path, required=True)

    launch_parser = subparsers.add_parser(
        "launch-sluggers", help="launch a verified managed build in pinned Dolphin"
    )
    launch_parser.add_argument("--build-directory", type=Path, required=True)
    launch_parser.add_argument("--dolphin", type=Path, required=True)
    launch_parser.add_argument("--profile", type=Path, required=True)
    launch_parser.add_argument("--wait", action="store_true")

    probe_parser = subparsers.add_parser(
        "probe-bridge", help="attach to Dolphin and negotiate bridge protocol v1"
    )
    probe_parser.add_argument("--adapter-build-sha256", required=True)
    probe_parser.add_argument("--game-build-sha256", required=True)
    probe_parser.add_argument("--attempt-nonce", required=True)
    probe_parser.add_argument(
        "--memory-base", type=lambda value: int(value, 0), default=0x807A5000
    )
    probe_parser.add_argument("--timeout-seconds", type=float, default=5.0)
    probe_parser.add_argument("--poll-seconds", type=float, default=1.0)

    benchmark_parser = subparsers.add_parser(
        "benchmark-bridge", help="measure the synthetic bridge polling path"
    )
    benchmark_parser.add_argument("--iterations", type=int, default=10_000)

    patcher_parser = subparsers.add_parser(
        "evaluate-patch-toolchains",
        help="benchmark precompiled patch application and report Kamek prerequisites",
    )
    patcher_parser.add_argument("--size-mib", type=int, default=8)
    patcher_parser.add_argument("--iterations", type=int, default=5)

    capture_parser = subparsers.add_parser(
        "capture",
        help="record and/or publish an FFmpeg capture using runner-local settings",
    )
    capture_parser.add_argument("--ffmpeg", default="ffmpeg")
    capture_parser.add_argument(
        "--video-backend",
        choices=("avfoundation", "gdigrab", "x11grab", "lavfi"),
        required=True,
    )
    capture_parser.add_argument("--video-input", required=True)
    capture_parser.add_argument(
        "--audio-backend", choices=("avfoundation", "dshow", "pulse", "lavfi")
    )
    capture_parser.add_argument("--audio-input")
    capture_parser.add_argument("--frame-rate", type=int, default=60)
    capture_parser.add_argument("--video-size", default="1920x1080")
    capture_parser.add_argument("--record", type=Path)
    capture_parser.add_argument(
        "--rtmp-url-environment",
        help="environment variable containing the RTMP URL and stream key",
    )
    capture_parser.add_argument("--duration-seconds", type=float, default=10.0)

    desktop_parser = subparsers.add_parser(
        "desktop", help="open the native Starworks runner station"
    )
    desktop_parser.add_argument(
        "--url", default=os.environ.get("STARWORKS_URL", "http://127.0.0.1:3000")
    )
    desktop_parser.add_argument(
        "--station-name",
        default=os.environ.get("STARWORKS_RUNNER_NAME", "Sluggers station"),
    )
    desktop_parser.add_argument(
        "--state",
        type=Path,
        default=default_state_path(),
    )
    desktop_parser.add_argument("--image", type=Path)
    desktop_parser.add_argument("--dolphin", type=Path)
    desktop_parser.add_argument("--dtk", type=Path)
    return parser


def _resolve_dtk(explicit_path: Path | None, cache: Path) -> Path:
    if explicit_path is not None:
        return explicit_path
    release = load_dtk_release()
    asset = dtk_asset_for_current_platform(release)
    return (
        cache.expanduser().resolve()
        / "tools"
        / "dtk"
        / release.version
        / asset.file_name
    )


def run(arguments: argparse.Namespace) -> int:
    if arguments.command == "validate-contracts":
        validate_contract_fixtures(arguments.contracts_directory.resolve())
        return 0
    if arguments.command == "install-dtk":
        installed = install_dtk(arguments.tool_directory)
        print(json.dumps({"installed": str(installed)}, sort_keys=True))
        return 0
    if arguments.command == "build-sluggers":
        cache = arguments.cache.expanduser().resolve()
        tool = DtkDiscTool(_resolve_dtk(arguments.dtk, cache))
        registry = SupportedBaseRegistry.load(arguments.supported_bases)
        if bool(arguments.content_pack_manifest) != bool(arguments.adapter_operations):
            raise SluggersAdapterError(
                "--content-pack-manifest and --adapter-operations must be provided together"
            )
        content_pack = None
        if arguments.content_pack_manifest:
            content_pack = ContentPackInput.load(
                arguments.content_pack_manifest,
                arguments.adapter_operations,
                assets_root=arguments.content_assets,
                target_catalog_path=arguments.static_targets,
            )
        result = GameBuildService(tool, registry).build(
            BuildRequest(
                image_path=arguments.image,
                cache_root=cache,
                content_pack_sha256=arguments.content_pack_sha256,
                content_pack=content_pack,
                adapter_version=arguments.adapter_version,
                compiler_version=arguments.compiler_version,
            )
        )
        print(
            json.dumps(
                {
                    "buildDirectory": str(result.build_directory),
                    "buildSha256": result.manifest["buildSha256"],
                    "cacheHit": result.cache_hit,
                },
                sort_keys=True,
            )
        )
        return 0
    if arguments.command == "fingerprint-sluggers":
        image = arguments.image.expanduser().resolve()
        tool = DtkDiscTool(arguments.dtk)
        tool_sha256 = tool.verify_pinned_binary()
        identity = tool.inspect(image)
        verification = tool.verify_image(image)
        with tempfile.TemporaryDirectory(prefix="starworks-fingerprint-") as temporary:
            extracted = Path(temporary) / "extracted"
            tool.extract(image, extracted)
            fingerprint, files = fingerprint_extraction(
                extracted,
                expected_game_id=identity.game_id,
                expected_revision=identity.revision,
            )
        print(
            json.dumps(
                {
                    "baseGame": fingerprint.manifest_value(),
                    "files": [file.manifest_value() for file in files],
                    "redumpName": verification.redump_name,
                    "dtkSha256": tool_sha256,
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0
    if arguments.command == "launch-sluggers":
        launch = DolphinLauncher(arguments.dolphin).launch(
            arguments.build_directory, arguments.profile
        )
        print(json.dumps({"command": launch.command, "pid": launch.process.pid}))
        if arguments.wait:
            return launch.process.wait()
        return 0
    if arguments.command == "probe-bridge":
        transport = DolphinMemoryEngineTransport()
        transport.attach()
        client = BridgeClient(
            transport,
            expected_adapter_build_sha256=arguments.adapter_build_sha256,
            expected_game_build_sha256=arguments.game_build_sha256,
            layout=BridgeLayout(base_address=arguments.memory_base),
        )
        acknowledged = client.negotiate(
            arguments.attempt_nonce, timeout_seconds=arguments.timeout_seconds
        )
        deadline = time.monotonic() + arguments.poll_seconds
        events = []
        while time.monotonic() < deadline:
            events.extend(client.poll_events())
            time.sleep(0.01)
        print(
            json.dumps(
                {
                    "acknowledgedEpoch": acknowledged.acknowledged_epoch,
                    "heartbeat": client.read_control().heartbeat,
                    "events": [
                        {
                            "sequence": event.sequence,
                            "frame": event.frame,
                            "eventType": event.event_type.name.lower(),
                            "payloadValue": event.payload_value,
                        }
                        for event in events
                    ],
                    "polling": client.metrics.report_value(),
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0
    if arguments.command == "benchmark-bridge":
        if arguments.iterations <= 0:
            raise SluggersAdapterError("iterations must be positive")
        layout = BridgeLayout()
        transport = ByteArrayMemoryTransport(layout)
        adapter_build = "a" * 64
        game_build = "b" * 64
        game = SyntheticGameBridge(transport, adapter_build, game_build, layout=layout)
        client = BridgeClient(
            transport,
            expected_adapter_build_sha256=adapter_build,
            expected_game_build_sha256=game_build,
            layout=layout,
        )
        client.negotiate(
            "synthetic_attempt_nonce_0123456789",
            progress=game.observe_runner_request,
            sleep=lambda _: None,
        )
        game.tick(emit_synthetic=True, payload_value=1)
        for _ in range(arguments.iterations):
            client.poll_events()
        print(json.dumps(client.metrics.report_value(), indent=2, sort_keys=True))
        return 0
    if arguments.command == "evaluate-patch-toolchains":
        if arguments.size_mib <= 0 or arguments.iterations <= 0:
            raise SluggersAdapterError("size-mib and iterations must be positive")
        source_bytes = bytearray(arguments.size_mib * 1024 * 1024)
        target_offset = 0x100
        expected_bytes = bytes.fromhex("7c0802a6")
        source_bytes[target_offset : target_offset + 4] = expected_bytes
        artifact_bytes = encode_ppc_branch(0x80004100, 0x807A5000)
        expected_output = bytearray(source_bytes)
        expected_output[target_offset : target_offset + 4] = artifact_bytes
        durations: list[float] = []
        with tempfile.TemporaryDirectory(prefix="starworks-patcher-") as temporary:
            root = Path(temporary)
            source = root / "main.dol"
            artifact_root = root / "artifacts"
            artifact_root.mkdir()
            artifact = artifact_root / "bridge.bin"
            source.write_bytes(source_bytes)
            artifact.write_bytes(artifact_bytes)
            plan = PrecompiledPatchPlan(
                patch_id="synthetic-toolchain-evaluation",
                target_path=PurePosixPath("sys/main.dol"),
                expected_input_sha256=hashlib.sha256(source_bytes).hexdigest(),
                expected_output_sha256=hashlib.sha256(expected_output).hexdigest(),
                artifact_path=PurePosixPath("bridge.bin"),
                artifact_sha256=hashlib.sha256(artifact_bytes).hexdigest(),
                artifact_size_bytes=len(artifact_bytes),
                writes=(
                    GuardedWrite(
                        target_offset=target_offset,
                        artifact_offset=0,
                        size_bytes=4,
                        expected_bytes=expected_bytes,
                    ),
                ),
            )
            plan.validate()
            for iteration in range(arguments.iterations):
                started = time.perf_counter()
                PrecompiledPatchApplier().apply(
                    source=source,
                    destination=root / f"output-{iteration}.dol",
                    artifact_root=artifact_root,
                    plan=plan,
                )
                durations.append(time.perf_counter() - started)
        report = {
            "precompiledArtifact": {
                "inputSizeBytes": len(source_bytes),
                "iterations": len(durations),
                "meanSeconds": sum(durations) / len(durations),
                "maxSeconds": max(durations),
                "endUserCompilerRequired": False,
            },
            "kamek": {
                "dotnetPath": shutil.which("dotnet"),
                "codeWarriorCompilerPath": shutil.which("mwcceppc"),
                "trustedReleaseEnvironmentRequired": True,
                "endUserCompilerRequired": False,
            },
            "selectedApproach": "trusted-kamek-build-plus-precompiled-runner-artifact",
        }
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    if arguments.command == "capture":
        if arguments.duration_seconds <= 0:
            raise SluggersAdapterError("duration-seconds must be positive")
        if arguments.record is None and arguments.rtmp_url_environment is None:
            raise SluggersAdapterError(
                "capture requires --record and/or --rtmp-url-environment"
            )
        source = CaptureSource(
            video_backend=arguments.video_backend,
            video_input=arguments.video_input,
            audio_backend=arguments.audio_backend,
            audio_input=arguments.audio_input,
            frame_rate=arguments.frame_rate,
            video_size=arguments.video_size,
        )
        rtmp_url = (
            resolve_local_secret(arguments.rtmp_url_environment)
            if arguments.rtmp_url_environment
            else None
        )
        controller = FfmpegCaptureController(arguments.ffmpeg)
        started = controller.start(
            CaptureRequest(
                source=source,
                recording_path=arguments.record,
                rtmp_url=rtmp_url,
                publish_configured=arguments.rtmp_url_environment is not None,
            )
        )
        deadline = time.monotonic() + arguments.duration_seconds
        try:
            while time.monotonic() < deadline and controller.health().state in (
                "running",
                "degraded",
            ):
                time.sleep(min(0.25, deadline - time.monotonic()))
        except KeyboardInterrupt:
            pass
        stopped = controller.stop()
        print(
            json.dumps(
                {"started": started.report_value(), "stopped": stopped.report_value()},
                indent=2,
                sort_keys=True,
            )
        )
        return 0 if started.state == "running" else 1
    if arguments.command == "desktop":
        from starworks_runner.desktop import DesktopDefaults, launch_desktop

        return launch_desktop(
            DesktopDefaults(
                base_url=arguments.url,
                credential=os.environ.get("STARWORKS_RUNNER_CREDENTIAL", ""),
                station_name=arguments.station_name,
                state_path=arguments.state,
                game_image=arguments.image,
                dolphin_executable=arguments.dolphin,
                dtk_executable=arguments.dtk,
            )
        )
    raise AssertionError(f"Unhandled command {arguments.command}")


def main() -> None:
    parser = create_parser()
    arguments = parser.parse_args()
    try:
        raise SystemExit(run(arguments))
    except SluggersAdapterError as error:
        print(f"starworks-runner: {error}", file=sys.stderr)
        raise SystemExit(2) from error
