#!/usr/bin/env python3
"""
Convert Sleeper's API dumps into the same shape as the pre-2025 CSV history,
so one pipeline builds every season.

Reads raw/sleeper/<season>/league.json (written by sleeper_fetch.py) plus
raw/sleeper_coaches.csv, which maps each Sleeper user id to a coach name.

Sleeper gives the playoff brackets outright, so for these seasons the
championship field, the Trash Bowl field and both winners are taken from the
API rather than inferred from results.
"""

import json
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

# Sleeper's slot codes -> the names the rest of the site already uses.
SLOT_ALIAS = {
    "WRRB_FLEX": "W/R",
    "REC_FLEX": "W/T",
    "FLEX": "W/R",
    "SUPER_FLEX": "SFLEX",
    "IDP_FLEX": "IDP",
}


def slot_names(roster_positions):
    """Starter slot names, in the order Sleeper lists them in `starters`.

    A position used more than once is numbered (RB -> RB1, RB2); a position
    used once keeps its bare name, which is what the old league called them.
    """
    starters = [p for p in roster_positions if p != "BN"]
    total = Counter(starters)
    seen = Counter()
    names = []
    for p in starters:
        seen[p] += 1
        base = SLOT_ALIAS.get(p, p)
        names.append(f"{base}{seen[p]}" if total[p] > 1 else base)
    return names


def played_weeks(bundle):
    """Weeks that actually happened.

    Sleeper publishes the whole fixture list up front, so a season in progress
    has matchup ids for weeks nobody has played yet, and a finished season has
    a trailing week with scores but no fixtures. A week counts only when it has
    both a fixture and a score.
    """
    out = []
    for key, teams in bundle["matchups"].items():
        has_fixture = any(t.get("matchup_id") is not None for t in teams)
        has_score = any((t.get("points") or 0) > 0 for t in teams)
        if has_fixture and has_score:
            out.append(int(key))
    return sorted(out)


def load(raw, issues):
    """Return everything the builder needs for the Sleeper seasons."""
    sleeper_dir = Path(raw) / "sleeper"
    if not sleeper_dir.exists():
        return None

    map_path = Path(raw) / "sleeper_coaches.csv"
    if not map_path.exists():
        issues.append("raw/sleeper_coaches.csv is missing, so Sleeper seasons "
                      "are skipped")
        return None
    cm = pd.read_csv(map_path, dtype=str)
    uid2coach = dict(zip(cm["SleeperUserId"].str.strip(), cm["Coach"].str.strip()))

    players = {}
    ppath = sleeper_dir / "players.json"
    if ppath.exists():
        players = json.loads(ppath.read_text())

    gw_rows, draft_rows, move_rows, trade_rows = [], [], [], []
    team_seasons, overrides = {}, {}

    for season_dir in sorted(sleeper_dir.iterdir()):
        if not season_dir.is_dir():
            continue
        bundle = json.loads((season_dir / "league.json").read_text())
        year = int(bundle["league"]["season"])

        out = convert(year, bundle, uid2coach, players, issues)
        gw_rows.extend(out["gameweeks"])
        draft_rows.extend(out["draft"])
        move_rows.extend(out["moves"])
        trade_rows.extend(out["trades"])
        team_seasons.update(out["team_seasons"])
        overrides[year] = out["override"]

    return {
        "gameweeks": pd.DataFrame(gw_rows),
        "draft": pd.DataFrame(draft_rows),
        "moves": pd.DataFrame(move_rows),
        "trades": pd.DataFrame(trade_rows),
        "team_seasons": team_seasons,
        "overrides": overrides,
    }


def convert(year, bundle, uid2coach, players, issues):
    league = bundle["league"]
    roster2coach, team_seasons = {}, {}

    unknown = []
    for u in bundle["users"]:
        if u["user_id"] not in uid2coach:
            unknown.append(f"{u['display_name']} ({u['user_id']})")
    if unknown:
        issues.append(f"{year}: Sleeper users with no coach mapping: "
                      f"{', '.join(unknown)}")

    uid2team = {u["user_id"]: (u.get("metadata") or {}).get("team_name")
                for u in bundle["users"]}
    for r in bundle["rosters"]:
        coach = uid2coach.get(r.get("owner_id"))
        if not coach:
            continue
        roster2coach[r["roster_id"]] = coach
        name = uid2team.get(r.get("owner_id")) or coach
        team_seasons[(year, coach)] = str(name).strip()

    slots = slot_names(league.get("roster_positions", []))
    weeks = played_weeks(bundle)
    playoff_start = (league.get("settings") or {}).get("playoff_week_start") or 99
    playoff_weeks = [w for w in weeks if w >= playoff_start]
    regular_weeks = [w for w in weeks if w < playoff_start]

    def pname(pid):
        p = players.get(str(pid))
        if p:
            return p.get("name") or str(pid), p.get("pos"), p.get("team")
        # Team defences are keyed by their abbreviation.
        if isinstance(pid, str) and pid.isalpha() and len(pid) <= 4:
            return pid, "DEF", pid
        return None, None, None

    gameweeks = []
    for wk in weeks:
        teams = bundle["matchups"][str(wk)]
        by_matchup = defaultdict(list)
        for t in teams:
            if t.get("matchup_id") is not None:
                by_matchup[t["matchup_id"]].append(t)
        opponent = {}
        for pair in by_matchup.values():
            if len(pair) == 2:
                a, b = pair
                opponent[a["roster_id"]] = roster2coach.get(b["roster_id"], "BYE")
                opponent[b["roster_id"]] = roster2coach.get(a["roster_id"], "BYE")

        for t in teams:
            coach = roster2coach.get(t["roster_id"])
            if not coach:
                continue
            opp = opponent.get(t["roster_id"], "BYE")
            starters = t.get("starters") or []
            pts = t.get("starters_points") or []
            all_pts = t.get("players_points") or {}

            for i, pid in enumerate(starters):
                slot = slots[i] if i < len(slots) else f"S{i+1}"
                name, pos, nfl = pname(pid)
                gameweeks.append({
                    "Year": year, "Week": wk, "Coach": coach, "Opponent": opp,
                    "Slot": slot, "Bench": "", "Position": pos or "",
                    "Player": name or "--empty--", "Team": nfl or "",
                    "Stats": "",
                    "Fantasy Points": pts[i] if i < len(pts) else 0.0,
                })

            bench = [p for p in (t.get("players") or []) if p not in set(starters)]
            for i, pid in enumerate(bench):
                name, pos, nfl = pname(pid)
                gameweeks.append({
                    "Year": year, "Week": wk, "Coach": coach, "Opponent": opp,
                    "Slot": f"BN{i+1}", "Bench": "BN", "Position": pos or "",
                    "Player": name or "--empty--", "Team": nfl or "",
                    "Stats": "",
                    "Fantasy Points": all_pts.get(str(pid), 0.0),
                })

    # ---- draft ----
    draft = []
    picks = []
    for d in bundle.get("drafts") or []:
        if d.get("picks"):
            picks = d["picks"]
            break                       # Sleeper keeps empty placeholder drafts
    for p in picks:
        meta = p.get("metadata") or {}
        coach = uid2coach.get(p.get("picked_by")) or roster2coach.get(p.get("roster_id"))
        if not coach:
            continue
        name = " ".join(filter(None, [meta.get("first_name"), meta.get("last_name")]))
        draft.append({
            "Year": year, "Round": int(p["round"]), "Pick": int(p["pick_no"]),
            "coach": coach, "player": name or str(p.get("player_id")),
            "pos": meta.get("position") or "",
        })

    # ---- waivers, free agents and trades ----
    moves, trades = [], []
    for wk, txs in (bundle.get("transactions") or {}).items():
        for t in txs:
            if t.get("status") != "complete":
                continue            # failed waiver claims never happened
            leg = t.get("leg")
            kind = t.get("type")
            if kind == "trade":
                drops = t.get("drops") or {}
                for pid, to_roster in (t.get("adds") or {}).items():
                    name, pos, nfl = pname(pid)
                    trades.append({
                        "Season": year, "week": leg,
                        "Time": t.get("transaction_id"),
                        "from_coach": roster2coach.get(drops.get(pid), ""),
                        "to_coach": roster2coach.get(to_roster, ""),
                        "proposer": uid2coach.get(t.get("creator"), ""),
                        "Player": name or str(pid), "Position": pos or "",
                        "Franchise": nfl or "",
                    })
                continue

            via = {"waiver": "Waivers", "free_agent": "Free Agents",
                   "commissioner": "Commissioner"}.get(kind, kind.title())
            bid = (t.get("settings") or {}).get("waiver_bid")
            for pid, roster in (t.get("adds") or {}).items():
                name, pos, nfl = pname(pid)
                moves.append({
                    "Season": year, "week": leg,
                    "coach": roster2coach.get(roster, ""), "Add/Drop": "Add",
                    "Type": via, "Player": name or str(pid), "Slot": pos or "",
                    "Franchise": nfl or "", "FAAB": "" if bid is None else str(bid),
                })
            for pid, roster in (t.get("drops") or {}).items():
                name, pos, nfl = pname(pid)
                moves.append({
                    "Season": year, "week": leg,
                    "coach": roster2coach.get(roster, ""), "Add/Drop": "Drop",
                    "Type": via, "Player": name or str(pid), "Slot": pos or "",
                    "Franchise": nfl or "", "FAAB": "",
                })

    # ---- brackets, straight from the API ----
    def bracket_field(entries):
        field = set()
        for e in entries or []:
            for k in ("t1", "t2"):
                c = roster2coach.get(e.get(k))
                if c:
                    field.add(c)
        return sorted(field)

    def bracket_winner(entries):
        for e in entries or []:
            if e.get("p") == 1 and e.get("w"):
                return roster2coach.get(e["w"])
        return None

    wb, lb = bundle.get("winners_bracket"), bundle.get("losers_bracket")
    complete = league.get("status") == "complete"

    # Sleeper fills in the bracket's first round from the current standings
    # while a season is still running. Those places are projections, not
    # qualifications, so a season in progress has no playoff field at all -
    # otherwise it would count towards playoff appearances.
    override = {
        "playoffWeeks": playoff_weeks,
        "regularWeeks": regular_weeks,
        "championshipField": bracket_field(wb) if complete else [],
        "consolationField": bracket_field(lb) if complete else [],
        "champion": bracket_winner(wb) if complete else None,
        "consolationWinner": bracket_winner(lb) if complete else None,
        "inProgress": not complete,
        "source": "sleeper",
        "leagueName": league.get("name"),
        "finals": {
            "championship": next((roster2coach.get(e["w"]) for e in (wb or [])
                                  if e.get("p") == 1 and e.get("w")), None),
            "consolation": next((roster2coach.get(e["w"]) for e in (lb or [])
                                 if e.get("p") == 1 and e.get("w")), None),
        },
    }

    if not complete:
        issues.append(f"{year}: season still in progress - built from weeks "
                      f"{weeks[0]}-{weeks[-1]}, no playoffs yet"
                      if weeks else f"{year}: no completed weeks yet")

    return {
        "gameweeks": gameweeks, "draft": draft, "moves": moves,
        "trades": trades, "team_seasons": team_seasons, "override": override,
    }
