/* Raingutter Regatta Bracket - UI + storage. Everything is saved on every change. */
(function () {
  'use strict';
  var L = window.RGR;
  var KEY_CUR = 'rgr:v1:cur', KEY_PREV = 'rgr:v1:prev';

  // ---------- Storage: localStorage (current + previous copy) mirrored to IndexedDB ----------
  var saveInfo = { ok: true, at: null, persisted: null, idb: null };

  function emptyRoot() { return { schema: 1, rev: 0, current: null, archive: [] }; }
  function parseRoot(s) {
    try { var o = JSON.parse(s); if (o && o.schema === 1 && Array.isArray(o.archive)) return o; } catch (e) {}
    return null;
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function idb(fn) {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open('rgr', 1); } catch (e) { return reject(e); }
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var db = req.result, tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
        var r = fn(st);
        tx.oncomplete = function () { db.close(); resolve(r && r.result); };
        tx.onerror = tx.onabort = function () { db.close(); reject(tx.error); };
      };
    });
  }

  function loadSync() {
    var best = null;
    [lsGet(KEY_CUR), lsGet(KEY_PREV)].forEach(function (s) {
      var o = s && parseRoot(s);
      if (o && (!best || o.rev > best.rev)) best = o;
    });
    return best || emptyRoot();
  }

  var root = loadSync();

  function persist() {
    var json = JSON.stringify(root), ok = true;
    try {
      var old = localStorage.getItem(KEY_CUR);
      if (old) localStorage.setItem(KEY_PREV, old);
      localStorage.setItem(KEY_CUR, json);
      if (localStorage.getItem(KEY_CUR) !== json) ok = false;
    } catch (e) { ok = false; }
    saveInfo.ok = ok; saveInfo.at = new Date();
    var snapshot = root;
    idb(function (st) { return st.put(JSON.parse(json), 'root'); })
      .then(function () { saveInfo.idb = true; })
      .catch(function () { saveInfo.idb = false; if (!ok) { saveInfo.ok = false; } })
      .then(function () { if (snapshot === root) renderHeader(); });
  }

  function reconcileFromIdb() {
    idb(function (st) { return st.get('root'); }).then(function (o) {
      if (o && o.schema === 1 && o.rev > root.rev) { root = o; render(); persist(); }
      else if (root.rev > 0) persist(); // make sure IDB mirror is up to date
    }).catch(function () {});
  }

  function commit(mutator) {
    var next = JSON.parse(JSON.stringify(root));
    mutator(next);
    next.rev = (root.rev || 0) + 1;
    root = next;
    persist();
    render();
  }

  // ---------- Helpers ----------
  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel) { return document.querySelector(sel); }
  function nameOf(ev, id) { var s = ev.scouts.filter(function (x) { return x.id === id; })[0]; return s ? s.name : null; }
  function cleanName(s) { return s.replace(/\s+/g, ' ').trim(); }
  function laneChip(n) { return '<span class="lane l' + n + '">Lane ' + n + '</span>'; }
  function logEvent(ev, type, data) { ev.log.push(Object.assign({ t: Date.now(), type: type }, data || {})); }

  var ui = { tab: 'race', sheet: null, toast: null, draft: '', title: '', swap: true, format: 'bracket', k: 3, adv: null, poolEdit: false };
  var toastTimer = null;

  // ---------- Render ----------
  function render() {
    var ev = root.current;
    var started = ev && ev.bracket, inPool = ev && ev.pool && !ev.bracket, running = started || inPool;
    var tab = ui.tab;
    var html = '<header class="top"><h1 id="ttl">' + esc(ev ? ev.title : 'Raingutter Regatta') + '</h1><span class="save" id="save"></span></header>';
    html += '<div id="banner"></div>';
    html += '<main class="' + (tab === 'bracket' && started ? 'wide' : '') + '">';
    if (tab === 'race') html += started ? viewRace(ev) : inPool ? viewPool(ev) : viewSetup(ev);
    else if (tab === 'bracket') html += started ? viewBracket(ev) : inPool ? '<div class="card muted">The bracket starts after pool play is finished (top ' + ev.pool.advance + ' advance). Go to the Race tab.</div>' : '<div class="card muted">Start the bracket first (Race tab).</div>';
    else if (tab === 'scouts') html += ev ? viewScouts(ev) : '<div class="card muted">No event yet.</div>';
    else html += viewMore(ev);
    html += '</main>';
    html += '<nav class="tabs">' + [['race', '🏁', running ? 'Race' : 'Setup'], ['bracket', '🗂️', 'Bracket'], ['scouts', '👦', 'Scouts'], ['more', '⚙️', 'More']]
      .map(function (t) { return '<button data-act="tab" data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '"><span class="ic">' + t[1] + '</span>' + t[2] + '</button>'; }).join('') + '</nav>';
    if (ui.sheet && ev && ev.bracket) html += viewSheet(ev);
    if (ui.toast) html += '<div class="toast"><span>' + esc(ui.toast.text) + '</span><button data-act="undo">Undo</button></div>';
    var keepDraft = document.getElementById('draft');
    if (keepDraft) ui.draft = keepDraft.value;
    $('#app').innerHTML = html;
    renderHeader();
  }

  function renderHeader() {
    var s = $('#save'); if (!s) return;
    var b = $('#banner');
    if (!saveInfo.ok) {
      s.className = 'save bad'; s.textContent = 'NOT SAVED';
      if (b) b.innerHTML = '<div class="banner">⚠️ Browser storage is failing. Use More → Export results now to keep your data.</div>';
    } else {
      s.className = 'save';
      s.textContent = saveInfo.at ? '✓ Saved ' + saveInfo.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : (root.rev ? '✓ Loaded' : '');
      if (b) b.innerHTML = '';
    }
  }

  // --- Setup ---
  function viewSetup(ev) {
    var scouts = ev ? ev.scouts : [];
    var h = '<div class="card"><h2>Event name</h2><input type="text" id="title" value="' + esc(ev ? ev.title : ui.title) + '" placeholder="Pack 123 Raingutter Regatta" data-input="title"></div>';
    h += '<div class="card"><h2>Add scouts (' + scouts.length + ')</h2>';
    h += '<textarea id="draft" placeholder="One name per line">' + esc(ui.draft) + '</textarea>';
    h += '<button class="btn primary block" data-act="addScouts">Add scouts</button>';
    if (scouts.length) {
      h += '<ul class="list" style="margin-top:10px">' + scouts.map(function (s) {
        return '<li><span>' + esc(s.name) + '</span><span><button class="btn sm" data-act="rename" data-id="' + s.id + '">Edit</button> <button class="btn sm danger" data-act="removeScout" data-id="' + s.id + '">Remove</button></span></li>';
      }).join('') + '</ul>';
    }
    h += '</div>';
    var n = scouts.length, pool = effFormat(n) === 'pool', po = poolOpts(n);
    h += '<div class="card"><h2>Format</h2>' +
      '<label class="check"><input type="radio" name="fmt" value="bracket" ' + (!pool ? 'checked' : '') + '> <span>Single elimination</span></label>' +
      '<label class="check"><input type="radio" name="fmt" value="pool" ' + (pool ? 'checked' : '') + (n < 3 ? ' disabled' : '') + '> <span>Pool play, then bracket' + (n < 3 ? ' <span class="muted small">(needs 3+ scouts)</span>' : '') + '</span></label>';
    if (pool) {
      h += '<div class="opts"><label>Heats per scout <select class="sel-select" id="k">' + range(2, Math.min(8, n - 1)).map(function (v) { return '<option' + (v === po.k ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select></label>' +
        '<label>Top <select class="sel-select" id="adv">' + advOptions(n).map(function (v) { return '<option' + (v === po.adv ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select> advance</label></div>';
    }
    h += '<label class="check"><input type="checkbox" id="swap" ' + (ui.swap ? 'checked' : '') + '> <span>' + (pool ? 'Swap lanes in the bracket (two heats per match)' : 'Swap lanes (two heats per match)') + '</span></label>';
    h += '<p class="small muted" style="margin:6px 0 0">' + (pool
        ? 'Every scout races <b>' + po.k + ' heats against ' + po.k + ' different opponents</b>, with lanes balanced (about half in each lane). The top ' + po.adv + ' by heat wins advance to a single-elimination bracket; ties are broken by head-to-head, then a random draw. '
        : 'Single elimination. ') +
      (ui.swap
        ? (pool ? 'In the bracket, each' : 'Each') + ' match is <b>two heats with lanes swapped</b>, so every scout races both lanes every match. Most heat wins advances; a 1–1 split gets a tiebreaker heat.' + (pool ? '' : ' Scouts without a partner in round 1 get a bye and still race both lanes in round 2.')
        : (pool ? 'In the bracket, each' : 'Each') + ' match is <b>one heat</b>; the winner advances.' + (pool ? '' : ' Scouts are <b>not</b> guaranteed to race both lanes, and nobody is guaranteed more than one heat.')) + '</p>' +
      estimateHtml(n) + '</div>';
    h += '<button class="btn primary block" data-act="start" ' + (scouts.length < 2 ? 'disabled' : '') + '>Start ' + (pool ? 'pool play' : 'bracket') + ' with ' + scouts.length + ' scouts</button>';
    if (scouts.length < 2) h += '<p class="hint muted small">Add at least 2 scouts.</p>';
    return h;
  }

  function range(a, b) { var r = []; for (var i = a; i <= b; i++) r.push(i); return r; }
  function effFormat(n) { return ui.format === 'pool' && n >= 3 ? 'pool' : 'bracket'; }
  function advOptions(n) { var o = [], m = 2; while (m <= n) { o.push(m); m *= 2; } return o; }
  function defaultAdv(n) { return n >= 4 ? 4 : 2; }
  function poolOpts(n) {
    var k = Math.max(2, Math.min(ui.k || 3, Math.max(2, n - 1))), advs = advOptions(n);
    return { k: k, adv: ui.adv && advs.indexOf(ui.adv) >= 0 ? ui.adv : defaultAdv(n) };
  }
  function saveOpts() {
    try { localStorage.setItem('rgr:v1:opts', JSON.stringify({ swap: ui.swap, format: ui.format, k: ui.k, adv: ui.adv })); } catch (x) {}
  }
  function estimateHtml(n) {
    if (n < 2) return '<p class="small" style="margin:8px 0 0"><b>Heats:</b> add at least 2 scouts to see an estimate.</p>';
    var pool = effFormat(n) === 'pool', po = poolOpts(n);
    var e = L.estimateHeats(n, pool ? { swap: ui.swap, format: 'pool', k: po.k, advance: po.adv } : { swap: ui.swap }), t;
    var typ = e.typLow === e.typHigh ? '<b>' + e.typLow + '</b>' : '<b>' + e.typLow + '–' + e.typHigh + '</b>';
    if (pool) {
      var bl = e.typLow - e.poolHeats, bh = e.typHigh - e.poolHeats;
      t = typ + ' heats total: ' + e.poolHeats + ' pool heats + ' + (bl === bh ? bl : bl + '–' + bh) + ' bracket heats (' + po.adv + ' scouts)';
      if (e.min !== e.max) t += '; ' + e.min + ' minimum, ' + e.max + ' if every bracket match needs a tiebreaker';
    } else if (!ui.swap) t = typ + ' heats total (' + e.matches + ' matches × 1 heat)';
    else t = typ + ' heats typical (' + e.min + ' minimum, ' + e.max + ' if every match needs a tiebreaker)';
    return '<p class="small" style="margin:8px 0 0"><b>Heats:</b> ' + t + '. Every scout races at least ' + e.perScoutMin + ' heat' + (e.perScoutMin === 1 ? '' : 's') + '.</p>';
  }

  // --- Pool play ---
  function poolStandingsCard(ev) {
    var pool = ev.pool, rows = L.poolStandings(pool), prev = null;
    var h = '<div class="card"><h2>Pool standings</h2><table><tr><th class="n">#</th><th>Scout</th><th class="n">W–L</th><th class="n">L1</th><th class="n">L2</th></tr>';
    rows.forEach(function (r, i) {
      var tag = prev && prev.by !== 'wins' ? ' <span class="muted small">(' + (prev.by === 'h2h' ? 'head-to-head' : 'draw') + ')</span>' : '';
      h += '<tr class="' + (i + 1 === pool.advance && i + 1 < rows.length ? 'cut' : '') + '"><td class="n">' + r.rank + '</td><td><b>' + esc(nameOf(ev, r.id)) + '</b>' + tag + '</td><td class="n">' + r.w + '–' + r.l + '</td><td class="n">' + r.lane1 + '</td><td class="n">' + r.lane2 + '</td></tr>';
      prev = r;
    });
    h += '</table><p class="muted small" style="margin:8px 0 0">Top ' + pool.advance + ' advance (green line). Ties: wins among the tied scouts, then a random draw made at the start. L1/L2 = pool heats raced in each lane.</p></div>';
    return h;
  }

  function poolEditCard(ev) {
    var pool = ev.pool;
    var h = '<div class="card"><h2>Pool heats</h2><button class="btn block" data-act="togglePoolEdit">' + (ui.poolEdit ? 'Hide heats' : 'View / correct pool heats') + '</button>';
    if (ui.poolEdit) {
      h += '<div class="heats">' + pool.heats.map(function (ht, n) {
        var w = ht.w && ht.w.w;
        return '<div class="heat"><div class="row between"><b>Heat ' + (n + 1) + '</b>' + (w ? '<button class="btn sm danger" data-act="poolClear" data-n="' + n + '">Clear result</button>' : '<span class="muted small">not run yet</span>') + '</div>' +
          '<div class="vs">' + [ht.a, ht.b].map(function (id, idx) {
            return '<button class="opt ' + (w === id ? 'sel' : '') + '" data-act="poolSet" data-n="' + n + '" data-w="' + id + '"><small>' + laneChip(idx + 1) + '</small>' + esc(nameOf(ev, id)) + (w === id ? ' ✓' : '') + '</button>';
          }).join('') + '</div></div>';
      }).join('') + '</div>';
    }
    return h + '</div>';
  }

  function viewPool(ev) {
    var pool = ev.pool, q = L.poolQueue(pool), total = pool.heats.length, done = total - q.length, h = '';
    if (q.length) {
      var n = q[0], ht = pool.heats[n];
      h += '<div class="card"><div class="next-label"><div><b>Pool play</b></div><span class="chip">Heat ' + (done + 1) + ' of ' + total + '</span></div>';
      h += '<div class="vs">' + [ht.a, ht.b].map(function (id, idx) {
        return '<button class="pick l' + (idx + 1) + '" data-act="poolWin" data-n="' + n + '" data-w="' + id + '"><small class="lane l' + (idx + 1) + '">Lane ' + (idx + 1) + '</small>' + esc(nameOf(ev, id)) + '</button>';
      }).join('') + '</div>';
      h += '<p class="hint muted small">Tap the scout whose boat <b>won</b> this heat. Top ' + pool.advance + ' advance to the bracket.</p></div>';
      if (q.length > 1) {
        h += '<div class="card upnext"><h2>Coming up</h2><ul class="list">' + q.slice(1, 8).map(function (x, i) {
          var hh = pool.heats[x];
          return '<li><span><b>' + esc(nameOf(ev, hh.a)) + '</b> ' + laneChip(1) + ' vs ' + laneChip(2) + ' <b>' + esc(nameOf(ev, hh.b)) + '</b></span><span class="muted small">Heat ' + (done + 2 + i) + '</span></li>';
        }).join('') + '</ul>' + (q.length > 8 ? '<p class="muted small" style="margin:6px 0 0">+ ' + (q.length - 8) + ' more heats</p>' : '') + '</div>';
      }
      h += poolStandingsCard(ev);
    } else {
      var rows = L.poolStandings(pool), M = pool.advance, cut = rows[M - 1], below = rows[M];
      h += '<div class="card"><h2>Pool play complete</h2><p class="small" style="margin-top:0">All ' + total + ' heats are done. Check the standings, then start the bracket with the top ' + M + '.</p>';
      if (below && cut.by !== 'wins') h += '<p class="small"><b class="warn">Cut line:</b> ' + esc(nameOf(ev, cut.id)) + ' (#' + M + ') and ' + esc(nameOf(ev, below.id)) + ' (#' + (M + 1) + ') are tied on heat wins; ' + esc(nameOf(ev, cut.id)) + ' advances by ' + (cut.by === 'h2h' ? 'head-to-head' : 'the random draw') + '. Correct any heat below if needed.</p>';
      h += '<button class="btn primary block" data-act="startBracket">Start bracket with top ' + M + '</button></div>';
      h += poolStandingsCard(ev);
    }
    return h + poolEditCard(ev);
  }

  // --- Race ---
  function viewRace(ev) {
    var res = L.resolve(ev.bracket), q = L.queue(res), champ = L.champion(res), total = res.length;
    var h = '';
    if (champ) {
      h += '<div class="card champ"><div class="trophy">🏆</div><div class="muted">Champion</div><div class="nm">' + esc(nameOf(ev, champ)) + '</div></div>';
    }
    if (q.length) {
      var n = q[0], m = res[n.r][n.i], ht = m.heats[n.k];
      var left = ht.laneA === 1 ? m.a : m.b, right = ht.laneA === 1 ? m.b : m.a;
      h += '<div class="card"><div class="next-label"><div><b>' + L.roundName(n.r, total) + '</b> · Match ' + (n.i + 1) + '</div>' +
        (n.k === 2 ? '<span class="chip tb">Tiebreaker</span>' : L.swapOn(ev.bracket) ? '<span class="chip">Heat ' + (n.k + 1) + ' of 2</span>' : '<span class="chip">Single heat</span>') + '</div>';
      h += '<div class="vs">' + [left, right].map(function (id, idx) {
        return '<button class="pick l' + (idx + 1) + '" data-act="win" data-r="' + n.r + '" data-i="' + n.i + '" data-k="' + n.k + '" data-w="' + id + '">' +
          '<small class="lane l' + (idx + 1) + '">Lane ' + (idx + 1) + '</small>' + esc(nameOf(ev, id)) + '</button>';
      }).join('') + '</div>';
      h += '<p class="hint muted small">Tap the scout whose boat <b>won</b> this heat.</p>';
      h += '<button class="btn block" data-act="sheet" data-r="' + n.r + '" data-i="' + n.i + '">View / edit this match</button></div>';
      if (q.length > 1) {
        h += '<div class="card upnext"><h2>Coming up</h2><ul class="list">' + q.slice(1, 8).map(function (x) {
          var mm = res[x.r][x.i], hh = mm.heats[x.k];
          var l = hh.laneA === 1 ? mm.a : mm.b, rr = hh.laneA === 1 ? mm.b : mm.a;
          return '<li data-act="sheet" data-r="' + x.r + '" data-i="' + x.i + '"><span><b>' + esc(nameOf(ev, l)) + '</b> ' + laneChip(1) + ' vs ' + laneChip(2) + ' <b>' + esc(nameOf(ev, rr)) + '</b></span>' +
            '<span class="muted small">' + L.roundName(x.r, total) + ' · ' + (x.k === 2 ? 'Tiebreaker' : 'Heat ' + (x.k + 1)) + '</span></li>';
        }).join('') + '</ul>' + (q.length > 8 ? '<p class="muted small" style="margin:6px 0 0">+ ' + (q.length - 8) + ' more heats</p>' : '') + '</div>';
      }
    } else if (!champ) {
      h += '<div class="card muted">Waiting for earlier results.</div>';
    }
    return h;
  }

  // --- Bracket ---
  function slotHtml(ev, m, id, which) {
    var nm = id ? esc(nameOf(ev, id)) : '<span class="tbd">TBD</span>';
    var win = m.winner && m.winner === id;
    var sc = (m.bye || !m.ready) ? (m.bye && id ? 'BYE' : '') : (which === 'a' ? m.score.a : m.score.b);
    if (m.bye && !id) { nm = '<span class="tbd">— bye —</span>'; sc = ''; }
    return '<div class="slot ' + (win ? 'win' : '') + '"><span>' + nm + '</span><span class="sc">' + sc + '</span></div>';
  }
  function viewBracket(ev) {
    var res = L.resolve(ev.bracket), q = L.queue(res), total = res.length, next = q[0];
    var h = '<div class="bracket">';
    res.forEach(function (ms, r) {
      h += '<div class="round"><h2>' + L.roundName(r, total) + '</h2>';
      ms.forEach(function (m) {
        var foot = '';
        if (m.bye) foot = 'Bye — advances';
        else if (!m.ready) foot = 'Waiting';
        else foot = m.heats.filter(function (x) { return x.needed; }).map(function (x) { return (x.k === 2 ? 'TB' : 'H' + (x.k + 1)) + (x.w ? ' ✓' : ' –'); }).join('  ·  ');
        var live = next && next.r === m.r && next.i === m.i;
        h += '<div class="match ' + (m.bye ? 'bye ' : '') + (live ? 'live' : '') + '" data-act="sheet" data-r="' + m.r + '" data-i="' + m.i + '">' +
          slotHtml(ev, m, m.a, 'a') + slotHtml(ev, m, m.b, 'b') + '<div class="foot">' + foot + '</div></div>';
      });
      h += '</div>';
    });
    return h + '</div><p class="muted small" style="text-align:center">Tap a match to see or correct its heats. Scrolls sideways →</p>';
  }

  // --- Scouts ---
  function viewScouts(ev) {
    if (!ev.bracket && !ev.pool) return viewSetup(ev);
    var h = '';
    if (ev.pool) h += poolStandingsCard(ev);
    if (ev.bracket) {
      var st = L.stats(ev), arr = Object.keys(st).map(function (k) { return st[k]; });
      var order = { Champion: 0, Active: 1, Out: 2 };
      arr.sort(function (a, b) { return order[a.status] - order[b.status] || b.hw - a.hw || a.name.localeCompare(b.name); });
      h += '<div class="card"><h2>' + (ev.pool ? 'Overall' : 'Standings') + '</h2><table><tr><th>Scout</th><th class="n">W–L</th><th class="n">L1</th><th class="n">L2</th><th>Status</th></tr>';
      arr.forEach(function (s) {
        var status = s.status === 'Out' ? 'Out · ' + s.outRound : s.status;
        h += '<tr><td><b>' + esc(s.name) + '</b>' + (s.bye ? ' <span class="muted small">(bye R1)</span>' : '') + '</td><td class="n">' + s.hw + '–' + s.hl + '</td><td class="n">' + s.lane1 + '</td><td class="n">' + s.lane2 + '</td><td class="st-' + s.status + '">' + status + '</td></tr>';
      });
      h += '</table><p class="muted small" style="margin:8px 0 0">W–L = heats won–lost' + (ev.pool ? ' (pool and bracket)' : '') + '. L1/L2 = heats raced in each lane.</p></div>';
    }
    if (ev.pool) h += poolEditCard(ev);
    h += '<div class="card"><h2>Fix a name</h2><ul class="list">' + ev.scouts.map(function (s) {
      return '<li><span>' + esc(s.name) + '</span><button class="btn sm" data-act="rename" data-id="' + s.id + '">Edit</button></li>';
    }).join('') + '</ul></div>';
    return h;
  }

  // --- More ---
  function viewMore(ev) {
    var h = '<div class="card"><h2>Data safety</h2><p class="small" style="margin-top:0">Every tap is saved immediately to this device, with a second copy in a separate store. Works fully offline once loaded.</p>' +
      '<p class="small muted">Status: ' + (saveInfo.ok ? '<b style="color:var(--good)">saving OK</b>' : '<b class="warn">save failing!</b>') +
      ' · Backup store: ' + (saveInfo.idb === null ? 'checking…' : saveInfo.idb ? 'OK' : 'unavailable') +
      ' · Protected from auto-clean: ' + (saveInfo.persisted === null ? 'unknown' : saveInfo.persisted ? 'yes' : 'no') + '</p>' +
      '<button class="btn block" data-act="export">Export all data (JSON file)</button>' +
      '<button class="btn block" data-act="copy">Copy all data to clipboard</button>' +
      '<button class="btn block" data-act="import">Import data file…</button>' +
      '<input type="file" id="file" accept="application/json,.json" style="display:none"></div>';
    if (ev && (ev.bracket || ev.pool)) h += '<div class="card"><h2>Results summary</h2><button class="btn block" data-act="summary">Copy results as text</button></div>';
    h += '<div class="card"><h2>Events</h2>';
    if (ev) h += '<p class="small" style="margin-top:0">Current: <b>' + esc(ev.title) + '</b></p><button class="btn block" data-act="newEvent">Start a new event (saves this one)</button>';
    else h += '<p class="small muted" style="margin-top:0">No current event.</p>';
    if (root.archive.length) {
      h += '<ul class="list" style="margin-top:10px">' + root.archive.map(function (a, i) {
        return '<li><span>' + esc(a.title) + '<br><span class="muted small">' + new Date(a.created).toLocaleDateString() + ' · ' + a.scouts.length + ' scouts</span></span><button class="btn sm" data-act="openArchive" data-n="' + i + '">Open</button></li>';
      }).join('') + '</ul>';
    }
    h += '</div>';
    h += '<p class="muted small" style="text-align:center">Nothing is ever deleted: corrected results are kept in each event’s history log.</p>';
    h += '<p class="small" style="text-align:center"><a href="https://github.com/mstratman/raingutter/" target="_blank" rel="noopener">Source code &amp; issues on GitHub</a></p>';
    return h;
  }

  // --- Match sheet ---
  function viewSheet(ev) {
    var res = L.resolve(ev.bracket), total = res.length, m = res[ui.sheet.r][ui.sheet.i];
    var h = '<div class="scrim" data-act="closeSheet"><div class="sheet" data-stop="1">';
    h += '<div class="row between"><h3>' + L.roundName(m.r, total) + ' · Match ' + (m.i + 1) + '</h3><button class="btn sm" data-act="closeSheet">Done</button></div>';
    if (m.bye) return h + '<p class="muted">' + esc(nameOf(ev, m.winner)) + ' has a bye and advances without racing.</p></div></div>';
    if (!m.ready) return h + '<p class="muted">Waiting for earlier matches to finish.</p></div></div>';
    m.heats.forEach(function (ht) {
      var show = ht.needed || (ht.k === 2 && ev.bracket.rounds[m.r][m.i].heats[2]);
      if (!show) return;
      var left = ht.laneA === 1 ? m.a : m.b, right = ht.laneA === 1 ? m.b : m.a;
      h += '<div class="heat"><div class="row between"><b>' + (ht.k === 2 ? 'Tiebreaker heat' : 'Heat ' + (ht.k + 1)) + '</b>' +
        (ht.w ? '<button class="btn sm danger" data-act="clear" data-r="' + m.r + '" data-i="' + m.i + '" data-k="' + ht.k + '">Clear result</button>' : '<span class="muted small">not run yet</span>') + '</div>';
      h += '<div class="vs">' + [left, right].map(function (id, idx) {
        return '<button class="opt ' + (ht.w === id ? 'sel' : '') + '" data-act="setwin" data-r="' + m.r + '" data-i="' + m.i + '" data-k="' + ht.k + '" data-w="' + id + '"><small>' + laneChip(idx + 1) + '</small>' + esc(nameOf(ev, id)) + (ht.w === id ? ' ✓' : '') + '</button>';
      }).join('') + '</div>';
      if (ht.k === 2) h += '<button class="btn sm block" data-act="swapTb" data-r="' + m.r + '" data-i="' + m.i + '">Swap lanes for tiebreaker</button>';
      h += '</div>';
    });
    h += '<p style="margin-bottom:0">' + (m.winner ? '<b>Winner: ' + esc(nameOf(ev, m.winner)) + '</b>' : '<span class="muted">No winner yet</span>') + '</p>';
    return h + '</div></div>';
  }

  // ---------- Actions ----------
  function recordHeat(r, i, k, w, how) {
    var ev = root.current;
    var imp = w === null || w ? L.impact(ev.bracket, r, i, k, w) : [];
    if (imp.length && !confirm('This change affects ' + imp.length + ' later result(s). They are kept but will not count unless this result is restored. Continue?')) return false;
    commit(function (n) {
      var e = n.current;
      e.bracket = L.setHeat(e.bracket, r, i, k, w);
      logEvent(e, w ? 'heat' : 'clear', { r: r, i: i, k: k, w: w, how: how });
    });
    return true;
  }

  function recordPool(n, w, how) {
    var ev = root.current;
    if (ev.bracket && !confirm('The bracket is already seeded from the pool results and will not change. Correct this pool heat anyway?')) return false;
    commit(function (nx) {
      var e = nx.current;
      e.pool = L.setPoolHeat(e.pool, n, w);
      logEvent(e, w ? 'poolHeat' : 'poolClear', { n: n, w: w, how: how });
    });
    return true;
  }

  function setToast(text, undo) {
    clearTimeout(toastTimer);
    ui.toast = { text: text, undo: undo };
    toastTimer = setTimeout(function () { ui.toast = null; var t = document.querySelector('.toast'); if (t) t.remove(); }, 9000);
  }

  var actions = {
    tab: function (d) { ui.tab = d.tab; ui.sheet = null; render(); window.scrollTo(0, 0); },
    addScouts: function () {
      var ta = $('#draft'); if (!ta) return;
      var names = ta.value.split(/\n/).map(cleanName).filter(Boolean);
      if (!names.length) return;
      ui.draft = '';
      commit(function (n) {
        if (!n.current) n.current = newEvent(ui.title);
        names.forEach(function (nm) { n.current.scouts.push({ id: uid(), name: nm }); });
        logEvent(n.current, 'addScouts', { names: names });
      });
    },
    removeScout: function (d) {
      var ev = root.current, nm = nameOf(ev, d.id);
      if (!confirm('Remove ' + nm + '?')) return;
      commit(function (n) { var e = n.current; e.scouts = e.scouts.filter(function (s) { return s.id !== d.id; }); logEvent(e, 'removeScout', { id: d.id, name: nm }); });
    },
    rename: function (d) {
      var nm = cleanName(prompt('Scout name', nameOf(root.current, d.id)) || '');
      if (!nm) return;
      commit(function (n) { var e = n.current, s = e.scouts.filter(function (x) { return x.id === d.id; })[0]; logEvent(e, 'rename', { id: d.id, from: s.name, to: nm }); s.name = nm; });
    },
    start: function () {
      var ev = root.current, nn = ev.scouts.length;
      if (effFormat(nn) === 'pool') {
        var po = poolOpts(nn), est = L.estimateHeats(nn, { swap: ui.swap, format: 'pool', k: po.k, advance: po.adv });
        if (!confirm('Start pool play with ' + nn + ' scouts (' + po.k + ' heats each, top ' + po.adv + ' advance; about ' + est.poolHeats + ' pool heats)? Scouts can no longer be added or removed after this.')) return;
        commit(function (n) {
          var e = n.current;
          e.format = 'pool';
          e.pool = L.createPool(e.scouts.map(function (s) { return s.id; }), po.k, po.adv, null, { swap: ui.swap });
          logEvent(e, 'startPool', { k: po.k, advance: po.adv, swap: ui.swap, heats: e.pool.heats.length });
        });
        ui.tab = 'race'; render();
        return;
      }
      if (!confirm('Start the bracket with ' + ev.scouts.length + ' scouts' + (ui.swap ? '' : ' (single heat per match, no lane swap)') + '? Scouts can no longer be added or removed after this.')) return;
      commit(function (n) {
        var e = n.current;
        e.bracket = L.createBracket(e.scouts.map(function (s) { return s.id; }), null, { swap: ui.swap });
        logEvent(e, 'start', { seeds: e.bracket.seeds, swap: ui.swap });
      });
      ui.tab = 'race'; render();
    },
    win: function (d) {
      var r = +d.r, i = +d.i, k = +d.k;
      if (recordHeat(r, i, k, d.w, 'race')) {
        var ev = root.current, m = L.resolve(ev.bracket)[r][i];
        var msg = nameOf(ev, d.w) + ' won' + (m.done ? ' — advances!' : ' the heat');
        setToast(msg, { r: r, i: i, k: k }); render();
      }
    },
    undo: function () {
      var u = ui.toast && ui.toast.undo; ui.toast = null; clearTimeout(toastTimer);
      if (u && u.pool != null) recordPool(u.pool, null, 'undo');
      else if (u) recordHeat(u.r, u.i, u.k, null, 'undo'); else render();
    },
    poolWin: function (d) {
      var n = +d.n;
      if (recordPool(n, d.w, 'race')) {
        var ev = root.current, left = L.poolQueue(ev.pool).length;
        setToast(nameOf(ev, d.w) + ' won' + (left ? ' the heat' : ' — pool play complete!'), { pool: n }); render();
      }
    },
    poolSet: function (d) { recordPool(+d.n, d.w, 'edit'); },
    poolClear: function (d) { recordPool(+d.n, null, 'edit'); },
    togglePoolEdit: function () { ui.poolEdit = !ui.poolEdit; render(); },
    startBracket: function () {
      var ev = root.current, pool = ev.pool;
      if (!L.poolDone(pool)) return;
      var seeds = L.poolSeeds(pool);
      if (!confirm('Start the bracket with the top ' + seeds.length + ' scouts? Pool results can still be corrected later, but the bracket seeding will not change.')) return;
      commit(function (n) {
        var e = n.current;
        e.bracket = L.createBracket(seeds, null, { swap: pool.swap, ordered: true });
        logEvent(e, 'startBracket', { seeds: e.bracket.seeds, swap: pool.swap });
      });
      ui.tab = 'race'; render();
    },
    sheet: function (d) { ui.sheet = { r: +d.r, i: +d.i }; render(); },
    closeSheet: function () { ui.sheet = null; render(); },
    setwin: function (d) { recordHeat(+d.r, +d.i, +d.k, d.w, 'edit'); },
    clear: function (d) { recordHeat(+d.r, +d.i, +d.k, null, 'edit'); },
    swapTb: function (d) {
      commit(function (n) { var m = n.current.bracket.rounds[+d.r][+d.i]; m.tbLane = m.tbLane === 1 ? 2 : 1; logEvent(n.current, 'swapTb', { r: +d.r, i: +d.i }); });
    },
    export: function () { download(); },
    copy: function () {
      var t = JSON.stringify(root, null, 1);
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { alert('Copied.'); }, function () { alert('Copy failed. Use the export file instead.'); });
    },
    summary: function () {
      var ev = root.current, t = ev.title + '\n', res = ev.bracket ? L.resolve(ev.bracket) : [], total = res.length;
      if (ev.pool) {
        t += '\nPool play (top ' + ev.pool.advance + ' advance)\n';
        L.poolStandings(ev.pool).forEach(function (r) { t += '  ' + r.rank + '. ' + nameOf(ev, r.id) + ' ' + r.w + '–' + r.l + '\n'; });
      }
      res.forEach(function (ms) { t += '\n' + L.roundName(ms[0].r, total) + '\n'; ms.forEach(function (m) {
        if (m.bye) { t += '  ' + nameOf(ev, m.winner) + ' (bye)\n'; return; }
        t += '  ' + (nameOf(ev, m.a) || 'TBD') + ' vs ' + (nameOf(ev, m.b) || 'TBD') + (m.winner ? ' → ' + nameOf(ev, m.winner) : '') + '\n';
      }); });
      var c = ev.bracket && L.champion(res); if (c) t += '\nChampion: ' + nameOf(ev, c) + '\n';
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { alert('Copied.'); }, function () { alert(t); });
    },
    import: function () { $('#file').click(); },
    newEvent: function () {
      if (!confirm('Start a new event? The current one is saved under Events and can be re-opened.')) return;
      commit(function (n) { if (n.current) n.archive.push(n.current); n.current = null; });
      ui.title = ''; ui.draft = ''; ui.tab = 'race'; render();
    },
    openArchive: function (d) {
      if (!confirm('Open this event? The current one is saved under Events.')) return;
      commit(function (n) { var a = n.archive.splice(+d.n, 1)[0]; if (n.current) n.archive.push(n.current); n.current = a; });
      ui.tab = 'race'; render();
    }
  };

  function newEvent(title) {
    return { id: uid(), title: cleanName(title || '') || 'Raingutter Regatta', created: Date.now(), scouts: [], bracket: null, log: [] };
  }

  function download() {
    var blob = new Blob([JSON.stringify(root, null, 1)], { type: 'application/json' });
    var name = 'regatta-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json';
    var file; try { file = new File([blob], name, { type: 'application/json' }); } catch (e) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch(function () {});
      return;
    }
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function importFile(f) {
    var rd = new FileReader();
    rd.onload = function () {
      var o = parseRoot(rd.result);
      if (!o) return alert('That file is not a valid regatta export.');
      if (!confirm('Import ' + (o.current ? '"' + o.current.title + '"' : 'events') + '? Your current data is kept under Events.')) return;
      commit(function (n) {
        if (n.current) n.archive.push(n.current);
        n.archive = n.archive.concat(o.archive);
        n.current = o.current;
      });
    };
    rd.readAsText(f);
  }

  // ---------- Events ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    if (e.target.closest('[data-stop]') && t.classList.contains('scrim')) return; // click inside sheet, not on scrim
    var a = actions[t.dataset.act];
    if (a) { e.preventDefault(); a(t.dataset); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'title') {
      ui.title = e.target.value;
      if (root.current && !root.current.bracket) {
        var v = e.target.value;
        root.current.title = cleanName(v) || 'Raingutter Regatta';
        root.rev++; persist();
        var h = $('#ttl'); if (h) h.textContent = root.current.title;
      }
    } else if (e.target.id === 'draft') {
      ui.draft = e.target.value;
      try { localStorage.setItem('rgr:v1:draft', ui.draft); } catch (x) {}
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'file' && e.target.files[0]) { importFile(e.target.files[0]); e.target.value = ''; }
    else if (e.target.id === 'swap') { ui.swap = e.target.checked; saveOpts(); render(); }
    else if (e.target.name === 'fmt') { ui.format = e.target.value; saveOpts(); render(); }
    else if (e.target.id === 'k') { ui.k = +e.target.value; saveOpts(); render(); }
    else if (e.target.id === 'adv') { ui.adv = +e.target.value; saveOpts(); render(); }
  });
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', function () { if (document.hidden) persist(); });

  // ---------- Boot ----------
  try {
    ui.draft = localStorage.getItem('rgr:v1:draft') || '';
    ui.swap = localStorage.getItem('rgr:v1:swap') !== '0';
    var o = JSON.parse(localStorage.getItem('rgr:v1:opts') || 'null');
    if (o) { ui.swap = o.swap !== false; ui.format = o.format === 'pool' ? 'pool' : 'bracket'; ui.k = o.k || 3; ui.adv = o.adv || null; }
  } catch (e) {}
  render();
  reconcileFromIdb();
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(function (p) { saveInfo.persisted = p; }).catch(function () {});
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () {}); });
  }
})();
