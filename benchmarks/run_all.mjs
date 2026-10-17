// Benchmark harness.
//
// Design rules, each one paid for by a mistake:
//
// 1. **Four arms, adjacent pairs.** Every speedup in the README must be
//    traceable to the two neighbouring arms that isolate it.
// 2. **Ratios, not absolute milliseconds.** Absolute wall-clock drifts by
//    several times across cases inside one process (allocator state
//    accumulates). Only the per-round ratio is stable.
// 3. **Interleave the arms within a round**, and reverse the order on
//    alternate rounds, so CPU frequency drift and background load cannot land
//    entirely on one arm.
// 4. **Median of per-round ratios**, with the observed range, never a single
//    reading.
// 5. **A null control.** Arm A timed against itself establishes the noise
//    floor, which is the threshold every claimed ratio must clear.
//
// Usage:
//   node benchmarks/run_all.mjs            # full run, writes results.json
//   node benchmarks/run_all.mjs --quick    # smoke only, does NOT write

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARMS, armAUpstream } from './arms.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUICK = process.argv.includes('--quick');

// ---------- deterministic input ----------
let seed = 20261017;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

function randStr(n) {
  let s = '';
  for (let i = 0; i < n; i += 1) s += String.fromCharCode(97 + Math.floor(rand() * 26));
  return s;
}

// ---------- timing ----------
// The measurement loop must live inside a function: a top-level `for` is not
// optimized by V8 the same way, and the difference shows up as a fake speedup.
function timeCall(fn, a, b, reps) {
  for (let i = 0; i < 3; i += 1) fn(a, b); // warm up
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < reps; i += 1) fn(a, b);
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6 / reps;
}

function median(values) {
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantile(values, q) {
  const s = [...values].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

// ---------- one measurement block ----------
// order:
//   'equal'      two strings of the same length
//   'shortFirst' a is short, b is long
//   'longFirst'  a is long, b is short
//
// The two asymmetric orientations both matter. Arms C and D differ in exactly
// one way: D indexes the inner loop over the shorter string regardless of
// argument order, while C's inner loop follows whatever was passed as `b`. So
// C's cost depends on the caller's argument order and D's does not, which only
// shows up if both orientations are measured.
function measure(size, reps, rounds, shortSize = null, order = 'equal') {
  seed = 20261017 + size + (shortSize ?? 0);
  const long = randStr(size);
  const short = randStr(shortSize ?? size);

  let a;
  let b;
  if (order === 'shortFirst') {
    a = short;
    b = long;
  } else {
    a = long;
    b = short;
  }

  const sums = Object.fromEntries(ARMS.map((arm) => [arm.key, 0]));
  const ratios = Object.fromEntries(ARMS.map((arm) => [arm.key, []]));
  const nullControl = [];

  for (let r = 0; r < rounds; r += 1) {
    // Reverse the order on alternate rounds so neither arm systematically
    // benefits from going first.
    const order = r % 2 === 0 ? ARMS : [...ARMS].reverse();
    const timings = {};

    for (const arm of order) {
      timings[arm.key] = timeCall(arm.fn, a, b, reps);
      sums[arm.key] += timings[arm.key];
    }

    const base = timings.A;
    for (const arm of ARMS) ratios[arm.key].push(base / timings[arm.key]);

    // Null control: A against itself, same round.
    const again = timeCall(armAUpstream, a, b, reps);
    nullControl.push(timings.A / again);
  }

  const summary = {};
  for (const arm of ARMS) {
    summary[arm.key] = {
      ms: +(sums[arm.key] / rounds).toFixed(4),
      ratioMedian: +median(ratios[arm.key]).toFixed(4),
      ratioP10: +quantile(ratios[arm.key], 0.1).toFixed(4),
      ratioP90: +quantile(ratios[arm.key], 0.9).toFixed(4),
    };
  }

  return {
    n: size,
    shortSize,
    order,
    reps,
    rounds,
    arms: summary,
    nullControl: {
      median: +median(nullControl).toFixed(4),
      min: +Math.min(...nullControl).toFixed(4),
      max: +Math.max(...nullControl).toFixed(4),
    },
  };
}

// ---------- memory ----------
// Cells stored, from the code, not from a timer: deterministic and portable.
function cellsStored(size) {
  const full = (size + 1) * (size + 1);
  const twoRow = 2 * (size + 1);
  return { full, twoRow, ratio: full / twoRow };
}

// ---------- main ----------
const CASES = QUICK
  ? [{ size: 200, reps: 100, rounds: 3 }]
  : [
    { size: 100, reps: 2000, rounds: 9 },
    { size: 200, reps: 300, rounds: 11 },
    { size: 500, reps: 40, rounds: 11 },
    { size: 1000, reps: 12, rounds: 11 },
    { size: 2000, reps: 4, rounds: 9 },
    // Asymmetric, both orientations. This is the case the argument swap exists
    // for, and it is the only case where C and D can diverge.
    { size: 2000, shortSize: 8, order: 'shortFirst', reps: 200, rounds: 11 },
    { size: 2000, shortSize: 8, order: 'longFirst', reps: 200, rounds: 11 },
    { size: 2000, shortSize: 64, order: 'shortFirst', reps: 100, rounds: 11 },
    { size: 2000, shortSize: 64, order: 'longFirst', reps: 100, rounds: 11 },
  ];

console.log(`levenshtein-opt-lab benchmark (${QUICK ? 'quick' : 'full'})`);
console.log(`node ${process.version} on ${process.platform}/${process.arch}\n`);

const cases = [];
for (const c of CASES) {
  const row = measure(c.size, c.reps, c.rounds, c.shortSize ?? null, c.order ?? 'equal');
  cases.push(row);
  const { A, B, C, D } = row.arms;
  const label = c.shortSize
    ? `${c.shortSize}/${c.size} ${c.order === 'shortFirst' ? 'S,L' : 'L,S'}`
    : `${c.size}`;
  console.log(
    `n=${label.padStart(14)}  `
    + `A=${String(A.ms).padStart(8)}ms  B=${String(B.ms).padStart(8)}ms  `
    + `C=${String(C.ms).padStart(8)}ms  D=${String(D.ms).padStart(8)}ms  |  `
    + `D/A=${D.ratioMedian.toFixed(2)}x  `
    + `B/A=${B.ratioMedian.toFixed(2)}x  C/B=${(C.ratioMedian / B.ratioMedian).toFixed(2)}x  `
    + `D/C=${(D.ratioMedian / C.ratioMedian).toFixed(2)}x  `
    + `| null=${row.nullControl.median.toFixed(3)}`,
  );
}

const results = {
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  method: {
    timing: 'same-round interleaved, order reversed on alternate rounds',
    statistic: 'median of per-round ratios, with p10/p90',
    nullControl: 'arm A timed against itself to establish the noise floor',
  },
  cases,
  cells: [100, 200, 500, 1000, 2000].map((n) => ({ n, ...cellsStored(n) })),
};

if (QUICK) {
  console.log('\nquick mode: results.json NOT written (smoke test only)');
} else {
  const out = join(ROOT, 'benchmarks', 'results.json');
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(`\nwrote ${out}`);
}
