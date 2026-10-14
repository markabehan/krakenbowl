#!/usr/bin/env python3
"""
Build the static JSON data files for the League Record Book.

Usage:  python3 build.py [raw_dir]   (default: ./raw)

Expects five CSVs in raw_dir:
    gameweeks.csv   every lineup slot, every week, every season
    drafts.csv      draft boards
    adds_drops.csv  waiver and free agent moves
    trades.csv      trades, with teams named rather than coaches
    team_names.csv  coach -> team name, for every name ever used

Writes:
    docs/data/index.json         career records, season list, roll of honour
    docs/data/season-YYYY.json   one file per season, loaded on demand

The script prints any data problems it finds before writing anything.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent
OUT = ROOT / "docs" / "data"

# Other files spell some coaches differently from the league's own roster.
ALIASES = {"David": "Dave", "Mark": "Scan", "dudley": "Dudley"}

# Playoff weeks per season. Byes only appear once a bracket starts, so these
# are checkable against the data, but the league's own format is the source
# of truth and a season with an odd shape shouldn't be guessed at.
PLAYOFF_WEEKS = {
    2015: [15, 16], 2016: [15, 16], 2017: [15, 16], 2018: [15, 16],
    2019: [15, 16], 2020: [14, 15, 16], 2021: [15, 16, 17],
    2022: [15, 16, 17], 2023: [15, 16, 17], 2024: [15, 16, 17],
}

# How many teams reached the championship bracket, and how the last place
# was decided. "record" = straight down the standings. "wildcard" = the top
# five by record, plus the highest scorer among the bottom five.
CHAMPIONSHIP_FORMAT = {
    2015: (4, "record"), 2016: (4, "record"), 2017: (4, "record"),
    2018: (4, "record"), 2019: (4, "record"), 2020: (6, "record"),
    2021: (6, "record"), 2022: (6, "record"),
    2023: (6, "wildcard"), 2024: (6, "wildcard"),
}

CHAMPIONS = {
    2015: "Dee",    2016: "Chris",   2017: "Beano",   2018: "Dudley",
    2019: "Niall",  2020: "Niall",   2021: "Stephen", 2022: "Ciaran",
    2023: "Whytey", 2024: "Beano",
}

SLOT_ORDER = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "W/R", "W/T", "K", "DEF",
              "BN1", "BN2", "BN3", "BN4", "BN5", "BN6"]

EMPTY_PLAYER = {"--empty--", "", "-"}


# --------------------------------------------------------------------------
# loading
# --------------------------------------------------------------------------

def tidy(series):
    """Normalise a text column: real spaces, single-spaced, trimmed."""
    return (series.astype(str)
            .str.replace(" ", " ", regex=False)
            .str.replace(r"\s+", " ", regex=True)
            .str.strip())


def load_gameweeks(raw, issues):
    d = pd.read_csv(raw / "gameweeks.csv", dtype=str, keep_default_na=False)
    d["Year"] = d["Year"].astype(int)
    d["Week"] = d["Week"].astype(int)
    for c in ("Coach", "Opponent", "Slot", "Position", "Player", "Team"):
        d[c] = tidy(d[c])
    d["Stats"] = (tidy(d["Stats"]).str.replace(",", ", ", regex=False)
                  .str.replace(r"\s+", " ", regex=True).str.strip())
    d["points"] = pd.to_numeric(d["Fantasy Points"], errors="coerce").fillna(0.0)
    d["is_empty"] = d["Player"].isin(EMPTY_PLAYER)

    # The Bench column is only filled in for 2015-2019; from 2020 it is blank
    # and the slot name is the only marker. Where both exist they agree on
    # every row, so either one counts.
    d["is_bench"] = (d["Bench"].str.strip().eq("BN")
                     | d["Slot"].str.upper().str.startswith("BN"))

    d = fix_known_faults(d, issues)
    return d


def fix_known_faults(d, issues):
    """Repair faults in the export that would otherwise corrupt a season.

    2023 week 15: two complete lineups are both filed under Chris and Ciaran
    has none. Comparing each against the surrounding weeks' rosters settles
    it outright - one block overlaps Chris by 15/16 and Ciaran by 0/16, the
    other the reverse - so the second block is reassigned to Ciaran.
    """
    mask = (d.Year == 2023) & (d.Week == 15) & (d.Coach == "Chris")
    rows = d.index[mask].tolist()
    if len(rows) == 32:
        block = rows[16:]
        ref = d[(d.Year == 2023) & (d.Week == 14)]
        chris = set(ref[ref.Coach == "Chris"]["Player"])
        ciaran = set(ref[ref.Coach == "Ciaran"]["Player"])
        players = set(d.loc[block, "Player"])
        if len(players & ciaran) > len(players & chris):
            d.loc[block, "Coach"] = "Ciaran"
            issues.append("2023 wk15: second lineup filed under Chris "
                          "reassigned to Ciaran (roster match 13/16 vs 0/16)")
        else:
            issues.append("2023 wk15: Chris has two lineups but neither "
                          "matches Ciaran - left as is")

    dup = d.duplicated(subset=["Year", "Week", "Coach", "Slot"], keep="first")
    if dup.any():
        for (y, w, c), g in d[dup].groupby(["Year", "Week", "Coach"]):
            issues.append(f"{y} wk{w} {c}: dropped {len(g)} duplicate slots")
        d = d[~dup]
    return d.reset_index(drop=True)


def load_support(raw, issues):
    """Drafts, adds/drops, trades and the coach/team-name lookup."""
    names = pd.read_csv(raw / "team_names.csv", dtype=str, keep_default_na=False)
    names["Coach"] = tidy(names["Coach"]).replace(ALIASES)
    names["Name"] = tidy(names["Name"])

    def key(s):
        # "We Are Borg-Ciaran" and "We Are Borg - Ciaran" are the same team.
        return " ".join(str(s).replace("-", " - ").split()).lower()

    lookup = {}
    for _, r in names.iterrows():
        k = key(r["Name"])
        if k in lookup and lookup[k] != r["Coach"]:
            issues.append(f"team name {r['Name']!r} maps to two coaches")
        lookup[k] = r["Coach"]

    drafts = pd.read_csv(raw / "drafts.csv", dtype=str, keep_default_na=False)
    drafts["Year"] = drafts["Year"].astype(int)
    drafts["Round"] = drafts["Round"].astype(int)
    drafts["Pick"] = drafts["Pick"].astype(int)
    # The column headed "Player" holds the coach; "Player Name" holds the pick.
    drafts["coach"] = tidy(drafts["Player"]).replace(ALIASES)
    drafts["player"] = tidy(drafts["Player Name"])
    drafts["pos"] = tidy(drafts["Position"])

    moves = pd.read_csv(raw / "adds_drops.csv", dtype=str, keep_default_na=False)
    moves["Season"] = moves["Season"].astype(int)
    moves["week"] = pd.to_numeric(moves["Gameweek"], errors="coerce")
    moves["coach"] = tidy(moves["Coach"]).replace(ALIASES)
    for c in ("Player", "Slot", "Franchise", "Type", "Add/Drop"):
        moves[c] = tidy(moves[c])
    blank = moves["coach"].eq("")
    if blank.any():
        issues.append(f"adds/drops: {int(blank.sum())} rows have no coach "
                      f"and are left out")
        moves = moves[~blank]

    trades = pd.read_csv(raw / "trades.csv", dtype=str, keep_default_na=False)
    trades["Season"] = trades["Season"].astype(int)
    trades["week"] = pd.to_numeric(trades["Week"], errors="coerce")
    for c in ("Player", "Position", "Franchise", "From", "To", "Proposer"):
        trades[c] = tidy(trades[c])
    trades["from_coach"] = trades["From"].map(lambda s: lookup.get(key(s), ""))
    trades["to_coach"] = trades["To"].map(lambda s: lookup.get(key(s), ""))
    trades["proposer"] = trades["Proposer"].replace(ALIASES)
    bad = trades[(trades.from_coach == "") | (trades.to_coach == "")]
    for _, r in bad.iterrows():
        issues.append(f"{r['Season']} trade: could not resolve "
                      f"{r['From']!r} -> {r['To']!r}")

    return drafts, moves, trades


# --------------------------------------------------------------------------
# standings
# --------------------------------------------------------------------------

def mini_league(matchups, group):
    """Win ratio for each coach counting only games against the others.

    With two teams this is the head-to-head result. With three or more it is
    the standard generalisation - the record inside the tied group - which is
    what decides a multi-way tie; comparing pairs cannot, because the pairwise
    results can form a loop.
    """
    rec = {c: [0, 0] for c in group}
    members = set(group)
    for m in matchups:
        a, b = m["home"], m["away"]
        if {a["coach"], b["coach"]} <= members and a["points"] != b["points"]:
            win, lose = (a, b) if a["points"] > b["points"] else (b, a)
            rec[win["coach"]][0] += 1
            rec[lose["coach"]][1] += 1
    return {c: (w / (w + l) if (w + l) else 0.0) for c, (w, l) in rec.items()}


def standings(teams, matchups, regular_weeks):
    """Regular season table: win ratio, then head-to-head, then points."""
    rec = {c: {"coach": c, "team": t, "w": 0, "l": 0, "t": 0, "pf": 0.0,
               "pa": 0.0, "games": 0, "high": 0.0} for c, t in teams.items()}
    regular = [m for m in matchups if m["week"] in regular_weeks]

    for m in regular:
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

    # Win ratio first; any tie is broken by the record among the tied teams,
    # and then by points scored.
    table.sort(key=lambda r: -r["pct"])
    ordered = []
    i = 0
    while i < len(table):
        j = i
        while j < len(table) and table[j]["pct"] == table[i]["pct"]:
            j += 1
        tied = table[i:j]
        if len(tied) > 1:
            h2h = mini_league(regular, [r["coach"] for r in tied])
            for r in tied:
                r["h2h"] = round(h2h[r["coach"]], 4)
            tied.sort(key=lambda r: (-r["h2h"], -r["pf"]))
        ordered.extend(tied)
        i = j

    for i, r in enumerate(ordered, 1):
        r["rank"] = i
    return ordered


# --------------------------------------------------------------------------
# playoffs
# --------------------------------------------------------------------------

def championship_field(year, table):
    """Which coaches contested the title that season."""
    size, rule = CHAMPIONSHIP_FORMAT[year]
    size = min(size, len(table))
    if rule == "record":
        return [r["coach"] for r in table[:size]], None
    # 2023 on: top five by record, plus the highest scorer of the bottom five.
    top = [r["coach"] for r in table[:size - 1]]
    rest = table[size - 1:]
    wild = max(rest, key=lambda r: r["pf"])
    return top + [wild["coach"]], wild["coach"]


def label_games(matchups, playoff_weeks, champ_field):
    """Tag each playoff game as championship, consolation or mixed."""
    field = set(champ_field)
    for m in matchups:
        if m["week"] not in playoff_weeks:
            m["round"] = "regular"
            continue
        sides = {m["home"]["coach"], m["away"]["coach"]}
        if sides <= field:
            m["round"] = "championship"
        elif not (sides & field):
            m["round"] = "consolation"
        else:
            m["round"] = "crossover"


def bracket_winner(matchups, playoff_weeks, field):
    """Winner of a single-elimination bracket among `field`.

    The final is the last game between two teams that have not yet lost
    inside this bracket; everything else that week is a placing game.
    """
    field = set(field)
    games = [m for m in matchups if m["week"] in playoff_weeks
             and {m["home"]["coach"], m["away"]["coach"]} <= field]
    if not games:
        return None, None

    lost = set()
    final = None
    for wk in sorted({m["week"] for m in games}):
        week_games = [m for m in games if m["week"] == wk]
        for m in week_games:
            a, b = m["home"], m["away"]
            if a["coach"] not in lost and b["coach"] not in lost:
                final = m  # last such game seen wins
        for m in week_games:
            a, b = m["home"], m["away"]
            if a["points"] > b["points"]:
                lost.add(b["coach"])
            elif b["points"] > a["points"]:
                lost.add(a["coach"])

    if final is None:
        return None, None
    a, b = final["home"], final["away"]
    win = a if a["points"] > b["points"] else b
    return win["coach"], final


# --------------------------------------------------------------------------
# season assembly
# --------------------------------------------------------------------------

def build_lineup(rows):
    players = []
    for _, r in rows.iterrows():
        empty = bool(r["is_empty"])
        players.append({
            "slot": r["Slot"],
            "pos": r["Position"] or None,
            "player": None if empty else r["Player"],
            "nfl": None if empty else (r["Team"] or None),
            "stats": None if empty or r["Stats"] in ("", "-") else r["Stats"],
            "pts": round(float(r["points"]), 2),
            "bench": bool(r["is_bench"]),
        })
    players.sort(key=lambda p: (SLOT_ORDER.index(p["slot"])
                               if p["slot"] in SLOT_ORDER else 99, p["slot"]))
    return players


def build_season(year, gw, drafts, moves, trades, team_of, issues):
    playoff_weeks = PLAYOFF_WEEKS[year]
    weeks = sorted(int(w) for w in gw["Week"].unique())
    regular_weeks = [w for w in weeks if w not in playoff_weeks]

    teams = {c: team_of[(year, c)] for c in gw["Coach"].unique()}

    lineups, team_week = {}, {}
    for (week, coach), rows in gw.groupby(["Week", "Coach"]):
        players = build_lineup(rows)
        lineups[f"{week}|{coach}"] = players
        starters = [p for p in players if not p["bench"]]
        bench = [p for p in players if p["bench"]]
        team_week[(int(week), coach)] = {
            "points": round(sum(p["pts"] for p in starters), 2),
            "bench": round(sum(p["pts"] for p in bench), 2),
            "opponent": rows["Opponent"].iloc[0],
        }

    matchups, seen = [], set()
    for (week, coach), info in sorted(team_week.items()):
        opp = info["opponent"]
        if opp == "BYE" or (week, opp) not in team_week:
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
            "home": {"coach": a, "team": teams[a], "points": ai["points"],
                     "bench": ai["bench"]},
            "away": {"coach": b, "team": teams[b], "points": bi["points"],
                     "bench": bi["bench"]},
        })
    matchups.sort(key=lambda m: (m["week"], m["home"]["coach"]))

    table = standings(teams, matchups, regular_weeks)
    champ_field, wildcard = championship_field(year, table)
    cons_field = [r["coach"] for r in table if r["coach"] not in set(champ_field)]
    # Only coaches who actually played a playoff game are in the consolation.
    played = {c for m in matchups if m["week"] in playoff_weeks
              for c in (m["home"]["coach"], m["away"]["coach"])}
    cons_field = [c for c in cons_field if c in played]

    label_games(matchups, playoff_weeks, champ_field)

    derived_champ, final = bracket_winner(matchups, playoff_weeks, champ_field)
    cons_winner, cons_final = bracket_winner(matchups, playoff_weeks, cons_field)

    champion = CHAMPIONS.get(year)
    if champion and derived_champ and derived_champ != champion:
        issues.append(f"{year}: recorded champion {champion} but the bracket "
                      f"points to {derived_champ}")

    seeds = {r["coach"]: r["rank"] for r in table}
    for m in matchups:
        m["homeSeed"] = seeds.get(m["home"]["coach"])
        m["awaySeed"] = seeds.get(m["away"]["coach"])
        if final and m["id"] == final["id"]:
            m["title"] = "Championship final"
        elif cons_final and m["id"] == cons_final["id"]:
            m["title"] = "Trash Bowl final"

    # playoff record per coach, for the career table
    po = defaultdict(lambda: {"w": 0, "l": 0})
    for m in matchups:
        if m["round"] not in ("championship", "consolation", "crossover"):
            continue
        a, b = m["home"], m["away"]
        if a["points"] == b["points"]:
            continue
        win, lose = (a, b) if a["points"] > b["points"] else (b, a)
        po[win["coach"]]["w"] += 1
        po[lose["coach"]]["l"] += 1

    return {
        "year": year,
        "teams": teams,
        "regularWeeks": regular_weeks,
        "playoffWeeks": playoff_weeks,
        "standings": table,
        "matchups": matchups,
        "lineups": lineups,
        "champion": champion,
        "consolationWinner": cons_winner,
        "championshipField": champ_field,
        "consolationField": cons_field,
        "wildcard": wildcard,
        "playoffRecords": {c: dict(v) for c, v in po.items()},
        "draft": build_draft(drafts, year),
        "moves": build_moves(moves, year),
        "trades": build_trades(trades, year),
    }


def build_draft(drafts, year):
    d = drafts[drafts.Year == year]
    if d.empty:
        return None
    rounds = []
    for rnd, g in d.sort_values(["Round", "Pick"]).groupby("Round"):
        rounds.append({
            "round": int(rnd),
            "picks": [{"pick": int(r["Pick"]), "coach": r["coach"],
                       "player": r["player"], "pos": r["pos"]}
                      for _, r in g.iterrows()],
        })
    return {"order": [p["coach"] for p in rounds[0]["picks"]], "rounds": rounds}


def build_moves(moves, year):
    m = moves[moves.Season == year]
    if m.empty:
        return []
    out = []
    for _, r in m.iterrows():
        wk = r["week"]
        out.append({
            "week": None if pd.isna(wk) else int(wk),
            "coach": r["coach"],
            "kind": r["Add/Drop"],
            "via": r["Type"],
            "player": r["Player"],
            "pos": r["Slot"] or None,
            "nfl": r["Franchise"] or None,
            "faab": r["FAAB"].strip() or None,
        })
    out.sort(key=lambda x: (x["week"] if x["week"] is not None else 99,
                            x["coach"], x["kind"]))
    return out


def build_trades(trades, year):
    t = trades[trades.Season == year]
    if t.empty:
        return []
    deals = {}
    for _, r in t.iterrows():
        wk = r["week"]
        wk = None if pd.isna(wk) else int(wk)
        # One trade spans several rows, one per player moved.
        key = (r["Time"], wk, tuple(sorted([r["from_coach"], r["to_coach"]])))
        d = deals.setdefault(key, {
            "week": wk, "proposer": r["proposer"],
            "sides": sorted([r["from_coach"], r["to_coach"]]), "moves": [],
        })
        d["moves"].append({
            "player": r["Player"], "pos": r["Position"] or None,
            "nfl": r["Franchise"] or None,
            "from": r["from_coach"], "to": r["to_coach"],
        })
    out = list(deals.values())
    out.sort(key=lambda d: (d["week"] if d["week"] is not None else 99,
                            d["sides"]))
    return out


# --------------------------------------------------------------------------
# index
# --------------------------------------------------------------------------

def build_index(seasons):
    career = defaultdict(lambda: {
        "coach": "", "seasons": [], "titles": [], "trash": [],
        "appearances": [],
        "w": 0, "l": 0, "t": 0, "pf": 0.0, "pa": 0.0, "games": 0,
        "pw": 0, "pl": 0})

    for s in sorted(seasons.values(), key=lambda x: x["year"]):
        for r in s["standings"]:
            c = career[r["coach"]]
            c["coach"] = r["coach"]
            c["seasons"].append(s["year"])
            for k in ("w", "l", "t", "games"):
                c[k] += r[k]
            c["pf"] += r["pf"]
            c["pa"] += r["pa"]
            # An appearance means reaching the championship bracket. The Trash
            # Bowl is where the teams that missed out go, so it doesn't count.
            if r["coach"] in s["championshipField"]:
                c["appearances"].append(s["year"])
            if s["champion"] == r["coach"]:
                c["titles"].append(s["year"])
            if s["consolationWinner"] == r["coach"]:
                c["trash"].append(s["year"])
            po = s["playoffRecords"].get(r["coach"])
            if po:
                c["pw"] += po["w"]
                c["pl"] += po["l"]

    rows = []
    for c in career.values():
        c["pf"] = round(c["pf"], 2)
        c["pa"] = round(c["pa"], 2)
        c["ppg"] = round(c["pf"] / c["games"], 2) if c["games"] else 0
        c["pct"] = round((c["w"] + 0.5 * c["t"]) / c["games"], 4) if c["games"] else 0
        tot = c["pw"] + c["pl"]
        c["ppct"] = round(c["pw"] / tot, 4) if tot else 0
        c["allW"] = c["w"] + c["pw"]
        c["allL"] = c["l"] + c["pl"]
        allg = c["allW"] + c["allL"] + c["t"]
        c["allPct"] = round((c["allW"] + 0.5 * c["t"]) / allg, 4) if allg else 0
        c["appearances"].sort()
        c["seasons"].sort()
        rows.append(c)
    rows.sort(key=lambda r: (-r["allPct"], -r["pf"]))

    return {
        "seasons": [{
            "year": s["year"],
            "teams": len(s["teams"]),
            "champion": s["champion"],
            "consolationWinner": s["consolationWinner"],
            "regularWeeks": s["regularWeeks"],
            "playoffWeeks": s["playoffWeeks"],
            "format": CHAMPIONSHIP_FORMAT[s["year"]][0],
        } for s in sorted(seasons.values(), key=lambda x: x["year"])],
        "career": rows,
        "coaches": sorted(career.keys()),
    }


def main():
    raw = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "raw"
    issues = []

    gw = load_gameweeks(raw, issues)
    drafts, moves, trades = load_support(raw, issues)

    team_of = season_team_names(gw, raw, issues)

    OUT.mkdir(parents=True, exist_ok=True)
    seasons = {}
    for year, g in gw.groupby("Year"):
        seasons[int(year)] = build_season(int(year), g, drafts, moves,
                                          trades, team_of, issues)

    if issues:
        print("Data notes:")
        for i in issues:
            print(f"  ! {i}")
        print()

    for year, s in sorted(seasons.items()):
        p = OUT / f"season-{year}.json"
        p.write_text(json.dumps(s, separators=(",", ":")))
        print(f"  season-{year}.json {p.stat().st_size/1024:6.0f} KB  "
              f"{len(s['matchups']):3d} games  champ {s['champion']}  "
              f"trash {s['consolationWinner']}")

    idx = build_index(seasons)
    (OUT / "index.json").write_text(json.dumps(idx, separators=(",", ":")))
    print(f"  index.json  {len(idx['seasons'])} seasons, "
          f"{len(idx['coaches'])} coaches")


def season_team_names(gw, raw, issues):
    """Which team name each coach used in each season.

    gameweeks.csv has no team-name column and team_names.csv is a deduplicated
    list (some coaches reused a name in different years), so neither gives the
    per-season answer on its own. team_seasons.csv carries it explicitly; any
    coach-season it misses falls back to the coach's own name.
    """
    path = raw / "team_seasons.csv"
    out = {}
    if path.exists():
        t = pd.read_csv(path, dtype=str, keep_default_na=False)
        for _, r in t.iterrows():
            out[(int(r["Year"]), tidy(pd.Series([r["Coach"]]))[0])] = \
                tidy(pd.Series([r["Name"]]))[0]

    missing = []
    for (y, c), _ in gw.groupby(["Year", "Coach"]):
        if (int(y), c) not in out:
            out[(int(y), c)] = c
            missing.append(f"{y} {c}")
    if missing:
        issues.append(f"no team name for {len(missing)} coach-season(s): "
                      f"{', '.join(missing[:5])}")
    return out


if __name__ == "__main__":
    main()
