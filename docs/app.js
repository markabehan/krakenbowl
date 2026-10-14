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
const rec = r => (r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`);
const pct = n => (n * 100).toFixed(1) + '%';

function dots(golds, silvers) {
  return '<span class="dot-g"></span>'.repeat(golds)
       + '<span class="dot-s"></span>'.repeat(silvers);
}

async function getSeason(year) {
  if (!seasonCache.has(year)) {
    const res = await fetch(`data/season-${year}.json`);
    if (!res.ok) throw new Error(`Season ${year} is missing from the archive.`);
    seasonCache.set(year, await res.json());
  }
  return seasonCache.get(year);
}

const latestYear = () => INDEX.seasons[INDEX.seasons.length - 1].year;

/* ---------- routing ---------- */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  return {
    parts: path ? path.split('/').map(decodeURIComponent) : [],
    params: new URLSearchParams(query || ''),
  };
}

function setNav(active) {
  const items = [['', 'Overall'], [`season/${latestYear()}`, 'Seasons']];
  nav.innerHTML = items.map(([href, label]) =>
    `<a href="#/${href}"${active === label ? ' aria-current="page"' : ''}>${label}</a>`
  ).join('');
}

async function router() {
  const { parts, params } = parseHash();
  try {
    if (parts[0] === 'season') await renderSeason(+parts[1], parts[2] || 'standings', params);
    else if (parts[0] === 'game') await renderGame(parts[1]);
    else if (parts[0] === 'coach') await renderCoach(parts[1]);
    else renderOverall(params);
  } catch (err) {
    view.innerHTML = `<div class="pagehead"><h1>That page didn't load</h1>
      <p>${esc(err.message)} Try picking a season from the list.</p></div>`;
  }
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/* ---------- overall ---------- */

const MODES = {
  all: { label: 'Combined', w: 'allW', l: 'allL', p: 'allPct',
         note: 'Regular season and playoffs together.' },
  regular: { label: 'Regular season', w: 'w', l: 'l', p: 'pct',
             note: 'Regular season only.' },
  playoffs: { label: 'Playoffs', w: 'pw', l: 'pl', p: 'ppct',
              note: 'Championship and Trash Bowl games only.' },
};

function renderOverall(params) {
  setNav('Overall');
  const mode = MODES[params.get('mode')] ? params.get('mode') : 'all';
  const M = MODES[mode];

  const rows = [...INDEX.career]
    .sort((a, b) => (b[M.p] - a[M.p]) || (b.pf - a.pf))
    .map((r, i) => {
      const played = r[M.w] + r[M.l];
      return `<tr>
        <td class="rank">${i + 1}</td>
        <td class="col-name">
          <a class="coachname" href="#/coach/${slug(r.coach)}">${esc(r.coach)}</a>
          <span class="teamname">${r.seasons.length} season${r.seasons.length > 1 ? 's' : ''}
            &middot; ${r.seasons[0]}&ndash;${r.seasons[r.seasons.length - 1]}</span>
        </td>
        <td class="dots">${dots(r.titles.length, r.trash.length)}</td>
        <td class="num apps">${r.appearances.length}<span class="of">/${r.seasons.length}</span></td>
        <td class="rec">${played ? `${r[M.w]}-${r[M.l]}` : '&mdash;'}</td>
        <td class="num">${played ? pct(r[M.p]) : '&mdash;'}</td>
        <td class="num">${pts(r.pf)}</td>
        <td class="num">${pts(r.ppg)}</td>
      </tr>`;
    }).join('');

  const toggle = Object.entries(MODES).map(([k, v]) =>
    `<a href="#/?mode=${k}"${k === mode ? ' aria-current="true"' : ''}>${v.label}</a>`
  ).join('');

  const games = INDEX.career.reduce((a, r) => a + r.games, 0) / 2;
  const points = INDEX.career.reduce((a, r) => a + r.pf, 0);
  const first = INDEX.seasons[0].year;

  const honours = INDEX.seasons.map(s => `
    <a class="honour" href="#/season/${s.year}/playoffs">
      <span class="hy">${s.year}</span>
      <span class="row"><span class="dot-g"></span>
        <span class="hc">${s.champion ? esc(s.champion) : '&mdash;'}</span></span>
      ${s.consolationWinner
        ? `<span class="ht"><span class="dot-s"></span> ${esc(s.consolationWinner)}</span>`
        : `<span class="ht">no Trash Bowl</span>`}
    </a>`).join('');

  view.innerHTML = `
    <div class="pagehead">
      <p class="eyebrow">${first}&ndash;${latestYear()}</p>
      <h1>The all-time record</h1>
      <p>${M.note} Ranked by win percentage, then points scored.
         Playoffs made counts the seasons a coach reached the championship
         bracket, out of the seasons they played &mdash; the Trash Bowl doesn't
         count.</p>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Seasons</div><div class="v">${INDEX.seasons.length}</div></div>
      <div class="stat"><div class="k">Coaches</div><div class="v">${INDEX.coaches.length}</div></div>
      <div class="stat"><div class="k">Games played</div><div class="v">${games.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Points scored</div><div class="v">${Math.round(points).toLocaleString()}</div></div>
    </div>
    <nav class="pills subnav" aria-label="Record type">${toggle}</nav>
    <div class="tablecard"><div class="tscroll"><table>
      <thead><tr>
        <th class="rank">#</th><th class="col-name">Coach</th><th>Honours</th>
        <th>Playoffs&nbsp;made</th><th>${esc(M.label)}</th><th>Win&nbsp;%</th>
        <th>Points&nbsp;for</th><th>Per&nbsp;game</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>
    <div class="legend">
      <span class="k"><span class="dot-g"></span> Championship</span>
      <span class="k"><span class="dot-s"></span> Trash Bowl</span>
    </div>
    <div class="section">
      <h2>Roll of honour</h2>
      <div class="honours">${honours}</div>
    </div>`;
}

/* ---------- season shell ---------- */

const SEASON_VIEWS = [
  ['standings', 'Standings'], ['playoffs', 'Playoffs'], ['matches', 'Matches'],
  ['draft', 'Draft'], ['moves', 'Adds &amp; drops'], ['trades', 'Trades'],
];

async function renderSeason(year, sub, params) {
  setNav('Seasons');
  const s = await getSeason(year);

  const years = `<nav class="pills years" aria-label="Season">` + INDEX.seasons.map(x =>
    `<a href="#/season/${x.year}/${sub}"${x.year === year ? ' aria-current="page"' : ''}>${x.year}</a>`
  ).join('') + `</nav>`;

  const subnav = `<nav class="pills subnav" aria-label="Season view">` + SEASON_VIEWS.map(([k, label]) =>
    `<a href="#/season/${year}/${k}"${k === sub ? ' aria-current="page"' : ''}>${label}</a>`
  ).join('') + `</nav>`;

  const banner = `<div class="champbar">
      <span class="item"><span class="dot-g"></span><span class="lbl">Champion</span>
        <span class="who">${s.champion ? esc(s.champion) : '&mdash;'}</span></span>
      ${s.consolationWinner ? `<span class="item"><span class="dot-s"></span>
        <span class="lbl">Trash Bowl</span>
        <span class="who">${esc(s.consolationWinner)}</span></span>` : ''}
    </div>`;

  const body = {
    standings: viewStandings, playoffs: viewPlayoffs, matches: viewMatches,
    draft: viewDraft, moves: viewMoves, trades: viewTrades,
  }[sub] || viewStandings;

  view.innerHTML = years + banner + subnav + body(s, params);
  if (sub === 'matches') wireMatchFilters(s);
  if (sub === 'moves') wireMoveFilters(s);
}

/* ---------- season: standings ---------- */

function viewStandings(s) {
  const champ = new Set(s.championshipField);
  const rows = s.standings.map(r => `<tr${champ.has(r.coach) ? ' class="inplayoffs"' : ''}>
    <td class="rank">${r.rank}</td>
    <td class="col-name">
      <a class="coachname" href="#/coach/${slug(r.coach)}">${esc(r.coach)}</a>
      <span class="teamname">${esc(r.team)}</span>
    </td>
    <td class="rec">${rec(r)}</td>
    <td class="num">${pts(r.pf)}</td>
    <td class="num">${pts(r.pa)}</td>
    <td class="num">${r.diff > 0 ? '+' : ''}${pts(r.diff)}</td>
    <td class="num">${pts(r.ppg)}</td>
    <td class="num">${pts(r.high)}</td>
  </tr>`).join('');

  const wk = s.regularWeeks;
  const wild = s.wildcard
    ? ` <strong>${esc(s.wildcard)}</strong> took the last place as the
        highest scorer outside the top five.`
    : '';

  return `
    <div class="pagehead">
      <p class="eyebrow">Season ${s.year} &middot; ${s.standings.length} teams</p>
      <h1>Final standings</h1>
      <p>Regular season, weeks ${wk[0]}&ndash;${wk[wk.length - 1]}. Ranked by win ratio, then
         the record among tied teams, then points scored. Coaches who reached the
         championship bracket are marked in amber.${wild}</p>
    </div>
    <div class="tablecard"><div class="tscroll"><table>
      <thead><tr>
        <th class="rank">#</th><th class="col-name">Coach</th>
        <th>Record</th><th>PF</th><th>PA</th><th>Diff</th><th>Avg</th><th>Best</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
}

/* ---------- season: playoffs ---------- */

function matchRow(m) {
  const hw = m.home.points > m.away.points, aw = m.away.points > m.home.points;
  const cons = m.round === 'consolation';
  const final = m.title
    ? `<span class="finaltag${cons ? ' silver' : ''}">${esc(m.title)}</span>` : '';
  return `<a class="mrow${cons ? ' cons' : ''}" href="#/game/${slug(m.id)}">
    <div class="side ${hw ? 'win' : ''}">
      <div class="nm">${m.homeSeed ? `<span class="sd">${m.homeSeed}</span>` : ''}${esc(m.home.coach)}</div>
      <div class="tm">${esc(m.home.team)}</div>
    </div>
    <div>
      <div class="score">
        <span class="v ${hw ? 'win' : ''}">${pts(m.home.points)}</span>
        <span class="dash">&ndash;</span>
        <span class="v ${aw ? 'win' : ''}">${pts(m.away.points)}</span>
      </div>${final}
    </div>
    <div class="side r ${aw ? 'win' : ''}">
      <div class="nm">${esc(m.away.coach)}${m.awaySeed ? `<span class="sd">${m.awaySeed}</span>` : ''}</div>
      <div class="tm">${esc(m.away.team)}</div>
    </div>
  </a>`;
}

function groupByWeek(games, heading) {
  if (!games.length) return `<p class="empty">Nothing to show here.</p>`;
  const weeks = [...new Set(games.map(m => m.week))].sort((a, b) => a - b);
  return weeks.map(w => {
    const ms = games.filter(m => m.week === w);
    return `<div class="weekhead">Week ${w}${heading ? heading(ms[0]) : ''}</div>
            <div class="mlist">${ms.map(matchRow).join('')}</div>`;
  }).join('');
}

function viewPlayoffs(s) {
  const champ = s.matchups.filter(m => m.round === 'championship');
  const cons = s.matchups.filter(m => m.round === 'consolation');
  const seeds = Object.fromEntries(s.standings.map(r => [r.coach, r.rank]));
  const list = f => f.map(c => `${esc(c)} (${seeds[c]})`).join(', ');

  return `
    <div class="pagehead">
      <p class="eyebrow">Season ${s.year}</p>
      <h1>Playoffs</h1>
      <p>Weeks ${s.playoffWeeks.join(', ')}. The championship bracket is
         ${list(s.championshipField)}.${s.consolationField.length
           ? ` The Trash Bowl is contested by ${list(s.consolationField)}.` : ''}
         Numbers beside each coach are their regular season seed.</p>
    </div>
    <div class="section" style="margin-top:0">
      <h2><span class="dot-g"></span> Championship</h2>
      ${groupByWeek(champ)}
    </div>
    ${cons.length ? `<div class="section">
      <h2><span class="dot-s"></span> Trash Bowl</h2>
      ${groupByWeek(cons)}
    </div>` : ''}`;
}

/* ---------- season: matches ---------- */

function viewMatches(s, params) {
  const week = params.get('week') || 'all';
  const coach = params.get('coach') || 'all';
  let games = s.matchups.filter(m => m.round === 'regular');
  if (week !== 'all') games = games.filter(m => m.week === +week);
  if (coach !== 'all') games = games.filter(m =>
    m.home.coach === coach || m.away.coach === coach);

  const weekOpts = ['<option value="all">All weeks</option>'].concat(
    s.regularWeeks.map(w => `<option value="${w}"${week == w ? ' selected' : ''}>Week ${w}</option>`)
  ).join('');
  const coachOpts = ['<option value="all">All coaches</option>'].concat(
    Object.keys(s.teams).sort().map(c =>
      `<option value="${esc(c)}"${coach === c ? ' selected' : ''}>${esc(c)}</option>`)
  ).join('');

  return `
    <div class="pagehead">
      <p class="eyebrow">Season ${s.year}</p>
      <h1>Matches</h1>
      <p>Regular season. Filter by week or coach, then open any game for the full box score.</p>
    </div>
    <div class="filters">
      <div class="field"><label for="fw">Week</label><select id="fw">${weekOpts}</select></div>
      <div class="field"><label for="fc">Coach</label><select id="fc">${coachOpts}</select></div>
      <span class="count">${games.length} game${games.length === 1 ? '' : 's'}</span>
    </div>
    ${groupByWeek(games)}`;
}

function wireMatchFilters(s) {
  const go = () => {
    const w = document.getElementById('fw').value;
    const c = document.getElementById('fc').value;
    const q = new URLSearchParams();
    if (w !== 'all') q.set('week', w);
    if (c !== 'all') q.set('coach', c);
    const qs = q.toString();
    location.hash = `#/season/${s.year}/matches${qs ? '?' + qs : ''}`;
  };
  document.getElementById('fw').addEventListener('change', go);
  document.getElementById('fc').addEventListener('change', go);
}

/* ---------- season: draft ---------- */

function viewDraft(s) {
  if (!s.draft) return `<div class="pagehead"><h1>Draft</h1>
    <p class="empty">No draft board recorded for ${s.year}.</p></div>`;

  const order = s.draft.order;
  const head = order.map(c => `<th>${esc(c)}</th>`).join('');
  const body = s.draft.rounds.map(r => {
    const byCoach = Object.fromEntries(r.picks.map(p => [p.coach, p]));
    const cells = order.map(c => {
      const p = byCoach[c];
      if (!p) return `<td></td>`;
      return `<td><div class="${p.pos ? 'pos-' + esc(p.pos) : ''}">
        <div class="pk">${p.pick}</div>
        <div class="pnm">${esc(p.player)}</div>
        <div class="ppos">${esc(p.pos || '')}</div></div></td>`;
    }).join('');
    return `<tr><td class="rnd">${r.round}</td>${cells}</tr>`;
  }).join('');

  return `
    <div class="pagehead">
      <p class="eyebrow">Season ${s.year}</p>
      <h1>Draft board</h1>
      <p>${s.draft.rounds.length} rounds, snaking each round. Columns follow the
         first-round order; the small number is the overall pick.</p>
    </div>
    <div class="board"><table>
      <thead><tr><th class="rnd">R</th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

/* ---------- season: adds & drops ---------- */

function viewMoves(s, params) {
  const coach = params.get('coach') || 'all';
  const kind = params.get('kind') || 'all';
  let rows = s.moves;
  if (coach !== 'all') rows = rows.filter(m => m.coach === coach);
  if (kind !== 'all') rows = rows.filter(m => m.kind === kind);

  const coachOpts = ['<option value="all">All coaches</option>'].concat(
    Object.keys(s.teams).sort().map(c =>
      `<option value="${esc(c)}"${coach === c ? ' selected' : ''}>${esc(c)}</option>`)
  ).join('');
  const kindOpts = ['all', 'Add', 'Drop'].map(k =>
    `<option value="${k}"${kind === k ? ' selected' : ''}>${k === 'all' ? 'Adds and drops' : k + 's'}</option>`
  ).join('');

  const weeks = [...new Set(rows.map(m => m.week))].sort((a, b) => (a ?? 99) - (b ?? 99));
  const list = weeks.map(w => {
    const ms = rows.filter(m => m.week === w);
    return `<div class="weekhead">${w === null ? 'Preseason' : 'Week ' + w}</div>
      <div class="movelist">${ms.map(m => `
        <div class="mv">
          <span class="kind ${m.kind.toLowerCase()}">${esc(m.kind)}</span>
          <span><span class="pl2">${esc(m.player)}</span>
            <span class="meta">${esc(m.pos || '')}${m.nfl ? ' &middot; ' + esc(m.nfl) : ''}
            &middot; ${esc(m.via)}${m.faab ? ' &middot; $' + esc(m.faab) : ''}</span></span>
          <span class="who">${esc(m.coach)}</span>
        </div>`).join('')}</div>`;
  }).join('');

  return `
    <div class="pagehead">
      <p class="eyebrow">Season ${s.year}</p>
      <h1>Adds &amp; drops</h1>
      <p>Waiver claims and free agent moves. Where a waiver bid was recorded the
         amount is shown.</p>
    </div>
    <div class="filters">
      <div class="field"><label for="mc">Coach</label><select id="mc">${coachOpts}</select></div>
      <div class="field"><label for="mk">Type</label><select id="mk">${kindOpts}</select></div>
      <span class="count">${rows.length} move${rows.length === 1 ? '' : 's'}</span>
    </div>
    ${rows.length ? list : '<p class="empty">No moves match that filter.</p>'}`;
}

function wireMoveFilters(s) {
  const go = () => {
    const c = document.getElementById('mc').value;
    const k = document.getElementById('mk').value;
    const q = new URLSearchParams();
    if (c !== 'all') q.set('coach', c);
    if (k !== 'all') q.set('kind', k);
    const qs = q.toString();
    location.hash = `#/season/${s.year}/moves${qs ? '?' + qs : ''}`;
  };
  document.getElementById('mc').addEventListener('change', go);
  document.getElementById('mk').addEventListener('change', go);
}

/* ---------- season: trades ---------- */

function viewTrades(s) {
  if (!s.trades.length) return `
    <div class="pagehead"><p class="eyebrow">Season ${s.year}</p><h1>Trades</h1>
    <p class="empty">No trades were made in ${s.year}.</p></div>`;

  const cards = s.trades.map(t => `
    <div class="trade">
      <div class="thead">
        <span class="pair">${t.sides.map(esc).join(' &harr; ')}</span>
        <span>${t.week === null ? 'Preseason' : 'Week ' + t.week}</span>
        ${t.proposer ? `<span>proposed by ${esc(t.proposer)}</span>` : ''}
      </div>
      ${t.moves.map(m => `<div class="tmove">
        <span class="arrow">&rarr;</span>
        <span class="who">${esc(m.to)}</span>
        <span class="pl2">${esc(m.player)}</span>
        <span class="meta">${esc(m.pos || '')}${m.nfl ? ' &middot; ' + esc(m.nfl) : ''}</span>
      </div>`).join('')}
    </div>`).join('');

  return `
    <div class="pagehead">
      <p class="eyebrow">Season ${s.year}</p>
      <h1>Trades</h1>
      <p>${s.trades.length} trade${s.trades.length === 1 ? '' : 's'}. Each line shows
         where a player ended up.</p>
    </div>
    <div class="trades">${cards}</div>`;
}

/* ---------- box score ---------- */

async function renderGame(id) {
  setNav('Seasons');
  const year = +id.split('-')[0];
  const s = await getSeason(year);
  const m = s.matchups.find(x => x.id === id);
  if (!m) throw new Error('That matchup is not in the archive.');

  const home = s.lineups[`${m.week}|${m.home.coach}`] || [];
  const away = s.lineups[`${m.week}|${m.away.coach}`] || [];
  const hw = m.home.points > m.away.points, aw = m.away.points > m.home.points;

  const order = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'W/R', 'W/T', 'K', 'DEF',
    'BN1', 'BN2', 'BN3', 'BN4', 'BN5', 'BN6'];
  const slots = [];
  const seen = new Set();
  for (const p of [...home, ...away]) {
    if (!seen.has(p.slot)) { seen.add(p.slot); slots.push(p.slot); }
  }
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

  const kind = m.round === 'championship' ? 'Championship'
    : m.round === 'consolation' ? 'Trash Bowl' : '';
  const back = m.round === 'regular'
    ? `#/season/${year}/matches?week=${m.week}` : `#/season/${year}/playoffs`;

  view.innerHTML = `
    <a class="backlink" href="${back}">&larr; ${m.round === 'regular'
      ? `Week ${m.week}, ${year}` : `${year} playoffs`}</a>
    <div class="boxhead">
      <div>
        <div class="nm">${esc(m.home.coach)}</div>
        <div class="tm">${esc(m.home.team)}</div>
        <div class="total ${hw ? 'win' : ''}">${pts(m.home.points)}</div>
      </div>
      <div class="vs">Week ${m.week}<br>${year}${kind ? '<br>' + kind : ''}</div>
      <div class="r">
        <div class="nm">${esc(m.away.coach)}</div>
        <div class="tm">${esc(m.away.team)}</div>
        <div class="total ${aw ? 'win' : ''}">${pts(m.away.points)}</div>
      </div>
    </div>
    ${m.title ? `<div class="champbar"><span class="item">
      <span class="${m.round === 'consolation' ? 'dot-s' : 'dot-g'}"></span>
      <span class="who">${esc(m.title)}</span></span></div>` : ''}
    <div class="ladder">${rungs}</div>
    <div class="legend">
      <span class="k"><span class="dot-g"></span> Top starter</span>
      <span class="k">Bench totals: ${pts(m.home.bench)} &middot; ${pts(m.away.bench)}</span>
    </div>`;
}

/* ---------- coach ---------- */

async function renderCoach(name) {
  setNav('Overall');
  const career = INDEX.career.find(c => c.coach === name);
  if (!career) throw new Error(`No coach called ${name} in the archive.`);

  const seasons = await Promise.all(career.seasons.map(getSeason));

  const rows = seasons.map(s => {
    const r = s.standings.find(x => x.coach === name);
    const po = s.playoffRecords[name];
    const made = s.championshipField.includes(name);
    const mark = s.champion === name ? '<span class="dot-g"></span>'
      : s.consolationWinner === name ? '<span class="dot-s"></span>' : '';
    return `<tr>
      <td class="rank">${s.year}</td>
      <td class="col-name">
        <a class="coachname" href="#/season/${s.year}/matches?coach=${slug(name)}">${esc(r.team)}</a>
        <span class="teamname">Seed ${r.rank} of ${s.standings.length}${made ? ' &middot; championship bracket' : ''}</span>
      </td>
      <td class="dots">${mark}</td>
      <td class="rec">${rec(r)}</td>
      <td class="rec">${po ? `${po.w}-${po.l}` : '&mdash;'}</td>
      <td class="num">${pts(r.pf)}</td>
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
  const ord = n => {
    const t = n % 100, u = n % 10;
    const suffix = (t >= 11 && t <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][u] || 'th');
    return n + suffix;
  };

  view.innerHTML = `
    <a class="backlink" href="#/">&larr; All coaches</a>
    <div class="pagehead">
      <p class="eyebrow">${career.seasons.length} seasons &middot;
        ${career.seasons[0]}&ndash;${career.seasons[career.seasons.length - 1]}</p>
      <h1>${esc(name)}</h1>
      ${career.titles.length || career.trash.length ? `<p>
        ${career.titles.length ? `Champion in ${career.titles.join(', ')}.` : ''}
        ${career.trash.length ? `Trash Bowl winner in ${career.trash.join(', ')}.` : ''}</p>` : ''}
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Regular season</div><div class="v">${career.w}-${career.l}</div>
        <div class="s">${pct(career.pct)}</div></div>
      <div class="stat"><div class="k">Playoffs made</div>
        <div class="v">${career.appearances.length}<span class="of">/${career.seasons.length}</span></div>
        <div class="s">${career.appearances.length ? career.appearances.join(', ') : 'never qualified'}</div></div>
      <div class="stat"><div class="k">Playoff record</div><div class="v">${career.pw}-${career.pl}</div>
        <div class="s">${career.pw + career.pl ? pct(career.ppct) : 'no games'}</div></div>
      <div class="stat"><div class="k">Points per game</div><div class="v">${pts(career.ppg)}</div>
        <div class="s">${Math.round(career.pf).toLocaleString()} total</div></div>
      <div class="stat"><div class="k">Best finish</div><div class="v">${ord(best.r.rank)}</div>
        <div class="s">${best.year}</div></div>
      <div class="stat"><div class="k">Highest score</div><div class="v">${pts(high.p)}</div>
        <div class="s"><a href="#/game/${slug(high.id)}">Week ${high.w}, ${high.y}</a></div></div>
    </div>
    <div class="tablecard"><div class="tscroll"><table>
      <thead><tr>
        <th class="rank">Year</th><th class="col-name">Team</th><th></th>
        <th>Regular</th><th>Playoffs</th><th>PF</th><th>Avg</th><th>Best</th>
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
    document.getElementById('brandSub').textContent =
      `Fantasy football, ${INDEX.seasons[0].year}–${latestYear()}`;
    window.addEventListener('hashchange', router);
    router();
  } catch (err) {
    view.innerHTML = `<div class="pagehead"><h1>The archive didn't load</h1>
      <p>${esc(err.message)} If you're opening this file directly, run a local
      server instead &mdash; browsers block data loading from <code>file://</code>.</p></div>`;
  }
})();
