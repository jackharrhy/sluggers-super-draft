from __future__ import annotations

import json
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
                "body": json.loads(body),
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
