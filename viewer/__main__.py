import argparse

from .server import make_server

ap = argparse.ArgumentParser(description="View a course bundle in the browser (localhost only).")
ap.add_argument("--bundle", required=True, help="bundle directory containing course.json")
ap.add_argument("--stack", required=True, help="the course_stack.tif the bundle was baked from (for the aerial layer)")
ap.add_argument("--port", type=int, default=8765)
a = ap.parse_args()
server = make_server(a.bundle, a.stack, a.port)
print(f"Viewing {a.bundle} at http://127.0.0.1:{server.server_address[1]}  (Ctrl+C to stop)")
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
