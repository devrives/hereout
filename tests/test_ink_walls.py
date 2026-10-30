"""Walls from all drawn ink (ink_walls.py) and the legend check (legend.py)."""

import cv2
import numpy as np

from hereout import ink_walls as iw
from hereout.ink_walls import (beyond_exits, door_arcs, footprints, ink_walls, legend_exits, outdoor_areas, place_exits, room_doors,
                                split_strokes)
from hereout.photo_map import is_photo_map
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


def test_inner_wall_much_thinner_than_the_outer_wall_is_hard():
    """Outer walls 30 px thick, an inner wall 10 px thick with a door gap:
    the inner wall is a wall, a 10 px blot is not (it is short)."""
    img = np.full((600, 900, 3), PAPER, np.uint8)
    cv2.rectangle(img, (50, 50), (850, 550), BLACK, 30)
    cv2.line(img, (65, 300), (600, 300), BLACK, 10)    # the inner wall; a door from 600 to 835
    cv2.rectangle(img, (400, 400), (410, 410), BLACK, -1)
    ink = np.all(img < 100, axis=2)
    hard, thin = split_strokes(ink)
    assert hard[300, 300] and hard[300, 595]
    assert not hard[300, 700]
    assert not hard[405, 405]


def plain_thin(mask):
    """Zhang-Suen thinning, every pixel in every pass: the reference for iw._thin."""
    img = np.pad(mask.astype(np.uint8), 1)
    while True:
        changed = False
        for step in (0, 1):
            p = [np.roll(np.roll(img, -dy, 0), -dx, 1) for dy, dx in iw.RING]
            b = sum(p)
            a = sum(((p[i] == 0) & (p[(i + 1) % 8] == 1)).astype(np.uint8) for i in range(8))
            if step == 0:
                c = (p[0] * p[2] * p[4] == 0) & (p[2] * p[4] * p[6] == 0)
            else:
                c = (p[0] * p[2] * p[6] == 0) & (p[0] * p[4] * p[6] == 0)
            kill = (img == 1) & (b >= 2) & (b <= 6) & (a == 1) & c
            if kill.any():
                img[kill] = 0
                changed = True
        if not changed:
            return img[1:-1, 1:-1] > 0


def test_fast_thinning_is_zhang_suen():
    img = np.zeros((300, 400), np.uint8)
    cv2.rectangle(img, (20, 20), (380, 280), 1, 9)
    cv2.line(img, (60, 250), (330, 40), 1, 5)
    cv2.circle(img, (200, 150), 60, 1, 14)
    cv2.rectangle(img, (300, 200), (370, 270), 1, -1)
    img[0:6, 0:400] = 1                  # ink on the edge of the image
    for mask in (img > 0, np.zeros((50, 50), bool)):
        assert np.array_equal(iw._thin(mask), plain_thin(mask))


def test_door_arc_is_found():
    ink = np.all(room_with_door() < 100, axis=2)
    _, thin = split_strokes(ink)
    arcs = door_arcs(thin)
    assert any(abs(cx - 850) < 8 and abs(cy - 330) < 8 and 40 < r < 60 for (cx, cy), r, _, _ in arcs)


def test_door_swing_opens_the_room():
    img = room_with_door()
    hard, soft, _ = ink_walls(img, boxes=[])
    r = route(hard, soft, (400, 300), (880, 305))
    assert r.exit_index == 0


def test_closed_wall_has_no_way():
    img = np.full((600, 900, 3), PAPER, np.uint8)
    cv2.rectangle(img, (50, 50), (850, 550), BLACK, 10)
    cv2.line(img, (450, 50), (450, 550), BLACK, 10)
    hard, soft, _ = ink_walls(img, boxes=[])
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


def test_legend_with_a_heading_tab_is_found():
    """A legend frame with a heading tab on its top edge and a divider from
    its left edge: each outline has more than four corners. The frame is
    full, so it is still a legend."""
    img = np.full((800, 1000, 3), PAPER, np.uint8)
    cv2.rectangle(img, (40, 40), (600, 760), BLACK, 6)
    cv2.rectangle(img, (660, 300), (960, 700), BLACK, 3)
    cv2.rectangle(img, (740, 270), (900, 300), BLACK, 3)   # the heading tab
    cv2.line(img, (660, 500), (820, 500), BLACK, 3)        # the divider
    text = [[[700, y], [900, y], [900, y + 20], [700, y + 20]] for y in range(330, 650, 70)]
    exits = [{"x": 600, "y": 400, "label": "A"}, {"x": 720, "y": 360, "label": "B"}]
    assert [e["label"] for e in drop_legend_exits(img, text, exits, plan_box=(40, 40, 600, 760))] == ["A"]


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


def test_exit_off_the_drawing_is_dropped():
    fp = np.zeros((500, 1000), bool)
    fp[50:450, 50:550] = True
    placed = place_exits([(550, 200), (900, 300)], fp, ~fp)
    assert placed[0] == (550, 200) and placed[1] is None
    # At least one exit stays.
    assert place_exits([(900, 300)], fp, ~fp) == [(900, 300)]
    # A lone exit next to a small drawing apart from the main one (a text
    # panel) goes; two exits there stay.
    fp[470:540, 700:800] = True
    assert place_exits([(300, 200), (820, 520)], fp, ~fp)[1] is None
    assert None not in place_exits([(300, 200), (750, 520), (780, 500)], fp, ~fp)
    # A small shape inside the bounds of the main drawing (the middle of a
    # hall that the closing split off) is part of the building: its exit stays.
    ring = np.zeros((500, 1000), bool)
    ring[50:450, 50:950] = True
    ring[150:350, 600:850] = False
    ring[200:300, 650:800] = True
    assert place_exits([(300, 200), (700, 250)], ring, ~ring)[1] is not None


def test_word_for_outside_closes_its_area(monkeypatch):
    """A building with a roof area beside the hall. The OCR reads "Dachfläche"
    in the roof area: that area is outside, the hall is not."""
    blocked = np.zeros((600, 1000), bool)
    blocked[:, :20] = blocked[:, -20:] = blocked[:20, :] = blocked[-20:, :] = True
    blocked[:, 650:654] = True          # the line between the hall and the roof
    boxes = [[[300, 290], [400, 290], [400, 310], [300, 310]], [[700, 290], [880, 290], [880, 310], [700, 310]]]
    monkeypatch.setattr(iw, "read_texts", lambda crops, lang=None: ["Dachfläche" if c.shape[1] > 150 else "Gastraum" for c in crops])
    img = np.full((600, 1000, 3), PAPER, np.uint8)
    out = outdoor_areas(img, blocked, boxes)
    assert out[100, 800] and not out[100, 300]


def test_exit_at_a_legend_heading_goes(monkeypatch):
    """An exit off the building next to "Legende:" is the sign of the legend.
    An exit in the building next to the same heading is a real exit."""
    fp = np.zeros((600, 1000), bool)
    fp[50:400, 50:950] = True
    heading = [[100, 430], [220, 430], [220, 455], [100, 455]]
    monkeypatch.setattr(iw, "read_texts", lambda crops, lang=None: ["Legende:" for c in crops])
    img = np.full((600, 1000, 3), PAPER, np.uint8)
    assert legend_exits(img, [(500, 300), (90, 425), (150, 395)], fp, [heading]) == {1}
    # Only the eslav model reads the Cyrillic heading.
    monkeypatch.setattr(iw, "read_texts", lambda crops, lang=None: ["УСЛОВНЫЕ ОБОЗНАЧЕНИЯ" if lang else "YCNOBHBIE" for c in crops])
    assert legend_exits(img, [(500, 300), (90, 425)], fp, [heading]) == {1}


def test_photo_map_is_found():
    """An aerial photo (fine coloured detail everywhere) is a photo map; a
    drawn plan on paper is not."""
    rng = np.random.default_rng(0)
    base = cv2.resize(rng.integers(0, 255, (60, 80, 3), dtype=np.uint8), (800, 600), interpolation=cv2.INTER_CUBIC)
    noise = rng.normal(0, 6, base.shape)
    photo = np.clip(base.astype(float) + noise, 0, 255).astype(np.uint8)
    assert is_photo_map(photo)
    assert not is_photo_map(room_with_door())


def test_exit_on_the_street_moves_to_the_building():
    fp = np.zeros((500, 1000), bool)
    fp[50:450, 50:950] = True
    blocked = ~fp
    blocked[300:450, :] = True          # the street below the front wall
    (x, y), = place_exits([(500, 380)], fp, blocked)
    assert x == 500 and 290 <= y < 300


def test_area_beyond_the_exits_is_outside():
    """A hall with exits in its front wall, and a forecourt between the front
    wall and a thin fence. The forecourt is outside; the hall is not."""
    blocked = np.zeros((600, 1000), bool)
    blocked[:, :20] = blocked[:, -20:] = blocked[:20, :] = blocked[500:, :] = True
    blocked[400:406, :] = True          # the front wall
    blocked[470:473, :] = True          # the fence
    inside = ~blocked
    inside[400:473, :] = True
    out = beyond_exits(blocked, inside, [(300, 403), (700, 403)])
    assert out[440, 500] and not out[200, 500]


def test_closed_room_gets_a_door():
    hard = np.zeros((500, 900), bool)
    hard[:10, :] = hard[-10:, :] = hard[:, :10] = hard[:, -10:] = True
    hard[:, 445:455] = True             # a wall with no door between the two rooms
    door = room_doors(hard, [(100, 250)], None)
    assert door[:, 445:455].any()
    walls = hard & ~door
    assert route(walls, np.zeros_like(walls), (700, 250), (100, 250)).exit_index == 0
