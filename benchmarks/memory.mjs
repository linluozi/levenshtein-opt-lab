// Memory benchmark: how large an input each arm can survive.
//
// Two numbers matter and they are not the same thing:
//
//   * cells stored  - deterministic, read straight off the code. This is the
//                     honest complexity claim.
//   * measured heap - what V8 actually allocates, which includes per-array
//                     overhead and is why 4M cells cost ~31 MiB and not 32 MB.
//
// The original OOMs under a 16 MiB heap cap somewhere between 1200 and 1500
// characters; the shipped version still runs at 50,000. Reproduce the cliff with:
//
//   node --max-old-space-size=16 benchmarks/memory.mjs A 1500     # OOM, exit 134
//   node --max-old-space-size=16 benchmarks/memory.mjs D 1500     # ok
//
// Usage:
//   node benchmarks/memory.mjs <A|B|C|D> <length>     # one arm, one length
//   node benchmarks/memory.mjs --cells                # cells-stored table only

import { ARMS } from './arms.mjs';

function randStr(n) {
  let seed = 1234567;
  let s = '';
  for (let i = 0; i < n; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    s += String.fromCharCode(97 + Math.floor((seed / 2147483648) * 26));
  }
  return s;
}

function cellsTable() {
  console.log('length |    full matrix | two rows | ratio');
  console.log('-------|----------------|----------|-------');
  for (const n of [100, 200, 500, 1000, 2000, 5000]) {
    const full = (n + 1) * (n + 1);
    const two = 2 * (n + 1);
    console.log(
      `${String(n).padStart(6)} | ${String(full.toLocaleString('en-US')).padStart(14)} | `
      + `${String(two.toLocaleString('en-US')).padStart(8)} | ${(full / two).toFixed(0)}x`,
    );
  }
}

const args = process.argv.slice(2);

if (args[0] === '--cells') {
  cellsTable();
} else {
  const key = (args[0] || 'D').toUpperCase();
  const len = Number(args[1] || 2000);

  const arm = ARMS.find((x) => x.key === key);
  if (!arm) {
    console.error(`unknown arm ${key}, expected one of A B C D`);
    process.exit(2);
  }

  const a = randStr(len);
  const b = randStr(len);

  const before = process.memoryUsage().heapUsed;
  const result = arm.fn(a, b);
  const after = process.memoryUsage().heapUsed;

  console.log(
    `arm ${arm.key} (${arm.name}) len=${len}: result=${result} `
    + `heapDelta=${((after - before) / 1048576).toFixed(2)}MiB `
    + `rss=${(process.memoryUsage().rss / 1048576).toFixed(1)}MiB`,
  );
}
