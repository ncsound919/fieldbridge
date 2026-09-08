"""FieldBridge Phase 1 — Full-matrix ingestion pipeline.

Samples works across ALL OpenAlex fields for two periods (current + baseline)
so the gap engine has a real sim-growth basis, resolves a *bounded* subset of
each field's references (budget: free tier is 10,000 credits/day, list=1),
and writes a snapshot the TS engine (src/lib) consumes.

Budget model (measured on live data, 2026-09):
  - /works sampling:   list (1 credit) per page of 100
  - reference resolve: list (1 credit) per batch of 50
  A 26-field x 2-year x 150-work run with 1,000 refs/field/year resolved is
  ~1,150 credits. --credit-cap aborts before overspending.

Usage:
    python run.py [--sample 150] [--years 2018,2023] [--max-refs 1000]
                  [--credit-cap 4000] [--out phase1_results.json]
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


class Ledger:
    """Tracks real OpenAlex credit spend (list=1, search=10, singleton=0)."""

    def __init__(self, daily_free=10_000, cap=None):
        self.credits = 0
        self.calls = 0
        self.daily_free = daily_free
        self.cap = cap

    def add(self, kind="list"):
        self.credits += {"list": 1, "search": 10}.get(kind, 0)
        self.calls += 1
        if self.cap and self.credits > self.cap:
            raise BudgetExceeded(self.credits, self.cap)

    def report(self):
        pct = 100 * self.credits / self.daily_free
        return (f"credits: {self.credits:,} / {self.daily_free:,}/day "
                f"({pct:.1f}%) over {self.calls} calls")


class BudgetExceeded(Exception):
    def __init__(self, used, cap):
        super().__init__(f"credit cap {cap} exceeded at {used}")
        self.used = used
        self.cap = cap


LEDGER = Ledger()


def _params(extra=None):
    p = {"api_key": os.environ.get("OPENALEX_API_KEY", ""),
         "mailto": os.environ.get("OPENALEX_EMAIL", "")}
    if extra:
        p.update(extra)
    return {k: v for k, v in p.items() if v}


def get(path, params, ledger_kind="list", retries=6):
    """GET with 429/5xx exponential backoff; credits counted once per 200."""
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


def list_fields():
    """All OpenAlex fields (taxonomy is small, one list call)."""
    data = get("/fields", _params({"per-page": 100, "select": "id,display_name"}))
    return [(f["display_name"], f["id"].rsplit("/", 1)[-1]) for f in data.get("results", [])]


def sample_works(field_id, pub_year, sample_size, select="id,abstract_inverted_index,referenced_works,primary_topic"):
    """Cursor-page recent works in a field+year. Returns list of work dicts."""
    works, cursor = [], "*"
    flt = (f"primary_topic.field.id:{field_id},publication_year:{pub_year},"
           f"has_references:true")
    while len(works) < sample_size:
        params = _params({"filter": flt, "per-page": 100, "cursor": cursor,
                          "select": select, "sort": "publication_date"})
        data = get("/works", params)
        results = data.get("results", [])
        if not results:
            break
        works.extend(results)
        cursor = data.get("meta", {}).get("next_cursor")
        if not cursor:
            break
    return works[:sample_size]


def resolve_cited_fields(ref_ids, cache, sub_cache):
    """Batch-resolve the field AND subfield of cited work IDs (50 per request).

    Field-level resolution keeps the 26-column matrix (legacy). Subfield-level
    resolution (OpenAlex: 252 subfields) is the granularity at which
    interdisciplinary link prediction is statistically viable (~31k pairs vs
    325), per the science-of-science literature (FOS benchmark, arXiv 2025).

    Outside-field display names keep their raw name and count toward `total`
    refs but not any tracked column (see buildFlowMatrix denominator).
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
            subfield = (topic.get("subfield") or {})
            cache[w["id"]] = field.get("display_name", "Unknown")
            sub_cache[w["id"]] = subfield.get("display_name", "Unknown")
    for w in todo:
        cache.setdefault(w, None)
        sub_cache.setdefault(w, None)


def deterministic_subset(refs, cap):
    """Deterministic bounded subset of refs.

    If the set exceeds the cap, stride-sample across the sorted order so the
    subset spreads over the full reference range instead of taking a biased
    prefix (OpenAlex IDs are roughly chronological). Reproducible across runs.
    """
    if len(refs) <= cap:
        return refs
    sorted_refs = sorted(refs)
    step = len(sorted_refs) / cap
    return [sorted_refs[int(i * step)] for i in range(cap)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=150, help="works sampled per field-year")
    ap.add_argument("--years", default="2018,2023", help="baseline,current publication years")
    ap.add_argument("--max-refs", type=int, default=1000, help="refs resolved per field-year (cap)")
    ap.add_argument("--credit-cap", type=int, default=4000, help="abort if credits exceed this")
    ap.add_argument("--out", default="phase1_results.json", help="output path")
    args = ap.parse_args()

    key = os.environ.get("OPENALEX_API_KEY")
    if not key:
        sys.exit("Set OPENALEX_API_KEY (openalex.org/settings/api) — or place it in .env")

    LEDGER.cap = args.credit_cap
    years = [int(y) for y in args.years.split(",") if y.strip()]
    if len(years) < 2:
        sys.exit("--years needs two values: baseline,current (e.g. 2018,2023)")

    fields = list_fields()
    print(f"FieldBridge Phase 1 — fields={len(fields)}, sample={args.sample}/field/year, "
          f"years={years}, max-refs/field/year={args.max_refs}\n")

    works_by_field = {}
    cited_cache = {}
    sub_cache = {}
    work_subfields = {}
    for display_name, fid in fields:
        works_by_field[display_name] = {}
        for year in years:
            print(f"sampling {display_name} ({fid}) {year}...")
            works = sample_works(fid, year, args.sample)
            works_by_field[display_name][str(year)] = works
            # Record each sampled work's own subfield (primary_topic.subfield).
            # Needed to group works by subfield for a true subfield×subfield
            # flow matrix; sampling is field-stratified but the works' own
            # granularity is finer.
            for w in works:
                topic = w.get("primary_topic") or {}
                subfield = (topic.get("subfield") or {}).get("display_name", "Unknown")
                work_subfields[w["id"]] = subfield
                # keep the snapshot lean: strip the nested topic from the work
                w.pop("primary_topic", None)
            refs = deterministic_subset(
                {r for w in works for r in (w.get("referenced_works") or [])},
                args.max_refs,
            )
            print(f"  {len(works)} works, {len(refs)} refs to resolve")
            resolve_cited_fields(list(refs), cited_cache, sub_cache)

    out = {
        "meta": {
            "pipeline": "phase1",
            "sample_size": args.sample,
            "years": years,
            "max_refs_per_field_year": args.max_refs,
            "fields": [d for d, _ in fields],
        },
        "works": works_by_field,
        "cited_fields": cited_cache,
        "cited_subfields": sub_cache,
        "work_subfields": work_subfields,
    }
    with open(args.out, "w") as fh:
        json.dump(out, fh, indent=2)
    print(f"\nsaved: {args.out}")
    print(f"OpenAlex spend — {LEDGER.report()}")


if __name__ == "__main__":
    main()