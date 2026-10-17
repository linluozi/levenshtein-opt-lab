// Confirm the one surprising number before it goes in the README: at 256 vs
// 2000, is D (swap) really ~25% slower than C (no swap)?
//
// Both arms compute the same number of cells, so any difference is pure loop
// shape. C: outer 256, inner 2000. D: outer 2000, inner 256. Same work, 7.8x
// more outer iterations.
//
// Three independent processes, to rule out one unlucky run.
//
// Usage: node benchmarks/confirm_256.mjs

import { armCTwoRow, armDShipped } from './arms.mjs';

function randStr(n, seed) {
  let s = seed;
  let out = '';
  for (let i = 0; i < n; i += 1) {
    s = (s * 1103515245 + 12345) % 2147483648;
    out += String.fromCharCode(97 + Math.floor((s / 2147483648) * 26));
  }
  return out;
}

function timeCall(fn, a, b, reps) {
  for (let i = 0; i < 3; i += 1) fn(a, b);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < reps; i += 1) fn(a, b);
  return Number(process.hrtime.bigint() - t0) / 1e6 / reps;
}

function median(v) {
  const s = [...v].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

const shortStr = randStr(256, 11);
const longStr = randStr(2000, 22);

// Sanity: both arms must agree, otherwise the comparison is meaningless.
if (armCTwoRow(shortStr, longStr) !== armDShipped(shortStr, longStr)) {
  console.error('arms disagree, aborting');
  process.exit(1);
}

const ROUNDS = 41;
const REPS = 60;
const ratios = [];
let sumC = 0;
let sumD = 0;

for (let r = 0; r < ROUNDS; r += 1) {
  let tc;
  let td;
  if (r % 2 === 0) {
    tc = timeCall(armCTwoRow, shortStr, longStr, REPS);
    td = timeCall(armDShipped, shortStr, longStr, REPS);
  } else {
    td = timeCall(armDShipped, shortStr, longStr, REPS);
    tc = timeCall(armCTwoRow, shortStr, longStr, REPS);
  }
  sumC += tc;
  sumD += td;
  ratios.push(tc / td);
}

const sorted = [...ratios].sort((x, y) => x - y);
console.log(`256 vs 2000, short string passed first, ${ROUNDS} rounds x ${REPS} reps`);
console.log(`C (no swap)  ${(sumC / ROUNDS).toFixed(4)} ms   outer=256  inner=2001`);
console.log(`D (swap)     ${(sumD / ROUNDS).toFixed(4)} ms   outer=2000 inner=257`);
console.log(`C/D median   ${median(ratios).toFixed(3)}  [p10 ${sorted[Math.floor(0.1 * (ROUNDS - 1))].toFixed(3)} - p90 ${sorted[Math.floor(0.9 * (ROUNDS - 1))].toFixed(3)}]`);
console.log(`D is ${((median(ratios) - 1) * 100).toFixed(1)}% ${median(ratios) > 1 ? 'faster' : 'slower'} than C`);
