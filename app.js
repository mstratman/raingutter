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

  var ui = { tab: 'race', sheet: null, toast: null, draft: '', title: '' };
  var toastTimer = null;

  // ---------- Render ----------
  function render() {
    var ev = root.current;
    var started = ev && ev.bracket;
    var tab = ui.tab;
    var html = '<header class="top"><h1 id="ttl">' + esc(ev ? ev.title : 'Raingutter Regatta') + '</h1><span class="save" id="save"></span></header>';
    html += '<div id="banner"></div>';
    html += '<main class="' + (tab === 'bracket' && started ? 'wide' : '') + '">';
    if (tab === 'race') html += started ? viewRace(ev) : viewSetup(ev);
    else if (tab === 'bracket') html += started ? viewBracket(ev) : '<div class="card muted">Start the bracket first (Race tab).</div>';
    else if (tab === 'scouts') html += ev ? viewScouts(ev) : '<div class="card muted">No event yet.</div>';
    else html += viewMore(ev);
    html += '</main>';
    html += '<nav class="tabs">' + [['race', '🏁', started ? 'Race' : 'Setup'], ['bracket', '🗂️', 'Bracket'], ['scouts', '👦', 'Scouts'], ['more', '⚙️', 'More']]
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
    h += '<div class="card"><h2>How it works</h2><p class="small muted" style="margin:0">Single-elimination bracket. Each match is <b>two heats with lanes swapped</b>, so every scout races both lanes every match. Most heat wins advances; a 1–1 split gets a tiebreaker heat. Scouts without a partner in round 1 get a bye and still race both lanes in round 2.</p></div>';
    h += '<button class="btn primary block" data-act="start" ' + (scouts.length < 2 ? 'disabled' : '') + '>Start bracket with ' + scouts.length + ' scouts</button>';
    if (scouts.length < 2) h += '<p class="hint muted small">Add at least 2 scouts.</p>';
    return h;
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
        (n.k === 2 ? '<span class="chip tb">Tiebreaker</span>' : '<span class="chip">Heat ' + (n.k + 1) + ' of 2</span>') + '</div>';
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
    if (!ev.bracket) return viewSetup(ev);
    var st = L.stats(ev), arr = Object.keys(st).map(function (k) { return st[k]; });
    var order = { Champion: 0, Active: 1, Out: 2 };
    arr.sort(function (a, b) { return order[a.status] - order[b.status] || b.hw - a.hw || a.name.localeCompare(b.name); });
    var h = '<div class="card"><h2>Standings</h2><table><tr><th>Scout</th><th class="n">W–L</th><th class="n">L1</th><th class="n">L2</th><th>Status</th></tr>';
    arr.forEach(function (s) {
      var status = s.status === 'Out' ? 'Out · ' + s.outRound : s.status + (s.bye && s.status === 'Active' ? '' : '');
      h += '<tr><td><b>' + esc(s.name) + '</b>' + (s.bye ? ' <span class="muted small">(bye R1)</span>' : '') + '</td><td class="n">' + s.hw + '–' + s.hl + '</td><td class="n">' + s.lane1 + '</td><td class="n">' + s.lane2 + '</td><td class="st-' + s.status + '">' + status + '</td></tr>';
    });
    h += '</table><p class="muted small" style="margin:8px 0 0">W–L = heats won–lost. L1/L2 = heats raced in each lane.</p></div>';
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
    if (ev && ev.bracket) h += '<div class="card"><h2>Results summary</h2><button class="btn block" data-act="summary">Copy results as text</button></div>';
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
      var ev = root.current;
      if (!confirm('Start the bracket with ' + ev.scouts.length + ' scouts? Scouts can no longer be added or removed after this.')) return;
      commit(function (n) {
        var e = n.current;
        e.bracket = L.createBracket(e.scouts.map(function (s) { return s.id; }));
        logEvent(e, 'start', { seeds: e.bracket.seeds });
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
      if (u) recordHeat(u.r, u.i, u.k, null, 'undo'); else render();
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
      var ev = root.current, res = L.resolve(ev.bracket), total = res.length, t = ev.title + '\n';
      res.forEach(function (ms) { t += '\n' + L.roundName(ms[0].r, total) + '\n'; ms.forEach(function (m) {
        if (m.bye) { t += '  ' + nameOf(ev, m.winner) + ' (bye)\n'; return; }
        t += '  ' + (nameOf(ev, m.a) || 'TBD') + ' vs ' + (nameOf(ev, m.b) || 'TBD') + (m.winner ? ' → ' + nameOf(ev, m.winner) : '') + '\n';
      }); });
      var c = L.champion(res); if (c) t += '\nChampion: ' + nameOf(ev, c) + '\n';
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
  });
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', function () { if (document.hidden) persist(); });

  // ---------- Boot ----------
  try { ui.draft = localStorage.getItem('rgr:v1:draft') || ''; } catch (e) {}
  render();
  reconcileFromIdb();
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(function (p) { saveInfo.persisted = p; }).catch(function () {});
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
