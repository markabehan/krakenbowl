#!/usr/bin/env python3
"""
Season grades: lineup efficiency, luck via all-play, and draft picks judged
on outcome. The design and the reference numbers they are checked against are
in GRADING.md.

Everything works from what build.py already assembles for a season - the
lineups, the matchups and the draft - so no new data is needed.
"""

from collections import Counter, defaultdict
from itertools import product

# Which positions each starting slot takes.
SLOTS = {"QB": ("QB",), "RB1": ("RB",), "RB2": ("RB",), "WR1": ("WR",),
         "WR2": ("WR",), "TE": ("TE",), "W/R": ("RB", "WR"),
         "W/T": ("WR", "TE"), "K": ("K",), "DEF": ("DEF",)}


def best_lineup(players):
    """Most points a roster could have started that week.

    Uses that lineup's own starting slots: 2015-2019 had no W/T. Each flex
    slot can go a few ways; once every flex is given a position, the best
    lineup is simply the top scorers at each position. Trying every way the
    flex slots can go (four at most) therefore gives the exact optimum - the
    same answer as an assignment solver, without greedy slot-filling's trap of
    using the best RB up front and stranding a better arrangement through the
    flex.
    """
    by_pos = defaultdict(list)
    for p in players:
        if p["player"]:
            by_pos[p["pos"]].append(p["pts"])
    for pts in by_pos.values():
        pts.sort(reverse=True)

    slots = [SLOTS.get(p["slot"], (p["slot"],)) for p in players if not p["bench"]]
    fixed = Counter(s[0] for s in slots if len(s) == 1)
    flex = [s for s in slots if len(s) > 1]
    best = 0.0
    for choice in product(*flex):
        need = fixed + Counter(choice)
        best = max(best, sum(sum(by_pos[pos][:n]) for pos, n in need.items()))
    return best


def lineup_efficiency(lineups):
    """Started v best possible, every week with a lineup (playoffs too)."""
    out = defaultdict(lambda: {"started": 0.0, "optimal": 0.0, "weeks": 0})
    for key, players in lineups.items():
        coach = key.split("|", 1)[1]
        o = out[coach]
        o["started"] += sum(p["pts"] for p in players if not p["bench"])
        o["optimal"] += best_lineup(players)
        o["weeks"] += 1
    rows = []
    for coach, o in out.items():
        started, optimal = o["started"], o["optimal"]
        rows.append({"coach": coach, "started": round(started, 1),
                     "optimal": round(optimal, 1),
                     "benched": round(optimal - started, 1),
                     "benchedPerWeek": round((optimal - started) / o["weeks"], 1),
                     "efficiency": round(started / optimal, 4) if optimal else 0,
                     "weeks": o["weeks"]})
    rows.sort(key=lambda r: -r["efficiency"])
    return rows


def all_play(scores, standings):
    """Each week's score against every other team, not just the one drawn.

    Regular season only. Luck is actual wins minus the wins the all-play
    percentage says the scoring deserved over the games played. Ties count
    as neither a win nor a loss on both sides.
    """
    weeks = defaultdict(list)
    for r in scores:
        weeks[r["week"]].append(r)
    ap = defaultdict(lambda: [0, 0])
    for rows in weeks.values():
        for r in rows:
            for o in rows:
                if o is not r:
                    if r["pts"] > o["pts"]:
                        ap[r["coach"]][0] += 1
                    elif r["pts"] < o["pts"]:
                        ap[r["coach"]][1] += 1
    out = []
    for s in standings:
        w, l = ap[s["coach"]]
        pct = w / (w + l) if w + l else 0
        out.append({"coach": s["coach"], "w": s["w"], "l": s["l"], "t": s["t"],
                    "apW": w, "apL": l, "apPct": round(pct, 4),
                    "luck": round(s["w"] - pct * s["games"], 1)})
    return out


# --------------------------------------------------------------------------
# drafts
# --------------------------------------------------------------------------

# The draft board sometimes uses a name the weekly data didn't: Washington's
# defence went from Redskins to Football Team to Commanders.
DEF_SAME = [{"redskins", "team", "commanders"}]


def _plain(name):
    for suffix in (" Jr.", " Sr.", " III", " II", " IV"):
        name = name.replace(suffix, "")
    return " ".join(name.replace(".", ". ").split()).lower()


def _key(name, pos):
    """Initial and surname - how 2015-2024 lineups write a player - or the
    nickname for a defence."""
    words = _plain(name).split()
    if pos == "DEF":
        last = words[-1]
        for same in DEF_SAME:
            if last in same:
                return ("DEF", frozenset(same))
        return ("DEF", last)
    return (pos, words[0][0], " ".join(w for w in words[1:]
                                       if not (len(w) == 2 and w.endswith("."))))


def draft_outcomes(draft, lineups, regular_weeks):
    """Each pick's points while rostered in this league, regular season.

    `raw/gameweeks.csv` only holds a player while he is on a roster here, so
    a pick dropped before week 1 scores nothing - that is the stated
    limitation, and a verdict of sorts in itself. A player who changed NFL
    team mid-season keeps only the points from his drafted team in the
    2015-2024 data, where names are abbreviated.
    """
    if not draft:
        return None
    regular = set(regular_weeks)
    # Every rostered week of every player: (player text, nfl, pos) -> rows.
    seen = defaultdict(list)
    first_on = {}                       # identity -> {coach: first week}
    for key, players in lineups.items():
        week, coach = key.split("|", 1)
        week = int(week)
        for p in players:
            if not p["player"]:
                continue
            ident = (p["player"], p["nfl"], p["pos"])
            if week in regular:
                seen[ident].append(p["pts"])
            first_on.setdefault(ident, {})
            first_on[ident][coach] = min(first_on[ident].get(coach, 99), week)

    exact = defaultdict(list)           # plain full name -> identities
    by_key = defaultdict(list)          # abbreviated key -> identities
    for ident in first_on:
        exact[_plain(ident[0])].append(ident)
        by_key[_key(ident[0], ident[2])].append(ident)

    def find(name, pos, coach):
        # Full names (the Sleeper era) match exactly, whatever the position:
        # Sleeper lists a two-way player under one position only.
        if _plain(name) in exact:
            return exact[_plain(name)]
        cands = by_key.get(_key(name, pos), [])
        if len(cands) <= 1:
            return cands
        # Two players share an initial and surname: take the one the drafting
        # coach rostered first, else the one rostered earliest by anyone.
        mine = [c for c in cands if coach in first_on[c]]
        pool = mine or cands
        owner = (lambda c: first_on[c][coach]) if mine else \
                (lambda c: min(first_on[c].values()))
        return [min(pool, key=owner)]

    picks, missing = [], 0
    for rnd in draft["rounds"]:
        for p in rnd["picks"]:
            ids = find(p["player"], p["pos"], p["coach"])
            pts = sum(sum(seen[i]) for i in ids)
            if not ids:
                missing += 1
            picks.append({"pick": p["pick"], "round": rnd["round"],
                          "coach": p["coach"], "player": p["player"],
                          "pos": p["pos"], "pts": round(pts, 2),
                          "rostered": bool(ids)})

    # Rank by points among everyone drafted that year; value is how many
    # places better (or worse) the outcome was than the slot it was taken in.
    for i, p in enumerate(sorted(picks, key=lambda p: (-p["pts"], p["pick"])), 1):
        p["ptsRank"] = i
        p["value"] = p["pick"] - i

    coaches = defaultdict(lambda: {"pts": 0.0, "value": 0, "picks": 0})
    for p in picks:
        c = coaches[p["coach"]]
        c["pts"] += p["pts"]
        c["value"] += p["value"]
        c["picks"] += 1
    summary = [{"coach": c, "pts": round(v["pts"], 2), "value": v["value"],
                "picks": v["picks"]} for c, v in coaches.items()]
    summary.sort(key=lambda r: -r["pts"])
    for i, r in enumerate(summary, 1):
        r["rank"] = i
    return {"picks": picks, "coaches": summary, "missing": missing}


def grade_season(season):
    """All three grades for one assembled season."""
    return {
        "lineups": lineup_efficiency(season["lineups"]),
        "allPlay": all_play(season["scores"], season["standings"]),
        "draft": draft_outcomes(season["draft"], season["lineups"],
                                season["regularWeeks"]),
    }


def percentile(value, population):
    """Share of the population this value beats or equals, 0-100."""
    if not population:
        return None
    return round(100 * sum(v <= value for v in population) / len(population))


def history(seasons):
    """Percentiles against every completed coach-season, and the awards.

    A season still being played is left out: its numbers are partial, and
    would otherwise top or tail every list on a few weeks' data.
    """
    done = [s for s in seasons.values() if not s.get("inProgress")]
    eff = [r["efficiency"] for s in done for r in s["grades"]["lineups"]]
    luck = [r["luck"] for s in done for r in s["grades"]["allPlay"]]
    for s in seasons.values():
        for r in s["grades"]["lineups"]:
            r["pctile"] = percentile(r["efficiency"], eff)
        for r in s["grades"]["allPlay"]:
            r["pctile"] = percentile(r["luck"], luck)

    def season_rows(kind):
        return [dict(r, year=s["year"]) for s in done for r in s["grades"][kind]]

    lineups, ap = season_rows("lineups"), season_rows("allPlay")
    picks = [dict(p, year=s["year"]) for s in done
             if s["grades"]["draft"] for p in s["grades"]["draft"]["picks"]]
    first = [p for p in picks if p["round"] == 1]
    late = [p for p in picks if p["round"] >= 8]

    def top(rows, key, n=3, low=False):
        return sorted(rows, key=lambda r: r[key] if low else -r[key])[:n]

    return [
        {"title": "Most points left on the bench", "unit": "benchedPerWeek",
         "note": "per week - seasons run 16 or 17 weeks",
         "rows": top(lineups, "benchedPerWeek")},
        {"title": "Sharpest lineups", "unit": "efficiency",
         "rows": top(lineups, "efficiency")},
        {"title": "Luckiest season", "unit": "luck",
         "rows": top(ap, "luck")},
        {"title": "Unluckiest season", "unit": "luck",
         "rows": top(ap, "luck", low=True)},
        {"title": "Best late-round pick", "unit": "pts",
         "note": "round 8 or later, points while rostered",
         "rows": top(late, "pts")},
        {"title": "Worst first-round pick", "unit": "pts",
         "note": "points while rostered",
         "rows": top(first, "pts", low=True)},
    ]
