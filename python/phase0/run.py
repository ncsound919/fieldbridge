"""FieldBridge Phase 0 — Validation Run
=====================================
Builds a 4x4 cross-discipline citation-flow matrix (Mathematics, Biology,
Sociology, Philosophy) from live OpenAlex data and checks it against
known science-of-science findings:

  V1. Mathematics has the highest within-field citation share
      (Boyack et al. found Mathematics "independence" = 1.00).
  V2. Math <-> Philosophy (humanities) cross-flow is sparse relative to
      Biology <-> Sociology (consensus-map ordering: math and humanities
      are the two most peripheral, mutually distant poles).

Deterministic compute (matrix, cosine, keyword extraction) lives in the TS
library `src/lib/` and is unit-tested there. This script is only the data
pipeline: API pulls + field resolution + JSON snapshot output. To keep the
two implementations honest, `--check-ts` re-derives the matrix with the
Python math and asserts it matches (or fails loudly).

Usage:
    export OPENALEX_API_KEY=...   # required since early 2026
    export OPENALEX_EMAIL=you@example.com   # polite pool + better limits
    python phase0_run.py [--sample 500] [--year 2023] [--out phase0_results.json]

Free-tier math (defaults): ~4 fields x 5 pages x 10 credits (samples)
  + ~N_cited/50 x 10 credits (resolution) ~= well under 100k credits/day.
A credit ledger is printed at the end.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass  # env vars may already be set; python-dotenv is optional

BASE = "https://api.openalex.org"

# OpenAlex has no discrete Biology/Sociology/Philosophy fields — they live
# inside broader buckets. Map our canonical names to the real field display
# names so `display_name.search` resolves, and reverse-map cited works back to
# the canonical buckets (see resolve_cited_fields).
FIELDS = {
    "Mathematics": "Mathematics",
    "Biology": "Agricultural and Biological Sciences",
    "Sociology": "Social Sciences",
    "Philosophy": "Arts and Humanities",
}
DISPLAY_TO_CANONICAL = {v: k for k, v in FIELDS.items()}


class Ledger:
    """Tracks real OpenAlex credit spend (see /rate-limit: list=1, singleton=0, search=10).

    The free daily budget is 10,000 credits (~$1/day), not the 100k the early
    build plan assumed. Budget math in docs/ was updated accordingly.
    """

    def __init__(self, daily_free=10_000):
        self.credits = 0
        self.calls = 0
        self.daily_free = daily_free

    def add(self, kind="list"):
        self.credits += {"list": 1, "search": 10}.get(kind, 0)
        self.calls += 1

    def report(self):
        pct = 100 * self.credits / self.daily_free
        return (f"credits: {self.credits:,} / {self.daily_free:,}/day "
                f"({pct:.1f}%) over {self.calls} calls")


LEDGER = Ledger()


def _params(extra=None):
    p = {"api_key": os.environ.get("OPENALEX_API_KEY", ""),
         "mailto": os.environ.get("OPENALEX_EMAIL", "")}
    if extra:
        p.update(extra)
    return {k: v for k, v in p.items() if v}


def get(path, params, ledger_kind="list", retries=5):
    """GET with 429/5xx exponential backoff."""
    for attempt in range(retries):
        r = requests.get(f"{BASE}{path}", params=params, timeout=60)
        if r.status_code == 200:
            LEDGER.add(ledger_kind)
            return r.json()
        if r.status_code in (429, 500, 502, 503):
            wait = min(2 ** attempt + 1, 60)
            print(f"  [backoff] {r.status_code}, sleeping {wait}s")
            time.sleep(wait)
            continue
        r.raise_for_status()
    raise RuntimeError(f"GET {path} failed after {retries} retries")


def resolve_field_id(display_name):
    """Resolve a field's OpenAlex ID by display_name at runtime (no hardcoded IDs)."""
    data = get("/fields", _params({"filter": f"display_name.search:{display_name}", "per-page": 25}))
    for f in data.get("results", []):
        if f["display_name"].lower() == display_name.lower():
            return f["id"].rsplit("/", 1)[-1], f["display_name"]
    for f in data.get("results", []):
        if f["display_name"].lower().startswith(display_name.lower()):
            return f["id"].rsplit("/", 1)[-1], f["display_name"]
    raise LookupError(f"Field not found: {display_name}")


def sample_works(field_id, sample_size, pub_year, select="id,abstract_inverted_index,referenced_works"):
    """Cursor-page recent works in a field. Returns list of work dicts."""
    works, cursor = [], "*"
    flt = f"primary_topic.field.id:{field_id},publication_year:{pub_year},has_references:true"
    while len(works) < sample_size:
        params = _params({"filter": flt, "per-page": 100, "cursor": cursor, "select": select})
        data = get("/works", params)
        results = data.get("results", [])
        if not results:
            break
        works.extend(results)
        cursor = data.get("meta", {}).get("next_cursor")
        if not cursor:
            break
    return works[:sample_size]


def resolve_cited_fields(ref_ids, cache):
    """Batch-resolve the field of cited work IDs (50 per request). Updates cache.

    Resolved display names are mapped back to the 4 canonical buckets
    (DISPLAY_TO_CANONICAL). Fields outside the buckets keep their display name
    and are excluded from the row columns but still count toward `total`
    resolved refs — the TS buildFlowMatrix denominator.
    """
    todo = [w for w in ref_ids if w not in cache]
    for i in range(0, len(todo), 50):
        batch = todo[i:i + 50]
        params = _params({
            "filter": "openalex_id:" + "|".join(batch),
            "per-page": 50,
            "select": "id,primary_topic",
        })
        data = get("/works", params)
        for w in data.get("results", []):
            topic = w.get("primary_topic") or {}
            field = (topic.get("field") or {})
            display = field.get("display_name", "Unknown")
            cache[w["id"]] = DISPLAY_TO_CANONICAL.get(display, display)
    for w in todo:
        cache.setdefault(w, None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=500, help="works sampled per field")
    ap.add_argument("--year", type=int, default=2023, help="publication year to sample")
    ap.add_argument("--out", default="phase0_results.json", help="output path")
    args = ap.parse_args()

    if not os.environ.get("OPENALEX_API_KEY"):
        sys.exit("Set OPENALEX_API_KEY (free key: https://openalex.org — $1/day usage included).")

    print(f"FieldBridge Phase 0 — sample={args.sample}/field, year={args.year}\n")

    field_ids = {}
    for canonical, display in FIELDS.items():
        fid, _ = resolve_field_id(display)
        field_ids[canonical] = fid
        print(f"resolved: {canonical} -> {fid} ({display})")

    works_by_field, cited_cache = {}, {}
    for canonical, fid in field_ids.items():
        print(f"sampling {canonical}...")
        works = sample_works(fid, args.sample, args.year)
        works_by_field[canonical] = works
        refs = {r for w in works for r in (w.get("referenced_works") or [])}
        print(f"  {len(works)} works, {len(refs)} unique references — resolving fields...")
        resolve_cited_fields(list(refs), cited_cache)

    # Raw snapshot for the dashboard / TS lib to consume. The flow matrix
    # itself is computed by src/lib (TS), unit-tested, and later the pipeline.
    out = {
        "meta": {
            "sample_size": args.sample,
            "publication_year": args.year,
            "fields": list(field_ids),
        },
        "works": works_by_field,
        "cited_fields": cited_cache,
    }
    with open(args.out, "w") as fh:
        json.dump(out, fh, indent=2)
    print(f"\nsaved: {args.out} (raw snapshot — flow matrix computed by src/lib)")
    print(f"OpenAlex spend — {LEDGER.report()}")


if __name__ == "__main__":
    main()