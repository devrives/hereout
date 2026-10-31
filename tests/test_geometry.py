import math

import cv2
import numpy as np
import pytest

from hereout.plan import find_plan_quad, order_corners, plan_aspect, plausible_sheet, rectify
from hereout.route import NoRoute, blocked_grid, find_route, wall_axes, wall_wing
from hereout.steps import directions
from hereout.walls import wall_hue, wall_mask

from conftest import draw_plan


def test_order_corners():
    pts = np.array([[10, 90], [90, 10], [10, 10], [90, 90]])
    assert order_corners(pts).tolist() == [[10, 10], [90, 10], [90, 90], [10, 90]]


def test_walls_skip_signs_and_text(plan):
    img, _, _ = plan
    walls = wall_mask(img)
    assert walls[40, 200]            # outer wall
    assert walls[300, 400]           # inner wall
    assert not walls[100, 630]       # green sign
    assert not walls[295, 160]       # "WC" text
    assert not walls[160, 400]       # the door stays open


def test_soft_route_band_is_not_a_wall():
    img, here, exit_ = draw_plan()
    # A grey-green band painted along the corridor, as many plans mark the escape route.
    cv2.rectangle(img, (420, 60), (500, 440), (175, 190, 170), -1)
    walls = wall_mask(img)
    assert not walls[60:440, 420:500].any()
    assert walls[300, 400]  # the inner wall next to it stays


def test_route_goes_through_the_door(plan):
    img, here, exit_ = plan
    route = find_route(wall_mask(img), here, [exit_])
    assert route.exit_index == 0
    # The only way east is the door at y 130-190 in the wall at x 400.
    crossing = [p for p in route.points if abs(p[0] - 400) < 6]
    assert crossing and all(125 < p[1] < 195 for p in crossing)
    walls = wall_mask(img)
    for x, y in route.points[1:-1]:
        assert not walls[int(y), int(x)]


def test_route_picks_nearest_exit(plan):
    img, here, far_exit = plan
    near_exit = (40, 380)  # make a gap in the left wall, close to the start
    cv2.rectangle(img, (30, 350), (50, 410), (245, 245, 245), -1)
    route = find_route(wall_mask(img), here, [far_exit, near_exit])
    assert route.exit_index == 1


def test_no_route_when_sealed():
    img, here, exit_ = draw_plan()
    cv2.line(img, (400, 130), (400, 190), (20, 20, 20), 8)  # close the door
    try:
        find_route(wall_mask(img), here, [exit_])
    except NoRoute:
        return
    raise AssertionError("expected NoRoute")


def test_directions_turns(plan):
    img, here, exit_ = plan
    h, w = img.shape[:2]
    route = find_route(wall_mask(img), here, [exit_])
    steps = directions(route.points, w, h)
    assert steps[-1]["kind"] == "arrive"
    walks = [s for s in steps if s["kind"] == "walk"]
    assert 2 <= len(walks) <= 6
    # Start is low on the left, the door is high in the middle: first leg goes up.
    assert walks[0]["turn"] in ("straight", "slight right", "right")
    assert walks[0]["text"].startswith("Start toward the top")


def test_directions_simple_l_shape():
    pts = [(100, 400), (100, 100), (400, 100)]
    steps = directions(pts, 500, 500)
    assert steps[0]["turn"] == "straight"
    assert steps[1]["turn"] == "right"
    assert steps[0]["text"] == "Start toward the top of the plan and walk a long way."
    assert steps[1]["text"] == "Turn right and walk a long way."
    assert steps[2]["text"] == "Then you reach the exit."


def test_directions_side_step_keeps_the_right_angle():
    """A short side step just before a right angle: the steps name no slight
    turn, because the side step does not tilt the walks. The walk with the
    side step names it."""
    pts = [(50, 250), (250, 250), (250, 265), (275, 265), (275, 460)]
    walks = [s for s in directions(pts, 500, 500) if s["kind"] == "walk"]
    assert [s["turn"] for s in walks] == ["right", "straight", "right"]
    assert walks[1]["text"] == "Step right, then keep going straight for a short way."
    assert walks[1]["path"] == [(250, 250), (250, 265), (275, 265)]


def test_directions_side_step_in_its_place():
    """A side step inside a walk gets words in its place (a11y and ux
    reviews): the walk splits where the side step starts. A side step at the
    start of the first walk comes first, in the plan frame."""
    walks = [s["text"] for s in directions([(500, 50), (500, 400), (800, 400), (800, 440), (1100, 440)], 1200, 1200)
             if s["kind"] == "walk"]
    assert walks[1:] == ["Turn left and walk a medium way.", "Step right, then keep going straight for a medium way."]
    walks = [s["text"] for s in directions([(943, 333), (898, 333), (898, 643)], 1200, 1200) if s["kind"] == "walk"]
    assert walks == ["Move over toward the left of the plan, then start toward the bottom of the plan and walk a medium way."]
    # Two small jogs to one side, each under the limit, are one side step (a11y review).
    walks = [s["text"] for s in directions([(356, 667), (338, 563), (313, 563), (313, 378), (296, 378), (296, 200)],
                                           1600, 1200) if s["kind"] == "walk"]
    assert walks[1:] == ["Step left, then keep going straight for a medium way."]
    # Past the corner and back: facing east after the turn, the step is to the left (up).
    walks = [s["text"] for s in directions([(500, 50), (500, 400), (500, 360), (1000, 360)], 1200, 1200)
             if s["kind"] == "walk"]
    assert walks[1:] == ["Turn left, step left, then walk a medium way."]


def test_directions_detour_out_and_back_gets_two_side_steps():
    """A straight walk that steps aside round a wall and back ends on its start
    line: it splits where it is farthest out, so the words name both side steps
    (a11y review)."""
    pts = [(1500, 300), (1244, 300), (1244, 355), (1009, 355), (1009, 305), (769, 305), (769, 600)]
    walks = [s["text"] for s in directions(pts, 1600, 1200) if s["kind"] == "walk"]
    assert walks[1:3] == ["Step left, then keep going straight for a medium way.",
                          "Step right, then keep going straight for a medium way."]


def test_directions_side_step_before_a_turn_back():
    """Down, then a side step to the plan left and back up: the walker steps
    to their right (facing down), then turns around."""
    pts = [(100, 50), (100, 300), (80, 300), (80, 200)]
    walks = [s for s in directions(pts, 500, 500) if s["kind"] == "walk"]
    assert walks[1]["text"] == "Step right, then turn around and go back a medium way."


def test_directions_zigzag_takes_the_main_way():
    """Short legs across a long walk down: the legs down add up, so the walk
    goes down and the turn after it is a right angle."""
    pts = [(100, 50), (100, 300), (112, 300), (112, 340), (124, 340), (124, 380), (124, 420), (400, 420)]
    walks = [s for s in directions(pts, 500, 500) if s["kind"] == "walk"]
    assert not any(s["turn"].startswith("slight") for s in walks)


def test_directions_split_walk_with_two_ways():
    """Down, a short way to the plan left, then a long way down. The words
    name both turns, so a walker who follows them ends up going down."""
    pts = [(500, 50), (500, 90), (450, 90), (450, 600)]
    texts = [s["text"] for s in directions(pts, 1200, 1200) if s["kind"] == "walk"]
    assert texts[1:] == ["Turn right and walk a short way.", "Turn left and walk a medium way."]


def camera_view(sheet_w, sheet_h, yaw_deg, pitch_deg, f=1000.0, size=(1200, 900), dist=1000.0):
    """Corners of a flat sheet seen by a pinhole camera, as photo pixels."""
    yaw, pitch = np.radians(yaw_deg), np.radians(pitch_deg)
    Ry = np.array([[np.cos(yaw), 0, np.sin(yaw)], [0, 1, 0], [-np.sin(yaw), 0, np.cos(yaw)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(pitch), -np.sin(pitch)], [0, np.sin(pitch), np.cos(pitch)]])
    R = Rx @ Ry
    s = 1.3  # sheet units to world units
    corners = np.array([[-sheet_w / 2, -sheet_h / 2, 0], [sheet_w / 2, -sheet_h / 2, 0],
                        [sheet_w / 2, sheet_h / 2, 0], [-sheet_w / 2, sheet_h / 2, 0]]) * s
    cam = corners @ R.T + [0, 0, dist]
    u = f * cam[:, 0] / cam[:, 2] + size[0] / 2
    v = f * cam[:, 1] / cam[:, 2] + size[1] / 2
    return np.float32(np.stack([u, v], axis=1))


def test_rectify_restores_a_tilted_plan():
    sheet, _, _ = draw_plan(600, 400)
    # Put the sheet on a dark wall and look at it from the side and below.
    canvas = np.full((900, 1200, 3), 70, np.uint8)
    src = np.float32([[0, 0], [600, 0], [600, 400], [0, 400]])
    dst = camera_view(600, 400, yaw_deg=25, pitch_deg=-10)
    H = cv2.getPerspectiveTransform(src, dst)
    photo = cv2.warpPerspective(sheet, H, (1200, 900), dst=canvas.copy(), borderMode=cv2.BORDER_TRANSPARENT)

    quad = find_plan_quad(photo)
    assert quad is not None
    for got, want in zip(quad, dst):
        assert math.dist(got, want) < 15

    flat, M = rectify(photo, quad)
    corners = cv2.perspectiveTransform(dst.reshape(-1, 1, 2), M).reshape(-1, 2)
    tl, tr, br, bl = corners
    # Opposite sides become parallel and corners square, within the error of
    # the corner search.
    tol = 0.015 * (tr[0] - tl[0])
    assert abs(tl[1] - tr[1]) < tol and abs(bl[1] - br[1]) < tol
    assert abs(tl[0] - bl[0]) < tol and abs(tr[0] - br[0]) < tol
    # The aspect ratio comes back close to the sheet's 3:2.
    ratio = (tr[0] - tl[0]) / (bl[1] - tl[1])
    assert abs(ratio - 1.5) < 0.08


@pytest.mark.parametrize("yaw,pitch", [(35, -15), (40, 10), (30, 0), (0, 25)])
def test_aspect_from_camera_view(yaw, pitch):
    # The test camera uses f = 1000 on a 1200 px wide photo, near the phone default.
    ratio = plan_aspect(camera_view(600, 400, yaw, pitch), (1200, 900))
    assert ratio is not None and abs(ratio - 1.5) < 0.12


def test_implausible_quad_is_rejected():
    # The shape of a header band joined to one sheet edge: one side is short.
    quad = order_corners(np.float32([[57, 147], [1821, 140], [1819, 288], [98, 1363]]))
    assert not plausible_sheet(quad)
    assert plausible_sheet(camera_view(600, 400, 25, -10))
    assert not plausible_sheet(camera_view(600, 400, 40, -15))  # too strong a tilt to trust


def test_rectify_leaves_a_straight_photo_alone(plan):
    img, _, _ = plan
    out, M = rectify(img)
    assert out is img and np.allclose(M, np.eye(3))


def test_red_walls_found_by_hue():
    img, here, exit_ = draw_plan()
    red = img.copy()
    red[(img == 20).all(axis=2)] = (45, 40, 200)  # walls and text in red ink
    assert wall_hue(red) is not None and wall_hue(img) is None
    walls = wall_mask(red)
    assert walls[300, 400] and not walls[160, 400]
    assert not walls[100, 630]                     # the green sign is still not a wall
    assert find_route(walls, here, [exit_]).exit_index == 0


def test_plan_box_blocks_the_page_outside():
    img, here, exit_ = draw_plan()
    walls = wall_mask(img, plan_box=(100, 60, 700, 440))
    assert walls[5, 5] and walls[450, 750]
    assert not walls[300, 300]


def test_door_swing_does_not_close_the_door():
    img, here, exit_ = draw_plan()
    # A thin door arc across the door gap in the inner wall.
    cv2.ellipse(img, (400, 130), (60, 60), 0, 90, 180, (20, 20, 20), 2)
    walls = wall_mask(img)
    assert walls[300, 400]                       # the thick wall stays
    assert find_route(walls, here, [exit_]).exit_index == 0


def test_wall_axes_find_the_tilt_of_a_plan():
    walls = np.zeros((600, 800), bool)
    for x in (100, 400, 700):
        walls[100:500, x - 3:x + 3] = True
    for y in (100, 300, 500):
        walls[y - 3:y + 3, 100:700] = True
    assert wall_axes(walls) == (0.0, 0.0)
    turn = cv2.getRotationMatrix2D((400, 300), -3, 1.0)  # 3 degrees clockwise on the screen
    tilted = cv2.warpAffine(walls.astype(np.uint8), turn, (800, 600), flags=cv2.INTER_NEAREST) > 0
    a, b = (math.degrees(t) for t in wall_axes(tilted))
    assert abs(a - 3) < 0.5 and abs(b - 3) < 0.5


def test_wall_wing_finds_a_wing_at_an_angle():
    walls = np.zeros((800, 1200), bool)
    for x in range(600, 1150, 100):          # the main block: rooms along x
        walls[300:700, x - 3:x + 3] = True
    for y in (300, 500, 700):
        walls[y - 3:y + 3, 600:1150] = True
    wing = np.zeros_like(walls)              # a wing on the left, the same rooms turned 25 degrees
    for x in range(100, 500, 100):
        wing[200:600, x - 3:x + 3] = True
    for y in (200, 400, 600):
        wing[y - 3:y + 3, 100:400] = True
    turn = cv2.getRotationMatrix2D((250, 400), 25, 1.0)
    walls |= cv2.warpAffine(wing.astype(np.uint8), turn, (1200, 800), flags=cv2.INTER_NEAREST) > 0
    axes = wall_axes(walls)
    blocked, scale = blocked_grid(walls)
    found = wall_wing(walls, axes, scale, blocked.shape)
    assert found is not None
    tilt, cells = found
    main = math.degrees(axes[0])
    assert abs(abs(math.degrees(tilt) - main) - 25) < 2
    # The two blocks fall on the two sides of the split.
    left = cells[int(400 * scale), int(250 * scale)]
    right = cells[int(500 * scale), int(900 * scale)]
    assert left != right
    assert wall_wing(walls[:, 550:], wall_axes(walls[:, 550:]), scale, blocked[:, int(550 * scale):].shape) is None
