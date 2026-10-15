# krakenbowl

A static GitHub Pages site archiving a fantasy football league, 2015 to the
present. No backend: CSVs and Sleeper API dumps are converted to JSON once by
`build.py`, and the browser does the rest. `README.md` is the full reference -
read it before changing the pipeline.

## Build and check

```bash
python3 build.py raw          # rewrites docs/data/
python3 -m http.server 8000 --directory docs
```

`build.py` prints every data problem it finds before writing anything. Read
that output each time; it is the first place a regression shows up.

After any change to the pipeline, verify against the sources rather than
trusting the build:

- recompute team scores straight from `raw/gameweeks.csv` and the Sleeper
  dumps, and compare to `docs/data/season-*.json`
- check wins equal losses in every season
- check each recorded champion won the game tagged `Championship final`
- check no playoff-week game is left unlabelled, and that championship and
  consolation fields never overlap

These catch real bugs. Several below were found exactly this way.

## League format

Seeding: win ratio, then a tiebreak that depends on the season (`TIEBREAK`
in `build.py`): every season except 2025 uses wins among the tied teams,
then fewest losses among them, then points; 2025 uses win ratio among the
tied teams then points (the commissioner's script). NFL.com's rules
(`seed_nfl`, unused) do **not** reproduce the 2017, 2021 or 2024 brackets
that were played, so don't apply them to old seasons. From 2023 the sixth place is a wildcard: highest scorer outside the
top five.

| Seasons | Regular | Playoffs | Championship | Trash Bowl |
| --- | --- | --- | --- | --- |
| 2015 | 1-14 | 15-16 | top 4 (all teams) | none |
| 2016 | 1-14 | 15-16 | top 4 | seeds 5-8 |
| 2017-2019 | 1-14 | 15-16 | top 4 | seeds 5-8, bottom two sit out |
| 2020 | 1-13 | 14-16 | top 6, seeds 1-2 bye | seeds 7-10 |
| 2021-2022 | 1-14 | 15-17 | top 6, seeds 1-2 bye | seeds 7-10 |
| 2023-2024 | 1-14 | 15-17 | top 5 + highest scorer of the bottom 5 | the other four |
| 2025- | 1-14 | 15-17 | as 2023, field taken from Sleeper's bracket | from Sleeper's bracket |

Drafts are linear up to 2017 and snake from 2018 (`LINEAR_DRAFTS`).

Power rankings and the weekly score tables are validated against the
commissioner's output for 2025; they match to the cent except where two
values sit exactly on a half cent.

Set in `PLAYOFF_WEEKS`, `CHAMPIONSHIP_FORMAT` and `CHAMPIONS` at the top of
`build.py`. The league tracks seedings by hand and the commissioner sets the
Sleeper brackets manually, so Sleeper seasons use the league's tiebreak, not
Sleeper's own points-only one.

## Gotchas that have already bitten

- **Bench is marked two ways.** 2015-2019 fill a `Bench` column; from 2020 it
  is empty and only the slot name (`BN1`-`BN6`) marks it. Trusting the column
  alone counts bench points as starter points and changes the winner in a
  large share of games.
- **Coach is the identity, not the team name.** Almost everyone renames their
  team every season.
- **Three coaches are spelled differently** in the support files: `David`,
  `Mark` and `dudley` map to Dave, Scan and Dudley (`ALIASES` in `build.py`).
  Sleeper identifies coaches by numeric id, in `raw/sleeper_coaches.csv`.
- **2023 week 15** has two lineups filed under Chris and none for Ciaran. The
  build reassigns the second block by roster overlap and says so. Don't
  "fix" this by dropping rows.
- **A Sleeper season in progress** publishes its whole fixture list up front
  and pre-fills the bracket from current standings. Only weeks with both a
  fixture and a score count, and the projected bracket is ignored entirely,
  so an unfinished season contributes no playoff appearances or winners.

## Adding a season

```bash
python3 sleeper_fetch.py <league_id>   # must run outside any sandbox
python3 build.py raw
```

`api.sleeper.app` is blocked from cloud containers and sandboxed shells, so
the fetch has to run on a normal machine. Everything after it is automatic.

Give `sleeper_fetch.py` the **most recent** league id; it walks back through
`previous_league_id` and collects every earlier Sleeper season itself.

## Working here

The site is served from `docs/` on GitHub Pages. Pushing to `main` deploys it.
Browsers cache `app.js`, `styles.css` and the season JSON aggressively, so a
hard refresh is needed after a deploy before changes are visible.

Don't upload files through the GitHub web UI. Doing that alongside local
commits forks the history, which has already happened once and needed a merge
to untangle.

## Open

The Trash Bowl winners for 2016-2024 are derived from the bracket, not
recorded anywhere external, and have never been confirmed against anyone's
memory. The same derivation independently reproduces all ten championship
winners, which is why it is trusted, but it remains unverified.
