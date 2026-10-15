# Grading coaches and drafts — design notes

Agreed approach for a requested feature: grade seasons and drafts. Written
before implementation so the decisions and the reference numbers are settled.
Build order below is deliberate — the first two need no data the repo doesn't
already have.

## 1. Lineup efficiency (no new data)

Points a coach actually started, against the best legal lineup their roster
could have fielded that week. Measures lineup-setting skill alone.

Slot eligibility, from `roster_positions`:

| Slot | Takes |
| --- | --- |
| QB | QB |
| RB1, RB2 | RB |
| WR1, WR2 | WR |
| TE | TE |
| W/R | RB, WR |
| W/T | WR, TE |
| K | K |
| DEF | DEF |

Consider the **whole roster**, starters and bench together. Solve it as an
assignment problem (`scipy.optimize.linear_sum_assignment` on a slot x player
cost matrix of negated points) — greedy slot-filling is not optimal, because
taking the best RB for RB1 can strand a better overall arrangement through
the flex slots.

A handful of historical rows put a K in RB1 and a DB in W/T. The table above
excludes those; it describes the format, and the data has a few oddities.

Reference, 2024, to check an implementation against:

| Coach | Started | Optimal | Left on bench | Efficiency |
| --- | --- | --- | --- | --- |
| Beano | 2041.7 | 2215.5 | 173.7 | 92.2% |
| Niall | 2033.8 | 2210.3 | 176.5 | 92.0% |
| Stephen | 1854.6 | 2016.6 | 162.0 | 92.0% |
| Catherine | 2100.7 | 2320.6 | 219.9 | 90.5% |
| Dudley | 1599.7 | 1801.8 | 202.2 | 88.8% |
| Whytey | 1948.6 | 2233.2 | 284.6 | 87.3% |
| Ciaran | 1771.3 | 2042.1 | 270.8 | 86.7% |
| Chris | 1779.9 | 2057.0 | 277.1 | 86.5% |
| Dee | 1770.5 | 2080.6 | 310.1 | 85.1% |
| Scan | 1731.5 | 2086.0 | 354.5 | 83.0% |

Covers every week with a lineup, regular season and playoffs.

## 2. Luck, via all-play (no new data)

Each week, score a coach against all nine others rather than the one they
drew. The resulting all-play percentage, times games played, is the record
their scoring deserved; actual wins minus that is luck.

Regular season only. Reference, 2024:

| Coach | Actual | All-play | All-play % | Luck |
| --- | --- | --- | --- | --- |
| Niall | 9-5 | 86-40 | 68.3% | -0.6 |
| Catherine | 9-5 | 91-35 | 72.2% | -1.1 |
| Whytey | 9-5 | 74-52 | 58.7% | +0.8 |
| Beano | 8-6 | 79-47 | 62.7% | -0.8 |
| Stephen | 7-7 | 67-59 | 53.2% | -0.4 |
| Scan | 7-7 | 48-78 | 38.1% | +1.7 |
| Ciaran | 6-8 | 48-78 | 38.1% | +0.7 |
| Chris | 6-8 | 46-80 | 36.5% | +0.9 |
| Dee | 6-8 | 56-70 | 44.4% | -0.2 |
| Dudley | 3-11 | 35-91 | 27.8% | -0.9 |

Ties count as neither a win nor a loss on both sides.

## 3. Draft grading on outcome (no new data)

Rank every drafted player by points scored that season, and compare to where
they were taken. Answers whether a pick worked, which is the question people
actually argue about.

**Known limitation, state it on the page.** `raw/gameweeks.csv` records a
player only while they are on a roster in this league. A bust dropped in
week 3 leaves the data, so the figure is *points while rostered here*, not
points scored in the NFL. Directionally fine — dropped early is itself a
verdict — but it conflates a bad player with an early cut, and the page
should say so rather than implying full-season production.

Draft order differs by era: linear to 2017, snake from 2018 (`LINEAR_DRAFTS`).

## 4. ADP, only if sourced cleanly

ADP grades **process** — did a coach draft ahead of or behind the market.
Outcome grading (3 above) answers a different question. The interesting
output is where the two disagree: beating ADP consistently while the picks
underperform means someone reads the room well and picks players badly.

Three things to settle before the numbers mean anything:

- **Vintage.** ADP moves all summer. Use the same point in the calendar each
  year, as close to the league's draft date as the source allows, and record
  which.
- **Scoring format.** If the source assumes PPR and the league isn't, the
  grade systematically punishes whoever drafts pass-catching backs. Check the
  league's scoring settings against the source before trusting it.
- **Availability.** Sleeper's API does not serve historical ADP. 2015-2024
  needs sourcing elsewhere, per season, and the source should be recorded in
  `raw/` alongside the data.

## Presentation

Resist letter grades. A "C-" encodes arbitrary thresholds and reads as more
authoritative than it is. Percentile against league history, or named awards
(*most points left on the bench*, *luckiest season*, *worst first-round pick*)
carry the same information and suit a league of friends better.
