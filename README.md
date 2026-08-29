# League Record Book

A static site for ten seasons of fantasy football history: final tables, every
matchup, and full box scores. No backend, no database — the CSV is converted to
JSON once and the browser does the rest.

## Getting it online

1. Create a repository and copy this folder into it.
2. Commit and push.
3. In the repo, go to **Settings → Pages**, set **Source** to "Deploy from a
   branch", pick your branch and the **`/docs`** folder, and save.

The site appears at `https://<you>.github.io/<repo>/` within a minute or so.

Nothing needs building on GitHub's side — `docs/` is already the finished site.

## Regenerating the data

Only needed when the CSV changes:

```bash
pip install pandas
python3 build.py path/to/lineup_data.csv
```

That rewrites `docs/data/`. Commit the result and push.

The script prints any data problems it finds before it writes anything — worth
reading each time.

## Looking at it locally

Browsers block loading JSON from `file://`, so open it through a server:

```bash
python3 -m http.server 8000 --directory docs
```

Then visit `http://localhost:8000`.

## How the site is laid out

```
build.py              CSV -> JSON
docs/
  index.html
  styles.css
  app.js              routing and rendering
  data/
    index.json        season list, all-time career table
    season-YYYY.json  one file per season, loaded on demand
```

Season files are ~300KB each and only load when that season is opened, so the
first page is quick regardless of how many years get added.

Pages are addressable, so links can be shared directly:

- `#/` — all-time table
- `#/season/2023` — that season's final table
- `#/matchups/2023?week=15&coach=Dee` — filtered matchup list
- `#/game/2023-15-Beano-Niall` — a single box score
- `#/coach/Whytey` — one manager's career

## Things worth knowing about the data

**Bench players are marked two different ways.** For 2015–2019 there's a
`Bench` column containing `BN`. From 2020 onward that column is empty and the
only marker is the slot name (`BN1`–`BN6`). The build treats either as
authoritative. This matters: trusting only the column counts bench points as
starter points, which changes the winner in 99 of 729 games, all in 2020–2024.

**Coach is the identity, not team name.** Almost everyone renames their team
every season, so all history is keyed on the coach and the team name is shown
as a subtitle.

**Regular season vs playoffs is inferred.** Byes only appear once the bracket
starts, so the postseason is detected as the last run of weeks containing byes,
extended to the end of the season. Final weeks often look "full" again because
the whole league plays consolation games. 2015 and 2016 have no byes at all, so
their playoff weeks are set by hand in `PLAYOFF_OVERRIDE` in `build.py`. Add
any other season there if it splits wrongly.

**Standings** are regular season only, ranked by record then points for.

**Champions are entered by hand** in `CHAMPIONS` in `build.py`, because
consolation games run alongside the final so the last week doesn't identify a
winner on its own.

After each build the script checks every recorded champion actually won their
last playoff game, and warns if not. Nine of the ten seasons pass. **2023 does
not**: the bracket has Ciaran beating Beano in the week 16 semi-final, then
losing the week 17 final to Whytey, 101.36-138.68. The name is left as supplied
so the warning stays visible — change it in `CHAMPIONS` once the real result is
settled.

### Known faults in the export

The build handles these and reports them on every run:

- **2015 week 6** — Dave's and Niall's lineups are each entered twice. The
  duplicates are dropped; without that their scores for the week double.
- **2023 week 15** — two different lineups are both filed under Chris, while
  Ciaran is missing entirely. Both were on a bye so no result depends on it,
  but only the first lineup is shown. Worth correcting at source.
- **2024 week 12** — Beano's lineup is missing and his opponent is marked
  `BYE`, so that week has four games instead of five.

Stat lines use non-breaking spaces (normalised during the build) and some were
truncated with `...` when the spreadsheet was exported; those are left as-is
because the underlying detail is gone.
