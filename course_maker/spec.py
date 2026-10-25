"""Constants of the course bundle format (docs/golf-course-format.md in the Rally Club repo)."""
import numpy as np

HEIGHT_RES = 1.0
CLASS_RES = 0.5
BOUNDS_RES = 1.0
PATCH_RES = 0.25
PATCH_REFINE = 4  # patch samples per macro cell, per axis
PATCH_MAX_SAMPLES = 1024
MAX_PATCHES = 64
PATCH_BORDER_TOL_M = 0.002
MAX_HOLES = 24
BUNDLE_BUDGET_BYTES = 8_000_000

CLASSES = {
    "rough": 0,
    "fairway": 1,
    "green": 2,
    "collar": 3,
    "tee": 4,
    "bunker": 5,
    "water": 6,
    "path": 7,
    "woods": 8,
}
ROUGH, FAIRWAY, GREEN, COLLAR, TEE = 0, 1, 2, 3, 4
OWNED_CLASSES = (FAIRWAY, GREEN, TEE)  # the only classes that belong to a single hole

DEFAULT_FILES = {
    "height": "height.png",
    "class": "class.png",
    "bounds": "bounds.png",
    "trees": "trees.bin",
}

# trees.bin: little-endian, 12-byte records, no header
TREE_DTYPE = np.dtype([("x", "<f4"), ("z", "<f4"), ("height_cm", "<u2"), ("kind", "u1"), ("reserved", "u1")])
TREE_RECORD_BYTES = 12
assert TREE_DTYPE.itemsize == TREE_RECORD_BYTES
