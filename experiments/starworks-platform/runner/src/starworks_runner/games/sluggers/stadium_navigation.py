from __future__ import annotations

from collections import deque

# Live-proven directed edges for CMainSelStadiumTask on the complete RMBE01
# save. The selector is not a rectangular grid: opposite directions are not
# always inverses and value 11 is a special tile. Keep this game-owned graph
# separate from the public stadium IDs enforced by the runtime bridge.
STADIUM_SELECTOR_GRAPH: dict[int, dict[str, int]] = {
    0: {"D_LEFT": 0, "D_RIGHT": 3, "D_UP": 7, "D_DOWN": 0},
    2: {"D_LEFT": 7, "D_RIGHT": 2, "D_UP": 5, "D_DOWN": 3},
    3: {"D_LEFT": 0, "D_RIGHT": 3, "D_UP": 2, "D_DOWN": 3},
    4: {"D_LEFT": 4, "D_RIGHT": 8, "D_UP": 11, "D_DOWN": 7},
    5: {"D_LEFT": 8, "D_RIGHT": 5, "D_UP": 5, "D_DOWN": 2},
    7: {"D_LEFT": 7, "D_RIGHT": 2, "D_UP": 4, "D_DOWN": 0},
    8: {"D_LEFT": 4, "D_RIGHT": 5, "D_UP": 11, "D_DOWN": 3},
    11: {"D_LEFT": 11, "D_RIGHT": 8, "D_UP": 11, "D_DOWN": 4},
}

# The reviewed pre-roster checkpoint restores between tiles at sentinel -1.
# A single live-proven Up input enters the ordinary selector graph at tile 8.
STADIUM_SELECTOR_ENTRY_STEPS: dict[int, tuple[str, int]] = {
    -1: ("D_UP", 8),
}


def selector_target_for_stadium(stadium_id: int) -> int:
    """Choose a proven selector tile while the bridge owns the real stadium.

    Values 1 and 6 were not reachable in the live selector graph. Selecting a
    known safe tile lets the menu advance; the bridge still applies and reads
    back the exact scheduled stadium byte before the runner continues.
    """

    return stadium_id if stadium_id in STADIUM_SELECTOR_GRAPH else 0


def stadium_entry_step(selection: int) -> tuple[str, int] | None:
    """Return a proven step from a checkpoint sentinel into the tile graph."""

    return STADIUM_SELECTOR_ENTRY_STEPS.get(selection)


def shortest_stadium_path(start: int, target: int) -> tuple[tuple[str, int], ...]:
    """Return directed controller steps and their expected selector values."""

    if start not in STADIUM_SELECTOR_GRAPH:
        raise ValueError(f"Unknown stadium selector value {start}")
    if target not in STADIUM_SELECTOR_GRAPH:
        raise ValueError(f"Unknown stadium selector target {target}")
    if start == target:
        return ()

    pending: deque[tuple[int, tuple[tuple[str, int], ...]]] = deque([(start, ())])
    visited = {start}
    while pending:
        current, path = pending.popleft()
        for button, destination in STADIUM_SELECTOR_GRAPH[current].items():
            if destination in visited:
                continue
            next_path = (*path, (button, destination))
            if destination == target:
                return next_path
            visited.add(destination)
            pending.append((destination, next_path))
    raise ValueError(f"No stadium selector path from {start} to {target}")
