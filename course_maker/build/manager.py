"""Runs builds in the background: debounced, one at a time per bundle, with a status the editor polls."""
from __future__ import annotations

import threading
import time
from pathlib import Path

from pydantic import ValidationError

from ..design.models import BuildStatus
from ..design.store import DesignError, snapshot
from .build import build_bundle


class BuildManager:
    def __init__(self, debounce: float = 0.8):
        self.debounce = debounce
        self._lock = threading.Lock()
        self._status: dict[str, BuildStatus] = {}
        self._timers: dict[str, threading.Timer] = {}
        self._running: set[str] = set()
        self._dirty: set[str] = set()

    @staticmethod
    def _key(bundle) -> str:
        return str(Path(bundle).resolve())

    def status(self, bundle) -> BuildStatus:
        with self._lock:
            return self._status.get(self._key(bundle), BuildStatus()).model_copy()

    def schedule(self, bundle, delay: float | None = None) -> None:
        """Build soon; further calls before it fires push it back, so a burst of edits makes one build."""
        key = self._key(bundle)
        with self._lock:
            if key in self._timers:
                self._timers[key].cancel()
            timer = threading.Timer(self.debounce if delay is None else delay, self.run_now, args=(bundle,))
            timer.daemon = True
            self._timers[key] = timer
            timer.start()

    def run_now(self, bundle) -> BuildStatus:
        """Build now, on the calling thread. If a build is already running, ask it to go again and return."""
        key = self._key(bundle)
        with self._lock:
            self._timers.pop(key, None)
            if key in self._running:
                self._dirty.add(key)
                return self._status.get(key, BuildStatus()).model_copy()
            self._running.add(key)
        try:
            while True:
                with self._lock:
                    self._dirty.discard(key)
                    prev = self._status.get(key, BuildStatus())
                    self._status[key] = prev.model_copy(update={"state": "building", "started": time.time(), "error": None})
                self._build_once(bundle, key)
                with self._lock:
                    if key not in self._dirty:
                        break
        finally:
            with self._lock:
                self._running.discard(key)
        return self.status(bundle)

    def _build_once(self, bundle, key: str) -> None:
        prev = self._status[key]
        try:
            snapshot(Path(bundle))  # rolling backup of the design, skipped when unchanged
            out = build_bundle(bundle)
            new = prev.model_copy(update={
                "id": prev.id + 1, "state": "done", "finished": time.time(), "report": out.report, "notes": out.notes,
                "error": None, "ms": out.ms, "regions": out.regions, "holes": out.holes,
            })
        except (DesignError, ValidationError, ValueError, OSError) as exc:
            # the previous bundle is untouched; say why. `id` does not change, so the viewer does not reload.
            new = prev.model_copy(update={"state": "failed", "finished": time.time(), "error": str(exc)[:500]})
        with self._lock:
            self._status[key] = new

    def wait_idle(self, bundle, timeout: float = 20.0) -> BuildStatus:
        """For tests and the CLI: wait for a scheduled or running build to finish."""
        key = self._key(bundle)
        end = time.time() + timeout
        while time.time() < end:
            with self._lock:
                busy = key in self._timers or key in self._running
            if not busy:
                break
            time.sleep(0.02)
        return self.status(bundle)
