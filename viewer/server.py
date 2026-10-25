"""Tiny stdlib HTTP server: the static page, the bundle's files and the aerial layer. No state, no writes."""
from __future__ import annotations

import json
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from compiler.schema import Course

from .aerial import build_aerial

STATIC = Path(__file__).parent / "static"


def safe_join(root: Path, rel: str) -> Path | None:
    """root / rel if it stays inside root and is a file, else None."""
    path = (root / rel).resolve()
    return path if root.resolve() in path.parents and path.is_file() else None


def make_server(bundle, stack, port: int = 8765, cache_dir=None) -> ThreadingHTTPServer:
    bundle = Path(bundle).resolve()
    course = Course.parse(json.loads((bundle / "course.json").read_text(encoding="utf-8")))
    cache = Path(cache_dir) if cache_dir else bundle.parent / ".viewer-cache" / bundle.name
    state: dict = {}

    def aerial():
        if "aerial" not in state:  # built on first request; reused afterwards
            state["aerial"] = build_aerial(stack, course, cache)
        return state["aerial"]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # quiet
            pass

        def send_bytes(self, body: bytes, content_type: str, status=HTTPStatus.OK):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")  # a dev tool: always show the latest bake
            self.end_headers()
            self.wfile.write(body)

        def send_file(self, path: Path | None):
            if path is None:
                return self.send_bytes(b"not found", "text/plain", HTTPStatus.NOT_FOUND)
            kind = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self.send_bytes(path.read_bytes(), kind)

        def do_GET(self):
            route = unquote(urlsplit(self.path).path)
            try:
                if route in ("/", "/index.html"):
                    return self.send_file(STATIC / "index.html")
                if route.startswith("/static/"):
                    return self.send_file(safe_join(STATIC, route[len("/static/"):]))
                if route.startswith("/bundle/"):
                    return self.send_file(safe_join(bundle, route[len("/bundle/"):]))
                if route == "/aerial.jpg":
                    return self.send_file(aerial()[0])
                if route == "/aerial.json":
                    return self.send_bytes(json.dumps(aerial()[1]).encode(), "application/json")
            except (ValueError, OSError) as exc:  # e.g. stack CRS mismatch, unreadable stack
                return self.send_bytes(str(exc).encode(), "text/plain", HTTPStatus.INTERNAL_SERVER_ERROR)
            self.send_bytes(b"not found", "text/plain", HTTPStatus.NOT_FOUND)

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)
