#!/usr/bin/env python3
"""
Pull a league's full history out of Sleeper and save it as raw JSON.

Usage:  python3 sleeper_fetch.py <league_id> [out_dir]

The league id is in the URL when you're looking at the league on the web:
    https://sleeper.com/leagues/1234567890123456789/team
                               ^^^^^^^^^^^^^^^^^^^
Give it the most recent season's id. Sleeper links each season to the one
before it, so the script walks backwards and collects every season by itself.

Needs nothing but Python 3 - no pip install. Writes to raw/sleeper/<season>/
and prints what it saved. Safe to re-run; it overwrites cleanly.
"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.sleeper.app/v1"
PAUSE = 0.12          # ~8 calls/sec, far below Sleeper's 1000/min guidance
MAX_WEEK = 18         # fetch through week 18 and ignore whatever is empty


def get(path, required=True):
    url = f"{API}/{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "record-book/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if required:
            raise SystemExit(f"\nFailed on {url}\n  HTTP {e.code} {e.reason}")
        return None
    except Exception as e:
        if required:
            raise SystemExit(f"\nFailed on {url}\n  {type(e).__name__}: {e}")
        return None
    time.sleep(PAUSE)
    return data


def save(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")))
    return path.stat().st_size


def fetch_season(league_id, out):
    league = get(f"league/{league_id}")
    if not league:
        raise SystemExit(f"No league found for id {league_id}")
    season = str(league.get("season", "unknown"))
    d = out / season
    print(f"\n=== {season}  {league.get('name', '')}  (id {league_id})")

    bundle = {"league": league}
    bundle["users"] = get(f"league/{league_id}/users")
    bundle["rosters"] = get(f"league/{league_id}/rosters")
    # Brackets only exist once the season has reached the playoffs.
    bundle["winners_bracket"] = get(f"league/{league_id}/winners_bracket", required=False)
    bundle["losers_bracket"] = get(f"league/{league_id}/losers_bracket", required=False)

    matchups, transactions = {}, {}
    for wk in range(1, MAX_WEEK + 1):
        m = get(f"league/{league_id}/matchups/{wk}", required=False)
        if m:
            matchups[str(wk)] = m
        t = get(f"league/{league_id}/transactions/{wk}", required=False)
        if t:
            transactions[str(wk)] = t
    bundle["matchups"] = matchups
    bundle["transactions"] = transactions
    print(f"    weeks with matchups: {len(matchups)}   "
          f"weeks with transactions: {len(transactions)}")

    drafts = get(f"league/{league_id}/drafts", required=False) or []
    bundle["drafts"] = []
    for dr in drafts:
        picks = get(f"draft/{dr['draft_id']}/picks", required=False) or []
        bundle["drafts"].append({"draft": dr, "picks": picks})
    print(f"    drafts: {len(bundle['drafts'])}  "
          f"picks: {sum(len(x['picks']) for x in bundle['drafts'])}")

    size = save(d / "league.json", bundle)
    print(f"    saved {d/'league.json'}  ({size/1024:.0f} KB)")

    return league.get("previous_league_id"), bundle


def referenced_player_ids(bundles):
    """Every player id that appears anywhere, so we can trim the player file."""
    ids = set()
    for b in bundles:
        for wk in b["matchups"].values():
            for team in wk:
                for key in ("starters", "players"):
                    for p in team.get(key) or []:
                        if p:
                            ids.add(str(p))
        for wk in b["transactions"].values():
            for t in wk:
                for key in ("adds", "drops"):
                    for p in (t.get(key) or {}):
                        ids.add(str(p))
        for d in b["drafts"]:
            for p in d["picks"]:
                if p.get("player_id"):
                    ids.add(str(p["player_id"]))
    return ids


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    league_id = sys.argv[1].strip()
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "raw/sleeper")

    print("Walking the league history backwards from", league_id)
    bundles, seen = [], set()
    while league_id and league_id not in seen:
        seen.add(league_id)
        league_id, bundle = fetch_season(league_id, out)
        bundles.append(bundle)

    # The full player list is ~10MB and mostly irrelevant, so keep only the
    # players this league actually used.
    print("\nFetching the player directory (large, one time)...")
    players = get("players/nfl")
    want = referenced_player_ids(bundles)
    trimmed = {}
    for pid in want:
        p = players.get(pid)
        if not p:
            continue
        trimmed[pid] = {
            "name": p.get("full_name") or
                    " ".join(filter(None, [p.get("first_name"), p.get("last_name")])) or
                    p.get("last_name") or pid,
            "pos": p.get("position"),
            "team": p.get("team"),
        }
    size = save(out / "players.json", trimmed)
    print(f"  {len(want)} players referenced, {len(trimmed)} resolved")
    print(f"  saved {out/'players.json'}  ({size/1024:.0f} KB)")

    missing = sorted(want - set(trimmed))
    if missing:
        print(f"  note: {len(missing)} ids had no entry "
              f"(usually team defences): {missing[:8]}")

    print("\nSeasons collected:",
          ", ".join(sorted(str(b["league"].get("season")) for b in bundles)))
    print(f"Everything is under {out}/ - zip that folder and send it over.")


if __name__ == "__main__":
    main()
