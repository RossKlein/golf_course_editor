"""python -m course_maker serve | bake | range | validate"""
from __future__ import annotations

import argparse
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m course_maker", description="Build golf course bundles.")
    sub = ap.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="run the course maker in the browser (localhost only)")
    serve.add_argument("--data", default=".", help="folder to index for GeoTIFFs and bundles (default: current)")
    serve.add_argument("--port", type=int, default=8765)

    bake = sub.add_parser("bake", help="bake a bundle from a course_stack.tif")
    bake.add_argument("stack", help="course_stack.tif (projected, metres or feet, with an elevation band)")
    bake.add_argument("--out", required=True, help="bundle folder to write")
    bake.add_argument("--name", required=True, help="course display name")
    bake.add_argument("--attribution", default=None)
    bake.add_argument("--replace", action="store_true",
                      help="rebuild an existing bundle (built beside it first; .course_maker/ is carried over)")

    blank = sub.add_parser("range", help="write a flat 500 m bundle to draw in the editor")
    blank.add_argument("--out", required=True, help="bundle folder to write")
    blank.add_argument("--name", default="Practice Range", help="course display name")
    blank.add_argument("--replace", action="store_true",
                       help="rebuild an existing bundle (built beside it first; .course_maker/ is carried over)")

    validate = sub.add_parser("validate", help="check a bundle against the format spec")
    validate.add_argument("bundle", help="bundle folder containing course.json")

    openapi = sub.add_parser("openapi", help="write the API schema (the web app's types are generated from it)")
    openapi.add_argument("--out", default="web/openapi.json")

    a = ap.parse_args(argv)
    if a.command == "openapi":
        import json

        from .server.app import create_app

        Path(a.out).write_text(json.dumps(create_app(".").openapi(), indent=2) + "\n", encoding="utf-8")
        print(f"wrote {a.out}")
        return 0
    if a.command == "serve":
        import uvicorn

        from .server.app import create_app

        app = create_app(a.data)
        print(f"Course maker: http://127.0.0.1:{a.port}  (indexing {Path(a.data).resolve()}; Ctrl+C to stop)")
        uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning")
        return 0

    from .compiler.validate import format_report, validate_bundle

    if a.command == "bake":
        from .compiler.bake import DEFAULT_ATTRIBUTION, bake as run_bake

        try:
            course = run_bake(a.stack, a.out, a.name, a.attribution or DEFAULT_ATTRIBUTION, replace=a.replace)
        except (ValueError, FileExistsError) as exc:
            print(f"error: {exc}")
            return 1
        print(f"{course.name}: {course.height.cols}x{course.height.rows} m macro grid, "
              f"height {course.hMin:.3f}..{course.hMax:.3f} m")
        report = validate_bundle(a.out)
    elif a.command == "range":
        from .range import write_range

        try:
            course = write_range(a.out, a.name, replace=a.replace)
        except (ValueError, FileExistsError) as exc:
            print(f"error: {exc}")
            return 1
        print(f"{course.name}: {course.extent[0]:.0f}x{course.extent[1]:.0f} m, flat at {course.hMin:.0f} m")
        report = validate_bundle(a.out)
    else:
        report = validate_bundle(a.bundle)
    print(format_report(report))
    return 0 if report.ok else 1
