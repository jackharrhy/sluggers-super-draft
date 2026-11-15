from __future__ import annotations

import pytest
from starworks_runner.games.sluggers.stadium_navigation import (
    STADIUM_SELECTOR_GRAPH,
    selector_target_for_stadium,
    shortest_stadium_path,
    stadium_entry_step,
)


@pytest.mark.parametrize("start", STADIUM_SELECTOR_GRAPH)
@pytest.mark.parametrize("target", STADIUM_SELECTOR_GRAPH)
def test_every_proven_stadium_selector_value_is_reachable(
    start: int, target: int
) -> None:
    current = start
    for button, expected in shortest_stadium_path(start, target):
        current = STADIUM_SELECTOR_GRAPH[current][button]
        assert current == expected

    assert current == target


def test_unproven_stadium_ids_use_the_safe_selector_tile() -> None:
    assert selector_target_for_stadium(1) == 0
    assert selector_target_for_stadium(6) == 0
    assert selector_target_for_stadium(8) == 8


def test_checkpoint_sentinel_has_one_live_proven_entry_step() -> None:
    assert stadium_entry_step(-1) == ("D_UP", 8)
    assert stadium_entry_step(0) is None


def test_unknown_selector_state_fails_closed() -> None:
    with pytest.raises(ValueError, match="Unknown stadium selector value 9"):
        shortest_stadium_path(9, 0)
