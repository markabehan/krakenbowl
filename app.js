/* League Record Book — static client. Loads pre-built JSON, no backend. */

const view = document.getElementById('view');
const nav = document.getElementById('mainnav');

let INDEX = null;
const seasonCache = new Map();

/* ---------- helpers ---------- */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pts = n => Number(n).toFixed(2);
const slug = s => encodeURIComponent(s);

function record(r) {
  return r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
}

async function getSeason(year) {
  if (!seasonCache.has(year)) {
    const res = await fetch(`data/season-${year}.json`);
    if (!res.ok) throw new Error(`Season ${year} is missing from the archive.`);
    seasonCache.set(year, await res.json());
  }
  return seasonCache.get(year);
}

/* ---------- routing ---------- */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const parts = path ? path.split('/').map(decodeURIComponent) : [];
  return { parts, params: new URLSearchParams(query || '') };
}

function setNav(active) {
  const latest = INDEX.seasons[INDEX.seasons.length - 1].year;
  const items = [
    ['', 'League'],
    [`season/${latest}`, 'Tables'],
    [`matchups/${latest}`, 'Matchups'],
  ];
  nav.innerHTML = items.map(([href, label]) =>
    `<a href="#/${href}"${active === label ? ' aria-current="page"' : ''}>${label}</a>`
  ).join('');
}

async function router() {
  const { parts, params } = parseHash();
  try {
    if (parts[0] === 'season') await renderSeason(+parts[1]);
    else if (parts[0] === 'matchups') await renderMatchups(+parts[1], params);
    else if (parts[0] === 'game') await renderGame(parts[1]);
    else if (parts[0] === 'coach') await renderCoach(parts[1]);
    else renderHome();
  } catch (err) {
    view.innerHTML = `<div class="pagehead"><h1>That page didn't load</h1>
      <p>${esc(err.message)} Try picking a season from the list.</p></div>`;
  }
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/* ---------- shared fragments ---------- */

function seasonStrip(current, base) {
  return `<nav class="seasons" aria-label="Seasons">` + INDEX.seasons.map(s =>
    `<a href="#/${base}/${s.year}"${s.year === current ? ' aria-current="page"' : ''}>${s.year}</a>`
  ).join('') + `</nav>`;
}

/* ---------- home ---------- */

function renderHome() {
  setNav('League');
  const c = INDEX.career;
  const first = INDEX.seasons[0].year;
  const last = INDEX.seasons[INDEX.seasons.length - 1].year;
  const games = c.reduce((a, r) => a + r.games, 0) / 2;
  const points = c.reduce((a, r) => a + r.pf, 0);

  const rows = c.map((r, i) => `<tr>
    <td class="rank">${i + 1}</td>
    <td class="col-name">
      <a class="coachname" href="#/coach/${slug(r.coach)}">${esc(r.coach)}</a>
      <span class="teamname">${r.seasons.length} season${r.seasons.length > 1 ? 's' : ''} &middot; ${r.seasons[0]}&ndash;${r.seasons[r.seasons.length - 1]}</span>
    </td>
    <td class="titles">${r.titles.length ? '&#9679;'.repeat(r.titles.length) : ''}</td>
    <td class="rec">${record(r)}</td>
    <td class="num">${(r.pct * 100).toFixed(1)}%</td>
    <td class="num">${pts(r.pf)}</td>
    <td class="num">${pts(r.ppg)}</td>
  </tr>`).join('');

  view.innerHTML = `
    <div class="pagehead">
      <p class="eyebrow">${first}&ndash;${last}</p>
      <h1>The all-time record</h1>
      <p>Regular season only. Playoff weeks are listed separately inside each season.</p>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Seasons</div><div class="v">${INDEX.seasons.length}</div></div>
      <div class="stat"><div class="k">Coaches</div><div class="v">${INDEX.coaches.length}</div></div>
      <div class="stat"><div class="k">Games played</div><div class="v">${games.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Points scored</div><div class="v">${Math.round(points).toLocaleString()}</div></div>
    </div>
    <div class="tablecard"><div class="tscroll"><table>
      <thead><tr>
        <th class="rank">#</th><th class="col-name">Coach</th>
        <th>Titles</th><th>Record</th><th>Win&nbsp;%</th>
        <th>Points&nbsp;for</th><th>Per&nbsp;game</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>
    <div class="section">
      <h2>Roll of honour</h2>
      <div class="honours">${INDEX.seasons.map(s => `
        <a class="honour" href="#/season/${s.year}">
          <span class="hy">${s.year}</span>
          <span class="hc">${s.champion ? esc(s.champion) : '&mdash;'}</span>
        </a>`).join('')}</div>
    </div>`;
}

/* ---------- season table ---------- */

async function renderSeason(year) {
  setNav('Tables');
  const s = await getSeason(year);
  const rows = s.standings.map(r => `<tr>
    <td class="rank">${r.rank}</td>
    <td class="col-name">
      <a class="coachname" href="#/coach/${slug(r.coach)}">${esc(r.coach)}</a>
      <span class="teamname">${esc(r.team)}</span>
    </td>
    <td class="rec">${record(r)}</td>
    <td class="num">${pts(r.pf)}</td>
    <td class="num">${pts(r.pa)}</td>
    <td class="num">${r.diff > 0 ? '+' : ''}${pts(r.diff)}</td>
    <td class="num">${pts(r.ppg)}</td>
    <td class="num">${pts(r.high)}</td>
  </tr>`).join('');

  const po = s.playoffWeeks.length
    ? `<div class="section"><h2>Playoffs</h2>${matchupList(s, s.playoffGames, true)}</div>`
    : `<div class="section"><h2>Playoffs</h2><p class="empty">Every team played all ${s.regularWeeks.length} weeks this season, so there's no separate bracket in the data.</p></div>`;

  view.innerHTML = `
    ${seasonStrip(year, 'season')}
    ${s.champion ? `<div class="champbar">
      <span class="trophy" aria-hidden="true"></span>
      <span><strong>${esc(s.champion)}</strong> won the ${year} title
      <span class="ct">${esc(s.teams[s.champion] || '')}</span></span>
    </div>` : ''}
    <div class="pagehead">
      <p class="eyebrow">Season ${year} &middot; ${s.standings.length} teams</p>
      <h1>Final table</h1>
      <p>Regular season, weeks ${s.regularWeeks[0]}&ndash;${s.regularWeeks[s.regularWeeks.length - 1]}.
         Ranked by record, then points for.</p>
    </div>
    <div class="tablecard"><div class="tscroll"><table>
      <thead><tr>
        <th class="rank">#</th><th class="col-name">Coach</th>
        <th>Record</th><th>PF</th><th>PA</th><th>Diff</th><th>Avg</th><th>Best</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>
    ${po}
    <div class="section">
      <p><a class="backlink" href="#/matchups/${year}">Browse every ${year} matchup &rarr;</a></p>
    </div>`;
}

/* ---------- matchup browser ---------- */

function matchupList(s, games, hideWeek) {
  if (!games.length) return `<p class="empty">No matchups match that filter.</p>`;
  const byWeek = new Map();
  for (const m of games) {
    if (!byWeek.has(m.week)) byWeek.set(m.week, []);
    byWeek.get(m.week).push(m);
  }
  return [...byWeek.entries()].map(([week, ms]) => `
    <div class="weekhead">Week ${week}${ms[0].playoff ? ' <span class="tag">Playoff</span>' : ''}</div>
    <div class="mlist">${ms.map(m => matchupRow(m)).join('')}</div>
  `).join('');
}

function matchupRow(m) {
  const hw = m.home.points > m.away.points, aw = m.away.points > m.home.points;
  return `<a class="mrow" href="#/game/${slug(m.id)}">
    <div class="side ${hw ? 'win' : ''}">
      <div class="nm">${esc(m.home.coach)}</div>
      <div class="tm">${esc(m.home.team)}</div>
    </div>
    <div class="score">
      <span class="v ${hw ? 'win' : ''}">${pts(m.home.points)}</span>
      <span class="dash">&ndash;</span>
      <span class="v ${aw ? 'win' : ''}">${pts(m.away.points)}</span>
    </div>
    <div class="side r ${aw ? 'win' : ''}">
      <div class="nm">${esc(m.away.coach)}</div>
      <div class="tm">${esc(m.away.team)}</div>
    </div>
  </a>`;
}

async function renderMatchups(year, params) {
  setNav('Matchups');
  const s = await getSeason(year);
  const week = params.get('week') || 'all';
  const coach = params.get('coach') || 'all';

  let games = s.matchups;
  if (week !== 'all') games = games.filter(m => m.week === +week);
  if (coach !== 'all') games = games.filter(m => m.home.coach === coach || m.away.coach === coach);

  const weeks = [...new Set(s.matchups.map(m => m.week))].sort((a, b) => a - b);
  const coaches = Object.keys(s.teams).sort();

  const weekOpts = ['<option value="all">All weeks</option>']
    .concat(weeks.map(w => `<option value="${w}"${week == w ? ' selected' : ''}>Week ${w}${s.playoffWeeks.includes(w) ? ' (playoff)' : ''}</option>`)).join('');
  const coachOpts = ['<option value="all">All coaches</option>']
    .concat(coaches.map(c => `<option value="${esc(c)}"${coach === c ? ' selected' : ''}>${esc(c)}</option>`)).join('');

  view.innerHTML = `
    ${seasonStrip(year, 'matchups')}
    <div class="pagehead">
      <p class="eyebrow">Season ${year}</p>
      <h1>Matchups</h1>
      <p>Filter by week or by coach, then open any game for the full box score.</p>
    </div>
    <div class="filters">
      <div class="field"><label for="fw">Week</label><select id="fw">${weekOpts}</select></div>
      <div class="field"><label for="fc">Coach</label><select id="fc">${coachOpts}</select></div>
      <span class="count">${games.length} game${games.length === 1 ? '' : 's'}</span>
    </div>
    ${matchupList(s, games)}`;

  const apply = () => {
    const w = document.getElementById('fw').value;
    const c = document.getElementById('fc').value;
    const q = new URLSearchParams();
    if (w !== 'all') q.set('week', w);
    if (c !== 'all') q.set('coach', c);
    const qs = q.toString();
    location.hash = `#/matchups/${year}${qs ? '?' + qs : ''}`;
  };
  document.getElementById('fw').addEventListener('change', apply);
  document.getElementById('fc').addEventListener('change', apply);
}

/* ---------- box score ---------- */

async function renderGame(id) {
  setNav(null);
  const year = +id.split('-')[0];
  const s = await getSeason(year);
  const m = s.matchups.find(x => x.id === id);
  if (!m) throw new Error('That matchup is not in the archive.');

  const home = s.lineups[`${m.week}|${m.home.coach}`] || [];
  const away = s.lineups[`${m.week}|${m.away.coach}`] || [];
  const hw = m.home.points > m.away.points, aw = m.away.points > m.home.points;

  // Pair the two lineups slot by slot so they read as a head-to-head ladder.
  const slots = [];
  const seen = new Set();
  for (const p of [...home, ...away]) {
    if (!seen.has(p.slot)) { seen.add(p.slot); slots.push(p.slot); }
  }
  const order = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'W/R', 'W/T', 'K', 'DEF',
    'BN1', 'BN2', 'BN3', 'BN4', 'BN5', 'BN6'];
  slots.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));

  const topH = Math.max(...home.filter(p => !p.bench).map(p => p.pts), 0);
  const topA = Math.max(...away.filter(p => !p.bench).map(p => p.pts), 0);

  const cell = (p, side, top) => {
    if (!p) return `<div class="pl ${side}"><div class="p-info"><div class="p-nm p-none">&mdash;</div></div></div>`;
    const name = p.player
      ? `${esc(p.player)}<span class="nfl">${esc(p.nfl || '')}</span>`
      : `<span class="p-none">Empty slot</span>`;
    return `<div class="pl ${side}">
      <div class="p-info">
        <div class="p-nm">${name}</div>
        ${p.stats ? `<div class="p-st">${esc(p.stats)}</div>` : ''}
      </div>
      <div class="p-pts ${!p.bench && p.pts === top && p.pts > 0 ? 'top' : ''}">${pts(p.pts)}</div>
    </div>`;
  };

  let benchStarted = false;
  const rungs = slots.map(slot => {
    const h = home.find(p => p.slot === slot);
    const a = away.find(p => p.slot === slot);
    const bench = (h || a).bench;
    let divider = '';
    if (bench && !benchStarted) { benchStarted = true; divider = '<div class="benchmark">Bench</div>'; }
    return `${divider}<div class="rung ${bench ? 'bench' : ''}">
      ${cell(h, 'l', topH)}
      <div class="slotlabel">${esc(slot.replace(/^BN\d$/, 'BN'))}</div>
      ${cell(a, 'r', topA)}
    </div>`;
  }).join('');

  view.innerHTML = `
    <a class="backlink" href="#/matchups/${year}?week=${m.week}">&larr; Week ${m.week}, ${year}</a>
    <div class="boxhead">
      <div>
        <div class="nm">${esc(m.home.coach)}</div>
        <div class="tm">${esc(m.home.team)}</div>
        <div class="total ${hw ? 'win' : ''}">${pts(m.home.points)}</div>
      </div>
      <div class="vs">Week ${m.week}<br>${year}${m.playoff ? '<br>Playoff' : ''}</div>
      <div class="r">
        <div class="nm">${esc(m.away.coach)}</div>
        <div class="tm">${esc(m.away.team)}</div>
        <div class="total ${aw ? 'win' : ''}">${pts(m.away.points)}</div>
      </div>
    </div>
    <div class="ladder">${rungs}</div>
    <div class="legend">
      <span class="k"><span class="dot"></span> Top starter</span>
      <span class="k"><span class="dot bench"></span> Bench &mdash; not counted</span>
      <span class="k">Bench totals: ${pts(m.home.bench)} &middot; ${pts(m.away.bench)}</span>
    </div>`;
}

/* ---------- coach page ---------- */

async function renderCoach(name) {
  setNav(null);
  const career = INDEX.career.find(c => c.coach === name);
  if (!career) throw new Error(`No coach called ${name} in the archive.`);

  const seasons = await Promise.all(career.seasons.map(getSeason));

  const rows = seasons.map(s => {
    const r = s.standings.find(x => x.coach === name);
    return `<tr>
      <td class="rank">${s.year}</td>
      <td class="col-name">
        <a class="coachname" href="#/matchups/${s.year}?coach=${slug(name)}">${esc(r.team)}</a>
        <span class="teamname">Finished ${r.rank} of ${s.standings.length}</span>
      </td>
      <td class="rec">${record(r)}</td>
      <td class="num">${pts(r.pf)}</td>
      <td class="num">${pts(r.pa)}</td>
      <td class="num">${pts(r.ppg)}</td>
      <td class="num">${pts(r.high)}</td>
    </tr>`;
  }).join('');

  const best = seasons
    .map(s => ({ year: s.year, r: s.standings.find(x => x.coach === name) }))
    .sort((a, b) => a.r.rank - b.r.rank)[0];
  const high = seasons.flatMap(s => s.matchups
    .filter(m => m.home.coach === name || m.away.coach === name)
    .map(m => ({ y: s.year, w: m.week, id: m.id,
                 p: m.home.coach === name ? m.home.points : m.away.points })))
    .sort((a, b) => b.p - a.p)[0];

  view.innerHTML = `
    <a class="backlink" href="#/">&larr; All coaches</a>
    <div class="pagehead">
      <p class="eyebrow">${career.seasons.length} seasons &middot; ${career.seasons[0]}&ndash;${career.seasons[career.seasons.length - 1]}</p>
      <h1>${esc(name)}</h1>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Career record</div><div class="v">${record(career)}</div>
        <div class="s">${(career.pct * 100).toFixed(1)}% wins</div></div>
      <div class="stat"><div class="k">Points per game</div><div class="v">${pts(career.ppg)}</div>
        <div class="s">${Math.round(career.pf).toLocaleString()} total</div></div>
      <div class="stat"><div class="k">Titles</div><div class="v">${career.titles.length}</div>
        <div class="s">${career.titles.length ? career.titles.join(', ') : 'None yet'}</div></div>
      <div class="stat"><div class="k">Best finish</div><div class="v">${best.r.rank}${['th','st','nd','rd'][best.r.rank % 10] || 'th'}</div>
        <div class="s">${best.year}</div></div>
      <div class="stat"><div class="k">Highest score</div><div class="v">${pts(high.p)}</div>
        <div class="s"><a href="#/game/${slug(high.id)}">Week ${high.w}, ${high.y}</a></div></div>
    </div>
    <div class="tablecard"><div class="tscroll"><table>
      <thead><tr>
        <th class="rank">Year</th><th class="col-name">Team</th>
        <th>Record</th><th>PF</th><th>PA</th><th>Avg</th><th>Best</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
}

/* ---------- boot ---------- */

(async function init() {
  try {
    const res = await fetch('data/index.json');
    if (!res.ok) throw new Error('Could not load the archive index.');
    INDEX = await res.json();
    const last = INDEX.seasons[INDEX.seasons.length - 1].year;
    document.getElementById('brandSub').textContent =
      `Fantasy football, ${INDEX.seasons[0].year}\u2013${last}`;
    window.addEventListener('hashchange', router);
    router();
  } catch (err) {
    view.innerHTML = `<div class="pagehead"><h1>The archive didn't load</h1>
      <p>${esc(err.message)} If you're opening this file directly, run a local
      server instead &mdash; browsers block data loading from <code>file://</code>.</p></div>`;
  }
})();
