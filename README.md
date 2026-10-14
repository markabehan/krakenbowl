# League Record Book

A static site for ten seasons of fantasy football history: all-time records,
season standings, playoffs, matches, draft boards, waiver moves, trades and
full box scores. No backend — the CSVs are converted to JSON once and the
browser does the rest.

## Getting it online

1. Create a repository and copy this folder into it.
2. Commit and push.
3. In the repo, go to **Settings → Pages**, set **Source** to "Deploy from a
   branch", pick your branch and the **`/docs`** folder, and save.

The site appears at `https://<you>.github.io/<repo>/` within a minute or so.
Nothing is built on GitHub's side — `docs/` is already the finished site.

## Regenerating the data

Only needed when a CSV changes:

```bash
pip install pandas
python3 build.py raw
```

That rewrites `docs/data/`. Commit the result and push. The script prints any
data problems it finds before it writes anything — worth reading each time.

## Looking at it locally

Browsers block loading JSON from `file://`, so open it through a server:

```bash
python3 -m http.server 8000 --directory docs
```

Then visit `http://localhost:8000`.

## Source files

All live in `raw/`:

| File | What it holds |
| --- | --- |
| `gameweeks.csv` | every lineup slot, every week, every season |
| `drafts.csv` | draft boards |
| `adds_drops.csv` | waiver claims and free agent moves |
| `trades.csv` | trades, with teams named rather than coaches |
| `team_names.csv` | every team name a coach has used |
| `team_seasons.csv` | which name each coach used in each season |

`team_seasons.csv` is generated, not hand-kept. `team_names.csv` is a
deduplicated list — some coaches reused a name in different years, so it can't
say which name belongs to which season — and `gameweeks.csv` has no team-name
column at all. `team_seasons.csv` fills that gap; it was derived from the
original lineup export and every name in it cross-checks against
`team_names.csv`. If a coach-season is missing from it, the site falls back to
showing the coach's name and the build says so.

## How the site is laid out

```
build.py              CSVs -> JSON
raw/                  the source CSVs
docs/
  index.html
  styles.css
  app.js              routing and rendering
  data/
    index.json        season list, career records, roll of honour
    season-YYYY.json  one file per season, loaded on demand
```

Season files are 300–450KB and only load when that season is opened, so the
first page stays quick however many years get added.

Pages are addressable, so links can be shared:

- `#/` — all-time record (add `?mode=regular` or `?mode=playoffs`)
- `#/season/2023/standings` — also `playoffs`, `matches`, `draft`, `moves`, `trades`
- `#/season/2023/matches?week=15&coach=Dee` — filtered
- `#/game/2023-17-Ciaran-Whytey` — a single box score
- `#/coach/Whytey` — one coach's career

## League format, as encoded

Set at the top of `build.py` in `PLAYOFF_WEEKS`, `CHAMPIONSHIP_FORMAT` and
`CHAMPIONS`. Change it there and rebuild.

**Seeding.** Win ratio first. Ties are broken by the record among the tied
teams, then by points scored. For two teams that is a straight head-to-head;
for three or more it is the record inside the tied group, because pairwise
results can form a loop and then no pair comparison can order them. This
matters in practice: 2018 had a three-way tie at 8-6 that only resolves
correctly this way, and getting it wrong misplaces three playoff seeds.

**Playoffs.**

| Seasons | Regular | Playoff weeks | Championship | Trash Bowl |
| --- | --- | --- | --- | --- |
| 2015 | 1–14 | 15–16 | top 4 (all four teams) | none |
| 2016 | 1–14 | 15–16 | top 4 | seeds 5–8 |
| 2017–2019 | 1–14 | 15–16 | top 4 | seeds 5–8, bottom two sit out |
| 2020 | 1–13 | 14–16 | top 6, seeds 1–2 bye | seeds 7–10 |
| 2021–2022 | 1–14 | 15–17 | top 6, seeds 1–2 bye | seeds 7–10 |
| 2023–2024 | 1–14 | 15–17 | top 5 plus the highest scorer of the bottom 5 | the other four |

Champions are listed explicitly because consolation games run alongside the
final, so the last week doesn't identify a winner on its own. The build checks
every recorded champion against the bracket anyway and warns on a mismatch —
all ten currently agree.

**Playoff appearances** on the Overall page count the seasons a coach reached
the championship bracket, out of the seasons they played. The Trash Bowl is
where the teams that missed out go, so it isn't an appearance. This is separate
from the playoff win-loss record, which counts games.

Trash Bowl winners are derived, not listed: within each bracket the final is
the last game between two teams that haven't yet lost, and its winner takes the
title. The same rule reproduces all ten championship winners independently,
which is what makes it trustworthy for the consolation side.

## Things worth knowing about the data

**Bench players are marked two different ways.** For 2015–2019 there is a
`Bench` column containing `BN`. From 2020 on that column is empty and the only
marker is the slot name (`BN1`–`BN6`). The build treats either as
authoritative. This matters: trusting only the column counts bench points as
starter points, which changes the winner in a large share of games from 2020
onward.

**Coach is the identity, not the team name.** Almost everyone renames their
team every season, so all history keys on the coach and the team name is shown
as a subtitle.

**Other files spell three coaches differently** — `David` for Dave, `Mark` for
Scan, and `dudley` for Dudley. The build maps these in `ALIASES`. The mapping
was confirmed by checking which coach's roster actually contained each added
player, not by guessing from the names.

**Trade rows name teams, not coaches.** They are resolved through
`team_names.csv`, matching on a normalised form so that `We Are Borg-Ciaran`
and `We Are Borg - Ciaran` are treated as the same team. All 55 distinct team
names in the trade file resolve.

### Known faults in the source

The build handles these and reports them on every run:

- **2023 week 15** — two complete lineups are filed under Chris and Ciaran has
  none. Comparing each block against the surrounding weeks settles it: one
  overlaps Chris 15/16 and Ciaran 0/16, the other the reverse, so the second
  block is reassigned to Ciaran. Both were on a bye, so no result changes.
- **adds/drops** — two rows have no coach and are left out.

Stat lines use non-breaking spaces, normalised during the build, and a few were
truncated with `...` when the spreadsheet was exported; those are left as-is
because the underlying detail is gone.
