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
    var ids = shuffle(scoutIds, rng);
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

  // Estimated heats for a setup. n scouts, opts.swap (default true).
  // Returns { matches, min, typLow, typHigh, max, perScoutMin }.
  function estimateHeats(n, opts) {
    var swap = !(opts && opts.swap === false);
    var matches = Math.max(0, n - 1);
    if (!swap) return { matches: matches, min: matches, typLow: matches, typHigh: matches, max: matches, perScoutMin: n >= 2 ? 1 : 0 };
    return { matches: matches, min: 2 * matches, typLow: Math.ceil(2 * matches + 0.25 * matches),
      typHigh: Math.floor(2 * matches + 0.5 * matches), max: 3 * matches, perScoutMin: n >= 2 ? 2 : 0 };
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
    var br = ev.bracket, res = resolve(br), total = br.rounds.length;
    var s = {};
    ev.scouts.forEach(function (sc) {
      s[sc.id] = { id: sc.id, name: sc.name, hw: 0, hl: 0, lane1: 0, lane2: 0, status: 'Active', outRound: null, bye: false };
    });
    var champ = champion(res);
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
    return s;
  }

  var api = { seedOrder: seedOrder, createBracket: createBracket, resolve: resolve, queue: queue,
    champion: champion, estimateHeats: estimateHeats, swapOn: swapOn, setHeat: setHeat, impact: impact, stats: stats, roundName: roundName, shuffle: shuffle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RGR = api;
})(typeof self !== 'undefined' ? self : this);
