// Focused, high-round test of the one question the headline benchmark cannot
// settle: what does the argument swap actually do?
//
// Arms C and D compute the SAME number of cells for any input, because
// (n+1)(m+1) is symmetric. The swap cannot reduce work. It can only change the
// row WIDTH, which affects cache behaviour, and it changes how many outer
// iterations run. Those two effects pull in opposite directions:
//
//   * short string second  -> C already has narrow rows; the swap only adds work
//   * short string first   -> C has wide rows; the swap narrows them
//   * very short string    -> the swap multiplies the outer loop count
//
// So the honest claim is about memory, not speed. This script measures the
// speed side carefully enough to say where it is real and where it is noise.
//
// Usage: node benchmarks/swap_probe.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { armCTwoRow, armDShipped } from './arms.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let seed = 987654;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

function randStr(n) {
  let s = '';
  for (let i = 0; i < n; i += 1) s += String.fromCharCode(97 + Math.floor(rand() * 26));
  return s;
}

function timeCall(fn, a, b, reps) {
  for (let i = 0; i < 3; i += 1) fn(a, b);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < reps; i += 1) fn(a, b);
  return Number(process.hrtime.bigint() - t0) / 1e6 / reps;
}

function median(v) {
  const s = [...v].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function q(v, p) {
  const s = [...v].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))];
}

const ROUNDS = 31;

const shapes = [
  { short: 8, long: 2000, reps: 300 },
  { short: 32, long: 2000, reps: 200 },
  { short: 64, long: 2000, reps: 150 },
  { short: 256, long: 2000, reps: 60 },
  { short: 1000, long: 2000, reps: 12 },
  { short: 2000, long: 2000, reps: 6 },
];

console.log(`swap probe: ${ROUNDS} interleaved rounds per shape, median of per-round ratios\n`);
console.log('shape        orientation   C ms     D ms     C/D ratio        verdict');

const records = [];

for (const s of shapes) {
  const shortStr = randStr(s.short);
  const longStr = randStr(s.long);

  for (const orientation of ['shortFirst', 'longFirst']) {
    const a = orientation === 'shortFirst' ? shortStr : longStr;
    const b = orientation === 'shortFirst' ? longStr : shortStr;

    const ratios = [];
    let sumC = 0;
    let sumD = 0;

    for (let r = 0; r < ROUNDS; r += 1) {
      let tc;
      let td;
      if (r % 2 === 0) {
        tc = timeCall(armCTwoRow, a, b, s.reps);
        td = timeCall(armDShipped, a, b, s.reps);
      } else {
        td = timeCall(armDShipped, a, b, s.reps);
        tc = timeCall(armCTwoRow, a, b, s.reps);
      }
      sumC += tc;
      sumD += td;
      ratios.push(tc / td);
    }

    const med = median(ratios);
    const p10 = q(ratios, 0.1);
    const p90 = q(ratios, 0.9);

    // Verdict rule, fixed before looking at the numbers:
    //   confident win  -> p10 > 1.00
    //   confident loss -> p90 < 1.00
    //   otherwise      -> indistinguishable from noise
    let verdict = 'noise';
    if (p10 > 1.0) verdict = 'D wins';
    else if (p90 < 1.0) verdict = 'D loses';

    records.push({
      short: s.short,
      long: s.long,
      orientation,
      cMs: +(sumC / ROUNDS).toFixed(4),
      dMs: +(sumD / ROUNDS).toFixed(4),
      ratio: +med.toFixed(4),
      p10: +p10.toFixed(4),
      p90: +p90.toFixed(4),
      verdict,
    });

    console.log(
      `${String(s.short).padStart(4)}/${String(s.long).padEnd(6)} `
      + `${orientation.padEnd(12)} `
      + `${(sumC / ROUNDS).toFixed(4).padStart(8)} `
      + `${(sumD / ROUNDS).toFixed(4).padStart(8)} `
      + `${med.toFixed(3).padStart(8)} [${p10.toFixed(2)}-${p90.toFixed(2)}] `
      + ` ${verdict}`,
    );
  }
}

console.log('\nMemory (cells held, not work done) for the same shapes:');
console.log('shape        C rows     D rows     D/C cells');
const memory = [];
for (const s of shapes) {
  // C's row width follows b.length, which depends on orientation; D always
  // uses min+1. Show the worst case for C (short string first).
  const cRows = 2 * (s.long + 1);
  const dRows = 2 * (s.short + 1);
  memory.push({ short: s.short, long: s.long, cRows, dRows, ratio: +(dRows / cRows).toFixed(4) });
  console.log(
    `${String(s.short).padStart(4)}/${String(s.long).padEnd(6)} `
    + `${String(cRows).padStart(8)} ${String(dRows).padStart(9)} `
    + `${(dRows / cRows).toFixed(3).padStart(10)}`,
  );
}

const out = join(ROOT, 'benchmarks', 'swap-probe.json');
writeFileSync(out, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  rounds: ROUNDS,
  verdictRule: 'p10 > 1.00 -> D wins; p90 < 1.00 -> D loses; otherwise noise',
  records,
  memory,
}, null, 2)}\n`, 'utf8');
console.log(`\nwrote ${out}`);
