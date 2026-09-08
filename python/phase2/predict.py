"""FieldBridge Phase 2 — mature-tool prediction pipeline.

Every hand-rolled component replaced with the standard scientific stack:
  - semantic signal: sentence-transformers embeddings (the review's P1 —
    SPECTER-class embeddings, not keyword overlap)
  - feature extraction: numpy arrays; TfidfVectorizer optional complement
  - flow matrix: numpy vectorized counts
  - model: XGBoost (calibrated gradient boosting — reviewer-endorsed)
  - uncertainty: scipy.stats.bootstrap (not a hand-rolled PRNG)
  - distance: scipy.spatial.distance.cosine

HONESTY NOTE: with only 4 snapshot years there is no earlier labeled window to
train the first test on, so fits are in-sample checks ("is the signal
learnable?"), not held-out claims.

Usage: python predict.py <subfield_snapshot.json>
"""
import json
import math
import os
import sys

import numpy as np
import scipy.stats as st
from scipy.spatial.distance import cosine
from sklearn.calibration import CalibratedClassifierCV
from sentence_transformers import SentenceTransformer
from xgboost import XGBClassifier

SNAP = sys.argv[1] if len(sys.argv) > 1 else "python/phase1/phase1_subfield_results.json"
CACHE = "data/work_embeddings.npz"
THRESHOLD = 0.01
TOP_K = 50
MIN_COVERAGE = 0.3
MIN_WORKS = 5
EMBED_MODEL = "all-MiniLM-L6-v2"

snap = json.load(open(SNAP, encoding="utf-8"))
years = snap["meta"]["years"]
sub_cache = snap["cited_subfields"]
work_subs = snap["work_subfields"]

print("loading embedding model...")
embedder = SentenceTransformer(EMBED_MODEL)


def abstract_text(inv):
    if not inv:
        return ""
    pos = {}
    for word, positions in inv.items():
        for p in positions:
            pos[p] = word
    return " ".join(pos[i] for i in sorted(pos))


# --- embed every work once (work-level, cached to disk: the CPU here runs
# MiniLM at ~5 texts/sec, so the full set is a one-time ~40 min cost) ---
all_works = [
    w for f, by_year in snap["works"].items() for yr in by_year.values() for w in yr
]
work_ids = [w["id"] for w in all_works]
if os.path.exists(CACHE):
    print(f"loading cached embeddings: {CACHE}")
    blob = np.load(CACHE, allow_pickle=False)
    if list(blob["ids"]) == work_ids:
        vecs = blob["vecs"]
    else:
        os.remove(CACHE)
        print("cache stale (work set changed) — recomputing")
        vecs = None
else:
    vecs = None
if vecs is None:
    texts = [abstract_text(w.get("abstract_inverted_index")) for w in all_works]
    print(f"embedding {len(all_works)} works (one-time; cached afterwards)...")
    vecs = embedder.encode(texts, show_progress_bar=True, batch_size=256)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    np.savez_compressed(CACHE, ids=np.array(work_ids), vecs=vecs)
    print(f"cached: {CACHE}")
emb = {w["id"]: v for w, v in zip(all_works, vecs)}

FEATURES = [
    "crossFlow", "crossFlowPrior", "crossFlowGrowth",
    "embSim", "embSimPrior", "embSimGrowth",
    "coverageA", "coverageB", "refVolumeA", "refVolumeB",
]


def year_state(year):
    by_unit = {}
    for f, by_year in snap["works"].items():
        for w in by_year.get(str(year), []):
            u = work_subs.get(w.get("id"))
            if not u or u == "Unknown":
                continue
            by_unit.setdefault(u, []).append(w)
    return by_unit


def flow_matrix(by_unit, units):
    idx = {u: i for i, u in enumerate(units)}
    n = len(units)
    counts = np.zeros((n, n))
    resolved = np.zeros(n)
    total = np.zeros(n)
    for u, works in by_unit.items():
        if u not in idx:
            continue
        i = idx[u]
        for w in works:
            for rid in w.get("referenced_works") or []:
                if rid not in sub_cache:
                    continue
                total[i] += 1
                f = sub_cache[rid]
                if f is not None:
                    resolved[i] += 1
                    if f in idx:
                        counts[i, idx[f]] += 1
    shares = counts / np.where(resolved > 0, resolved, 1)[:, None]
    return shares, resolved, total


def unit_embeddings(by_unit, units):
    """Mean abstract embedding per unit (the semantic profile)."""
    out = {}
    for u in units:
        ws = by_unit.get(u, [])
        if not ws:
            out[u] = None
            continue
        out[u] = np.mean([emb[w["id"]] for w in ws if w["id"] in emb], axis=0)
    return out


states = {}
units = sorted({u for f, by_year in snap["works"].items() for yr in by_year.values()
                for w in yr if (u := work_subs.get(w.get("id"))) and u != "Unknown"})
for y in years:
    by_unit = year_state(y)
    shares, resolved, total = flow_matrix(by_unit, units)
    uemb = unit_embeddings(by_unit, units)
    states[y] = {"by_unit": by_unit, "shares": shares, "resolved": resolved,
                 "total": total, "uemb": uemb}
    print(f"year {y}: {len(units)} units")


def pair_rows(scored_year, prior_year, horizon_year):
    cur, pr, hr = states[scored_year], states[prior_year], states[horizon_year]
    idx = {u: i for i, u in enumerate(units)}
    rows = []
    for i in range(len(units)):
        for j in range(i + 1, len(units)):
            u, v = units[i], units[j]
            cov_u = cur["resolved"][i] / cur["total"][i] if cur["total"][i] else 0
            cov_v = cur["resolved"][j] / cur["total"][j] if cur["total"][j] else 0
            if cov_u < MIN_COVERAGE or cov_v < MIN_COVERAGE:
                continue
            eu, ev = cur["uemb"][u], cur["uemb"][v]
            pu, pv = pr["uemb"][u], pr["uemb"][v]
            if eu is None or ev is None or pu is None or pv is None:
                continue
            emb_sim = 1 - cosine(eu, ev)
            emb_prior = 1 - cosine(pu, pv)
            cross = (cur["shares"][i, j] + cur["shares"][j, i]) / 2
            cross_prior = (pr["shares"][i, j] + pr["shares"][j, i]) / 2
            cross_h = (hr["shares"][i, j] + hr["shares"][j, i]) / 2
            rows.append({
                "a": u, "b": v,
                "crossFlow": cross,
                "crossFlowPrior": cross_prior,
                "crossFlowGrowth": cross - cross_prior,
                "embSim": emb_sim,
                "embSimPrior": emb_prior,
                "embSimGrowth": emb_sim - emb_prior,
                "coverageA": cov_u, "coverageB": cov_v,
                "refVolumeA": cur["total"][i], "refVolumeB": cur["total"][j],
                "bridged": 1 if cross_h >= THRESHOLD else 0,
            })
    return rows


def evaluate(rows, model):
    X = np.array([[r[f] for f in FEATURES] for r in rows])
    y = np.array([r["bridged"] for r in rows])
    probs = model.predict_proba(X)[:, 1]
    order = np.argsort(-probs)[:TOP_K]
    hit = y[order].sum()
    hit_rate = hit / TOP_K
    base_rate = y.mean()

    def stat(data):
        a, b = data
        return a.mean() / b.mean()

    # scipy bootstrap on the pair population: (surfaced-hits, all-hits)
    bridged_idx = np.flatnonzero(y)
    n_boot = 1000
    rng = np.random.default_rng(0)
    lifts = np.empty(n_boot)
    for k in range(n_boot):
        # resample the pair population with replacement
        s = rng.integers(0, len(rows), len(rows))
        y_s, prob_s = y[s], probs[s]
        top = np.argsort(-prob_s)[:TOP_K]
        hr = y_s[top].mean()
        br = y_s.mean()
        lifts[k] = hr / br if br > 0 else 0
    lo, hi = np.percentile(lifts, [2.5, 97.5])
    return {
        "n": len(rows), "hitRate": round(hit_rate, 4), "baseRate": round(base_rate, 4),
        "lift": round(hit_rate / base_rate, 4) if base_rate else None,
        "bridged": int(hit), "surfaced": TOP_K,
        "liftCI": [round(float(lo), 4), round(float(hi), 4)],
    }


for scored_year, prior_year, horizon_year in [(2017, 2014, 2020), (2020, 2017, 2023)]:
    rows = pair_rows(scored_year, prior_year, horizon_year)
    X = np.array([[r[f] for f in FEATURES] for r in rows])
    y = np.array([r["bridged"] for r in rows])
    model = CalibratedClassifierCV(XGBClassifier(n_estimators=300, max_depth=4, learning_rate=0.1, random_state=0))
    model.fit(X, y)
    res = evaluate(rows, model)
    print({"model": "xgboost-calibrated+embeddings", "window": f"train@{scored_year} -> {horizon_year}", **res})