"""Find the posted plan in a photo and make it flat.

A photo of a plan on a wall is usually taken at an angle. When the photo shows
the four edges of the plan sheet, we map that quadrilateral to a rectangle.
The warp keeps every pixel of the photo: marks such as "you are here" are
sometimes outside the drawn building outline, so we never crop to the quad.
"""

from __future__ import annotations

import cv2
import numpy as np

WORK_SIZE = 900          # longest side used for the edge search
MIN_QUAD_AREA = 0.20     # the quad must cover this share of the photo
MAX_QUAD_AREA = 0.97     # bigger than this is the photo frame itself
SQUARE_ENOUGH_DEG = 2.5  # skip the warp when every corner is this close to 90
MIN_CORNER_DEG = 50      # a sheet seen at an angle still has corners near 90
# Opposite sides of a sheet keep a similar length. In the open-licensed test
# set, every false quad had a ratio of 0.71 or less, and most true ones 0.74 or
# more. A missed warp costs little; a false warp distorts the whole plan.
MIN_SIDE_RATIO = 0.72
MAX_OUTPUT_SIDE = 2400
TYPICAL_FOCAL = 0.75     # phone main camera focal length, in units of the long side


def order_corners(pts: np.ndarray) -> np.ndarray:
    """Return the corners as top-left, top-right, bottom-right, bottom-left."""
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array(
        [pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]],
        dtype=np.float32,
    )


def find_plan_quad(img: np.ndarray) -> np.ndarray | None:
    """Return the four corners of the plan sheet in image pixels, or None."""
    h, w = img.shape[:2]
    scale = WORK_SIZE / max(h, w)
    small = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 40, 120)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    area_total = small.shape[0] * small.shape[1]
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:12]:
        hull = cv2.convexHull(c)
        approx = cv2.approxPolyDP(hull, 0.02 * cv2.arcLength(hull, True), True)
        if len(approx) != 4:
            continue
        share = cv2.contourArea(approx) / area_total
        if MIN_QUAD_AREA <= share <= MAX_QUAD_AREA:
            quad = order_corners(approx.reshape(4, 2) / scale)
            if plausible_sheet(quad):
                return quad
    return None


def plausible_sheet(quad: np.ndarray) -> bool:
    """False for a quad that cannot be a flat sheet seen by a phone.

    Long edges of other things (a header band and a sheet edge) can make a
    large four-sided shape that is not the sheet. Its corners are far from 90
    degrees or its opposite sides differ much in length.
    """
    if any(not (MIN_CORNER_DEG <= a <= 180 - MIN_CORNER_DEG) for a in _corner_angles(quad)):
        return False
    tl, tr, br, bl = quad
    sides = [np.linalg.norm(tr - tl), np.linalg.norm(br - tr), np.linalg.norm(bl - br), np.linalg.norm(tl - bl)]
    for a, b in ((sides[0], sides[2]), (sides[1], sides[3])):
        if min(a, b) / max(a, b) < MIN_SIDE_RATIO:
            return False
    return True


def _corner_angles(quad: np.ndarray) -> list[float]:
    angles = []
    for i in range(4):
        a, b, c = quad[i - 1], quad[i], quad[(i + 1) % 4]
        v1, v2 = a - b, c - b
        cos = float(np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9))
        angles.append(float(np.degrees(np.arccos(np.clip(cos, -1, 1)))))
    return angles


def plan_aspect(quad: np.ndarray, image_size: tuple[int, int]) -> float | None:
    """Estimate width / height of the real sheet from its four corners.

    A pinhole camera with square pixels and the principal point at the image
    centre is assumed. The focal length is solved from the quad, then the
    aspect ratio follows from the two sheet edges. Returns None when the
    numbers are not physical.
    """
    w, h = image_size
    u0, v0 = w / 2, h / 2
    tl, tr, br, bl = (np.array([p[0], p[1], 1.0]) for p in quad)
    m1, m2, m3, m4 = tl, tr, bl, br
    k2 = np.dot(np.cross(m1, m4), m3) / np.dot(np.cross(m2, m4), m3)
    k3 = np.dot(np.cross(m1, m4), m2) / np.dot(np.cross(m3, m4), m2)
    n2 = k2 * m2 - m1
    n3 = k3 * m3 - m1
    denom = n2[2] * n3[2]
    f2 = None
    if abs(denom) > 1e-6:
        f2 = -((n2[0] * n3[0] - (n2[0] * n3[2] + n2[2] * n3[0]) * u0 + n2[2] * n3[2] * u0 ** 2)
               + (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + n2[2] * n3[2] * v0 ** 2)) / denom
    # When one pair of edges looks parallel, the focal length cannot be solved.
    # A focal length far outside normal phone lenses means the solve is
    # unstable. In both cases assume a typical phone main camera.
    if f2 is None or not (0.3 * max(w, h)) ** 2 < f2 < (6 * max(w, h)) ** 2:
        f2 = (TYPICAL_FOCAL * max(w, h)) ** 2
    A_inv = np.linalg.inv(np.array([[np.sqrt(f2), 0, u0], [0, np.sqrt(f2), v0], [0, 0, 1.0]]))
    B = A_inv.T @ A_inv
    ratio2 = (n2 @ B @ n2) / (n3 @ B @ n3)
    if not 0.04 < ratio2 < 25:
        return None
    return float(np.sqrt(ratio2))


def rectify(img: np.ndarray, quad: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Warp the photo so the plan is seen straight on.

    Returns the new image and the 3x3 homography from photo pixels to new
    pixels. When no quad is found, or the quad is already square, the image is
    returned as it is with the identity matrix.
    """
    if quad is None:
        quad = find_plan_quad(img)
    if quad is None or all(abs(a - 90) < SQUARE_ENOUGH_DEG for a in _corner_angles(quad)):
        return img, np.eye(3)

    tl, tr, br, bl = quad
    width = max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))
    height = max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))
    aspect = plan_aspect(quad, (img.shape[1], img.shape[0]))
    if aspect is not None:
        # Keep the larger measured side and set the other from the real shape.
        if width / height >= aspect:
            height = width / aspect
        else:
            width = height * aspect
    target = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    H = cv2.getPerspectiveTransform(quad, target)

    # Move the whole warped photo into view, so nothing is cut away.
    h, w = img.shape[:2]
    frame = np.array([[[0, 0]], [[w, 0]], [[w, h]], [[0, h]]], dtype=np.float32)
    warped = cv2.perspectiveTransform(frame, H).reshape(4, 2)
    lo, hi = warped.min(axis=0), warped.max(axis=0)
    # A strong tilt sends the far side of the photo very far out. Keep the
    # output to the plan plus a margin of half its size on each side.
    lo = np.maximum(lo, [-width / 2, -height / 2])
    hi = np.minimum(hi, [width * 1.5, height * 1.5])
    shift = np.array([[1, 0, -lo[0]], [0, 1, -lo[1]], [0, 0, 1]])
    size = hi - lo
    fit = min(1.0, MAX_OUTPUT_SIDE / max(size))
    zoom = np.diag([fit, fit, 1.0])
    M = zoom @ shift @ H
    out_size = (max(1, round(size[0] * fit)), max(1, round(size[1] * fit)))
    out = cv2.warpPerspective(img, M, out_size, flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
    return out, M
