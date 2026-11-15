from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

from starworks_runner.content_sync import ContentPackDownloader


class RecordingClient:
    def __init__(self, value: bytes) -> None:
        self.value = value
        self.requests: list[tuple[str, str]] = []

    def asset(self, attempt_id: str, asset: dict[str, Any]) -> bytes:
        self.requests.append((attempt_id, asset["sha256"]))
        return self.value


def test_content_pack_downloads_only_declared_assets_and_repairs_cache(
    tmp_path: Path,
) -> None:
    envelope, configuration = execution_with_content_pack()
    value = b"user-authored-icon"
    sha256 = hashlib.sha256(value).hexdigest()
    configuration["contentPack"]["assets"] = [
        {"sha256": sha256, "mediaType": "image/png", "sizeBytes": len(value)}
    ]
    configuration["contentPack"]["assignments"] = [
        {
            "assignmentType": "character-asset",
            "characterId": "mario",
            "slot": "icon",
            "assetSha256": sha256,
        }
    ]
    client = RecordingClient(value)
    downloader = ContentPackDownloader(client, tmp_path)  # type: ignore[arg-type]

    resolved = downloader.resolve(envelope, configuration)

    assert resolved is not None
    asset_path = resolved.directory / "assets" / sha256
    assert asset_path.read_bytes() == value
    assert client.requests == [(envelope["attemptId"], sha256)]
    assert (
        json.loads((resolved.directory / "manifest.json").read_text())["revisionId"]
        == envelope["contentPackRevisionId"]
    )

    assert downloader.resolve(envelope, configuration) is not None
    assert len(client.requests) == 1
    asset_path.write_bytes(b"tampered")
    assert downloader.resolve(envelope, configuration) is not None
    assert len(client.requests) == 2
    assert asset_path.read_bytes() == value


def test_runtime_only_attempt_needs_no_content_download(tmp_path: Path) -> None:
    envelope, configuration = execution_with_content_pack()
    envelope["contentPackRevisionId"] = None
    configuration["contentPack"] = None
    client = RecordingClient(b"unused")

    assert (
        ContentPackDownloader(client, tmp_path).resolve(  # type: ignore[arg-type]
            envelope, configuration
        )
        is None
    )
    assert client.requests == []


def execution_with_content_pack() -> tuple[dict[str, Any], dict[str, Any]]:
    root = Path(__file__).resolve().parents[2] / "contracts/fixtures/valid"
    envelope = json.loads((root / "run-envelope.json").read_text())
    configuration = json.loads((root / "match-configuration-package.json").read_text())
    content_pack = copy.deepcopy(
        json.loads((root / "content-pack-manifest.json").read_text())
    )
    content_pack["adapterVersion"] = configuration["adapterVersion"]
    content_pack["statProfileRevisionId"] = configuration["statProfile"]["revisionId"]
    content_pack["rulesetRevisionId"] = configuration["ruleset"]["revisionId"]
    configuration["contentPack"] = content_pack
    envelope.update(
        {
            "leagueId": configuration["leagueId"],
            "matchId": configuration["matchId"],
            "attemptId": configuration["attemptId"],
            "attemptNonce": configuration["attemptNonce"],
            "contentPackRevisionId": content_pack["revisionId"],
            "statProfileRevisionId": configuration["statProfile"]["revisionId"],
            "rulesetRevisionId": configuration["ruleset"]["revisionId"],
            "teams": [
                {
                    "side": team["side"],
                    "teamId": team["lineup"]["teamId"],
                    "rosterRevisionId": team["lineup"]["rosterRevisionId"],
                    "lineupRevisionId": team["lineup"]["lineupRevisionId"],
                }
                for team in configuration["teams"]
            ],
        }
    )
    return envelope, configuration
