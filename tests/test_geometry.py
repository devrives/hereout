import math

import cv2
import numpy as np
import pytest

from hereout.plan import find_plan_quad, order_corners, plan_aspect, plausible_sheet, rectify
from hereout.route import NoRoute, find_route
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
