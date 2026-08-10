from __future__ import annotations

from starworks_runner.desktop import native_capabilities


def test_native_capabilities_are_safe_declarative_metadata() -> None:
    capabilities = native_capabilities(dolphin_version="2603")

    assert capabilities["architecture"] in ("arm64", "x64")
    assert capabilities["operatingSystem"] in ("linux", "macos", "windows")
    assert capabilities["adapterIds"] == ["sluggers-rmbe01"]
    assert "launch-dolphin" in capabilities["features"]
    assert capabilities["dolphinVersion"] == "2603"
