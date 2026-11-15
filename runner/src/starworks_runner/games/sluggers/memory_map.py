from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from starworks_runner.games.sluggers.bridge.layout import (
    BRIDGE_BASE_ADDRESS,
    BRIDGE_REGION_SIZE,
)
from starworks_runner.games.sluggers.errors import BuildIntegrityError


def parse_address(value: str) -> int:
    if not isinstance(value, str) or not value.startswith("0x"):
        raise BuildIntegrityError(f"Memory address must be 0x-prefixed: {value!r}")
    try:
        return int(value, 16)
    except ValueError as error:
        raise BuildIntegrityError(f"Invalid memory address {value!r}") from error


@dataclass(frozen=True)
class MemoryRange:
    identifier: str
    start: int
    end_exclusive: int
    category: str

    @property
    def size(self) -> int:
        return self.end_exclusive - self.start

    def overlaps(self, other: MemoryRange) -> bool:
        return self.start < other.end_exclusive and other.start < self.end_exclusive


@dataclass(frozen=True)
class MemoryMap:
    address_space: MemoryRange
    known_allocations: tuple[MemoryRange, ...]
    reservations: tuple[MemoryRange, ...]
    raw: dict[str, Any]

    @classmethod
    def load(cls, path: Path | None = None) -> MemoryMap:
        manifest_path = path or Path(__file__).with_name("memory_map.json")
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        space = raw["addressSpace"]
        address_space = MemoryRange(
            identifier="wii-mem1",
            start=parse_address(space["start"]),
            end_exclusive=parse_address(space["endExclusive"]),
            category="address-space",
        )

        def create_range(item: dict[str, Any], category: str) -> MemoryRange:
            return MemoryRange(
                identifier=item["id"],
                start=parse_address(item["start"]),
                end_exclusive=parse_address(item["endExclusive"]),
                category=category,
            )

        memory_map = cls(
            address_space=address_space,
            known_allocations=tuple(
                create_range(item, "known-allocation")
                for item in raw["knownAllocations"]
            ),
            reservations=tuple(
                create_range(item, "reservation") for item in raw["reservations"]
            ),
            raw=raw,
        )
        memory_map.validate()
        return memory_map

    def validate(self) -> None:
        all_ranges = (*self.known_allocations, *self.reservations)
        for item in all_ranges:
            if item.start >= item.end_exclusive:
                raise BuildIntegrityError(
                    f"Memory range {item.identifier} is empty or backwards"
                )
            if (
                item.start < self.address_space.start
                or item.end_exclusive > self.address_space.end_exclusive
            ):
                raise BuildIntegrityError(
                    f"Memory range {item.identifier} leaves the declared address space"
                )
        for index, left in enumerate(all_ranges):
            for right in all_ranges[index + 1 :]:
                if left.overlaps(right):
                    raise BuildIntegrityError(
                        f"Memory ranges overlap: {left.identifier} and {right.identifier}"
                    )
        bridge = next(
            (
                item
                for item in self.reservations
                if item.identifier == "starworks-bridge"
            ),
            None,
        )
        if bridge is None:
            raise BuildIntegrityError("Memory map has no starworks-bridge reservation")
        if bridge.start != BRIDGE_BASE_ADDRESS or bridge.size != BRIDGE_REGION_SIZE:
            raise BuildIntegrityError(
                "Bridge protocol constants disagree with the memory-map reservation"
            )
