from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from starworks_runner.control import (
    HttpResponse,
    RunnerApiError,
    RunnerControlClient,
)


class FakeTransport:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.response = HttpResponse(
            status=201,
            body=json.dumps(
                {
                    "schemaVersion": 1,
                    "kind": "runner-registration-response",
                    "runnerId": "11111111-1111-4111-8111-111111111111",
                    "heartbeatSeconds": 15,
                    "leaseSeconds": 60,
                }
            ).encode(),
        )

    def request(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes,
        timeout_seconds: float,
    ) -> HttpResponse:
        self.requests.append(
            {
                "method": method,
                "url": url,
                "headers": headers,
                "body": json.loads(body) if body else None,
                "timeout": timeout_seconds,
            }
        )
        return self.response


def test_registration_uses_versioned_json_and_keeps_credential_in_header() -> None:
    transport = FakeTransport()
    client = RunnerControlClient(
        "https://starworks.example/",
        "secret-runner-credential",
        transport=transport,
    )

    response = client.register(
        "Broadcast desk",
        {
            "architecture": "arm64",
            "operatingSystem": "macos",
            "runnerVersion": "0.1.0",
            "adapterIds": ["sluggers-rmbe01"],
            "features": ["launch-dolphin"],
            "dolphinVersion": "2603",
        },
    )

    assert response["runnerId"] == "11111111-1111-4111-8111-111111111111"
    request = transport.requests[0]
    assert request["url"] == "https://starworks.example/api/v1/runner/register"
    assert request["headers"]["authorization"] == "Bearer secret-runner-credential"
    assert "secret-runner-credential" not in json.dumps(request["body"])
    assert request["body"]["kind"] == "runner-registration-request"


def test_api_errors_preserve_status_and_server_message() -> None:
    transport = FakeTransport()
    transport.response = HttpResponse(
        status=409,
        body=json.dumps(
            {"error": {"code": "conflict", "message": "Lease expired"}}
        ).encode(),
    )
    client = RunnerControlClient(
        "http://localhost:3000", "credential", transport=transport
    )

    with pytest.raises(RunnerApiError, match="Lease expired") as captured:
        client.claim("11111111-1111-4111-8111-111111111111")

    assert captured.value.status == 409


def test_configuration_download_is_scoped_to_an_attempt() -> None:
    transport = FakeTransport()
    fixture_path = (
        Path(__file__).resolve().parents[2]
        / "contracts/fixtures/valid/match-configuration-package.json"
    )
    configuration = json.loads(fixture_path.read_text(encoding="utf-8"))
    transport.response = HttpResponse(
        status=200,
        body=json.dumps(configuration).encode(),
    )
    client = RunnerControlClient(
        "https://starworks.example", "credential", transport=transport
    )

    received = client.configuration(configuration["attemptId"])

    assert received == configuration
    assert transport.requests[0]["method"] == "GET"
    assert transport.requests[0]["body"] is None
    assert transport.requests[0]["url"].endswith(
        f"/attempts/{configuration['attemptId']}/configuration"
    )


def test_telemetry_upload_uses_the_shared_batch_contract() -> None:
    root = Path(__file__).resolve().parents[2] / "contracts/fixtures/valid"
    upload = json.loads((root / "telemetry-upload.json").read_text(encoding="utf-8"))
    transport = FakeTransport()
    transport.response = HttpResponse(
        status=200,
        body=json.dumps(
            {
                "schemaVersion": 1,
                "kind": "telemetry-upload-response",
                "attemptId": upload["attemptId"],
                "acceptedSequences": [1],
                "duplicateSequences": [],
                "nextExpectedSequence": 2,
                "maxAcceptedSequence": 1,
                "requiresReview": False,
                "issues": [],
            }
        ).encode(),
    )
    client = RunnerControlClient(
        "https://starworks.example", "credential", transport=transport
    )

    response = client.upload_telemetry(upload)

    assert response["acceptedSequences"] == [1]
    assert transport.requests[0]["body"] == upload
    assert transport.requests[0]["url"].endswith(
        f"/attempts/{upload['attemptId']}/telemetry"
    )
