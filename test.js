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
console.log('all tests passed');
