"""Walls as straight lines: the drawn plan gives its walls, keeps its doors, and drops text."""

import base64
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest

from hereout.route import Field, blocked_grid
from hereout.wall_lines import _contrast, _drop_coloured, plan_walls

from conftest import draw_plan
from test_route_parity import NODE


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


def test_a_printed_route_line_is_not_a_wall():
    # A dull red route line across a room: walls.py keeps its ink (not
    # saturated enough for a sign), but it is much more coloured than the
    # black walls, so it is no wall line.
    img, here, exit_ = draw_plan()
    cv2.line(img, (100, 300), (360, 300), (80, 80, 150), 4)
    _, drawn = plan_walls(img)
    assert not [l for l in drawn["lines"] if 290 <= l[1] <= 310 and 290 <= l[3] <= 310]



def test_a_black_wall_beside_a_painted_area_stays():
    # In a photo a thin black wall beside a green painted area takes on some
    # of the green. The colour peaks in the paint, not on the wall line, so
    # the wall stays. A red line on paper peaks on the line and goes.
    img = np.full((400, 600, 3), 245, np.uint8)
    for y in (50, 350):
        cv2.line(img, (50, y), (550, y), (30, 30, 30), 3)               # usual walls
    img[60:340, 200:203] = (70, 110, 70)                               # wall tinted by the paint
    img[60:340, 203:300] = (60, 175, 60)                               # the paint
    cv2.line(img, (400, 60), (400, 340), (70, 70, 170), 3)             # printed route line
    segs = [[50, 50, 550, 50, 3], [50, 350, 550, 350, 3], [201, 60, 201, 340, 3], [400, 60, 400, 340, 3]]
    kept = _drop_coloured(img, _contrast(img), [list(map(float, s)) for s in segs])
    xs = sorted(round(s[0]) for s in kept)
    assert 201 in xs and 400 not in xs


def _building_lines(blocked, exits, lines, width, height):
    bits = np.packbits(blocked.ravel().astype(np.uint8))
    grid = {"w": blocked.shape[1], "h": blocked.shape[0], "scale": 0.1, "bits": base64.b64encode(bits.tobytes()).decode()}
    case = {"grid": grid, "exits": exits, "lines": lines, "width": width, "height": height}
    out = subprocess.run([NODE, str(Path(__file__).parent / "building_lines_check.js")], input=json.dumps(case),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_routes_only_hides_lines_off_the_building():
    """Routes only draws the wall lines on the building: by the floor with a
    way out, touching such a line, inside the outline, or a long group of
    their own (another floor). A short line on a legend goes (judge review 3,
    DE-commons_000022)."""
    if NODE is None:
        pytest.skip("node is not installed")
    blocked = np.ones((40, 60), bool)
    blocked[10:31, 10:41] = False          # the floor, 310 x 210 px at scale 0.1
    blocked[13:28, 15:31] = True           # a hatched room on the floor
    blocked[32:39, 45:56] = False          # the inside of a legend box: open, no way out
    lines = {
        "top": [95, 95, 415, 95, 3], "left": [95, 95, 95, 315, 3], "bottom": [95, 315, 415, 315, 3],
        "right": [415, 95, 415, 315, 3],
        "corner": [60, 95, 92, 95, 3], "outer": [60, 110, 60, 300, 3],   # an outer wall past a closed strip
        "hatch": [222, 200, 238, 200, 3],                                 # a stub in the hatched room
        "legend": [460, 350, 540, 350, 3],                                # a stub on the legend
        "floor2_top": [450, 20, 580, 20, 3], "floor2_bottom": [450, 80, 580, 80, 3],  # another floor of the sheet
        "floor2_left": [450, 20, 450, 80, 3],
    }
    keep = _building_lines(blocked, [[250, 120]], list(lines.values()), 1000, 400)
    kept = {name for name, k in zip(lines, keep) if k}
    assert kept == set(lines) - {"legend"}
    # A short wall by the floor stays on its own.
    assert _building_lines(blocked, [[250, 120]], [lines["legend"], [150, 95, 250, 95, 3]], 1000, 400) == [False, True]
    # With no floor with a way out, every line stays.
    assert all(_building_lines(np.ones((40, 60), bool), [[250, 120]], list(lines.values()), 1000, 400))
