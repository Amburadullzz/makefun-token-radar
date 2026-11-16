// Token Radar's dashboard: a plain page over window.RADAR, which main.ts writes beside the page.
// It renders the ranked board, a filterable and sortable table, a detail view for one protocol with the
// derivation of its implied value and its farm plan, and the comps table the model is measured from.
// No framework, no build step, no network: every figure on the page is in data.js, which comes from the
// sealed snapshot. Nothing here recomputes the board; it recomputes one row to show the arithmetic.
(() => {
  'use strict';

  const DATA = window.RADAR;
  const app = document.getElementById('app');
  const dialog = document.getElementById('detail');
  if (!DATA || !app || !dialog) return;

  const state = { q: '', cat: 'all', chain: 'all', watch: false, sort: 'rank', dir: 1, sel: null, open: null };

  /* ---------- formatting ---------- */

  const money = (n) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    const abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  };
  const exact = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const pct = (n) => (n === null || n === undefined || !Number.isFinite(n) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%');
  const age = (d) => (d === null || d === undefined ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + 'y' : Math.round(d) + 'd');
  const mult = (x) => x.toFixed(3);
  /** The two adjustment factors on the board: three decimals, the trailing one dropped when it is 0. */
  const mult2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');

  /* ---------- a small DOM builder ---------- */

  function h(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.append(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return node;
  }

  /* ---------- filters and sorting ---------- */

  const categories = [...new Set(DATA.rows.map((r) => r.category || 'Other'))].sort((a, b) => a.localeCompare(b));
  const chains = [...new Set(DATA.rows.flatMap((r) => r.chains))].sort((a, b) => a.localeCompare(b));

  const visible = () => {
    const q = state.q.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (state.watch && !r.watchlist) return false;
      if (state.cat !== 'all' && (r.category || 'Other') !== state.cat) return false;
      if (state.chain !== 'all' && !r.chains.includes(state.chain)) return false;
      if (!q) return true;
      return (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().includes(q);
    });
  };

  const SORTS = {
    rank: (r) => r.rank,
    name: (r) => r.name.toLowerCase(),
    category: (r) => (r.category || 'other').toLowerCase(),
    tvl: (r) => r.tvl_usd,
    multiple: (r) => r.multiple,
    growth: (r) => (r.change_7d === null ? -Infinity : r.change_7d),
    growth_mult: (r) => r.growth_multiplier,
    maturity_mult: (r) => r.maturity_multiplier,
    implied: (r) => r.implied_value_usd,
  };

  function sorted(list) {
    const key = SORTS[state.sort] || SORTS.rank;
    return list.slice().sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
  }

  /* ---------- hash state, so a view can be linked and screenshotted ---------- */

  function readHash() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('cat')) state.cat = params.get('cat');
    if (params.get('chain')) state.chain = params.get('chain');
    state.watch = params.get('watch') === '1';
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('p')) state.sel = params.get('p');
  }
  function writeHash() {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.cat !== 'all') params.set('cat', state.cat);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watch) params.set('watch', '1');
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.sel) params.set('p', state.sel);
    const next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  /* ---------- header and lede ---------- */

  const header = () =>
    h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'wordmark', text: 'Token Radar' })),
      h('div', { class: 'top-meta' },
        h('span', null, 'Snapshot ', h('b', { text: DATA.as_of })),
        h('span', null, 'Source ', h('b', { text: DATA.source.split(' ')[0] })),
        h('span', null, 'Model ', h('b', { text: DATA.model_version })),
        h('span', null, 'Comparables ', h('b', { text: String(DATA.comps.global.n) }))));

  const lede = () =>
    h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: 'What a token would be worth, and how to farm it first' }),
        h('p', null,
          'The snapshot holds ', h('b', { text: String(DATA.summary.protocols) }), ' protocols. ',
          h('b', { text: String(DATA.summary.pre_token) }), ' record no token; ', h('b', { text: String(DATA.summary.rows) }),
          ' of those could still launch, and they are the board. Each row is valued by the price the market already pays for a dollar of TVL in that protocol\u2019s category, measured from the ',
          h('b', { text: String(DATA.comps.global.n) }), ' protocols in this same snapshot whose token trades, then adjusted for a week of growth and for how long it has run without a token.')),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATA.summary.watchlist + ' / ' + DATA.summary.watchlist })),
        h('div', { class: 'fact' }, h('span', { text: 'Rows ranked' }), h('b', { text: String(DATA.summary.rows) })),
        h('div', { class: 'fact' }, h('span', { text: 'Outside the watchlist' }), h('b', { text: String(DATA.summary.outside_watchlist) })),
        h('div', { class: 'fact' }, h('span', { text: 'Measured categories' }), h('b', { text: String(DATA.comps.categories.length) })),
        h('div', { class: 'fact' }, h('span', { text: 'Records set aside as products' }), h('b', { text: String(DATA.summary.product_excluded) }))));

  /* ---------- controls ---------- */

  function controls(count) {
    const search = h('input', { type: 'search', id: 'q', value: state.q, placeholder: 'Name, slug or chain', 'aria-label': 'Search the board' });
    search.addEventListener('input', () => { state.q = search.value; writeHash(); render(); });

    const cat = h('select', { id: 'cat', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map((c) => h('option', { value: c, text: c, selected: c === state.cat ? 'selected' : null })));
    cat.addEventListener('change', () => { state.cat = cat.value; writeHash(); render(); });

    const chain = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map((c) => h('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null })));
    chain.addEventListener('change', () => { state.chain = chain.value; writeHash(); render(); });

    const box = h('input', { type: 'checkbox', checked: state.watch ? 'checked' : null });
    box.addEventListener('change', () => { state.watch = box.checked; writeHash(); render(); });

    return h('section', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'cat', text: 'Category' }), cat),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chain),
      h('label', { class: 'toggle' }, box, h('span', { text: 'Watchlist only' })),
      h('button', { class: 'reset', type: 'button', text: 'Reset', onclick: () => { state.q = ''; state.cat = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render(); } }),
      h('span', { class: 'count', text: count + ' of ' + DATA.summary.rows + ' rows' }));
  }

  /* ---------- the board ---------- */

  function th(label, key, cls) {
    const active = state.sort === key;
    return h('th', { class: cls || null, scope: 'col' },
      h('button', {
        type: 'button',
        onclick: () => { state.sort = key; state.dir = active ? -state.dir : key === 'rank' || key === 'name' || key === 'category' ? 1 : -1; writeHash(); render(); },
      }, label, active ? h('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir === 1 ? '\u25b2' : '\u25bc' }) : null));
  }

  function board(list) {
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search, or pick another category or chain, to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear the filters', onclick: () => { state.q = ''; state.cat = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render(); } })));
    }
    const top = Math.max(...DATA.rows.map((r) => r.implied_value_usd));
    const body = h('tbody');
    for (const r of list) {
      const width = Math.max(2, Math.round((r.implied_value_usd / top) * 100));
      body.append(h('tr', {
        'aria-selected': state.sel === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: () => openDetail(r.slug),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        h('td', { class: 'num rank', text: String(r.rank) }),
        h('td', null, h('div', { class: 'proto' },
          h('span', { class: 'line' }, h('b', { text: r.name }), r.watchlist ? h('span', { class: 'tag watch', text: 'watchlist' }) : null),
          h('span', { class: 'slug', text: r.chains.length ? r.chains.slice(0, 3).join(' \u00b7 ') : 'no chain on record' }))),
        h('td', null, h('span', { class: 'tag', text: r.category || 'Other' })),
        h('td', { class: 'num right', text: money(r.tvl_usd) }),
        h('td', null, h('div', { class: 'mult' }, h('b', { text: mult(r.multiple) }), h('span', { text: r.multiple_source }))),
        h('td', { class: 'num right ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        h('td', { class: 'num right adj', text: mult2(r.growth_multiplier) }),
        h('td', { class: 'num right adj', text: mult2(r.maturity_multiplier) }),
        h('td', null, h('div', { class: 'value' },
          h('span', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + width + '%' })),
          h('span', { class: 'num', text: money(r.implied_value_usd) })))));
    }
    return h('div', { class: 'panel' },
      h('div', { class: 'caption' },
        h('span', null, 'Ranked by implied value = TVL \u00d7 the multiple the market pays for a dollar of TVL in that category \u00d7 the growth factor \u00d7 the age factor. The last two are columns, so every row recomputes from what is on screen; the bars are each row\u2019s share of the top row. The multiple is measured from the 128 protocols in this snapshot whose token trades and whose record carries both a TVL and a market cap \u2014 the other token holders are stablecoins, wrapped or bridged assets, or carry no market cap, so they cannot price a dollar of TVL.'),
        h('span', { text: list.length + ' shown \u00b7 select a row for its full derivation and its farm plan' })),
      h('div', { class: 'table-wrap' },
      h('table', null,
        h('thead', null, h('tr', null,
          th('Rank', 'rank', 'right'),
          th('Protocol', 'name'),
          th('Category', 'category'),
          th('TVL', 'tvl', 'right'),
          th('Multiple', 'multiple'),
          th('TVL 7d', 'growth', 'right'),
          th('\u00d7 Growth', 'growth_mult', 'right'),
          th('\u00d7 Age', 'maturity_mult', 'right'),
          th('Implied value', 'implied', 'right'))),
        body)));
  }

  /* ---------- the model panel: the comps table, and what it does not claim ---------- */

  function sampleList(category) {
    const rows = DATA.comps.samples.filter((s) => s.category === category).sort((a, b) => b.ratio - a.ratio);
    return h('tr', { class: 'samples' }, h('td', { colspan: '4' },
      h('ul', null, rows.map((s) => h('li', null,
        h('span', null, h('b', { text: s.name }), ' \u00b7 ' + money(s.tvl_usd) + ' TVL \u00b7 ' + money(s.mcap_usd) + ' cap'),
        h('span', { text: 'mcap/TVL ' + mult(s.ratio) }))))));
  }

  function modelPanel() {
    const usedBy = new Map();
    for (const r of DATA.rows) usedBy.set(r.category, (usedBy.get(r.category) || 0) + 1);

    const catRows = [];
    for (const c of DATA.comps.categories) {
      const open = state.open === c.key;
      catRows.push(h('tr', null,
        h('td', null, h('button', { class: 'expand', type: 'button', 'aria-expanded': open ? 'true' : 'false', text: c.key, onclick: () => { state.open = open ? null : c.key; render(); } })),
        h('td', { class: 'n', text: String(c.n) }),
        h('td', { class: 'n', text: mult(c.median) }),
        h('td', { class: 'n', text: String(usedBy.get(c.key) || 0) })));
      if (open) catRows.push(sampleList(c.key));
    }

    // Only the groups a thin category actually falls back to are worth a row; a group whose categories are
    // all measured is never read, and printing it would only repeat a measured category's numbers.
    const groupRows = DATA.comps.groups
      .filter((g) => DATA.comps.thin.some((t) => t.group === g.key))
      .map((g) => h('tr', null,
        h('td', { text: g.label || g.key }),
        h('td', { class: 'n', text: String(g.n) }),
        h('td', { class: 'n', text: mult(g.median) }),
        h('td', { class: 'n', text: String(DATA.comps.thin.filter((t) => t.group === g.key).reduce((n, t) => n + t.n, 0)) })));

    const mean = DATA.comps.global.mean;
    const median = DATA.comps.global.median;

    return h('section', { class: 'panel model' },
      h('h2', { text: 'The multiple is measured, not assumed: ' + DATA.comps.global.n + ' protocols in this snapshot that already trade' }),
      h('p', { class: 'sub' },
        'Every protocol whose record carries both a TVL and a market cap is one observation: the dollars the market pays per dollar of TVL. The model groups them by category and takes the median. A category with ' + DATA.model.min_samples + ' or more observations is measured directly; a thinner one borrows the median of its coarse group; a category with no group of that size borrows the global median. Every multiple is clamped into [' + DATA.model.multiple_floor + ', ' + DATA.model.multiple_cap + '].'),
      h('div', { class: 'formula' },
        'implied = round( tvl_usd \u00d7 multiple(category) \u00d7 (1 + clamp(change_7d, ' + DATA.model.growth_floor + ', ' + DATA.model.growth_cap + ') / 100 \u00d7 ' + DATA.model.growth_weight + ') \u00d7 (' + DATA.model.maturity_ceiling + ' \u2212 ' + DATA.model.maturity_span + ' \u00d7 clamp(age_days / ' + DATA.model.maturity_days + ', 0, 1)) )'),
      h('div', { class: 'split' },
        h('div', null,
          h('h3', { text: 'Measured categories' }),
          h('table', { class: 'mini' },
            h('thead', null, h('tr', null, h('th', { text: 'Category' }), h('th', { class: 'n', text: 'n' }), h('th', { class: 'n', text: 'Median' }), h('th', { class: 'n', text: 'Rows' }))),
            h('tbody', null, catRows)),
          h('p', { class: 'sub', text: 'Select a category to see the protocols behind its median.' })),
        h('div', null,
          h('h3', { text: 'Group fallback, for categories too thin to measure' }),
          h('table', { class: 'mini' },
            h('thead', null, h('tr', null, h('th', { text: 'Group' }), h('th', { class: 'n', text: 'n' }), h('th', { class: 'n', text: 'Median' }), h('th', { class: 'n', text: 'Rows' }))),
            h('tbody', null, groupRows)),
          h('p', { class: 'sub', text: 'Global median ' + mult(median) + ' over ' + DATA.comps.global.n + ' observations, for a category no group can serve. The n of a group counts every comparable in its categories, the ones a measured category already used included, and the group is read only when a thin category needs it.' }))),
      h('p', { class: 'note' },
        h('b', { text: 'Why the median and not the mean. ' }),
        'The mean of these ' + DATA.comps.global.n + ' ratios is ' + mult(mean) + ' and the median is ' + mult(median) + '. One prediction market trades at 400 times its TVL and a handful of protocols sit above 2; they move the mean by dollars and the median by nothing. A multiple that one record can move is a multiple that describes that record, not the category.',
        h('br'),
        h('b', { text: 'What the model does not claim. ' }),
        'It does not predict a token, a date or a price: a protocol can stay tokenless for years, and a token that launches usually sells a float far smaller than the fully diluted value here. It ignores supply, unlocks, revenue and team, and it takes TVL at face value although TVL double-counts when the same deposit is lent and re-deposited. A row is a ranked hypothesis about what the market pays for this kind of protocol, not advice.'),
      h('p', { class: 'note' },
        h('b', { text: 'What the board leaves out. ' }),
        'The snapshot holds ' + DATA.summary.pre_token + ' records with no token. ' + DATA.summary.product_excluded + ' of them are wrapped, staked or bridged products of a token that already trades, or an exchange\u2019s custody business, so they are not ranked: a wrapped asset has a token already. The remaining ' + DATA.summary.rows + ' are the board, and the watchlist\u2019s ' + DATA.summary.watchlist + ' are all in it.'));
  }

  /* ---------- detail view ---------- */

  function openDetail(slug) {
    const r = DATA.rows.find((x) => x.slug === slug);
    if (!r) return;
    state.sel = slug;
    writeHash();
    const recomputed = Math.round(r.tvl_usd * r.multiple * r.growth_multiplier * r.maturity_multiplier);
    const agrees = recomputed === r.implied_value_usd;

    dialog.replaceChildren(
      h('div', { class: 'detail-head' },
        h('div', null,
          h('div', { class: 'eyebrow', text: 'Rank ' + r.rank + ' of ' + DATA.summary.rows + (r.watchlist ? ' \u00b7 on the watchlist' : ' \u00b7 outside the watchlist') }),
          h('h2', { id: 'detail-name', text: r.name }),
          h('p', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains.length ? r.chains.join(', ') : 'an unnamed chain') })),
        h('button', { class: 'close', type: 'button', text: 'Close', onclick: () => dialog.close() })),
      h('div', { class: 'detail-body' },
        h('section', { class: 'detail-section' },
          h('h3', { text: 'Implied value, and where every factor comes from' }),
          h('div', { class: 'derivation' },
            'TVL ' + money(r.tvl_usd) + ' \u00d7 ' + mult(r.multiple) + ' ' + r.multiple_source + ' \u00d7 ' + r.growth_multiplier + ' growth \u00d7 ' + r.maturity_multiplier + ' maturity = ',
            h('b', { text: exact(r.implied_value_usd) })),
          h('div', { class: 'fields' },
            h('div', null, h('span', { text: 'TVL' }), h('b', { text: exact(r.tvl_usd) })),
            h('div', null, h('span', { text: 'Seven-day change' }), h('b', { text: pct(r.change_7d) })),
            h('div', null, h('span', { text: 'Multiple' }), h('b', { text: mult(r.multiple) + ' \u00b7 ' + r.multiple_source })),
            h('div', null, h('span', { text: 'Growth factor' }), h('b', { text: String(r.growth_multiplier) })),
            h('div', null, h('span', { text: 'Maturity factor' }), h('b', { text: String(r.maturity_multiplier) })),
            h('div', null, h('span', { text: 'Age without a token' }), h('b', { text: age(r.age_days) })),
            h('div', null, h('span', { text: 'First listed' }), h('b', { text: r.listed_at || 'unknown' })),
            h('div', null, h('span', { text: 'Record' }), h('b', { text: 'no token recorded' }))),
          h('p', { class: 'check' + (agrees ? '' : ' bad'), text: 'Recomputed from the figures above: ' + exact(recomputed) + (agrees ? ' \u2014 the same number the board carries.' : ' \u2014 this differs from the board, so the data is stale.') })),
        h('section', { class: 'detail-section' },
          h('h3', { text: 'How to farm it, in the order to do it' }),
          h('ol', { class: 'steps' }, r.farm_steps.map((s) => h('li', { text: s }))),
          h('p', { class: 'check', text: 'The plan is generated from this record alone: its category picks the play, ' + (r.chains[0] || 'its chain') + ' picks the asset and the gas estimate, its TVL picks the size, its age picks the hold.' }))));

    if (!dialog.open) dialog.showModal();
  }

  /* ---------- render ---------- */

  function render() {
    // The page is rebuilt on every change, so the control the reader is typing in is put back in place.
    const focused = document.activeElement;
    const focusId = focused && focused.id ? focused.id : null;
    const caret = focused && typeof focused.selectionStart === 'number' ? focused.selectionStart : null;
    const list = sorted(visible());
    app.replaceChildren(h('div', { class: 'shell' }, header(), lede(), controls(list.length), board(list), modelPanel()));
    app.setAttribute('aria-busy', 'false');
    if (focusId) {
      const again = document.getElementById(focusId);
      if (again) {
        again.focus();
        if (caret !== null && again.setSelectionRange) again.setSelectionRange(caret, caret);
      }
    }
    if (state.sel) openDetail(state.sel);
  }

  dialog.addEventListener('close', () => { state.sel = null; writeHash(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dialog.open) dialog.close(); });

  readHash();
  render();
})();