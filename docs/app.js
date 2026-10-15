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

/* Heat map shading for a table column: blue where a value helps, red where
   it hurts, by distance from `mid` (the column average unless given), on four
   steps each way. `dir` is which way is good: 1 = higher, -1 = lower.
   Returns the scale's midpoint and a function from value to class string;
   null values (no games) stay unshaded. `fit`, if given, is the subset the
   midpoint and range are set from; anything beyond that range takes the
   strongest step. */
function heatScale(values, dir, mid, fit = values) {
  const vs = fit.filter(v => v !== null);
  if (mid === undefined || mid === null) mid = vs.reduce((x, y) => x + y, 0) / (vs.length || 1);
  const max = Math.max(0, ...vs.map(v => Math.abs(v - mid))) || 1;
  const cls = v => {
    if (v === null) return '';
    const t = (v - mid) * dir / max, a = Math.min(Math.abs(t), 1);
    const step = a < 0.15 ? 0 : a < 0.4 ? 1 : a < 0.65 ? 2 : a < 0.9 ? 3 : 4;
    return step ? ` heat-${t > 0 ? 'up' : 'down'}${step}` : '';
  };
  return { mid, cls };
}

const HEAT_KEY = `<span class="k heatkey">Hurts
  <span class="heat-down4"></span><span class="heat-down3"></span><span class="heat-down2"></span><span class="heat-down1"></span>
  <span class="mid"></span>
  <span class="heat-up1"></span><span class="heat-up2"></span><span class="heat-up3"></span><span class="heat-up4"></span>
  Helps</span>`;

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
         pf: 'allPf', ppg: 'allPpg', g: 'allGames',
         note: 'Regular season and playoffs together.' },
  regular: { label: 'Regular season', w: 'w', l: 'l', p: 'pct',
             pf: 'pf', ppg: 'ppg', g: 'games',
             note: 'Regular season only.' },
  playoffs: { label: 'Playoffs', w: 'pw', l: 'pl', p: 'ppct',
              pf: 'ppf', ppg: 'pppg', g: 'pgames',
              note: 'Championship bracket games only; the Trash Bowl doesn\'t count.' },
};

function renderOverall(params) {
  setNav('Overall');
  const mode = MODES[params.get('mode')] ? params.get('mode') : 'all';
  const M = MODES[mode];

  // Heat map on the columns that compare like with like. Win % is centred on
  // .500; playoffs made (as a share of completed seasons) and points per game
  // on the league average. Points for is a career total, so it isn't shaded -
  // it mostly measures how long someone has played. The scales are set from
  // coaches with three or more seasons, so a two-season career at either
  // extreme doesn't wash out everyone else; it just takes the strongest shade.
  const appRate = r => r.completed ? r.appearances.length / r.completed : null;
  const has = r => r[M.w] + r[M.l] > 0;
  const regulars = INDEX.career.filter(r => r.seasons.length >= 3);
  const scaleOf = (f, mid) => heatScale(INDEX.career.map(f), 1, mid, regulars.map(f));
  const heatApps = scaleOf(appRate);
  const heatPct = scaleOf(r => has(r) ? r[M.p] : null, 0.5);
  const heatPpg = scaleOf(r => r[M.g] ? r[M.ppg] : null);

  const rows = [...INDEX.career]
    .sort((a, b) => (b[M.p] - a[M.p]) || (b[M.pf] - a[M.pf]))
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
        <td class="num apps${heatApps.cls(appRate(r))}">${r.appearances.length}<span class="of">/${r.completed}</span></td>
        <td class="rec">${played ? `${r[M.w]}-${r[M.l]}` : '&mdash;'}</td>
        <td class="num${heatPct.cls(has(r) ? r[M.p] : null)}">${played ? pct(r[M.p]) : '&mdash;'}</td>
        <td class="num">${r[M.g] ? pts(r[M.pf]) : '&mdash;'}</td>
        <td class="num${heatPpg.cls(r[M.g] ? r[M.ppg] : null)}">${r[M.g] ? pts(r[M.ppg]) : '&mdash;'}</td>
      </tr>`;
    }).join('');

  // Head to head, rows read against columns, in the same order as the table.
  const order = [...INDEX.career]
    .sort((a, b) => (b[M.p] - a[M.p]) || (b[M.pf] - a[M.pf])).map(r => r.coach);
  const pick = r => mode === 'regular' ? r.slice(0, 3)
    : mode === 'playoffs' ? r.slice(3)
    : [r[0] + r[3], r[1] + r[4], r[2] + r[5]];
  const h2hCell = (me, them) => {
    if (me === them) return '<td class="self"></td>';
    const r = INDEX.h2h[me] && INDEX.h2h[me][them];
    const [w, l, t] = r ? pick(r) : [0, 0, 0];
    if (!w && !l && !t) return '<td class="none">&middot;</td>';
    const cls = w > l ? 'up' : w < l ? 'down' : 'even';
    return `<td class="${cls}" title="${esc(me)} v ${esc(them)}: ${w}-${l}${t ? '-' + t : ''}">${w}-${l}${t ? '-' + t : ''}</td>`;
  };
  const h2hRows = order.map(me => `<tr>
    <th class="rowhead"><a class="coachname" href="#/coach/${slug(me)}">${esc(me)}</a></th>
    ${order.map(them => h2hCell(me, them)).join('')}</tr>`).join('');

  const toggle = Object.entries(MODES).map(([k, v]) =>
    `<a href="#/?mode=${k}"${k === mode ? ' aria-current="true"' : ''}>${v.label}</a>`
  ).join('');

  const games = INDEX.career.reduce((a, r) => a + r[M.g], 0) / 2;
  const points = INDEX.career.reduce((a, r) => a + r[M.pf], 0);
  const first = INDEX.seasons[0].year;

  const honours = INDEX.seasons.map(s => `
    <a class="honour" href="#/season/${s.year}/playoffs">
      <span class="hy">${s.year}</span>
      <span class="row">${s.inProgress ? '<span class="pulse"></span>' : '<span class="dot-g"></span>'}
        <span class="hc">${s.champion ? esc(s.champion) : (s.inProgress ? 'Playing' : '&mdash;')}</span></span>
      ${s.consolationWinner
        ? `<span class="ht"><span class="dot-s"></span> ${esc(s.consolationWinner)}</span>`
        : `<span class="ht">${s.inProgress ? 'season under way' : 'no Trash Bowl'}</span>`}
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
      ${HEAT_KEY}
      <span class="k">Win % is shaded against .500, playoffs made and per game
        against the average; the scale is set by coaches with three or more seasons</span>
    </div>
    <div class="section">
      <h2>Head to head</h2>
      <p class="sectnote">Each row's record against each column, ${esc(M.label.toLowerCase())}
        ${mode === 'all' ? '' : 'only'}. Green is a winning record, red a losing one.</p>
      <div class="tablecard"><div class="tscroll"><table class="h2h">
        <thead><tr><th class="rowhead"></th>${order.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${h2hRows}</tbody>
      </table></div></div>
    </div>
    <div class="section">
      <h2>Roll of honour</h2>
      <div class="honours">${honours}</div>
    </div>`;
}

/* ---------- season shell ---------- */

const SEASON_VIEWS = [
  ['standings', 'Standings'], ['playoffs', 'Playoffs'], ['power', 'Power rankings'],
  ['matches', 'Matches'], ['weekly', 'Highest weekly'], ['overall', 'Highest overall'],
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

  const lastWeek = s.regularWeeks[s.regularWeeks.length - 1];
  const banner = s.inProgress
    ? `<div class="champbar live">
         <span class="item"><span class="pulse"></span>
           <span class="lbl">Season in progress</span>
           <span class="who">Through week ${lastWeek}</span></span>
       </div>`
    : `<div class="champbar">
      <span class="item"><span class="dot-g"></span><span class="lbl">Champion</span>
        <span class="who">${s.champion ? esc(s.champion) : '&mdash;'}</span></span>
      ${s.consolationWinner ? `<span class="item"><span class="dot-s"></span>
        <span class="lbl">Trash Bowl</span>
        <span class="who">${esc(s.consolationWinner)}</span></span>` : ''}
    </div>`;

  const body = {
    standings: viewStandings, playoffs: viewPlayoffs, power: viewPower,
    matches: viewMatches, weekly: viewWeekly, overall: viewOverall,
    draft: viewDraft, moves: viewMoves, trades: viewTrades,
  }[sub] || viewStandings;

  view.innerHTML = years + banner + subnav + body(s, params);
  if (sub === 'matches') wireMatchFilters(s);
  if (sub === 'moves') wireMoveFilters(s);
  if (sub === 'weekly') wireFilters(s, 'weekly', { sw: 'week' });
  if (sub === 'overall') wireFilters(s, 'overall', { so: 'coach' });
}

/* ---------- season: standings ---------- */

const TIEBREAKS = {
  'group-record': `Ties on win ratio go to the most wins in games among the tied teams,
        then the fewest losses in those games, then points scored.`,
  'group-ratio': 'Ties on win ratio go to the best win ratio in games among the tied teams, then points scored.',
  nfl: `Ties on win ratio follow NFL.com's rules, one seed at a time: the record among
        the tied teams counts only if they have all met equally often; otherwise
        points scored, then points against.`,
};

const signed = (n, f = pts) => (n > 0 ? '+' : '') + f(n);

function viewStandings(s) {
  const proj = s.inProgress ? s.projection : null;
  const champ = new Set(proj ? proj.championshipField : s.championshipField);
  const wildcard = proj ? proj.wildcard : s.wildcard;
  const wc = s.format && s.format.rule === 'wildcard';
  const rows = s.standings.map(r => `<tr${champ.has(r.coach) ? ' class="inplayoffs"' : ''}>
    <td class="rank">${r.rank}</td>
    <td class="col-name">
      <a class="coachname" href="#/coach/${slug(r.coach)}">${esc(r.coach)}</a>${
        r.coach === wildcard ? ' <span class="tag">Wildcard</span>' : ''}
      <span class="teamname">${esc(r.team)}</span>
    </td>
    <td class="rec">${rec(r)}</td>
    <td class="rec muted">${r.h2hW !== undefined ? `${r.h2hW}-${r.h2hL}` : ''}</td>
    <td class="num">${pts(r.pf)}</td>
    <td class="num">${pts(r.pa)}</td>
    <td class="num">${signed(r.diff)}</td>
    ${wc ? `<td class="num">${r.wcGap === 0 ? '&mdash;' : signed(r.wcGap)}</td>` : ''}
    <td class="num">${pts(r.ppg)}</td>
    <td class="num">${pts(r.high)}</td>
  </tr>`).join('');

  const wk = s.regularWeeks;
  const wild = !wildcard ? ''
    : proj ? ` <strong>${esc(wildcard)}</strong> holds the wildcard as the highest
        scorer outside the top five.`
    : ` <strong>${esc(wildcard)}</strong> took the last place as the
        highest scorer outside the top five.`;
  const marked = proj
    ? 'If the season ended today, the coaches marked in amber would make the championship bracket.'
    : s.championshipField.length
      ? 'Coaches who reached the championship bracket are marked in amber.'
      : 'The playoff field is not settled yet.';

  return `
    <div class="pagehead">
      <p class="eyebrow">Season ${s.year} &middot; ${s.standings.length} teams</p>
      <h1>${s.inProgress ? 'Standings' : 'Final standings'}</h1>
      <p>Regular season, weeks ${wk[0]}&ndash;${wk[wk.length - 1]}. Ranked by win ratio.
         ${TIEBREAKS[s.tiebreak] || ''} ${marked}${wild}</p>
    </div>
    <div class="tablecard"><div class="tscroll"><table>
      <thead><tr>
        <th class="rank">#</th><th class="col-name">Coach</th>
        <th>Record</th><th title="Record in games among teams tied on win ratio">Tied&nbsp;H2H</th>
        <th>PF</th><th>PA</th><th>Diff</th>
        ${wc ? '<th title="Points for, against the wildcard holder">vs&nbsp;WC</th>' : ''}
        <th>Avg</th><th>Best</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>
    <div class="legend">
      <span class="k">Tied H2H: record against the other teams on the same win ratio</span>
      ${wc ? '<span class="k">vs WC: points for, compared with the wildcard holder</span>' : ''}
    </div>`;
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

function projRow(s, g) {
  const sd = t => `<span class="sd">${t.seed}</span>`;
  return `<div class="mrow proj">
    <div class="side">
      <div class="nm">${sd(g.high)}${esc(g.high.coach)}</div>
      <div class="tm">${esc(s.teams[g.high.coach])}</div>
    </div>
    <div><div class="score"><span class="dash">v</span></div>
      ${g.next ? `<span class="finaltag">Winner plays ${esc(g.next.coach)}</span>` : ''}</div>
    <div class="side r">
      <div class="nm">${esc(g.low.coach)}${sd(g.low)}</div>
      <div class="tm">${esc(s.teams[g.low.coach])}</div>
    </div>
  </div>`;
}

function viewProjection(s) {
  const p = s.projection;
  const byes = p.championship && p.championship.byes.length
    ? `<p class="byes">Bye: ${p.championship.byes.map(b =>
        `<strong>${esc(b.coach)}</strong> (${b.seed})`).join(' and ')}</p>` : '';
  return `
    <div class="pagehead">
      <p class="eyebrow">Season ${s.year} &middot; through week ${s.regularWeeks[s.regularWeeks.length - 1]}</p>
      <h1>If the season ended today</h1>
      <p>The ${s.year} playoffs haven't started. These are the week ${p.week || ''} games the
         current standings would produce.${p.wildcard ? ` <strong>${esc(p.wildcard)}</strong>
         takes the sixth seed as the wildcard, the highest scorer outside the top five.` : ''}
         Numbers beside each coach are their seed.</p>
    </div>
    <div class="section" style="margin-top:0">
      <h2><span class="dot-g"></span> Championship</h2>
      ${byes}
      <div class="mlist">${p.championship ? p.championship.games.map(g => projRow(s, g)).join('') : ''}</div>
    </div>
    ${p.consolation ? `<div class="section">
      <h2><span class="dot-s"></span> Trash Bowl</h2>
      <p class="byes">Seeds here are standings places.</p>
      <div class="mlist">${p.consolation.games.map(g => projRow(s, g)).join('')}</div>
    </div>` : ''}`;
}

function viewPlayoffs(s) {
  if (s.inProgress && s.projection) return viewProjection(s);
  if (!s.playoffWeeks.length) {
    return `<div class="pagehead">
        <p class="eyebrow">Season ${s.year}</p><h1>Playoffs</h1>
        <p class="empty">${s.inProgress
          ? `The ${s.year} season is still being played, so there are no playoff
             games yet. This page will fill in once the brackets are decided.`
          : 'No playoff games are recorded for this season.'}</p>
      </div>`;
  }
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

/* ---------- season: power rankings ---------- */

function viewPower(s) {
  if (!s.power || !s.power.length) return `<div class="pagehead"><h1>Power rankings</h1>
    <p class="empty">No regular season games yet in ${s.year}.</p></div>`;
  const ros = s.inProgress;
  const n = s.standings.length;

  // Heat map: each column shaded by distance from the league average, blue
  // where it helps the team and red where it hurts. `dir` is which way is
  // good - lower is better for consistency (steadier) and schedule strength.
  const HEAT = { ppg: 1, consistency: -1, breakdown: 1, sos: -1, ros: -1, fortune: 1 };
  const scale = {};
  for (const [k, dir] of Object.entries(HEAT)) scale[k] = heatScale(s.power.map(r => r[k]), dir);
  const heat = (r, k, text) => {
    const cls = scale[k].cls(r[k]);
    const diff = r[k] - scale[k].mid;
    const tip = `${diff >= 0 ? '+' : ''}${diff.toFixed(k === 'sos' || k === 'ros' || k === 'fortune' ? 0 : 1)} vs average`
      + (cls ? (cls.includes('up') ? ', helps' : ', hurts') : '');
    return `<td class="num${cls}" title="${tip}">${text}</td>`;
  };
  const cells = r => `
    ${heat(r, 'ppg', pts(r.ppg))}
    ${heat(r, 'consistency', pts(r.consistency))}
    ${heat(r, 'breakdown', r.breakdown.toFixed(1))}
    ${heat(r, 'sos', r.sos)}
    ${ros ? heat(r, 'ros', r.ros) : ''}
    ${heat(r, 'fortune', signed(r.fortune, String))}`;
  const rows = s.power.map((r, i) => `<tr>
    <td class="rank">${i + 1}</td>
    <td class="col-name"><a class="coachname" href="#/coach/${slug(r.coach)}">${esc(r.coach)}</a>
      <span class="teamname">${esc(s.teams[r.coach])}</span></td>
    ${cells(r)}</tr>`).join('');
  const a = s.powerAverage;

  return `
    <div class="pagehead">
      <p class="eyebrow">Season ${s.year} &middot; ${s.regularWeeks.length} weeks</p>
      <h1>Power rankings</h1>
      <p>Regular season, ranked by points per game. <strong>Breakdown</strong> is how many
         teams a score would have beaten that week (0&ndash;${n - 1}), averaged.
         <strong>SoS</strong> is the opponents' average breakdown in the weeks they were
         faced, as a percentage of the best possible${ros
           ? '; <strong>RoS SoS</strong> does the same for the fixtures still to come'
           : ''}. <strong>Fortune</strong> adds up how lucky the results were: a win with a
         low breakdown counts up, a loss with a high one counts down.</p>
    </div>
    <div class="tablecard"><div class="tscroll"><table>
      <thead><tr>
        <th class="rank">#</th><th class="col-name">Coach</th>
        <th>PPG</th><th>Consistency</th><th>Breakdown</th><th>SoS</th>
        ${ros ? '<th>RoS&nbsp;SoS</th>' : ''}<th>Fortune</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="rank"></td><td class="col-name">Average</td>
        <td class="num">${a.ppg.toFixed(1)}</td><td class="num">${a.consistency.toFixed(1)}</td>
        <td class="num">${a.breakdown.toFixed(1)}</td><td class="num">${a.sos}</td>
        ${ros ? `<td class="num">${a.ros}</td>` : ''}<td class="num">${a.fortune}</td></tr></tfoot>
    </table></div></div>
    <div class="legend">
      ${HEAT_KEY}
      <span class="k">Shaded by distance from the league average in each column. Lower consistency
        and SoS help: steadier scoring and easier opponents.</span>
    </div>
    <div class="legend"><span class="k">Consistency is the standard deviation of weekly
      scores &mdash; lower is steadier</span></div>`;
}

/* ---------- season: highest weekly / overall scores ---------- */

function scoreTable(s, rows, showWeek) {
  const body = rows.map((r, i) => `<tr>
    <td class="rank">${i + 1}</td>
    ${showWeek ? `<td class="num">${r.week}</td>` : ''}
    <td class="col-name"><a class="coachname" href="#/coach/${slug(r.coach)}">${esc(r.coach)}</a>
      <span class="teamname">${esc(s.teams[r.coach])}</span></td>
    <td class="opp">${esc(r.opp)}</td>
    <td class="res ${r.result.toLowerCase()}">${r.result}</td>
    <td class="num"><a class="scorelink" href="#/game/${slug(r.game)}">${pts(r.pts)}</a></td>
    <td class="num">${r.breakdown}</td>
    <td class="num">${signed(r.fortune, String)}</td>
  </tr>`).join('');
  return `<div class="tablecard"><div class="tscroll"><table>
    <thead><tr><th class="rank">#</th>${showWeek ? '<th>Week</th>' : ''}
      <th class="col-name">Coach</th><th>Opponent</th><th>Result</th><th>Score</th>
      <th>Breakdown</th><th>Fortune</th></tr></thead>
    <tbody>${body}</tbody></table></div></div>`;
}

const SCORE_NOTE = `Breakdown is how many teams the score would have beaten that week;
  fortune is +(teams it would have lost to) for a win and &minus;breakdown for a loss.`;

function viewWeekly(s, params) {
  const week = params.get('week') || 'all';
  const weeks = week === 'all' ? s.regularWeeks : [+week];
  const opts = ['<option value="all">All weeks</option>'].concat(
    s.regularWeeks.map(w => `<option value="${w}"${week == w ? ' selected' : ''}>Week ${w}</option>`)
  ).join('');
  const blocks = weeks.map(w => {
    const rows = s.scores.filter(r => r.week === w);
    return rows.length ? `<div class="weekhead">Week ${w}</div>${scoreTable(s, rows, false)}` : '';
  }).join('');
  return `
    <div class="pagehead">
      <p class="eyebrow">Season ${s.year}</p>
      <h1>Highest weekly score</h1>
      <p>Every team ranked by its score, week by week, regular season only. ${SCORE_NOTE}</p>
    </div>
    <div class="filters">
      <div class="field"><label for="sw">Week</label><select id="sw">${opts}</select></div>
    </div>
    ${blocks || '<p class="empty">No regular season games yet.</p>'}`;
}

function viewOverall(s, params) {
  const coach = params.get('coach') || 'all';
  const ranked = [...s.scores].sort((a, b) => (b.pts - a.pts) || (a.week - b.week));
  const rows = coach === 'all' ? ranked : ranked.filter(r => r.coach === coach);
  const opts = ['<option value="all">All coaches</option>'].concat(
    Object.keys(s.teams).sort().map(c =>
      `<option value="${esc(c)}"${coach === c ? ' selected' : ''}>${esc(c)}</option>`)
  ).join('');
  return `
    <div class="pagehead">
      <p class="eyebrow">Season ${s.year}</p>
      <h1>Highest overall score</h1>
      <p>Every regular season score of the year, highest first. Pick a coach to see
         just their weeks. ${SCORE_NOTE}</p>
    </div>
    <div class="filters">
      <div class="field"><label for="so">Coach</label><select id="so">${opts}</select></div>
      <span class="count">${rows.length} score${rows.length === 1 ? '' : 's'}</span>
    </div>
    ${rows.length ? scoreTable(s, rows, true) : '<p class="empty">No regular season games yet.</p>'}`;
}

/* One select per query parameter: {elementId: paramName}. */
function wireFilters(s, sub, fields) {
  const go = () => {
    const q = new URLSearchParams();
    for (const [id, key] of Object.entries(fields)) {
      const v = document.getElementById(id).value;
      if (v !== 'all') q.set(key, v);
    }
    const qs = q.toString();
    location.hash = `#/season/${s.year}/${sub}${qs ? '?' + qs : ''}`;
  };
  for (const id of Object.keys(fields)) document.getElementById(id).addEventListener('change', go);
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
      <p>${s.draft.rounds.length} rounds, ${s.draft.style === 'linear'
           ? 'in the same order every round' : 'snaking each round'}. Columns follow the
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
      ${s.source === 'sleeper'
        ? '<span class="k">Sleeper records points only, no stat lines</span>' : ''}
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
        <div class="v">${career.appearances.length}<span class="of">/${career.completed}</span></div>
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
