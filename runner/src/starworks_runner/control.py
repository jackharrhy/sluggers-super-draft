from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol, cast
from urllib.parse import quote

from starworks_runner.contracts import validate_contract


class RunnerApiError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status

    @property
    def retryable(self) -> bool:
        return (
            self.status is None
            or self.status in {408, 425, 429}
            or self.status >= 500
        )


@dataclass(frozen=True)
class HttpResponse:
    status: int
    body: bytes


class HttpTransport(Protocol):
    def request(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes,
        timeout_seconds: float,
    ) -> HttpResponse: ...


class UrlLibHttpTransport:
    def request(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes,
        timeout_seconds: float,
    ) -> HttpResponse:
        request = urllib.request.Request(
            url=url,
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                return HttpResponse(status=response.status, body=response.read())
        except urllib.error.HTTPError as error:
            return HttpResponse(status=error.code, body=error.read())
        except (OSError, urllib.error.URLError) as error:
            raise RunnerApiError(
                f"Starworks runner API is unavailable: {error}"
            ) from error


class RunnerControlClient:
    def __init__(
        self,
        base_url: str,
        bearer_credential: str,
        *,
        timeout_seconds: float = 15.0,
        transport: HttpTransport | None = None,
    ) -> None:
        if not base_url.startswith(("http://", "https://")):
            raise ValueError("Starworks URL must use http or https")
        if not bearer_credential:
            raise ValueError("Runner bearer credential is required")
        self.base_url = base_url.rstrip("/")
        self._credential = bearer_credential
        self.timeout_seconds = timeout_seconds
        self.transport = transport or UrlLibHttpTransport()

    def register(
        self, station_name: str, capabilities: dict[str, Any]
    ) -> dict[str, Any]:
        return self._send(
            "/api/runner/register",
            {
                "kind": "runner-registration-request",
                "stationName": station_name,
                "capabilities": capabilities,
            },
            expected_kind="runner-registration-response",
        )

    def heartbeat(
        self,
        *,
        runner_id: str,
        sent_at: str,
        state: str,
        active_attempt_id: str | None,
        active_lease_id: str | None,
        last_captured_sequence: int | None,
        component_health: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        message: dict[str, Any] = {
            "kind": "runner-heartbeat-request",
            "runnerId": runner_id,
            "sentAt": sent_at,
            "state": state,
            "activeAttemptId": active_attempt_id,
            "activeLeaseId": active_lease_id,
            "lastCapturedSequence": last_captured_sequence,
        }
        if component_health is not None:
            message["components"] = component_health
        return self._send(
            "/api/runner/heartbeat",
            message,
            expected_kind="runner-heartbeat-response",
        )

    def claim(self, runner_id: str) -> dict[str, Any]:
        return self._send(
            "/api/runner/claim",
            {
                "kind": "runner-claim-request",
                "runnerId": runner_id,
            },
            expected_kind="runner-claim-response",
        )

    def update_lease(self, message: dict[str, Any]) -> dict[str, Any]:
        lease_id = message.get("leaseId")
        if not isinstance(lease_id, str):
            raise TypeError("Lease update requires leaseId")
        return self._send(
            f"/api/runner/leases/{quote(lease_id, safe='')}",
            message,
            expected_kind="runner-lease-update-response",
        )

    def configuration(self, attempt_id: str) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/api/runner/attempts/{quote(attempt_id, safe='')}/configuration",
            None,
            response_contract="match-configuration-package",
            expected_kind="match-configuration-package",
        )

    def asset(self, attempt_id: str, asset: dict[str, Any]) -> bytes:
        sha256 = asset.get("sha256")
        size_bytes = asset.get("sizeBytes")
        if (
            not isinstance(sha256, str)
            or len(sha256) != 64
            or any(character not in "0123456789abcdef" for character in sha256)
            or not isinstance(size_bytes, int)
            or isinstance(size_bytes, bool)
            or size_bytes < 0
        ):
            raise TypeError("Content asset reference is invalid")
        response = self.transport.request(
            "GET",
            self.base_url
            + f"/api/runner/attempts/{quote(attempt_id, safe='')}/assets/{sha256}",
            {
                "accept": "application/octet-stream",
                "authorization": f"Bearer {self._credential}",
            },
            b"",
            self.timeout_seconds,
        )
        if not 200 <= response.status < 300:
            try:
                document = json.loads(response.body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                document = None
            error_document = (
                document.get("error") if isinstance(document, dict) else None
            )
            message = (
                error_document.get("message")
                if isinstance(error_document, dict)
                and isinstance(error_document.get("message"), str)
                else f"Starworks runner API returned HTTP {response.status}"
            )
            raise RunnerApiError(message, status=response.status)
        if (
            len(response.body) != size_bytes
            or hashlib.sha256(response.body).hexdigest() != sha256
        ):
            raise RunnerApiError(
                "Downloaded content asset failed integrity verification"
            )
        return response.body

    def upload_telemetry(self, message: dict[str, Any]) -> dict[str, Any]:
        validate_contract("telemetry-upload", message)
        attempt_id = message.get("attemptId")
        if not isinstance(attempt_id, str):
            raise TypeError("Telemetry upload requires attemptId")
        return self._request(
            "POST",
            f"/api/runner/attempts/{quote(attempt_id, safe='')}/telemetry",
            message,
            response_contract="telemetry-upload",
            expected_kind="telemetry-upload-response",
        )

    def _send(
        self,
        path: str,
        message: dict[str, Any],
        *,
        expected_kind: str,
    ) -> dict[str, Any]:
        validate_contract("runner-control", message)
        return self._request(
            "POST",
            path,
            message,
            response_contract="runner-control",
            expected_kind=expected_kind,
        )

    def _request(
        self,
        method: str,
        path: str,
        message: dict[str, Any] | None,
        *,
        response_contract: str,
        expected_kind: str,
    ) -> dict[str, Any]:
        response = self.transport.request(
            method,
            self.base_url + path,
            {
                "accept": "application/json",
                "authorization": f"Bearer {self._credential}",
                "content-type": "application/json",
            },
            (
                json.dumps(message, separators=(",", ":"), sort_keys=True).encode()
                if message is not None
                else b""
            ),
            self.timeout_seconds,
        )
        try:
            document = json.loads(response.body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RunnerApiError(
                "Starworks runner API returned invalid JSON", status=response.status
            ) from error
        if not 200 <= response.status < 300:
            error_document = (
                document.get("error") if isinstance(document, dict) else None
            )
            message_text = (
                error_document.get("message")
                if isinstance(error_document, dict)
                and isinstance(error_document.get("message"), str)
                else f"Starworks runner API returned HTTP {response.status}"
            )
            raise RunnerApiError(message_text, status=response.status)
        if not isinstance(document, dict):
            raise RunnerApiError("Starworks runner API returned a non-object response")
        try:
            validate_contract(response_contract, document)  # type: ignore[arg-type]
        except Exception as error:
            raise RunnerApiError(
                "Starworks runner API returned an invalid control message"
            ) from error
        if document.get("kind") != expected_kind:
            raise RunnerApiError(
                f"Expected {expected_kind}, received {document.get('kind')!r}"
            )
        return cast(dict[str, Any], document)
