"""The default look: what a course is drawn like until someone changes it. These are the values the renderer used to carry
as constants in its shaders and scenery code, so adopting the look changed nothing on screen."""
from __future__ import annotations

from .models import Blob, Frustum, Grass, Look, Shadows, Sun, Surface, TreeKind, Trees, Tufts

TRUNK = (0.42, 0.29, 0.18)
ROUGH = (0.40, 0.65, 0.24)  # darker than the fairway


def default_look() -> Look:
    return Look(
        sky=(0.62, 0.76, 0.90),
        # 11 am daylight time in midsummer on the US east coast, at Augusta's latitude: solar noon there is about 1:25 pm
        # daylight time, so 11 am is 2.4 hours before it, an hour angle of -36 degrees. The sun is nearly due east and
        # high: about 98 degrees round and 57 degrees up.
        sun=Sun(latitude=33.5, declination=23.44, hourAngle=-36),
        surfaces=[
            Surface(color=ROUGH, grain=1.0, tuft=1.0),  # rough
            Surface(color=(0.50, 0.86, 0.30), color2=(0.66, 0.95, 0.44), stripe=2.4, grain=0.55),  # fairway
            Surface(color=(0.60, 0.92, 0.38), grain=0.3),  # green: plain, no stripes
            Surface(color=(0.52, 0.82, 0.30), color2=(0.60, 0.88, 0.36), stripe=0.9, grain=0.35),  # collar
            Surface(color=(0.64, 0.94, 0.42), grain=0.35),  # tee: plain
            Surface(color=(0.965, 0.93, 0.81), grain=0.4, shade=0.12, speckleDark=0.1, specklePale=0.07),  # bunker
            Surface(color=(0.27, 0.60, 0.86), grain=0.15),  # water
            Surface(color=(0.72, 0.66, 0.52), grain=0.4),  # path
            Surface(color=ROUGH, earth=(0.42, 0.31, 0.20), mottle=1.6, grain=0.8, tuft=0.7),  # woods: rough mottled with soil
        ],
        grass=Grass(tile="grass.png", tileMetres=3.0, wobble=0.9, speckleGrain=0.03, edge=1.0),
        shadows=Shadows(strength=0.8, tint=(0.5, 0.58, 0.78), softness=0.6, distance=200),
        tufts=Tufts(height=0.4, width=1.1, root=(0.16, 0.31, 0.10), tip=(0.46, 0.66, 0.24)),
        trees=Trees(
            ambient=0.5,
            direct=0.65,
            base=0.78,
            kinds=[
                TreeKind(  # a long bare trunk and a narrow crown of stacked cones
                    name="pine",
                    height=(14, 24),
                    parts=[
                        Frustum(y0=0, r0=0.028, y1=0.4, r1=0.02, sides=6, color=TRUNK),
                        Frustum(y0=0.3, r0=0.17, y1=0.62, r1=0.0, sides=7, color=(0.16, 0.42, 0.2)),
                        Frustum(y0=0.5, r0=0.14, y1=0.82, r1=0.0, sides=7, color=(0.19, 0.48, 0.23)),
                        Frustum(y0=0.7, r0=0.1, y1=1.0, r1=0.0, sides=7, color=(0.22, 0.54, 0.26)),
                    ],
                ),
                TreeKind(  # a short trunk and a wide faceted crown
                    name="broadleaf",
                    height=(9, 15),
                    parts=[
                        Frustum(y0=0, r0=0.04, y1=0.42, r1=0.03, sides=6, color=TRUNK),
                        Blob(cx=0, cy=0.68, cz=0, rx=0.3, ry=0.3, rz=0.3, color=(0.3, 0.6, 0.2)),
                        Blob(cx=0.1, cy=0.84, cz=0.05, rx=0.19, ry=0.17, rz=0.19, color=(0.4, 0.7, 0.25)),
                    ],
                ),
                TreeKind(  # dense overlapping cones from low down
                    name="fir",
                    height=(14, 24),
                    parts=[
                        Frustum(y0=0, r0=0.03, y1=0.2, r1=0.025, sides=6, color=TRUNK),
                        Frustum(y0=0.12, r0=0.26, y1=0.5, r1=0.0, sides=8, color=(0.1, 0.35, 0.2)),
                        Frustum(y0=0.34, r0=0.2, y1=0.74, r1=0.0, sides=8, color=(0.13, 0.41, 0.23)),
                        Frustum(y0=0.56, r0=0.14, y1=1.0, r1=0.0, sides=8, color=(0.16, 0.47, 0.26)),
                    ],
                ),
            ],
        ),
    )
