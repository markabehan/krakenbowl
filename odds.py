#!/usr/bin/env python3
"""
Finishing-place odds for a season still being played.

Follows the commissioner's permutations.py: every remaining regular season
game is a coin flip, every combination of results is played out, and each
one is ranked the way the league seeds - win ratio, then the season's
tiebreak among the tied teams, then points for. Points for stays at what
each team has scored so far; nobody knows the future scores, so a points
tiebreak (and the wildcard, which is the highest scorer outside the top
five) is judged on the points already banked.

Up to 2^22 combinations are played out in full. Beyond that (early in a
season) a fixed random sample of 2^20 is used instead, so the build stays
quick and its output stays the same from run to run.
"""

import numpy as np

EXHAUSTIVE_MAX = 22         # games; 2^22 = 4.2 million combinations
SAMPLE = 1 << 20            # combinations when there are too many to list
CHUNK = 1 << 15             # combinations ranked at a time


def playoff_odds(standings, regular, upcoming, rule, fmt):
    """Odds of each standings place, of an automatic playoff place (the top
    five in a wildcard season), of the wildcard and of a bye.

    `regular` is the regular season games played so far, `upcoming` the
    fixtures still to come as (week, coach, coach). Returns None when there
    is nothing left to play or the tiebreak can't be vectorised.
    """
    if not upcoming or rule not in ("group-ratio", "group-record"):
        return None
    coaches = [r["coach"] for r in standings]
    n = len(coaches)
    at = {c: i for i, c in enumerate(coaches)}
    size, kind = fmt
    size = min(size, n)

    # Win score in half-wins, so a tied game counts half; head-to-head wins
    # so far between every pair; points for, frozen.
    score = np.array([2 * r["w"] + r["t"] for r in standings], dtype=np.int32)
    pf = np.array([r["pf"] for r in standings])
    h2h = np.zeros((n, n), dtype=np.int32)
    for m in regular:
        a, b = m["home"], m["away"]
        if a["points"] != b["points"]:
            win, lose = (a, b) if a["points"] > b["points"] else (b, a)
            h2h[at[win["coach"]], at[lose["coach"]]] += 1

    games = [(at[a], at[b]) for _, a, b in upcoming if a in at and b in at]
    g = len(games)
    exhaustive = g <= EXHAUSTIVE_MAX
    total = (1 << g) if exhaustive else SAMPLE

    # One-hot maps from "game k went to its first team" (bit 1) or to its
    # second (bit 0) onto win scores and onto the head-to-head grid.
    first = np.zeros((g, n), dtype=np.int32)
    second = np.zeros((g, n), dtype=np.int32)
    beat_ab = np.zeros((g, n * n), dtype=np.int32)
    beat_ba = np.zeros((g, n * n), dtype=np.int32)
    for k, (a, b) in enumerate(games):
        first[k, a] = second[k, b] = 1
        beat_ab[k, a * n + b] = beat_ba[k, b * n + a] = 1

    places = np.zeros((n, n), dtype=np.int64)      # coach x standings place
    top = np.zeros(n, dtype=np.int64)              # an automatic place
    wilds = np.zeros(n, dtype=np.int64)            # the wildcard
    byes = np.zeros(n, dtype=np.int64)
    rng = np.random.default_rng(2026)
    shift = np.arange(g, dtype=np.uint64)
    eye = np.eye(n, dtype=bool)
    cols = np.arange(n)

    for start in range(0, total, CHUNK):
        m = min(CHUNK, total - start)
        if exhaustive:
            ids = np.arange(start, start + m, dtype=np.uint64)
            bits = ((ids[:, None] >> shift) & 1).astype(np.int32)
        else:
            bits = rng.integers(0, 2, size=(m, g), dtype=np.int32)
        lost = 1 - bits

        s = score + 2 * (bits @ first + lost @ second)
        h = (h2h.ravel() + bits @ beat_ab + lost @ beat_ba).reshape(m, n, n)
        tied = (s[:, :, None] == s[:, None, :]) & ~eye
        hw = (h * tied).sum(2)
        hl = (h.transpose(0, 2, 1) * tied).sum(2)

        if rule == "group-ratio":
            played = hw + hl
            ratio = np.where(played > 0,
                             np.round(hw / np.maximum(played, 1), 3), 0.0)
            keys = (np.broadcast_to(-pf, s.shape), -ratio, -s)
        else:
            keys = (np.broadcast_to(-pf, s.shape), hl, -hw, -s)
        order = np.lexsort(keys, axis=1)            # order[:, k] = place k+1

        np.add.at(places, (order.ravel(), np.tile(cols, m)), 1)
        # The automatic places: the top five when the last place is a
        # wildcard, else the whole bracket. The wildcard is the highest
        # scorer outside the top five.
        auto = size - 1 if kind == "wildcard" else size
        np.add.at(top, order[:, :auto].ravel(), 1)
        if kind == "wildcard":
            rest = order[:, auto:]
            np.add.at(wilds, rest[np.arange(m), np.argmax(pf[rest], axis=1)], 1)
        if size == 6:
            np.add.at(byes, order[:, :2].ravel(), 1)

    pct = lambda x: round(100 * float(x) / total, 1)
    rows = [{"coach": c,
             "places": [pct(v) for v in places[i]],
             "top": pct(top[i]),
             "wildcard": pct(wilds[i]) if kind == "wildcard" else None,
             "bye": pct(byes[i]) if size == 6 else None}
            for i, c in enumerate(coaches)]
    rows.sort(key=lambda r: [-p for p in r["places"]])
    return {"rows": rows, "games": g, "weeks": sorted({w for w, _, _ in upcoming}),
            "outcomes": total, "exhaustive": exhaustive,
            "auto": size - 1 if kind == "wildcard" else size}
