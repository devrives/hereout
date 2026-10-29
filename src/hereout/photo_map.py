"""Tell a photo map (an aerial photo with a printed route) from a drawn plan.

Tsunami and site evacuation signs often print the route on an aerial photo.
Walls found in a photo are roofs, trees and cars, so the ways out over it
are wrong. Three measures inside the plan box separate the two kinds:
- paper: the share of pixels near the tone of the sheet (a drawing is mostly paper)
- texture: the share of pixels with a mid gradient (a photo has fine detail everywhere)
- colour: the share of strongly coloured pixels
On the 203 gallery plans, the rule found 8 of 8 photo maps and no other plan
(wiki/decisions/weak-plan-types.md).
"""

from __future__ import annotations

import cv2
import numpy as np

SIDE = 512             # px: the width that the measures are made at
PAPER_TONE = 18        # Lab distance from the sheet tone: still paper
MAX_PAPER = 0.35       # the photo maps have up to 0.3; the nearest drawing (a platform plan with yellow bands) 0.46
MIN_TEXTURE = 0.34
MIN_COLOUR = 0.3
COLOUR_SAT = 60        # HSV saturation: a strong colour
TEXTURE = (4, 25)      # |Laplacian| after a 3x3 blur: fine detail, not flat paper and not a hard line


def measures(img: np.ndarray, plan_box=None) -> tuple[float, float, float]:
    """paper, texture and colour shares inside the plan box."""
    if plan_box is not None:
        x0, y0, x1, y1 = (int(v) for v in plan_box)
        crop = img[max(0, y0):max(0, y1), max(0, x0):max(0, x1)]
        if crop.shape[0] >= 8 and crop.shape[1] >= 8:
            img = crop
    img = cv2.resize(img, (SIDE, max(1, round(SIDE * img.shape[0] / img.shape[1]))), interpolation=cv2.INTER_AREA)
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    # The sheet tone is the median of the brightest pixels, so a tinted sheet is paper too.
    tone = np.median(lab[grey.reshape(-1) >= np.percentile(grey, 70)], axis=0)
    paper = float((np.linalg.norm(lab - tone, axis=1) < PAPER_TONE).mean())
    lap = np.abs(cv2.Laplacian(cv2.GaussianBlur(grey, (3, 3), 0), cv2.CV_32F))
    texture = float(((lap > TEXTURE[0]) & (lap < TEXTURE[1])).mean())
    colour = float((cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[..., 1] > COLOUR_SAT).mean())
    return paper, texture, colour


def is_photo_map(img: np.ndarray, plan_box=None) -> bool:
    paper, texture, colour = measures(img, plan_box)
    return paper < MAX_PAPER and texture > MIN_TEXTURE and colour > MIN_COLOUR
