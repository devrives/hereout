"""Walls from all drawn ink (ink_walls.py) and the legend check (legend.py)."""

import cv2
import numpy as np

from hereout.ink_walls import door_arcs, footprints, ink_walls, split_strokes
from hereout.legend import drop_legend_exits
from hereout.route import Field, NoRoute, blocked_grid, soft_grid

PAPER, BLACK = (245, 245, 245), (20, 20, 20)


def route(walls, soft, start, exit_):
    blocked, scale = blocked_grid(walls)
    return Field(blocked, scale, [exit_], soft=soft_grid(soft, blocked)).route(start)


def room_with_door(arc=True):
    """A room 800 x 500 with thick walls; the right wall has a door drawn as a thin
    closed line with a door swing (a quarter arc and a leaf) inside the room."""
    img = np.full((600, 900, 3), PAPER, np.uint8)
    cv2.rectangle(img, (50, 50), (850, 550), BLACK, 10)
    # The doorway: a gap in the thick wall, closed by a thin sill line.
    cv2.rectangle(img, (840, 280), (860, 330), PAPER, -1)
    cv2.line(img, (850, 280), (850, 330), BLACK, 2)
    if arc:
        cv2.ellipse(img, (850, 330), (50, 50), 0, 180, 270, BLACK, 2)  # swing, hinge at (850, 330)
        cv2.line(img, (850, 330), (800, 330), BLACK, 2)                # open leaf
    return img


def test_thick_walls_are_hard_and_a_stub_is_soft():
    img = np.full((600, 900, 3), PAPER, np.uint8)
    cv2.rectangle(img, (50, 50), (850, 550), BLACK, 10)
    cv2.line(img, (300, 55), (300, 200), BLACK, 2)   # a thin stub: one end on a wall
    cv2.line(img, (500, 55), (500, 545), BLACK, 2)   # a thin partition: both ends on walls
    ink = np.all(img < 100, axis=2)
    hard, thin = split_strokes(ink)
    assert hard[300, 50] and hard[50, 400]
    assert not hard[150, 300] and thin[150, 300]
    assert hard[300, 500]


def test_door_arc_is_found():
    ink = np.all(room_with_door() < 100, axis=2)
    _, thin = split_strokes(ink)
    arcs = door_arcs(thin)
    assert any(abs(cx - 850) < 8 and abs(cy - 330) < 8 and 40 < r < 60 for (cx, cy), r, _, _ in arcs)


def test_door_swing_opens_the_room():
    img = room_with_door()
    hard, soft = ink_walls(img, boxes=[])
    r = route(hard, soft, (400, 300), (880, 305))
    assert r.exit_index == 0


def test_closed_wall_has_no_way():
    img = np.full((600, 900, 3), PAPER, np.uint8)
    cv2.rectangle(img, (50, 50), (850, 550), BLACK, 10)
    cv2.line(img, (450, 50), (450, 550), BLACK, 10)
    hard, soft = ink_walls(img, boxes=[])
    try:
        route(hard, soft, (250, 300), (650, 300))
    except NoRoute:
        return
    raise AssertionError("expected NoRoute")


def test_paper_between_two_drawings_is_closed():
    img = np.full((500, 1000, 3), PAPER, np.uint8)
    cv2.rectangle(img, (40, 40), (440, 460), BLACK, 8)
    cv2.rectangle(img, (560, 40), (960, 460), BLACK, 8)
    walls = np.all(img < 100, axis=2)
    fp = footprints(walls)
    assert fp[250, 240] and fp[250, 760]
    assert not fp[250, 500] and not fp[10, 10]


def test_legend_exit_is_dropped():
    img = np.full((800, 1000, 3), PAPER, np.uint8)
    cv2.rectangle(img, (40, 40), (600, 760), BLACK, 6)    # the floor drawing
    cv2.rectangle(img, (660, 300), (960, 700), BLACK, 3)  # the legend box
    text = [[[700, y], [900, y], [900, y + 20], [700, y + 20]] for y in range(330, 650, 70)]
    exits = [{"x": 600, "y": 400, "label": "A"}, {"x": 720, "y": 360, "label": "B"}]
    kept = drop_legend_exits(img, text, exits, plan_box=(40, 40, 600, 760))
    assert [e["label"] for e in kept] == ["A"]
    # At least one exit stays.
    assert drop_legend_exits(img, text, exits[1:], plan_box=(40, 40, 600, 760)) == exits[1:]
