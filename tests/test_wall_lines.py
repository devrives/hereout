"""Walls as straight lines: the drawn plan gives its walls, keeps its doors, and drops text."""

import cv2
import numpy as np

from hereout.route import Field, blocked_grid
from hereout.wall_lines import plan_walls

from conftest import draw_plan


def near(line, x0, y0, x1, y1, tol=12):
    a, b = np.array(line[:2]), np.array(line[2:4])
    p, q = np.array([x0, y0]), np.array([x1, y1])
    return (np.abs(a - p).max() <= tol and np.abs(b - q).max() <= tol) or \
           (np.abs(a - q).max() <= tol and np.abs(b - p).max() <= tol)


def test_walls_of_the_drawn_plan():
    img, here, exit_ = draw_plan()
    walls, drawn = plan_walls(img)
    lines = drawn["lines"]
    assert any(near(l, 40, 40, 760, 40) for l in lines)       # top wall
    assert any(near(l, 400, 190, 400, 460) for l in lines)    # inner wall below its door
    # No line closes the door in the inner wall or covers the text.
    door = [l for l in lines if abs(l[0] - 400) < 12 and abs(l[2] - 400) < 12]
    assert all(min(l[1], l[3]) >= 125 or max(l[1], l[3]) <= 135 for l in door)
    assert not walls[300, 150:200].any()
    # The routing grid from the lines still has the way through the door.
    blocked, scale = blocked_grid(walls)
    assert Field(blocked, scale, [exit_]).route(here).exit_index == 0


def test_a_closed_door_has_no_way():
    img, here, exit_ = draw_plan()
    cv2.line(img, (400, 130), (400, 190), (20, 20, 20), 8)
    walls, _ = plan_walls(img)
    blocked, scale = blocked_grid(walls)
    f = Field(blocked, scale, [exit_])
    try:
        f.route(here)
    except Exception as e:
        assert str(e) == "no open way to an exit"
        return
    raise AssertionError("expected no route")
