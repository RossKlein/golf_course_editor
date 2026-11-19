"""The default look: what a course is drawn like until someone changes it. The surfaces, grass, tufts, shadows, relief and the light on the
trees are Augusta National's, which was tuned by eye to look like a golf course; the sky, sun and tree models are the original defaults."""
from __future__ import annotations

from .models import Blob, Frustum, Grass, Look, ReliefLook, Shadows, Sun, Surface, TreeKind, Trees, Tufts

TRUNK = (0.42, 0.29, 0.18)


def surface(**fields) -> Surface:
    """A default surface. It states its standing grass's density and clumping, so building the defaults never asks for them
    (a look read from a file that lacks them is given these, by Look)."""
    return Surface(**{"tuftDensity": 1.0, "tuftClump": 0.0, **fields})


def default_look() -> Look:
    return Look(
        sky=(0.62, 0.76, 0.90),
        # 11 am daylight time in midsummer on the US east coast, at Augusta's latitude: solar noon there is about 1:25 pm
        # daylight time, so 11 am is 2.4 hours before it, an hour angle of -36 degrees. The sun is nearly due east and
        # high: about 98 degrees round and 57 degrees up.
        sun=Sun(latitude=33.5, declination=23.44, hourAngle=-36),
        surfaces={
            "rough": surface(color=(0.304161, 0.591428, 0.12031), grain=0.76, shade=1.01, tuft=2.01, tuftDensity=1.0, tuftClump=0.08, bump=1.4, height=0.063),
            "fairway": surface(color=(0.5, 0.86, 0.3), color2=(0.66, 0.95, 0.44), stripe=2.4, grain=0.55, tuftDensity=1.0, tuftClump=0.0, bump=0.35, height=0.015),
            "green": surface(color=(0.6, 0.92, 0.38), stripe=1.1, grain=0.3, tuftDensity=1.0, tuftClump=0.0, bump=0.2, height=0.003),  # green: with a faint stripe
            "collar": surface(color=(0.52, 0.82, 0.3), grain=0.3, shade=0.84, tuftDensity=1.0, tuftClump=0.0, bump=0.4, height=0.01),  # collar: plain, a darker green than the green
            "tee": surface(color=(0.550816, 0.814286, 0.357605), grain=0.2, shade=0.08, tuftDensity=1.0, tuftClump=0.0, bump=0.3, height=0.022),  # tee: plain
            "bunker": surface(color=(0.888571, 0.846993, 0.704438), grain=0.0, shade=0.67, speckleDark=0.1, specklePale=0.07, tuftDensity=1.0, tuftClump=0.0, bump=0.2, bumpMap='grain', height=0.002),
            "water": surface(color=(0.111923, 0.555908, 0.905714), grain=0.15, tuftDensity=1.0, tuftClump=0.0, height=0.0),
            "path": surface(color=(0.557143, 0.557143, 0.557143), stripe=0.1, grain=0.0, shade=0.91, speckleDark=0.09, specklePale=0.07, tuftDensity=1.0, tuftClump=0.0, bump=0.05, bumpMap='grain', height=0.102),
            "woods": surface(color=(0.419608, 0.309804, 0.2), grain=0.38, speckleDark=0.2, earth=(0.4, 0.65098, 0.239216), mottle=0.4, tuft=2.88, tuftDensity=0.08, tuftClump=1.0, bump=0.5, height=0.038),  # woods: soil with grass in clumps
        },
        grass=Grass(tile='grass.png', tileMetres=6.8, wobble=0.07, speckleGrain=0.02, smoothing=2.5, edgeWidth=0.039, edgeRagged=0.059, edgeShadow=0.05, edgeGain=1.5),
        relief=ReliefLook(smoothing=1.3, exaggeration=5.0, shading=1.8),
        shadows=Shadows(strength=0.8, tint=(0.5, 0.58, 0.78), softness=0.3, distance=200.0),
        tufts=Tufts(height=0.17, spread=0.7, bladeWidth=0.043, blades=18, root=(0.16, 0.31, 0.1), tip=(0.46, 0.66, 0.24)),
        trees=Trees(
            ambient=0.52,
            direct=0.72,
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
