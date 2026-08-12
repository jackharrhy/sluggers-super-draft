from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from starworks_runner.games.sluggers.bridge.configuration import (
    CHARACTER_GAME_IDS,
    CONFIGURATION_SIZE,
    STADIUM_IDS,
    RuntimeConfigurationBlock,
)
from starworks_runner.games.sluggers.bridge.layout import BridgeProtocolError
from starworks_runner.games.sluggers.session import (
    FINAL_FORMATION_POINTER_ADDRESS,
    FORMATION_SLOT_SIZE,
    FORMATION_TEAM_SIZE,
    LiveSluggersSession,
)
from starworks_runner.match_configuration import compile_match_configuration


def compiled_configuration():
    fixture = (
        Path(__file__).resolve().parents[2]
        / "contracts/fixtures/valid/match-configuration-package.json"
    )
    configuration = json.loads(fixture.read_text(encoding="utf-8"))
    return configuration, compile_match_configuration(configuration)


def test_symbolic_match_configuration_packs_into_the_bounded_bridge_block() -> None:
    _, compiled = compiled_configuration()

    block = RuntimeConfigurationBlock.from_operation_bundles(
        compiled.home,
        compiled.away,
    )
    packed = block.pack()

    assert len(packed) == CONFIGURATION_SIZE
    assert RuntimeConfigurationBlock.unpack(packed) == block
    assert block.rules == (7, 0xFF, 0xFF, 0xFF)
    assert [entry[0] for entry in block.home.entries] == [0, 1, 4, 5, 6, 17, 13, 15, 9]
    assert block.home.captain_brand_id == 0
    assert block.execution_mode == 1
    assert block.stadium_id == 0


def test_runtime_override_and_imported_character_aliases_are_resolved() -> None:
    configuration, _ = compiled_configuration()
    configuration["dynamicRuleOverrides"] = {"game.innings": 7}
    for team in configuration["teams"]:
        lineup = team["lineup"]
        remap = {
            value: f"rmbe01-character-{CHARACTER_GAME_IDS[value]:03d}"
            for value in lineup["rosterCharacterIds"]
        }
        lineup["rosterCharacterIds"] = [
            remap[value] for value in lineup["rosterCharacterIds"]
        ]
        lineup["lineup"]["captainCharacterId"] = remap[
            lineup["lineup"]["captainCharacterId"]
        ]
        lineup["lineup"]["pitcherCharacterId"] = remap[
            lineup["lineup"]["pitcherCharacterId"]
        ]
        lineup["lineup"]["battingOrder"] = [
            remap[value] for value in lineup["lineup"]["battingOrder"]
        ]
        lineup["lineup"]["bench"] = [
            remap[value] for value in lineup["lineup"]["bench"]
        ]
        for assignment in lineup["lineup"]["fielding"]:
            assignment["characterId"] = remap[assignment["characterId"]]
    compiled = compile_match_configuration(configuration)

    block = RuntimeConfigurationBlock.from_operation_bundles(
        compiled.home,
        compiled.away,
    )

    assert block.rules[0] == 7
    assert block.home.entries[0][0] == 0


def test_unknown_characters_and_rule_targets_fail_before_dolphin_launch() -> None:
    _, compiled = compiled_configuration()
    unknown_character = copy.deepcopy(compiled.home)
    next(
        operation
        for operation in unknown_character["operations"]
        if operation["operation"] == "set-batting-slot"
    )["characterId"] = "not-a-reviewed-character"

    with pytest.raises(BridgeProtocolError, match="batting and fielding"):
        RuntimeConfigurationBlock.from_operation_bundles(
            unknown_character,
            compiled.away,
        )

    unknown_rule = copy.deepcopy(compiled.home)
    next(
        operation
        for operation in unknown_rule["operations"]
        if operation["operation"] == "set-game-rule"
    )["gameplayTarget"] = "rules.unmapped"
    with pytest.raises(BridgeProtocolError, match="Unsupported runtime rule"):
        RuntimeConfigurationBlock.from_operation_bundles(unknown_rule, compiled.away)


def test_execution_and_stadium_are_bounded_before_dolphin_launch() -> None:
    configuration, compiled = compiled_configuration()
    execution = copy.deepcopy(configuration["execution"])
    execution["stadium"]["gameStadiumId"] = "unreviewed-stadium"
    with pytest.raises(BridgeProtocolError, match="stadium"):
        RuntimeConfigurationBlock.from_operation_bundles(
            compiled.home,
            compiled.away,
            execution=execution,
        )


def test_stadium_ids_match_the_reviewed_rmbe01_runtime_order() -> None:
    assert STADIUM_IDS == {
        "mario-stadium": 0,
        "bowser-castle": 1,
        "wario-city": 2,
        "yoshi-park": 3,
        "peach-ice-garden": 4,
        "dk-jungle": 5,
        "luigis-mansion": 6,
        "daisy-cruiser": 7,
        "bowser-jr-playroom": 8,
    }


class SparseMemoryTransport:
    def __init__(self) -> None:
        self.memory: dict[int, int] = {}

    def read(self, address: int, size: int) -> bytes:
        return bytes(self.memory.get(address + offset, 0) for offset in range(size))

    def write(self, address: int, value: bytes) -> None:
        self.memory.update(
            {address + offset: byte for offset, byte in enumerate(value)}
        )


def test_final_formation_rewrites_only_character_and_position_bytes(
    tmp_path: Path,
) -> None:
    _, compiled = compiled_configuration()
    configuration = RuntimeConfigurationBlock.from_operation_bundles(
        compiled.home,
        compiled.away,
    )
    transport = SparseMemoryTransport()
    home_address = 0x90001090
    transport.write(FINAL_FORMATION_POINTER_ADDRESS, home_address.to_bytes(4, "big"))
    for team, address, untouched in (
        (configuration.away, home_address - FORMATION_TEAM_SIZE, 0xA5),
        (configuration.home, home_address, 0x5A),
    ):
        initial = bytearray([untouched]) * FORMATION_TEAM_SIZE
        for game_id, batting_slot, fielding_position in reversed(team.entries):
            random_slot = 8 - batting_slot
            offset = random_slot * FORMATION_SLOT_SIZE
            initial[offset + 1] = game_id
            initial[offset + 12] = fielding_position
        transport.write(address, bytes(initial))
    session = LiveSluggersSession(
        build_directory=tmp_path,
        dolphin_executable=tmp_path / "Dolphin",
        profile_directory=tmp_path / "profile",
        adapter_build_sha256="a" * 64,
        game_build_sha256="b" * 64,
    )
    session.transport = transport  # type: ignore[assignment]

    session.apply_final_formation(configuration)

    for team, address, untouched in (
        (configuration.away, home_address - FORMATION_TEAM_SIZE, 0xA5),
        (configuration.home, home_address, 0x5A),
    ):
        observed = transport.read(address, FORMATION_TEAM_SIZE)
        for game_id, batting_slot, fielding_position in team.entries:
            offset = batting_slot * FORMATION_SLOT_SIZE
            assert observed[offset + 1] == game_id
            assert observed[offset + 12] == fielding_position
            assert observed[offset] == untouched
