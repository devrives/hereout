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


def test_stairs_are_not_walls():
    img, here, exit_ = draw_plan()
    for y in range(300, 361, 10):  # the treads of a flight of stairs
        cv2.line(img, (560, y), (620, y), (20, 20, 20), 2)
    _, drawn = plan_walls(img)
    assert not [l for l in drawn["lines"] if 290 <= l[1] <= 370 and 550 <= min(l[0], l[2]) and max(l[0], l[2]) <= 630]


def test_a_door_in_blank_paper_stays_open():
    # Two wall pieces with a gap of blank paper, narrower than the join
    # limit (0.6 % of 1600 px): a door. With ink in the gap it is one wall.
    for ink, joined in ((245, False), (20, True)):
        img = np.full((1000, 1600, 3), 245, np.uint8)
        cv2.line(img, (200, 500), (790, 500), (20, 20, 20), 3)
        cv2.line(img, (799, 500), (1400, 500), (20, 20, 20), 3)
        cv2.line(img, (791, 500), (798, 500), (ink, ink, ink), 1)
        _, drawn = plan_walls(img)
        across = [l for l in drawn["lines"] if min(l[0], l[2]) < 780 and max(l[0], l[2]) > 810]
        assert bool(across) == joined


def test_a_wavy_wall_gives_one_line_and_keeps_its_door():
    img = np.full((500, 800, 3), 245, np.uint8)
    cv2.rectangle(img, (40, 40), (760, 460), (20, 20, 20), 6)
    # A wavy wall at x = 300 with a door from y = 200 to 260.
    for y0, y1 in ((46, 200), (260, 454)):
        ys = np.arange(y0, y1)
        pts = np.stack([300 + 12 * np.sin(ys / 40 * 2 * np.pi), ys], 1).astype(np.int32)
        cv2.polylines(img, [pts], False, (20, 20, 20), 5)
    _, drawn = plan_walls(img)
    wavy = [l for l in drawn["lines"] if abs((l[0] + l[2]) / 2 - 300) < 20 and abs(l[1] - l[3]) > 60]
    assert wavy
    assert not [l for l in wavy if min(l[1], l[3]) < 215 and max(l[1], l[3]) > 245]
