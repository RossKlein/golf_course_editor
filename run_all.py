#!/usr/bin/env python3
"""Run fetch_3dep.py + course_stack.py for every CONUS course in course_bounds.csv.

  python run_all.py --out courses --workers 6 [--limit N] [--only NAME ...]

Each course goes to <out>/<name>/ (course_stack.tif, course_rgb.tif, preview.jpg, sources.txt, dem_1m.tif).
Finished courses are skipped, so reruns resume. Transient failures retry with exponential backoff
(exit code 2 from the scripts = no coverage, never retried). Results are logged to <out>/results.csv.
"""
import argparse, csv, os, random, shutil, subprocess, sys, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
lock = threading.Lock()


def run(cmd):
    p = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr).strip().splitlines()[-1:] or [""]


def process(name, out, retries, base):
    final = os.path.join(out, name)
    if os.path.exists(os.path.join(final, "course_stack.tif")):
        return name, "skipped", ""
    tmp = final + ".tmp"
    last = ""
    for attempt in range(retries + 1):
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        dem = os.path.join(tmp, "dem_1m.tif")
        code, msg = run([PY, "fetch_3dep.py", "--name", name, "--out", dem])
        if code == 0:
            code, msg = run([PY, "course_stack.py", "--dem", dem, "--out", tmp])
        last = msg[0]
        if code == 0:
            shutil.rmtree(final, ignore_errors=True)
            os.rename(tmp, final)
            return name, "ok", ""
        if code == 2:
            shutil.rmtree(tmp, ignore_errors=True)
            return name, "no_coverage", last
        if attempt < retries:
            time.sleep(base * 2 ** attempt + random.uniform(0, base))   # exponential backoff + jitter
    shutil.rmtree(tmp, ignore_errors=True)
    return name, "failed", last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="courses")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--retries", type=int, default=5)
    ap.add_argument("--backoff", type=float, default=2.0, help="base delay in seconds")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--only", nargs="+")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    with open(os.path.join(HERE, "course_bounds.csv")) as f:
        names = [r["name"].rsplit(".", 1)[0] for r in csv.DictReader(f) if r["in_conus_box"] == "True"]
    if a.only:
        names = [n for n in names if n in a.only]
    if a.limit:
        names = names[:a.limit]
    print(f"{len(names)} courses, {a.workers} workers")

    log = os.path.join(a.out, "results.csv")
    new = not os.path.exists(log)
    counts = {}
    with open(log, "a", newline="") as lf, ThreadPoolExecutor(a.workers) as ex:
        w = csv.writer(lf)
        if new:
            w.writerow(["name", "status", "detail"])
        futs = [ex.submit(process, n, a.out, a.retries, a.backoff) for n in names]
        for i, fu in enumerate(as_completed(futs), 1):
            name, status, detail = fu.result()
            counts[status] = counts.get(status, 0) + 1
            w.writerow([name, status, detail]); lf.flush()
            print(f"[{i}/{len(names)}] {name}: {status} {detail}")
    print(counts)


if __name__ == "__main__":
    main()
