"""A bundle's aerial layer: the RGB render of the stack it was baked from, placed in course coordinates."""
from __future__ import annotations

from pathlib import Path

from ..models import AerialMeta, Course, TifView


def aerial_meta(stack_rel: str, view: TifView, course: Course) -> AerialMeta:
    """Placement of the rendered stack image's top-left corner in course metres (x east, z south)."""
    if view.rgb is None:
        raise ValueError(f"{stack_rel} has no RGB bands")
    if view.crs != course.crs:
        raise ValueError(f"stack CRS {view.crs} does not match the bundle's {course.crs}")
    a, b, c, d, e, f = view.transform
    if b or d or a <= 0 or e >= 0:
        raise ValueError("stack must be north-up")
    return AerialMeta(stack=stack_rel, x0=c - course.originEasting, z0=course.originNorthing - f,
                      res=view.resX, width=view.rgb.width, height=view.rgb.height)


def relative_to(root: Path, path: Path) -> str | None:
    """Data-relative POSIX path, or None if path is outside root."""
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return None
