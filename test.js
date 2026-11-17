// Run: node test.js
const L = require('./logic.js');
const assert = require('assert');

function sim(n, seedRng, opts) {
  const scouts = Array.from({ length: n }, (_, i) => ({ id: 's' + i, name: 'S' + i }));
  let br = L.createBracket(scouts.map(s => s.id), seedRng, opts);
  let guard = 0;
  for (;;) {
    const res = L.resolve(br);
    const q = L.queue(res);
    if (!q.length) break;
    assert(guard++ < 1000, 'loop');
    const { r, i, k } = q[0];
    const m = res[r][i];
    // random winner
    const w = Math.random() < 0.5 ? m.a : m.b;
    br = L.setHeat(br, r, i, k, w);
  }
  const res = L.resolve(br);
  const champ = L.champion(res);
  assert(champ, 'champion exists for n=' + n);
  const st = L.stats({ scouts, bracket: br });
  const heats = Object.values(st).reduce((a, x) => a + x.hw, 0);
  const est = L.estimateHeats(n, opts);
  assert(heats >= est.min && heats <= est.max, `n=${n} heats ${heats} outside ${est.min}-${est.max}`);
  scouts.forEach(sc => {
    const x = st[sc.id];
    if (opts && opts.swap === false) return;
    assert(x.lane1 >= 1 && x.lane2 >= 1, `n=${n} ${sc.id} must race both lanes: ${JSON.stringify(x)}`);
  });
  assert.strictEqual(Object.values(st).filter(x => x.status === 'Champion').length, 1);
  return br;
}
for (let n = 2; n <= 40; n++) for (let t = 0; t < 30; t++) { sim(n); sim(n, null, { swap: false }); }

// No double byes in round 0
for (let n = 2; n <= 40; n++) {
  const br = L.createBracket(Array.from({ length: n }, (_, i) => 's' + i));
  const res = L.resolve(br);
  res[0].forEach(m => assert(m.a || m.b));
}

// Correcting an earlier result keeps later data and restores it
{
  const ids = ['a', 'b', 'c', 'd'];
  let br = L.createBracket(ids, () => 0.1);
  const play = (r, i, ws) => { const m = L.resolve(br)[r][i]; ws.forEach((w, k) => { br = L.setHeat(br, r, i, k, w === 'a' ? m.a : m.b); }); };
  play(0, 0, ['a', 'a']); play(0, 1, ['a', 'a']);
  const before = L.resolve(br)[1][0];
  const [x, y] = [before.a, before.b];
  play(1, 0, ['a', 'a']);
  assert.strictEqual(L.resolve(br)[1][0].winner, x);
  // flip a semifinal result: final participants change
  const imp = L.impact(br, 0, 0, 0, L.resolve(br)[0][0].b);
  assert(imp.length >= 0);
  const m0 = L.resolve(br)[0][0];
  br = L.setHeat(br, 0, 0, 0, m0.b); br = L.setHeat(br, 0, 0, 1, m0.b);
  assert.notStrictEqual(L.resolve(br)[1][0].a, x);
  // restore
  br = L.setHeat(br, 0, 0, 0, m0.a); br = L.setHeat(br, 0, 0, 1, m0.a);
  assert.strictEqual(L.resolve(br)[1][0].winner, x, 'final result restored');
}

// Tiebreaker
{
  let br = L.createBracket(['a', 'b'], () => 0.1);
  let m = L.resolve(br)[0][0];
  br = L.setHeat(br, 0, 0, 0, m.a); br = L.setHeat(br, 0, 0, 1, m.b);
  m = L.resolve(br)[0][0];
  assert(!m.winner && m.heats[2].needed);
  br = L.setHeat(br, 0, 0, 2, m.b);
  assert.strictEqual(L.resolve(br)[0][0].winner, m.b);
}
// No-swap: one heat decides each match, no tiebreaker
{
  let br = L.createBracket(['a', 'b', 'c', 'd'], () => 0.1, { swap: false });
  assert.strictEqual(L.queue(L.resolve(br)).length, 2);
  let m = L.resolve(br)[0][0];
  br = L.setHeat(br, 0, 0, 0, m.b);
  assert.strictEqual(L.resolve(br)[0][0].winner, m.b);
  assert(!L.resolve(br)[0][0].heats[1].needed);
}
// Legacy brackets (no swap flag) behave as swap-on
{
  const br = L.createBracket(['a', 'b'], () => 0.1); delete br.swap;
  assert.strictEqual(L.queue(L.resolve(br)).length, 2);
}
// Estimates
{
  const e = L.estimateHeats(8); assert.deepStrictEqual([e.min, e.typLow, e.typHigh, e.max], [14, 16, 17, 21]);
  const f = L.estimateHeats(8, { swap: false }); assert.deepStrictEqual([f.min, f.max], [7, 7]);
}
// ---- Pool play ----
{
  for (let n = 3; n <= 40; n++) for (let k = 2; k <= Math.min(8, n - 1); k++) {
    const ids = Array.from({ length: n }, (_, i) => 's' + i);
    const pool = L.createPool(ids, k, 2);
    const seen = new Set(), deg = {}, l1 = {}, l2 = {};
    pool.heats.forEach(h => {
      const key = [h.a, h.b].sort().join('|');
      assert(!seen.has(key), `repeat opponent n=${n} k=${k}`); seen.add(key);
      deg[h.a] = (deg[h.a] || 0) + 1; deg[h.b] = (deg[h.b] || 0) + 1;
      l1[h.a] = (l1[h.a] || 0) + 1; l2[h.b] = (l2[h.b] || 0) + 1;
    });
    assert.strictEqual(pool.heats.length, Math.ceil(n * k / 2), `heat count n=${n} k=${k}`);
    const lim = (n % 2 && k % 2) ? 2 : 1;
    ids.forEach(id => {
      assert(deg[id] >= k, `n=${n} k=${k} ${id} only ${deg[id]} heats`);
      assert(l1[id] && l2[id], 'both lanes');
      assert(Math.abs((l1[id] || 0) - (l2[id] || 0)) <= lim, `lane balance n=${n} k=${k}`);
    });
    assert.strictEqual(L.estimateHeats(n, { format: 'pool', k, advance: 2 }).poolHeats, pool.heats.length);
  }
}
// Pool -> bracket end to end, with random results
for (let n = 3; n <= 30; n++) for (let t = 0; t < 10; t++) {
  const scouts = Array.from({ length: n }, (_, i) => ({ id: 's' + i, name: 'S' + i }));
  const ids = scouts.map(s => s.id);
  let pool = L.createPool(ids, 3, 4);
  assert.strictEqual(pool.advance, Math.min(4, n));
  assert(!L.poolDone(pool));
  L.poolQueue(pool).forEach(i => { const h = pool.heats[i]; pool = L.setPoolHeat(pool, i, Math.random() < .5 ? h.a : h.b); });
  assert(L.poolDone(pool));
  const rows = L.poolStandings(pool);
  assert.strictEqual(rows.length, n);
  for (let i = 1; i < n; i++) assert(rows[i - 1].w >= rows[i].w, 'standings sorted by wins');
  const seeds = L.poolSeeds(pool);
  assert.deepStrictEqual(seeds, rows.slice(0, pool.advance).map(r => r.id));
  let br = L.createBracket(seeds, null, { swap: true, ordered: true });
  // seed 1 and seed 2 are on opposite halves; seed 1 meets the lowest seed first
  if (seeds.length >= 4) {
    const r0 = L.resolve(br)[0];
    assert.strictEqual(r0[0].a, seeds[0]); assert.strictEqual(r0[0].b, seeds[seeds.length - 1]);
  }
  for (;;) {
    const res = L.resolve(br), q = L.queue(res);
    if (!q.length) break;
    const { r, i, k } = q[0], m = res[r][i];
    br = L.setHeat(br, r, i, k, Math.random() < .5 ? m.a : m.b);
  }
  const st = L.stats({ scouts, pool, bracket: br });
  assert(L.champion(L.resolve(br)));
  const out = Object.values(st).filter(x => x.outRound === 'Pool').length;
  assert.strictEqual(out, n - pool.advance, 'non-qualifiers marked out in Pool');
  assert.strictEqual(Object.values(st).filter(x => x.status === 'Champion').length, 1);
  scouts.forEach(sc => assert(st[sc.id].lane1 >= 1 && st[sc.id].lane2 >= 1));
}
// Tie-breaks: head-to-head, then draw
{
  const pool = { k: 2, advance: 2, swap: true, draw: { a: .1, b: .2, c: .3 },
    heats: [{ a: 'a', b: 'b', w: { w: 'b' } }, { a: 'b', b: 'c', w: { w: 'c' } }, { a: 'c', b: 'a', w: { w: 'a' } }] };
  // 3-way cycle: all 1-1, mini 1 each -> draw order a, b, c
  assert.deepStrictEqual(L.poolStandings(pool).map(r => r.id), ['a', 'b', 'c']);
  assert.strictEqual(L.poolStandings(pool)[0].by, 'draw');
  // a beats b only; b and c unplayed: a 1-0, b 0-1... add c beats b, b beats nobody -> a=1,c=1,b=0; a/c tied, a-c heat: c beat a? make a beat c
  const p2 = { k: 2, advance: 1, swap: true, draw: { a: .9, b: .5, c: .1 },
    heats: [{ a: 'a', b: 'c', w: { w: 'a' } }, { a: 'c', b: 'b', w: { w: 'c' } }, { a: 'b', b: 'a', w: { w: 'b' } }] };
  // each 1-1 again (cycle) -> draw: c, b, a
  assert.deepStrictEqual(L.poolStandings(p2).map(r => r.id), ['c', 'b', 'a']);
  const p3 = { k: 2, advance: 1, swap: true, draw: { a: .9, b: .5, c: .1, d: .2 },
    heats: [{ a: 'a', b: 'c', w: { w: 'a' } }, { a: 'b', b: 'd', w: { w: 'b' } }, { a: 'c', b: 'd', w: { w: 'c' } }, { a: 'a', b: 'b', w: { w: 'a' } }] };
  // a 2-0, then b 1-1 (beat d, lost a), c 1-1 (beat d, lost a), d 0-2 ; b vs c unplayed -> mini 0 each -> draw c, b
  assert.deepStrictEqual(L.poolStandings(p3).map(r => r.id), ['a', 'c', 'b', 'd']);
  // h2h decides: tied b,c, c beat b
  p3.heats.push({ a: 'b', b: 'c', w: { w: 'c' } });
  const s3 = L.poolStandings(p3);
  assert.deepStrictEqual(s3.map(r => r.id), ['a', 'c', 'b', 'd']);
}
// Pool estimates
{
  const e = L.estimateHeats(8, { format: 'pool', k: 4, advance: 4 });
  assert.deepStrictEqual([e.poolHeats, e.min, e.max, e.perScoutMin], [16, 22, 25, 4]);
}
console.log('all tests passed');
