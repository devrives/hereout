"""Fixes of the exit points of the main call, with no model call.

Muse Spark gives its points on a 0 to 1000 grid of the image. On hand labels of
30 gallery plans (four reads: the saved gallery reading, two fresh reads with
the product prompt and one with a test prompt), the exits in the lower part of
the image were too low: model y 600 to 800 was about 25 grid units below the
label, model y 800 to 1000 about 30. Exits in the upper half had no clear
error, and the x values had none. So the y of each exit of the main call below
Y_PIVOT moves up by Y_PULL of its distance below Y_PIVOT.

On the 203 saved gallery readings, this moves the exits of the lower half
onto the green or red route marks more often than away from them, and it does
not move the exits of the upper half. The zoom call gives points on its own
sheets and is not changed. The box of the floor drawing is not changed: a fix
of the box too was a little worse on the labels. ModelClient.read_plan applies
the fix before the zoom check. Each fixed exit keeps the point of the model in
"model", so the page shows the model's own point and the fix as a move by the
code, and the legend and text checks also look at the model's point. A saved
reading (the gallery) keeps the points it was saved with.
"""

from __future__ import annotations

Y_PULL = 0.10    # share of the distance below the pivot that a y value moves up
Y_PIVOT = 500.0  # grid units: a y value above this does not move


def grid_y(v: float) -> float:
    """A y value of the main call on the 0 to 1000 grid, where the model meant it."""
    return v - Y_PULL * max(0.0, v - Y_PIVOT)


def fix_exits(exits: list[dict], height: int) -> list[dict]:
    """The exits of the main call (pixels of an image of this height) with grid_y on each y."""
    return [{**e, "y": grid_y(e["y"] / height * 1000) / 1000 * height, "model": (e["x"], e["y"])} for e in exits]
