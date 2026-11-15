from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Any

from starworks_runner.games.sluggers.bridge.layout import BridgeProtocolError

CONFIGURATION_MAGIC = b"SWC1"
CONFIGURATION_VERSION = 1
CONFIGURATION_OFFSET = 0xA8
CONFIGURATION_SIZE = 88
UNSET_RULE = 0xFF

CONFIGURATION_STRUCT = struct.Struct(">4sHHIIII4B2B2x27s27s2B")

EXECUTION_MODES = {"cpu-vs-cpu": 1}
STADIUM_IDS = {
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

FIELDING_POSITION_IDS = {
    "P": 0,
    "C": 1,
    "1B": 2,
    "2B": 3,
    "3B": 4,
    "SS": 5,
    "LF": 6,
    "CF": 7,
    "RF": 8,
}

# Clean-room symbolic names paired with the numeric roster order documented by
# MSS-AutoTeam. The generated rmbe01-character-NNN aliases preserve imported
# legacy catalogs without making their JSON format part of this protocol.
CHARACTER_IDS = (
    "mario",
    "luigi",
    "donkey-kong",
    "diddy-kong",
    "peach",
    "daisy",
    "yoshi",
    "baby-mario",
    "baby-luigi",
    "bowser",
    "wario",
    "waluigi",
    "green-koopa-troopa",
    "toad",
    "boo",
    "toadette",
    "red-shy-guy",
    "birdo",
    "monty-mole",
    "bowser-jr",
    "red-koopa-paratroopa",
    "blue-pianta",
    "red-pianta",
    "yellow-pianta",
    "blue-noki",
    "red-noki",
    "green-noki",
    "hammer-bro",
    "toadsworth",
    "blue-toad",
    "yellow-toad",
    "green-toad",
    "purple-toad",
    "blue-magikoopa",
    "red-magikoopa",
    "green-magikoopa",
    "yellow-magikoopa",
    "king-boo",
    "petey-piranha",
    "dixie-kong",
    "goomba",
    "paragoomba",
    "red-koopa-troopa",
    "green-koopa-paratroopa",
    "blue-shy-guy",
    "yellow-shy-guy",
    "green-shy-guy",
    "gray-shy-guy",
    "gray-dry-bones",
    "green-dry-bones",
    "dark-bones",
    "blue-dry-bones",
    "fire-bro",
    "boomerang-bro",
    "wiggler",
    "blooper",
    "funky-kong",
    "tiny-kong",
    "green-kritter",
    "blue-kritter",
    "red-kritter",
    "brown-kritter",
    "king-k-rool",
    "baby-peach",
    "baby-daisy",
    "baby-dk",
    "red-yoshi",
    "blue-yoshi",
    "yellow-yoshi",
    "light-blue-yoshi",
    "pink-yoshi",
    "unused-yoshi-2",
    "unused-yoshi",
    "unused-toad",
    "unused-pianta",
    "unused-kritter",
    "unused-koopa",
)

# Exact RMBE01 roster indices 0..70 are selectable built-in characters.
# MSS-AutoTeam's table continues through 76 because the DOL contains six
# unused records; those records are useful to preserve in the stat catalog but
# must never enter a live formation. Miis begin at 77 and are profile-local, so
# they require a separate station identity mapping rather than this table.
PLAYABLE_CHARACTER_COUNT = 71

CHARACTER_GAME_IDS = {
    **{character_id: index for index, character_id in enumerate(CHARACTER_IDS)},
    **{f"rmbe01-character-{index:03d}": index for index in range(len(CHARACTER_IDS))},
}
CHARACTER_GAME_IDS.update(
    {
        "green-yoshi": 6,
        "red-toad": 13,
        "shy-guy": 16,
        "dry-bones": 48,
        "koopa": 12,
        "koopa-troopa": 12,
        "koopa-paratroopa": 20,
        "pianta": 21,
        "noki": 24,
        "magikoopa": 33,
        "kritter": 58,
    }
)

CAPTAIN_BRAND_IDS = {
    character_id: brand_index
    for brand_index, character_id in enumerate(
        (
            "mario",
            "luigi",
            "donkey-kong",
            "diddy-kong",
            "peach",
            "daisy",
            "yoshi",
            "bowser",
            "wario",
            "waluigi",
            "birdo",
            "bowser-jr",
        )
    )
}
CAPTAIN_BRAND_IDS.update(
    {
        f"rmbe01-character-{CHARACTER_GAME_IDS[character_id]:03d}": brand_index
        for character_id, brand_index in tuple(CAPTAIN_BRAND_IDS.items())
    }
)
CAPTAIN_BRAND_IDS["green-yoshi"] = CAPTAIN_BRAND_IDS["yoshi"]

RUNTIME_RULES = {
    "rules.innings": (0, 1, 99),
    "rules.mercy": (1, 0, 1),
    "rules.stars": (2, 0, 1),
    "rules.items": (3, 0, 1),
}


@dataclass(frozen=True)
class TeamSelection:
    captain_brand_id: int
    entries: tuple[tuple[int, int, int], ...]

    def pack(self) -> bytes:
        if len(self.entries) != 9:
            raise BridgeProtocolError(
                "A Sluggers team must contain nine active players"
            )
        value = bytearray()
        batting_slots: set[int] = set()
        fielding_positions: set[int] = set()
        for game_id, batting_slot, fielding_position in self.entries:
            if not 0 <= game_id < PLAYABLE_CHARACTER_COUNT:
                raise BridgeProtocolError(
                    "Lineup contains a character that is not playable in RMBE01"
                )
            if not 0 <= batting_slot < 9 or batting_slot in batting_slots:
                raise BridgeProtocolError(
                    "Lineup batting slots must be unique and bounded"
                )
            if (
                not 0 <= fielding_position < 9
                or fielding_position in fielding_positions
            ):
                raise BridgeProtocolError(
                    "Lineup fielding positions must be unique and bounded"
                )
            batting_slots.add(batting_slot)
            fielding_positions.add(fielding_position)
            value.extend((game_id, batting_slot, fielding_position))
        return bytes(value)


@dataclass(frozen=True)
class RuntimeConfigurationBlock:
    requested_epoch: int
    runtime_applied_epoch: int
    lineup_applied_epoch: int
    lineup_applied_mask: int
    rules: tuple[int, int, int, int]
    away: TeamSelection
    home: TeamSelection
    execution_mode: int
    stadium_id: int

    @classmethod
    def from_operation_bundles(
        cls,
        home_bundle: dict[str, Any],
        away_bundle: dict[str, Any],
        *,
        execution: dict[str, Any] | None = None,
        requested_epoch: int = 1,
    ) -> RuntimeConfigurationBlock:
        if not 1 <= requested_epoch <= 0xFFFFFFFF:
            raise BridgeProtocolError("Runtime configuration epoch must be positive")
        home_rules = _compile_rules(home_bundle)
        away_rules = _compile_rules(away_bundle)
        if home_rules != away_rules:
            raise BridgeProtocolError(
                "Home and away operation bundles disagree on rules"
            )
        selected_execution = execution or {
            "mode": "cpu-vs-cpu",
            "stadium": {"gameStadiumId": "mario-stadium"},
        }
        execution_mode = EXECUTION_MODES.get(selected_execution.get("mode"))
        if execution_mode is None:
            raise BridgeProtocolError("Unsupported Sluggers execution mode")
        stadium = selected_execution.get("stadium")
        if not isinstance(stadium, dict):
            raise BridgeProtocolError("Sluggers execution has no stadium selection")
        stadium_id = STADIUM_IDS.get(stadium.get("gameStadiumId"))
        if stadium_id is None:
            raise BridgeProtocolError("Unsupported Sluggers stadium")
        return cls(
            requested_epoch=requested_epoch,
            runtime_applied_epoch=0,
            lineup_applied_epoch=0,
            lineup_applied_mask=0,
            rules=home_rules,
            away=_compile_team(away_bundle),
            home=_compile_team(home_bundle),
            execution_mode=execution_mode,
            stadium_id=stadium_id,
        )

    @classmethod
    def unpack(cls, value: bytes) -> RuntimeConfigurationBlock:
        if len(value) != CONFIGURATION_SIZE:
            raise BridgeProtocolError(
                f"Runtime configuration must be {CONFIGURATION_SIZE} bytes"
            )
        unpacked = CONFIGURATION_STRUCT.unpack(value)
        magic, version, size = unpacked[:3]
        if magic != CONFIGURATION_MAGIC or version != CONFIGURATION_VERSION:
            raise BridgeProtocolError("Runtime configuration identity is invalid")
        if size != CONFIGURATION_SIZE:
            raise BridgeProtocolError("Runtime configuration size is invalid")
        away = TeamSelection(unpacked[11], _unpack_team(unpacked[13]))
        home = TeamSelection(unpacked[12], _unpack_team(unpacked[14]))
        return cls(
            requested_epoch=unpacked[3],
            runtime_applied_epoch=unpacked[4],
            lineup_applied_epoch=unpacked[5],
            lineup_applied_mask=unpacked[6],
            rules=tuple(unpacked[7:11]),  # type: ignore[arg-type]
            away=away,
            home=home,
            execution_mode=unpacked[15],
            stadium_id=unpacked[16],
        )

    def pack(self) -> bytes:
        if len(self.rules) != 4 or any(not 0 <= value <= 0xFF for value in self.rules):
            raise BridgeProtocolError("Runtime rules must contain four bytes")
        if not 0 <= self.away.captain_brand_id <= 11:
            raise BridgeProtocolError(
                "Away captain is not a supported Sluggers captain"
            )
        if not 0 <= self.home.captain_brand_id <= 11:
            raise BridgeProtocolError(
                "Home captain is not a supported Sluggers captain"
            )
        if self.execution_mode not in EXECUTION_MODES.values():
            raise BridgeProtocolError("Runtime execution mode is unsupported")
        if self.stadium_id not in STADIUM_IDS.values():
            raise BridgeProtocolError("Runtime stadium is unsupported")
        return CONFIGURATION_STRUCT.pack(
            CONFIGURATION_MAGIC,
            CONFIGURATION_VERSION,
            CONFIGURATION_SIZE,
            self.requested_epoch,
            self.runtime_applied_epoch,
            self.lineup_applied_epoch,
            self.lineup_applied_mask,
            *self.rules,
            self.away.captain_brand_id,
            self.home.captain_brand_id,
            self.away.pack(),
            self.home.pack(),
            self.execution_mode,
            self.stadium_id,
        )


def _compile_rules(bundle: dict[str, Any]) -> tuple[int, int, int, int]:
    rules = [UNSET_RULE] * 4
    for operation in bundle["operations"]:
        if (
            operation["operation"] != "set-game-rule"
            or operation["loadPhase"] != "runtime"
        ):
            continue
        target = RUNTIME_RULES.get(operation["gameplayTarget"])
        if target is None:
            raise BridgeProtocolError(
                f"Unsupported runtime rule target {operation['gameplayTarget']}"
            )
        slot, minimum, maximum = target
        value = operation["value"]
        if isinstance(value, bool):
            value = int(value)
        if not isinstance(value, int) or not minimum <= value <= maximum:
            raise BridgeProtocolError(
                f"Runtime rule {operation['ruleKey']} is outside its supported range"
            )
        rules[slot] = value
    return tuple(rules)  # type: ignore[return-value]


def _compile_team(bundle: dict[str, Any]) -> TeamSelection:
    operations = bundle["operations"]
    captain_operations = [
        operation for operation in operations if operation["operation"] == "set-captain"
    ]
    if len(captain_operations) != 1:
        raise BridgeProtocolError("Lineup must select exactly one captain")
    captain_id = captain_operations[0]["characterId"]
    captain_brand_id = CAPTAIN_BRAND_IDS.get(captain_id)
    if captain_brand_id is None:
        raise BridgeProtocolError(
            f"Captain {captain_id} is not a supported Sluggers captain"
        )

    batting = {
        operation["characterId"]: operation["slot"] - 1
        for operation in operations
        if operation["operation"] == "set-batting-slot"
    }
    fielding = {
        operation["characterId"]: FIELDING_POSITION_IDS[operation["position"]]
        for operation in operations
        if operation["operation"] == "set-fielding-position"
    }
    if len(batting) != 9 or set(batting) != set(fielding):
        raise BridgeProtocolError("Lineup batting and fielding assignments must match")
    entries = []
    for character_id, batting_slot in sorted(batting.items(), key=lambda item: item[1]):
        game_id = CHARACTER_GAME_IDS.get(character_id)
        if game_id is None:
            raise BridgeProtocolError(
                f"Character {character_id} has no reviewed RMBE01 roster mapping"
            )
        if game_id >= PLAYABLE_CHARACTER_COUNT:
            raise BridgeProtocolError(
                f"Character {character_id} is not playable in RMBE01"
            )
        entries.append((game_id, batting_slot, fielding[character_id]))
    return TeamSelection(captain_brand_id, tuple(entries))


def _unpack_team(value: bytes) -> tuple[tuple[int, int, int], ...]:
    if len(value) != 27:
        raise BridgeProtocolError("Packed team selection must contain 27 bytes")
    return tuple(tuple(value[index : index + 3]) for index in range(0, 27, 3))  # type: ignore[return-value]


assert CONFIGURATION_STRUCT.size == CONFIGURATION_SIZE
