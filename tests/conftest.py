import cv2
import numpy as np
import pytest


def draw_plan(w=800, h=500):
    """A plain floor: outer walls, one inner wall with a door, an exit gap.

    Returns the image, the "you are here" point and the exit point.
    """
    img = np.full((h, w, 3), 245, np.uint8)
    black = (20, 20, 20)
    t = 8
    cv2.rectangle(img, (40, 40), (w - 40, h - 40), black, t)
    # Exit: a gap in the right wall near the bottom.
    cv2.rectangle(img, (w - 40 - t, h - 140), (w - 40 + t, h - 90), (245, 245, 245), -1)
    # Inner wall from top to bottom with a door near the top.
    cv2.line(img, (400, 40), (400, 130), black, t)
    cv2.line(img, (400, 190), (400, h - 40), black, t)
    # A green sign and some text; neither is a wall.
    cv2.rectangle(img, (600, 80), (660, 120), (40, 160, 40), -1)
    cv2.putText(img, "WC", (150, 300), cv2.FONT_HERSHEY_SIMPLEX, 0.6, black, 2)
    return img, (200, 380), (w - 30, h - 115)


@pytest.fixture
def plan():
    return draw_plan()
