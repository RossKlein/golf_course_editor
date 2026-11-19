# Range versus course

What the game changes when `course.json` has `"kind": "range"`. Everything else in [golf-course-format.md](golf-course-format.md) is unchanged: height, class map, trees, look, landmarks, water mesh, and patches load and render as they do for a course.

A file that omits `kind` is a course. `"kind": "course"` is the same as omitting it.

There is no targets file. The class map is the description. The game derives the tee and the targets at load.

## What is the same

| | Course | Range |
| --- | --- | --- |
| Files | `course.json`, `height.png`, `class.png`, `bounds.png`, `trees.bin`, optional `patches/`, optional `water-*.json` | The same files |
| Coordinates | x east, y up, z south, origin at the north-west corner of the height grid | Same |
| Surface classes | R channel of `class.png`, 0.5 m cells, nearest-neighbour | Same. Paint every class, including several separate fairways and greens |
| Look, trees, landmarks, water | As in the format spec | Same |

Rendering does not special-case a range. Extra greens and fairways are already class cells.

## What changes

| | Course | Range |
| --- | --- | --- |
| `course.json` `kind` | `"course"` or omitted | `"range"` |
| `holes` | One entry per hole: `number`, `par`, `route` (tee to green, at least two points) | `[]`. A range with any hole is invalid |
| Class map G channel | Hole number on fairway (1), green (2) and tee (4). 0 everywhere else | 0 on every cell. A range does not number surfaces by hole |
| Greens | Each hole owns one 4-connected green | Any number of 4-connected green groups. Each group is a target. They need not touch |
| Tees | Each hole owns its own tee cells | Exactly one 4-connected tee (class 4). That is the teebox |
| Fairways | Owned by a hole | Class 1 cells, any number of separate pieces. Landing ground, not targets. No flags |
| `bounds.png` | Bit per hole. A clear bit is out of bounds for that hole | Present, and empty (every byte 0) because there are no holes. **Do not read it.** The whole map is in play |
| Ball start | First point of the hole's route | A cell of the tee. See below. There is no route |
| Flag | One pin on the hole's green. The host picks it and syncs it | One pin on each green group, same pin rule. The host picks them and syncs them |
| Play | Hole order, par, yardage along the route | Not in the bundle. The game decides how a session is scored and which target is the one in play |

Water, bunker, and the other classes still mean what they mean on a course. Water is water, not out of bounds.

## Finding the targets

Work in class-map cells. Cell (col, row) covers x in `[col × 0.5, (col + 1) × 0.5)` and the same in z. Image row 0 is north.

Two cells are neighbours when they share an edge: up, down, left, right. A diagonal touch is not a join, so two greens that meet only at a corner are two targets.

**Green groups.** Take every cell whose R is 2. Split them into 4-connected groups. Order the groups by a stable scan so every client numbers them the same way: walk rows from north to south and, within a row, columns from west to east; the first unseen green cell starts the next group. Group 0 is the first, then 1, and so on. Nothing in the file stores this number.

**The tee.** Take every cell whose R is 4 and split the same way. A playable range has exactly one group. Zero groups or more than one is an invalid range: do not start play.

**A fairway** is any cell whose R is 1. Do not group them into holes, and do not put a flag on them.

## Pins and the tee

The pin rule is the one in the format spec, applied per green group instead of per hole. "Owned by the hole" becomes "in this group".

For each green group, the host:

1. Tries random cells of that group. Accepts the first whose surrounding ring, about 3 m out, is also cells of **that same group**, so the pin is not on the edge and not in a gap between two greens.
2. After a few failed tries, uses the group's centre: the mean of its cell centres, then the cell of the group nearest that mean.

The pin is not stored in the bundle. The host synchronizes the chosen cells, as it does for a course.

**Ball start.** There is no route, so there is no stored tee point. Use the tee group's centre the same way: the mean of the tee cell centres, then the tee cell nearest that mean. That cell's centre is where the ball starts.

## What the loader checks

Same checks as a course, except the per-hole ones.

Fail the load when:

- `kind` is anything other than `course` or `range`
- `kind` is `range` and `holes` is not empty
- `kind` is `range` and any class-map G byte is not 0
- `kind` is `range` and the tee cells are not exactly one 4-connected group
- `kind` is `range` and there is no green cell

Do not require each green to be a single connected region. Do not require a route, a par, or a bounds bit.

## Example

```json
{
  "name": "Practice Range",
  "kind": "range",
  "holes": [],
  "class": { "file": "class.png", "cols": 1732, "rows": 1732, "res": 0.5 }
}
```

`class.png` for that bundle has R in the usual class values and G = 0 everywhere. One connected run of class 4 is the tee. Each connected run of class 2 is a target.
