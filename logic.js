/* Raingutter Regatta bracket logic. Pure functions, no DOM. Works in browser and Node.
 *
 * Format: single elimination. Every match is TWO heats with lanes swapped, so each
 * scout races in both lanes in every match they play. If the heats split 1-1, a
 * third (tiebreaker) heat decides it. Whoever has more heat wins advances.
 *
 * Stored data is only: seeds (scout ids in bracket slots) + recorded heat winners.
 * Everything else (who plays whom, winners, stats) is derived, so correcting an
 * earlier result never destroys later recorded results; they are kept and simply
 * ignored while they no longer apply (and come back if the earlier result is restored).
 */
(function (root) {
  'use strict';

  function seedOrder(size) {
    var order = [1];
    while (order.length < size) {
      var n = order.length * 2;
      var next = [];
      order.forEach(function (s) { next.push(s, n + 1 - s); });
      order = next;
    }
    return order;
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor((rng || Math.random)() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // opts.swap (default true): each match is two lane-swapped heats (+ tiebreaker).
  // swap === false: each match is a single heat.
  function createBracket(scoutIds, rng, opts) {
    if (scoutIds.length < 2) throw new Error('Need at least 2 scouts');
    var size = 2;
    while (size < scoutIds.length) size *= 2;
    // opts.ordered: scoutIds are already in seed order (best first), e.g. from pool standings
    var ids = opts && opts.ordered ? scoutIds.slice() : shuffle(scoutIds, rng);
    var seeds = seedOrder(size).map(function (s) { return ids[s - 1] || null; });
    var rounds = [];
    for (var r = 0, count = size / 2; count >= 1; r++, count /= 2) {
      var ms = [];
      for (var i = 0; i < count; i++) {
        // firstLane alternates so lanes are balanced across matches
        ms.push({ firstLane: (i % 2) + 1, tbLane: 1, heats: [null, null, null] });
      }
      rounds.push(ms);
    }
    return { seeds: seeds, rounds: rounds, swap: !(opts && opts.swap === false) };
  }

  function roundName(r, totalRounds) {
    var fromEnd = totalRounds - 1 - r;
    if (fromEnd === 0) return 'Final';
    if (fromEnd === 1) return 'Semifinal';
    if (fromEnd === 2) return 'Quarterfinal';
    return 'Round ' + (r + 1);
  }

  function swapOn(br) { return br.swap !== false; } // older saved brackets have no flag = swap on

  // Heats for a single-elimination bracket of m scouts.
  function bracketEstimate(m, swap) {
    var matches = Math.max(0, m - 1);
    if (!swap) return { matches: matches, min: matches, typLow: matches, typHigh: matches, max: matches };
    return { matches: matches, min: 2 * matches, typLow: Math.ceil(2 * matches + 0.25 * matches),
      typHigh: Math.floor(2 * matches + 0.5 * matches), max: 3 * matches };
  }

  function clampPool(n, k, advance) {
    return { k: Math.max(2, Math.min(k || 3, n - 1)), advance: Math.max(2, Math.min(advance || 2, n)) };
  }

  // Estimated heats for a setup. opts: { swap (default true), format: 'bracket' | 'pool', k, advance }.
  // Returns { min, typLow, typHigh, max, perScoutMin, matches } (+ poolHeats, k, advance for pool).
  function estimateHeats(n, opts) {
    opts = opts || {};
    var swap = opts.swap !== false;
    if (opts.format === 'pool') {
      var c = clampPool(n, opts.k, opts.advance);
      var pool = Math.ceil(n * c.k / 2), b = bracketEstimate(c.advance, swap);
      return { poolHeats: pool, k: c.k, advance: c.advance, bracketMatches: b.matches, matches: pool + b.matches,
        min: pool + b.min, typLow: pool + b.typLow, typHigh: pool + b.typHigh, max: pool + b.max, perScoutMin: c.k };
    }
    var e = bracketEstimate(n, swap);
    e.perScoutMin = n >= 2 ? (swap ? 2 : 1) : 0;
    return e;
  }

  // ---------- Pool play ----------
  // Pool = every scout races k heats against k different opponents, lanes balanced.
  // Stored: { k, advance, swap, heats: [{a (lane 1), b (lane 2), w: null | {w, t}}], draw: {id: random} }.
  // Standings and bracket seeds are derived from the recorded heat winners.

  function range(n) { var r = []; for (var i = 0; i < n; i++) r.push(i); return r; }

  // Edges [i, j] (i races in lane 1) forming a k-regular circulant graph on n scouts. No repeat opponents.
  // If n*k is odd one scout ends up with k+1 heats. Every scout gets at least k.
  function poolEdges(n, k) {
    var edges = [], have = {}, d = Math.floor(k / 2), i, j, o;
    function key(a, b) { return a < b ? a + '-' + b : b + '-' + a; }
    function add(a, b) { edges.push([a, b]); have[key(a, b)] = 1; }
    for (o = 1; o <= d; o++) for (i = 0; i < n; i++) add(i, (i + o) % n);
    if (k % 2) {
      if (n % 2 === 0) { for (i = 0; i < n / 2; i++) add(i, i + n / 2); }
      else {
        // Odd n and odd k: add a near-perfect matching among non-opponents (retry random orders).
        var bestPairs = null, bestRem = null;
        for (var tries = 0; tries < 400; tries++) {
          var order = shuffle(range(n)), usedT = {}, pairs = [];
          order.forEach(function (v) {
            if (usedT[v]) return;
            for (var q = 0; q < order.length; q++) {
              var w = order[q];
              if (w !== v && !usedT[w] && !have[key(v, w)]) { pairs.push([v, w]); usedT[v] = usedT[w] = 1; return; }
            }
          });
          var remT = order.filter(function (v) { return !usedT[v]; });
          if (!bestRem || remT.length < bestRem.length) { bestPairs = pairs; bestRem = remT; }
          if (remT.length <= 1) break;
        }
        var used = {};
        bestPairs.forEach(function (pr) { add(pr[0], pr[1]); used[pr[0]] = used[pr[1]] = 1; });
        bestRem.forEach(function (v) {
          if (used[v]) return;
          var w = -1;
          for (j = 0; j < n && w < 0; j++) if (j !== v && !used[j] && !have[key(v, j)]) w = j;
          for (j = 0; j < n && w < 0; j++) if (j !== v && !have[key(v, j)]) w = j;
          if (w >= 0) { add(v, w); used[v] = used[w] = 1; }
        });
      }
    }
    return edges;
  }

  // Order heats so nobody races back to back when it can be avoided.
  function orderHeats(edges, n) {
    var last = [], left = edges.slice(), out = [], t = 0, i;
    for (i = 0; i < n; i++) last.push(-1000);
    while (left.length) {
      var best = 0, bs = -1;
      for (i = 0; i < left.length; i++) {
        var ra = t - last[left[i][0]], rb = t - last[left[i][1]], sc = Math.min(ra, rb) * 1000 + ra + rb;
        if (sc > bs) { bs = sc; best = i; }
      }
      var e = left.splice(best, 1)[0];
      last[e[0]] = last[e[1]] = t++; out.push(e);
    }
    return out;
  }

  function createPool(scoutIds, k, advance, rng, opts) {
    var n = scoutIds.length;
    if (n < 3) throw new Error('Pool play needs at least 3 scouts');
    var c = clampPool(n, k, advance), ids = shuffle(scoutIds, rng), draw = {};
    var heats = orderHeats(poolEdges(n, c.k), n).map(function (e) { return { a: ids[e[0]], b: ids[e[1]], w: null }; });
    ids.forEach(function (id) { draw[id] = (rng || Math.random)(); });
    return { k: c.k, advance: c.advance, swap: !(opts && opts.swap === false), heats: heats, draw: draw };
  }

  function setPoolHeat(pool, n, winnerId, now) {
    var np = JSON.parse(JSON.stringify(pool));
    np.heats[n].w = winnerId ? { w: winnerId, t: now || Date.now() } : null;
    return np;
  }

  function poolQueue(pool) {
    var q = [];
    pool.heats.forEach(function (h, n) { if (!h.w) q.push(n); });
    return q;
  }
  function poolDone(pool) { return pool.heats.every(function (h) { return !!h.w; }); }

  // Rows best-first: { id, w, l, p, lane1, lane2, rank, by }.
  // Order: heat wins, then wins in heats among the tied scouts, then the random draw.
  // by = how this row was separated from the row below it: 'wins' | 'h2h' | 'draw' | 'end'.
  function poolStandings(pool) {
    var rec = {};
    Object.keys(pool.draw).forEach(function (id) { rec[id] = { id: id, w: 0, l: 0, p: 0, lane1: 0, lane2: 0, mini: 0, by: 'end' }; });
    pool.heats.forEach(function (h) {
      if (!h.w) return;
      var A = rec[h.a], B = rec[h.b];
      A.p++; B.p++; A.lane1++; B.lane2++;
      if (h.w.w === h.a) { A.w++; B.l++; } else { B.w++; A.l++; }
    });
    var arr = Object.keys(rec).map(function (id) { return rec[id]; });
    arr.sort(function (x, y) { return y.w - x.w || pool.draw[x.id] - pool.draw[y.id]; });
    var out = [], i = 0;
    while (i < arr.length) {
      var j = i; while (j < arr.length && arr[j].w === arr[i].w) j++;
      var grp = arr.slice(i, j), inGrp = {};
      grp.forEach(function (r) { inGrp[r.id] = 1; });
      if (grp.length > 1) {
        pool.heats.forEach(function (h) { if (h.w && inGrp[h.a] && inGrp[h.b]) rec[h.w.w].mini++; });
        grp.sort(function (x, y) { return y.mini - x.mini || pool.draw[x.id] - pool.draw[y.id]; });
      }
      out = out.concat(grp); i = j;
    }
    out.forEach(function (r, n) {
      r.rank = n + 1;
      var nx = out[n + 1];
      if (nx) r.by = r.w !== nx.w ? 'wins' : r.mini !== nx.mini ? 'h2h' : 'draw';
    });
    return out;
  }

  function poolSeeds(pool) {
    return poolStandings(pool).slice(0, pool.advance).map(function (r) { return r.id; });
  }

  // Derive everything from seeds + recorded heats.
  function resolve(br) {
    var out = [], swap = swapOn(br);
    br.rounds.forEach(function (ms, r) {
      out[r] = ms.map(function (m, i) {
        var a, b;
        if (r === 0) { a = br.seeds[2 * i]; b = br.seeds[2 * i + 1]; }
        else { a = out[r - 1][2 * i].winner; b = out[r - 1][2 * i + 1].winner; }
        var res = { r: r, i: i, a: a || null, b: b || null, bye: false, heats: [], winner: null, ready: false, done: false };
        if (r === 0 && ((a && !b) || (!a && b))) {
          res.bye = true; res.winner = a || b; res.done = true; return res;
        }
        res.ready = !!(a && b);
        var lanes = [m.firstLane, m.firstLane === 1 ? 2 : 1, m.tbLane];
        for (var k = 0; k < 3; k++) {
          var rec = m.heats[k];
          var w = rec && (rec.w === a || rec.w === b) && res.ready ? rec.w : null;
          res.heats.push({ k: k, laneA: lanes[k], laneB: lanes[k] === 1 ? 2 : 1, w: w, needed: false, stale: !!(rec && !w) });
        }
        if (!res.ready) return res;
        res.heats[0].needed = true;
        if (!swap) {
          if (res.heats[0].w) res.winner = res.heats[0].w;
          res.done = !!res.winner;
          res.score = { a: res.heats[0].w === a ? 1 : 0, b: res.heats[0].w === b ? 1 : 0 };
          return res;
        }
        res.heats[1].needed = true;
        var wa = 0, wb = 0;
        [0, 1].forEach(function (k) {
          if (res.heats[k].w === a) wa++; else if (res.heats[k].w === b) wb++;
        });
        if (res.heats[0].w && res.heats[1].w) {
          if (wa !== wb) { res.winner = wa > wb ? a : b; }
          else {
            res.heats[2].needed = true;
            if (res.heats[2].w) res.winner = res.heats[2].w;
          }
        }
        res.done = !!res.winner;
        res.score = { a: wa + (res.heats[2].needed && res.heats[2].w === a ? 1 : 0), b: wb + (res.heats[2].needed && res.heats[2].w === b ? 1 : 0) };
        return res;
      });
    });
    return out;
  }

  // Heats still to be run, in order.
  function queue(resolved) {
    var q = [];
    resolved.forEach(function (ms) {
      ms.forEach(function (m) {
        m.heats.forEach(function (h) {
          if (h.needed && !h.w) q.push({ r: m.r, i: m.i, k: h.k });
        });
      });
    });
    return q;
  }

  function champion(resolved) {
    var last = resolved[resolved.length - 1][0];
    return last.winner;
  }

  function effectiveKeys(resolved) {
    var keys = {};
    resolved.forEach(function (ms) { ms.forEach(function (m) { m.heats.forEach(function (h) {
      if (h.w && (h.needed)) keys[m.r + '-' + m.i + '-' + h.k] = h.w;
    }); }); });
    return keys;
  }

  // Returns a new bracket with heat (r,i,k) set to winner id (or cleared if null).
  function setHeat(br, r, i, k, winnerId, now) {
    var nb = JSON.parse(JSON.stringify(br));
    nb.rounds[r][i].heats[k] = winnerId ? { w: winnerId, t: now || Date.now() } : null;
    return nb;
  }

  // Which currently-counted results (other than the one being changed) would stop counting?
  function impact(br, r, i, k, winnerId) {
    var before = effectiveKeys(resolve(br));
    var after = effectiveKeys(resolve(setHeat(br, r, i, k, winnerId)));
    var self = r + '-' + i + '-' + k;
    return Object.keys(before).filter(function (key) { return key !== self && !after[key]; });
  }

  function stats(ev) {
    var br = ev.bracket, pool = ev.pool, res = br && resolve(br), total = br && br.rounds.length;
    var s = {};
    ev.scouts.forEach(function (sc) {
      s[sc.id] = { id: sc.id, name: sc.name, hw: 0, hl: 0, lane1: 0, lane2: 0, status: 'Active', outRound: null, bye: false };
    });
    if (pool) pool.heats.forEach(function (h) {
      if (!h.w || !s[h.a] || !s[h.b]) return;
      var A = s[h.a], B = s[h.b];
      A.lane1++; B.lane2++;
      if (h.w.w === h.a) { A.hw++; B.hl++; } else { B.hw++; A.hl++; }
    });
    if (br) {
      var champ = champion(res), inBr = {};
      br.seeds.forEach(function (id) { if (id) inBr[id] = 1; });
      if (pool) ev.scouts.forEach(function (sc) { if (!inBr[sc.id]) { s[sc.id].status = 'Out'; s[sc.id].outRound = 'Pool'; } });
      res.forEach(function (ms) { ms.forEach(function (m) {
        if (m.bye) { s[m.winner].bye = true; return; }
        m.heats.forEach(function (h) {
          if (!h.needed || !h.w) return;
          var A = s[m.a], B = s[m.b];
          if (h.laneA === 1) { A.lane1++; B.lane2++; } else { A.lane2++; B.lane1++; }
          if (h.w === m.a) { A.hw++; B.hl++; } else { B.hw++; A.hl++; }
        });
        if (m.done) {
          var loser = m.winner === m.a ? m.b : m.a;
          s[loser].status = 'Out'; s[loser].outRound = roundName(m.r, total);
        }
      }); });
      if (champ) s[champ].status = 'Champion';
    }
    return s;
  }

  var api = { seedOrder: seedOrder, createBracket: createBracket, resolve: resolve, queue: queue,
    champion: champion, estimateHeats: estimateHeats, swapOn: swapOn, createPool: createPool, setPoolHeat: setPoolHeat,
    poolQueue: poolQueue, poolDone: poolDone, poolStandings: poolStandings, poolSeeds: poolSeeds, poolEdges: poolEdges, setHeat: setHeat, impact: impact, stats: stats, roundName: roundName, shuffle: shuffle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RGR = api;
})(typeof self !== 'undefined' ? self : this);
