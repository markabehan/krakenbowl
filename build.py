#!/usr/bin/env python3
"""
Build static JSON data files from the league lineup CSV export.

Usage:  python3 build.py [path/to/lineup_data.csv]

Reads the raw spreadsheet export, drops the trailing dropdown-list helper
columns, cleans the placeholder values, and writes:

    docs/data/index.json         league-wide summary + season list
    docs/data/season-YYYY.json   standings, matchups and lineups per season

Everything downstream is static, so this only needs re-running when the
CSV changes.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent
OUT = ROOT / "docs" / "data"

# Columns 19+ in the export are spreadsheet dropdown sources, not data.
DATA_COLS = 19

# Values the spreadsheet uses for "nothing here".
EMPTY_PLAYER = {"--empty--", "", "-"}

# Slot ordering for lineup display.
SLOT_ORDER = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "W/R", "W/T", "K", "DEF",
              "BN1", "BN2", "BN3", "BN4", "BN5", "BN6"]

# Seasons where the playoff weeks can't be inferred from the data because
# every team played every week. Supplied by the league.
PLAYOFF_OVERRIDE = {
    2015: [15, 16],
    2016: [15, 16],
}

# Winners, by season. Not derivable from the export: consolation games run
# alongside the final, so the last week doesn't identify a champion.
CHAMPIONS = {
    2015: "Dee",     2016: "Chris",   2017: "Beano",   2018: "Dudley",
    2019: "Niall",   2020: "Niall",   2021: "Stephen", 2022: "Whytey",
    2023: "Ciaran",  2024: "Beano",
}


def load(csv_path):
    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    d = df.iloc[:, :DATA_COLS].copy()

    d["Year"] = d["Year"].astype(int)
    d["Week"] = d["Week"].astype(int)
    d["points"] = pd.to_numeric(d["Fantasy Points"], errors="coerce").fillna(0.0)

    d["Player"] = d["Player"].str.strip()
    d["is_empty"] = d["Player"].isin(EMPTY_PLAYER)
    # The "Bench" column is only filled in for 2015-2019; from 2020 on it's
    # blank and the slot name is the only marker. Where both exist they agree
    # exactly, so treat either as authoritative.
    d["is_bench"] = (d["Bench"].str.strip().eq("BN")
                     | d["Slot"].str.strip().str.upper().str.startswith("BN"))

    for col in ("Team", "Coach", "Slot", "Position", "Franchise",
                "Stats", "Opponent", "Opponent Coach"):
        d[col] = d[col].str.strip()

    # The export uses non-breaking spaces inside stat lines, which stops them
    # wrapping. Some are also truncated with "..." at source; that's left alone.
    d["Stats"] = (d["Stats"].str.replace("\u00a0", " ", regex=False)
                            .str.replace(",", ", ", regex=False)
                            .str.replace(r"\s+", " ", regex=True).str.strip())

    return dedupe(d)


def dedupe(d):
    """Remove double-entered rows and report anything left that looks wrong.

    Two known faults in the export:
      * 2015 week 6 has Dave's and Niall's whole lineups entered twice, which
        would double their scores for that week.
      * 2023 week 15 has two different lineups both filed under Chris, while
        Ciaran is missing entirely. Both were on a bye, so no result depends
        on it, but only one can be shown.
    """
    issues = []

    exact = ["Year", "Week", "Coach", "Slot", "Player", "Fantasy Points"]
    dup = d.duplicated(subset=exact, keep="first")
    if dup.any():
        for (y, w, c), g in d[dup].groupby(["Year", "Week", "Coach"]):
            issues.append(f"{y} wk{w} {c}: removed {len(g)} duplicated rows "
                          f"(lineup entered twice)")
        d = d[~dup]

    # Anything still sharing a slot is a genuine conflict, not a copy.
    conflict = d.duplicated(subset=["Year", "Week", "Coach", "Slot"], keep="first")
    if conflict.any():
        for (y, w, c), g in d[conflict].groupby(["Year", "Week", "Coach"]):
            issues.append(f"{y} wk{w} {c}: {len(g)} slots had a second, different "
                          f"player; kept the first lineup only — needs a manual fix")
        d = d[~conflict]

    return d.reset_index(drop=True), issues



def season_weeks(season):
    """Split a season's weeks into regular season and playoffs.

    A week is a playoff week if anyone has a BYE, or if fewer teams
    took part than the league carried that year.
    """
    year = int(season["Year"].iloc[0])
    league_size = season["Coach"].nunique()

    weeks = sorted(int(w) for w in season["Week"].unique())

    def is_full(week):
        wk = season[season["Week"] == week]
        byes = wk.loc[wk["Opponent Coach"] == "BYE", "Coach"].nunique()
        return byes == 0 and wk["Coach"].nunique() == league_size

    if year in PLAYOFF_OVERRIDE:
        playoff = [w for w in weeks if w in PLAYOFF_OVERRIDE[year]]
        return [w for w in weeks if w not in set(playoff)], playoff

    # Byes only happen once the bracket starts, so the postseason is the last
    # cluster of non-full weeks, extended to the end of the season. The final
    # week is often "full" again because the whole league plays consolation
    # games, so it can't just be a trailing run. Grouping into clusters also
    # means an isolated mid-season data gap (a missing lineup) is ignored.
    non_full = [w for w in weeks if not is_full(w)]
    if not non_full:
        return weeks, []

    clusters = [[non_full[0]]]
    for w in non_full[1:]:
        if w == clusters[-1][-1] + 1:
            clusters[-1].append(w)
        else:
            clusters.append([w])

    start = clusters[-1][0]
    playoff = [w for w in weeks if w >= start]
    regular = [w for w in weeks if w < start]
    return regular, playoff


def build_lineup(rows):
    players = []
    for _, r in rows.iterrows():
        if r["is_empty"]:
            players.append({
                "slot": r["Slot"], "pos": r["Position"] or None,
                "player": None, "nfl": None, "stats": None,
                "pts": 0.0, "bench": bool(r["is_bench"]),
            })
        else:
            players.append({
                "slot": r["Slot"],
                "pos": r["Position"] or None,
                "player": r["Player"],
                "nfl": r["Franchise"] or None,
                "stats": r["Stats"] if r["Stats"] not in ("", "-") else None,
                "pts": round(float(r["points"]), 2),
                "bench": bool(r["is_bench"]),
            })
    players.sort(key=lambda p: (SLOT_ORDER.index(p["slot"])
                                if p["slot"] in SLOT_ORDER else 99, p["slot"]))
    return players


def build_season(year, season):
    regular, playoff = season_weeks(season)

    teams = {}
    for coach, g in season.groupby("Coach"):
        teams[coach] = g["Team"].iloc[0]

    lineups = {}
    team_week = {}
    for (week, coach), rows in season.groupby(["Week", "Coach"]):
        players = build_lineup(rows)
        lineups[f"{week}|{coach}"] = players
        starters = [p for p in players if not p["bench"]]
        bench = [p for p in players if p["bench"]]
        team_week[(int(week), coach)] = {
            "points": round(sum(p["pts"] for p in starters), 2),
            "bench_points": round(sum(p["pts"] for p in bench), 2),
            "opponent": rows["Opponent Coach"].iloc[0],
        }

    matchups = []
    seen = set()
    for (week, coach), info in sorted(team_week.items()):
        opp = info["opponent"]
        if opp == "BYE":
            continue
        key = (week, *sorted([coach, opp]))
        if key in seen:
            continue
        seen.add(key)
        a, b = sorted([coach, opp])
        ai, bi = team_week[(week, a)], team_week[(week, b)]
        matchups.append({
            "id": f"{year}-{week}-{a}-{b}".replace(" ", "_"),
            "week": week,
            "playoff": week in playoff,
            "home": {"coach": a, "team": teams[a], "points": ai["points"],
                     "bench": ai["bench_points"]},
            "away": {"coach": b, "team": teams[b], "points": bi["points"],
                     "bench": bi["bench_points"]},
        })

    matchups.sort(key=lambda m: (m["week"], m["home"]["coach"]))

    standings = compute_standings(teams, matchups, regular)
    playoff_games = [m for m in matchups if m["playoff"]]
    byes = [{"week": w, "coach": c}
            for (w, c), i in sorted(team_week.items()) if i["opponent"] == "BYE"]

    return {
        "year": year,
        "champion": CHAMPIONS.get(year),
        "teams": teams,
        "regularWeeks": regular,
        "playoffWeeks": playoff,
        "standings": standings,
        "matchups": matchups,
        "playoffGames": playoff_games,
        "byes": byes,
        "lineups": lineups,
    }


def compute_standings(teams, matchups, regular_weeks):
    rec = {c: {"coach": c, "team": t, "w": 0, "l": 0, "t": 0,
               "pf": 0.0, "pa": 0.0, "games": 0, "high": 0.0}
           for c, t in teams.items()}

    for m in matchups:
        if m["week"] not in regular_weeks:
            continue
        for side, other in ((m["home"], m["away"]), (m["away"], m["home"])):
            r = rec[side["coach"]]
            r["pf"] += side["points"]
            r["pa"] += other["points"]
            r["games"] += 1
            r["high"] = max(r["high"], side["points"])
            if side["points"] > other["points"]:
                r["w"] += 1
            elif side["points"] < other["points"]:
                r["l"] += 1
            else:
                r["t"] += 1

    table = []
    for r in rec.values():
        if not r["games"]:
            continue
        r["pf"] = round(r["pf"], 2)
        r["pa"] = round(r["pa"], 2)
        r["diff"] = round(r["pf"] - r["pa"], 2)
        r["ppg"] = round(r["pf"] / r["games"], 2)
        r["pct"] = round((r["w"] + 0.5 * r["t"]) / r["games"], 4)
        table.append(r)

    # Standard fantasy tiebreak: record first, then points for.
    table.sort(key=lambda r: (-r["pct"], -r["pf"]))
    for i, r in enumerate(table, 1):
        r["rank"] = i
    return table


def check_champions(seasons):
    """Sanity-check the recorded champion against the last playoff game.

    The winner isn't in the export, so the names are supplied by hand. This
    catches a name being mistyped or a season being shifted by one.
    """
    warnings = []
    for s in sorted(seasons.values(), key=lambda x: x["year"]):
        champ = s["champion"]
        if not champ or not s["playoffWeeks"]:
            continue
        last = max(s["playoffWeeks"])
        played = [m for m in s["matchups"] if m["week"] == last
                  and champ in (m["home"]["coach"], m["away"]["coach"])]
        if not played:
            warnings.append(f"{s['year']}: {champ} is recorded as champion but "
                            f"played no game in week {last}")
            continue
        m = played[0]
        me, opp = ((m["home"], m["away"]) if m["home"]["coach"] == champ
                   else (m["away"], m["home"]))
        if me["points"] <= opp["points"]:
            warnings.append(
                f"{s['year']}: {champ} is recorded as champion but lost the "
                f"week {last} game to {opp['coach']}, "
                f"{me['points']:.2f}-{opp['points']:.2f}")
    return warnings


def build_index(seasons):
    career = defaultdict(lambda: {"coach": "", "seasons": [], "titles": [],
                                  "w": 0, "l": 0, "t": 0, "pf": 0.0,
                                  "pa": 0.0, "games": 0})
    for s in seasons.values():
        for r in s["standings"]:
            c = career[r["coach"]]
            c["coach"] = r["coach"]
            c["seasons"].append(s["year"])
            for k in ("w", "l", "t", "games"):
                c[k] += r[k]
            c["pf"] += r["pf"]
            c["pa"] += r["pa"]
            if s["champion"] == r["coach"]:
                c["titles"].append(s["year"])

    rows = []
    for c in career.values():
        c["pf"] = round(c["pf"], 2)
        c["pa"] = round(c["pa"], 2)
        c["ppg"] = round(c["pf"] / c["games"], 2) if c["games"] else 0
        c["pct"] = round((c["w"] + 0.5 * c["t"]) / c["games"], 4) if c["games"] else 0
        c["seasons"].sort()
        rows.append(c)
    rows.sort(key=lambda r: (-r["pct"], -r["pf"]))

    return {
        "seasons": [
            {
                "year": s["year"],
                "teams": len(s["teams"]),
                "regularWeeks": s["regularWeeks"],
                "playoffWeeks": s["playoffWeeks"],
                "champion": s["champion"],
            }
            for s in sorted(seasons.values(), key=lambda x: x["year"])
        ],
        "career": rows,
        "coaches": sorted(career.keys()),
    }


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else "lineup_data.csv"
    d, issues = load(csv_path)
    OUT.mkdir(parents=True, exist_ok=True)

    if issues:
        print("Data issues found and handled:")
        for i in issues:
            print(f"  ! {i}")
        print()

    seasons = {}
    for year, season in d.groupby("Year"):
        seasons[year] = build_season(int(year), season)

    for year, s in seasons.items():
        path = OUT / f"season-{year}.json"
        path.write_text(json.dumps(s, separators=(",", ":")))
        print(f"  season-{year}.json  {path.stat().st_size/1024:6.0f} KB  "
              f"{len(s['matchups']):3d} matchups  "
              f"reg {s['regularWeeks'][0]}-{s['regularWeeks'][-1]}  "
              f"playoffs {s['playoffWeeks'] or 'none'}")

    champ_warnings = check_champions(seasons)
    if champ_warnings:
        print()
        print("Champion check:")
        for w in champ_warnings:
            print(f"  ! {w}")

    idx = build_index(seasons)
    (OUT / "index.json").write_text(json.dumps(idx, separators=(",", ":")))
    print(f"  index.json  {len(idx['seasons'])} seasons, {len(idx['coaches'])} coaches")


if __name__ == "__main__":
    main()
