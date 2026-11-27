#!/usr/bin/env python3
"""
The checks CLAUDE.md asks for after any pipeline change, as a script.

Usage:  python3 check.py        (after python3 build.py raw)

Exits non-zero if anything is wrong, so the daily GitHub Action refuses to
commit data that fails them.

- every team score matches the source: raw/gameweeks.csv for 2015-2024, the
  Sleeper dumps from 2025
- wins equal losses in every season
- each recorded champion won the game tagged "Championship final"
- no playoff-week game is left unlabelled
- the championship and consolation fields never overlap
- a season in progress has the same record for every coach as Sleeper,
  through the last week Sleeper has fully scored
"""

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "docs" / "data"
RAW = ROOT / "raw"


def csv_scores():
    """(year, week, coach) -> starters' points, from raw/gameweeks.csv."""
    out = defaultdict(float)
    with open(RAW / "gameweeks.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            bench = (r["Bench"].strip() == "BN"
                     or r["Slot"].strip().upper().startswith("BN"))
            if bench:
                continue
            try:
                pts = float(r["Fantasy Points"])
            except ValueError:
                pts = 0.0
            out[(int(r["Year"]), int(r["Week"]), r["Coach"].strip())] += pts
    return out


def sleeper_source(year):
    """(week -> coach -> points, coach -> (wins, losses), last fully scored
    week) from a Sleeper dump."""
    path = RAW / "sleeper" / str(year) / "league.json"
    if not path.exists():
        return None, None, 0
    b = json.loads(path.read_text())
    with open(RAW / "sleeper_coaches.csv", encoding="utf-8") as f:
        uid = {r["SleeperUserId"].strip(): r["Coach"].strip()
               for r in csv.DictReader(f)}
    coach = {r["roster_id"]: uid.get(r["owner_id"]) for r in b["rosters"]}
    pts = {wk: {coach[t["roster_id"]]: t.get("points") or 0 for t in teams}
           for wk, teams in b["matchups"].items()}
    rec = {coach[r["roster_id"]]: (r["settings"].get("wins"),
                                   r["settings"].get("losses"))
           for r in b["rosters"]}
    return pts, rec, b["league"]["settings"].get("last_scored_leg") or 0


def main():
    problems = []
    scores = csv_scores()
    seasons = sorted(DATA.glob("season-*.json"))
    for path in seasons:
        s = json.loads(path.read_text())
        y = s["year"]
        bad = lambda msg: problems.append(f"{y}: {msg}")

        w = sum(r["w"] for r in s["standings"])
        l = sum(r["l"] for r in s["standings"])
        if w != l:
            bad(f"wins {w} != losses {l}")

        if s["champion"]:
            final = [m for m in s["matchups"] if m.get("title") == "Championship final"]
            if not final:
                bad("no game tagged Championship final")
            else:
                m = final[0]
                won = m["home"] if m["home"]["points"] > m["away"]["points"] else m["away"]
                if won["coach"] != s["champion"]:
                    bad(f"champion {s['champion']} didn't win the final")

        loose = [m["id"] for m in s["matchups"]
                 if m["week"] in s["playoffWeeks"] and m["round"] == "regular"]
        if loose:
            bad(f"unlabelled playoff games {loose}")
        both = set(s["championshipField"]) & set(s["consolationField"])
        if both:
            bad(f"in both brackets: {sorted(both)}")

        if s.get("source") == "sleeper":
            pts, rec, scored = sleeper_source(y)
            if pts is None:
                bad("no Sleeper dump to check against")
                continue
            for m in s["matchups"]:
                for side in (m["home"], m["away"]):
                    src = pts.get(str(m["week"]), {}).get(side["coach"])
                    if src is None or abs(src - side["points"]) > 0.011:
                        bad(f"week {m['week']} {side['coach']} {side['points']} "
                            f"!= Sleeper {src}")
            if s.get("inProgress"):
                # Sleeper's records only move once a week is fully scored, so
                # mid-week compare against the weeks it has finished.
                done = defaultdict(lambda: [0, 0])
                for m in s["matchups"]:
                    if m["week"] <= scored and m["week"] in s["regularWeeks"]:
                        a, b = m["home"], m["away"]
                        if a["points"] != b["points"]:
                            win, lose = (a, b) if a["points"] > b["points"] else (b, a)
                            done[win["coach"]][0] += 1
                            done[lose["coach"]][1] += 1
                for c, (w, l) in done.items():
                    if rec.get(c) != (w, l):
                        bad(f"{c} {w}-{l} through week {scored} != Sleeper "
                            f"{rec.get(c)}")
        else:
            for m in s["matchups"]:
                for side in (m["home"], m["away"]):
                    c = side["coach"]
                    # 2023 week 15: the build moves a lineup filed under Chris
                    # to Ciaran (see CLAUDE.md), so the CSV can't vouch for it.
                    if (y, m["week"]) == (2023, 15) and c in ("Chris", "Ciaran"):
                        continue
                    key = (y, m["week"], c)
                    if key in scores and abs(scores[key] - side["points"]) > 0.011:
                        bad(f"week {m['week']} {c} {side['points']} != CSV "
                            f"{round(scores[key], 2)}")

    if problems:
        print(f"{len(problems)} problem(s):")
        for p in problems:
            print(f"  ! {p}")
        sys.exit(1)
    print(f"All checks pass across {len(seasons)} seasons.")


if __name__ == "__main__":
    main()
