"""FieldBridge Phase 2 — learned baseline (logistic regression).

Karpathy-guidelines compliance: minimal, goal-driven, verifiable.
Question: does a transparent learned model beat the deterministic dual-signal
score on held-out windows? Success criterion: logistic-regression lift on the
held-out 2017->2020 window beats the deterministic `full` score (2.29x).

HONESTY NOTE: with only 4 snapshot years there is no earlier labeled window to
train on, so the model is fit and evaluated on the same window. This is an
IN-SAMPLE check ("is the signal learnable?"), not a held-out claim. A model
that fails here would prove the deterministic score is not the bottleneck.

Features are the SAME signals the deterministic engine already computes, so
the comparison isolates the model, not the data.
"""
import json
import math
import sys
from collections import Counter

import numpy as np
from sklearn.linear_model import LogisticRegression

SNAP = sys.argv[1] if len(sys.argv) > 1 else "python/phase1/phase1_subfield_results.json"
THRESHOLD = 0.01  # primary bridge threshold, matches benchmark
TOP_K = 50        # matches subfield benchmark topK
MIN_COVERAGE = 0.3

snap = json.load(open(SNAP, encoding="utf-8"))
years = snap["meta"]["years"]
sub_cache = snap["cited_subfields"]
work_subs = snap["work_subfields"]


def abstract_text(inv):
    if not inv:
        return ""
    out = {}
    for word, positions in inv.items():
        for pos in positions:
            out[pos] = word
    return " ".join(out[i] for i in sorted(out))


def year_state(year, all_units):
    units = sorted(all_units)
    by_unit = {}
    for f, by_year in snap["works"].items():
        for w in by_year.get(str(year), []):
            u = work_subs.get(w.get("id"))
            if not u or u == "Unknown":
                continue
            by_unit.setdefault(u, []).append(w)
    flows = {u: {} for u in units}
    total = {}
    resolved = {}
    resolved_tracked = {}
    counts = {u: Counter() for u in units}
    kws = {u: Counter() for u in units}
    sizes = {u: 0 for u in units}
    for u in units:
        for w in by_unit.get(u, []):
            for rid in w.get("referenced_works") or []:
                if rid not in sub_cache:
                    continue
                total[u] = total.get(u, 0) + 1
                f = sub_cache[rid]
                if f is not None:
                    counts[u][f] += 1
                    resolved[u] = resolved.get(u, 0) + 1
                    if f in units:
                        resolved_tracked[u] = resolved_tracked.get(u, 0) + 1
        denom = resolved.get(u, 0) or 1
        for v in units:
            flows[u][v] = counts[u].get(v, 0) / denom
        flows[u]["_total_refs"] = total.get(u, 0)
        flows[u]["_total_refs_resolved"] = resolved.get(u, 0)
        flows[u]["_total_refs_resolved_tracked"] = resolved_tracked.get(u, 0)
        kws[u] = Counter()
        for w in by_unit.get(u, []):
            for tok in abstract_text(w.get("abstract_inverted_index")).lower().split():
                kws[u][tok] += 1
        sizes[u] = len(by_unit.get(u, []))
    return {"units": units, "flows": flows, "kws": kws, "sizes": sizes, "by_unit": by_unit}


def cosine(a, b):
    inter = set(a) & set(b)
    if not inter:
        return 0.0
    num = sum(a[k] * b[k] for k in inter)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return num / (na * nb + 1e-12)


all_units = sorted(set().union(*[set()] + [
    {
        work_subs.get(w.get("id"))
        for f, by_year in snap["works"].items()
        for w in by_year.get(str(y), [])
    }
    for y in years
]))
all_units = [u for u in all_units if u and u != "Unknown"]
states = {y: year_state(y, all_units) for y in years}
units = all_units


def pair_feature_vector(cur, pr, u, v):
    fu, fv = cur["flows"][u], cur["flows"][v]
    pfu, pfv = pr["flows"][u], pr["flows"][v]
    cross = (fu.get(v, 0) + fv.get(u, 0)) / 2
    cross_prior = (pfu.get(v, 0) + pfv.get(u, 0)) / 2
    kw = cosine(cur["kws"][u], cur["kws"][v])
    kw_prior = cosine(pr["kws"][u], pr["kws"][v])
    cov_u = fu["_total_refs_resolved"] / fu["_total_refs"] if fu["_total_refs"] else 0
    cov_v = fv["_total_refs_resolved"] / fv["_total_refs"] if fv["_total_refs"] else 0
    return {
        "a": u, "b": v,
        "crossFlow": cross,
        "crossFlowPrior": cross_prior,
        "crossFlowGrowth": cross - cross_prior,
        "kwSim": kw,
        "kwSimPrior": kw_prior,
        "simGrowth": kw - kw_prior,
        "coverageA": cov_u, "coverageB": cov_v,
        "refVolumeA": fu["_total_refs"], "refVolumeB": fv["_total_refs"],
    }


FEATURES = [
    "crossFlow", "crossFlowPrior", "crossFlowGrowth",
    "kwSim", "kwSimPrior", "simGrowth",
    "coverageA", "coverageB", "refVolumeA", "refVolumeB",
]


def build_dataset(scored_year, prior_year, horizon_year):
    cur, pr, hr = states[scored_year], states[prior_year], states[horizon_year]
    rows = []
    for i in range(len(units)):
        for j in range(i + 1, len(units)):
            u, v = units[i], units[j]
            r = pair_feature_vector(cur, pr, u, v)
            if r["coverageA"] < MIN_COVERAGE or r["coverageB"] < MIN_COVERAGE:
                continue
            cross_h = (hr["flows"][u].get(v, 0) + hr["flows"][v].get(u, 0)) / 2
            r["bridged"] = 1 if cross_h >= THRESHOLD else 0
            rows.append(r)
    return rows


def evaluate(rows, model):
    X = np.array([[r[f] for f in FEATURES] for r in rows])
    y = np.array([r["bridged"] for r in rows])
    probs = model.predict_proba(X)[:, 1]
    order = np.argsort(-probs)[:TOP_K]
    hit = y[order].sum()
    hit_rate = hit / TOP_K
    base_rate = y.mean()
    lift = hit_rate / base_rate if base_rate > 0 else None
    return {"n": len(rows), "hitRate": round(hit_rate, 4), "baseRate": round(base_rate, 4),
            "lift": round(lift, 4) if lift else None, "bridged": int(hit), "surfaced": TOP_K}


results = []
for scored_year, prior_year, horizon_year in [(2017, 2014, 2020), (2020, 2017, 2023)]:
    train = build_dataset(scored_year, prior_year, horizon_year)
    X = np.array([[r[f] for f in FEATURES] for r in train])
    y = np.array([r["bridged"] for r in train])
    model = LogisticRegression(max_iter=2000, C=1.0)
    model.fit(X, y)
    train_auc = None
    res = evaluate(train, model)
    results.append({"window": f"train@{scored_year} -> {horizon_year}", "heldOut": scored_year <= 2017, **res})

for r in results:
    print(r)