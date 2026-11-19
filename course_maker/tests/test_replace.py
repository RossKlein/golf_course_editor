"""Replacing a file that something else is reading. Run with python -m unittest discover -s course_maker/tests -t ."""
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from course_maker.project import store
from course_maker.project.store import atomic_write, replace_file


class ReplaceFileTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.src, self.dst = self.dir / "a.tmp", self.dir / "a.json"
        self.src.write_text("new")
        self.dst.write_text("old")
        self.real = os.replace

    def refusing(self, times, error=PermissionError("Access is denied")):
        calls = {"n": 0}

        def replace(a, b):
            calls["n"] += 1
            if calls["n"] <= times:
                raise error
            return self.real(a, b)

        return calls, replace

    def test_it_replaces_the_file(self):
        replace_file(self.src, self.dst)
        self.assertEqual(self.dst.read_text(), "new")
        self.assertFalse(self.src.exists())

    @unittest.skipUnless(os.name == "nt", "the retry is for Windows")
    def test_a_refusal_for_a_moment_is_waited_out(self):
        calls, replace = self.refusing(3)
        with mock.patch.object(store.os, "replace", replace), mock.patch.object(store.time, "sleep") as sleep:
            replace_file(self.src, self.dst)
        self.assertEqual((calls["n"], sleep.call_count), (4, 3))
        self.assertEqual(self.dst.read_text(), "new")

    @unittest.skipUnless(os.name == "nt", "the retry is for Windows")
    def test_a_refusal_that_does_not_end_is_raised_after_about_a_second(self):
        calls, replace = self.refusing(10_000)
        with mock.patch.object(store.os, "replace", replace), mock.patch.object(store.time, "sleep"):
            with self.assertRaises(PermissionError):
                replace_file(self.src, self.dst)
        self.assertEqual(calls["n"], store.REPLACE_ATTEMPTS)

    def test_another_error_is_not_retried(self):
        calls, replace = self.refusing(10_000, FileNotFoundError("gone"))
        with mock.patch.object(store.os, "replace", replace), mock.patch.object(store.time, "sleep") as sleep:
            with self.assertRaises(FileNotFoundError):
                replace_file(self.src, self.dst)
        self.assertEqual((calls["n"], sleep.call_count), (1, 0))

    def test_a_reader_going_at_the_same_time_does_not_make_the_write_fail(self):
        # Reads the file over and over while it is replaced over and over, as a build copying the design does while the editor saves.
        # Without the retry this fails on Windows within a few replacements.
        path = self.dir / "macro.delta"
        path.write_bytes(b"x" * 200_000)
        stop = threading.Event()
        errors = []

        def reader():
            while not stop.is_set():
                try:
                    path.read_bytes()
                except OSError as e:  # a read can also lose the race; that is not what is being tested
                    errors.append(e)

        t = threading.Thread(target=reader, daemon=True)
        t.start()
        try:
            for n in range(150):
                atomic_write(path, f"{n}" * 5000)
        finally:
            stop.set()
            t.join()
        self.assertEqual(path.read_text(), "149" * 5000)
        self.assertEqual(sorted(p.name for p in self.dir.glob("*.tmp")), ["a.tmp"])  # no temporary file is left behind


if __name__ == "__main__":
    unittest.main()
