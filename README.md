# levenshtein-opt-lab

Levenshtein edit distance in **O(min(n,m)) memory**, plus the measurement that
shows the "3x faster" claim is really three separate changes — and that the one
change people assume is free (swapping the arguments) is a **speed loss**.

The upstream implementation in
[trekhleb/javascript-algorithms](https://github.com/trekhleb/javascript-algorithms)
allocates the full `(n+1) x (m+1)` DP matrix. This repo ships the two-row
version, keeps every arm of the optimization around so each number is
traceable, and reports the parts that don't flatter the result.

```js
import levenshteinDistance from './src/levenshteinDistance.js';

levenshteinDistance('kitten', 'sitting');   // 3
levenshteinDistance('', 'abc');             // 3
levenshteinDistance('😀', '');              // 2  (UTF-16 code units, as upstream)
```

No dependencies. Node 22+.

---

## The short version

| Question | Answer |
|---|---|
| Is the two-row version faster? | Yes — **2.5x to 3.3x** at n=100..2000 |
| How much of that is the two-row change? | **Only 1.3x–2.0x** (C/B). The rest is micro-opt |
| Does it save memory? | Yes — **4,004,001 cells → 4,002** at n=2000 |
| Does that memory saving matter in practice? | Yes — upstream **OOMs at 1,500 chars** under a 16 MiB cap; this runs at 50,000 |
| Does swapping to the shorter string help speed? | **No. It is often 11–28% slower.** It is a memory optimization |
| Does it ever hurt correctness? | No — 20,400 differential cases, zero mismatches |

![Four-arm attribution](assets/four-arms.png)

The right panel is the point: `D/A = 3x` is really `2.0x × 1.5x × 1.0x`. If you
report only the total, you cannot tell which change is load-bearing.

---

## Four arms, adjacent comparisons

Each arm differs from its neighbour by exactly one change, so every ratio below
is attributable to the pair that isolates it.

| Arm | What it does | Isolates |
|---|---|---|
| **A** `upstream` | Full matrix, `fill(null).map`, loop `j` outer / `i` inner | The baseline |
| **B** `micro-opt` | A + hoist `m[j]`/`m[j-1]`/`b[j-1]` into locals, `fill(0)` instead of `fill(null).map` | The boring stuff |
| **C** `two-row` | B + rolling two-row array, inner loop over `b` | The algorithmic change |
| **D** `shipped` | C + index the inner loop over the **shorter** string | The memory change |

Measured on Node 22.22.2, 11 interleaved rounds per case, median of per-round
ratios, order reversed on alternate rounds. `n` = equal-length input.

| n | A | B | C | D | **D/A** | B/A | C/B | D/C |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 0.106 ms | 0.045 ms | 0.032 ms | 0.030 ms | **3.69x** | 2.40x | 1.45x | 1.06x |
| 200 | 0.455 ms | 0.221 ms | 0.157 ms | 0.147 ms | **3.17x** | 2.08x | 1.47x | 1.04x |
| 500 | 2.868 ms | 1.453 ms | 1.108 ms | 1.087 ms | **2.53x** | 1.92x | 1.28x | 1.03x |
| 1000 | 13.09 ms | 7.753 ms | 4.754 ms | 4.376 ms | **2.97x** | 1.72x | 1.59x | 1.09x |
| 2000 | 65.82 ms | 39.80 ms | 20.69 ms | 20.24 ms | **3.28x** | 1.65x | 1.97x | 1.01x |

Noise floor: arm A timed against itself in the same round gives a median of
**0.96–1.04** across all cases. Anything inside that band is not a result.

**Read the C/B column, not the D/A column.** The two-row change is worth 1.3x to
2.0x. The other half of the headline number comes from hoisting three array
lookups into locals and allocating rows with `fill(0)` — changes that apply to
the full-matrix version too, and that nobody would write a blog post about.

---

## Memory: the actual reason to ship this

![Memory cliff](assets/memory.png)

Cells stored is deterministic, read straight off the code:

| n | full matrix `(n+1)²` | two rows `2(min+1)` | ratio |
|---|---:|---:|---:|
| 100 | 10,201 | 202 | 51x |
| 500 | 251,001 | 1,002 | 251x |
| 1000 | 1,002,001 | 2,002 | 501x |
| 2000 | 4,004,001 | 4,002 | 1,001x |
| 5000 | 25,010,001 | 10,002 | 2,501x |

Measured heap under `--max-old-space-size=16` (16 MiB cap):

| length | upstream | shipped |
|---|---|---|
| 800 | 4.76 MiB, ok | ok |
| 1200 | 10.76 MiB, ok | ok |
| **1500** | **OOM, exit 134** | 0.04 MiB |
| 2000 | OOM | 0.05 MiB |
| 5000 | OOM | 0.15 MiB |
| 20000 | OOM | 0.37 MiB |
| 50000 | OOM | 0.89 MiB |

The cliff is between 1200 and 1500 characters. Reproduce it:

```bash
node --max-old-space-size=16 benchmarks/memory.mjs A 1500   # OOM, exit 134
node --max-old-space-size=16 benchmarks/memory.mjs D 1500   # ok
```

This is not a "nice to have". It is the difference between a function that works
on a 2,000-character input and one that kills the process.

---

## The surprise: the argument swap costs time

![Swap trade-off](assets/asymmetric.png)

Arms C and D compute **the same number of cells** for any input, because
`(n+1)(m+1)` is symmetric. The swap cannot reduce work. It changes two things
that pull in opposite directions:

- **Row width.** C's rows follow `b.length`; D's follow `min(n,m)+1`. D's are
  never wider, often much narrower.
- **Outer loop count.** D always iterates `max(n,m)` times. When the short
  string is passed first, C only iterates `min(n,m)` times — up to 250x fewer
  passes over its inner loop.

31 interleaved rounds per shape, verdict fixed in advance
(`p10 > 1.00` → wins, `p90 < 1.00` → loses, else noise):

| shape (short/long) | short passed first | short passed second |
|---|---|---|
| 8 / 2000 | 1.03 — noise | 1.03 — noise |
| 32 / 2000 | 0.99 — noise | 1.06 — noise |
| 64 / 2000 | **0.89 — loses** | 1.05 — wins |
| 256 / 2000 | **0.72 — loses** | 1.03 — noise |
| 1000 / 2000 | **0.85 — loses** | 1.05 — noise |
| 2000 / 2000 | 1.05 — noise | 1.08 — noise |

At 256 vs 2000 the swap is **~20% slower**, confirmed across three separate
processes (0.807 / 0.793 / 0.823, non-overlapping intervals). The reason is
plain arithmetic: 256 outer passes × 2001 inner cells becomes 2000 outer passes
× 257 inner cells. Same cells, 7.8x more loop setup.

What it buys is memory: **4,002 cells → 514** at that shape, and 222x fewer at
8 vs 2000.

So the swap is a memory optimization with a modest speed cost. That is a
defensible trade — but it is not what "swap so the inner loop is shorter" is
usually sold as, and a benchmark that only measures equal-length input or only
one argument order will never see it.

---

## What this repo does NOT claim

- **Not a speed optimization first.** If you only care about speed and your
  inputs are always equal-length, `C` (no swap) is as fast or faster. Ship `D`
  for the memory.
- **No single-number speedup.** The "3x" is three changes; only 1.3x–2.0x is the
  algorithmic one.
- **No algorithmic improvement in time complexity.** Both are O(n·m) time. Only
  space changes, from O(n·m) to O(min(n,m)).
- **Not benchmarked against `fast-levenshtein` or `leven`.** Those use different
  trade-offs (bailout thresholds, typed arrays). Different question.

---

## Behavioural difference

For non-string arguments the behaviour loosens:

| input | upstream | this version |
|---|---|---|
| `null` / `undefined` | `TypeError` | `TypeError` |
| `123` as first arg | `RangeError` | returns `2` |
| `true` as first arg | `RangeError` | returns `2` |

Cause: upstream's `Array(b.length + 1)` rejects a non-numeric length, while
`new Array(undefined + 1)` degrades to `Array(NaN)`, i.e. length 0, and the
function silently returns a number. All string inputs behave identically. This
is a loosening, not a break, but it is a real behaviour change and is called out
in the PR description.

UTF-16 code units are preserved: `'😀'` still counts as 2, because indexing a
string with `[i-1]` gives code units, not code points. The rewrite does not
"fix" this.

---

## Verify it yourself

```bash
node --test tests/levenshtein.test.mjs   # 7 tests: oracle differential, symmetry,
                                         # asymmetry, emoji, no-mutation, arms agree
node benchmarks/run_all.mjs              # full benchmark, writes results.json
node benchmarks/run_all.mjs --quick      # smoke only, does NOT write
node benchmarks/swap_probe.mjs           # the 31-round swap measurement
node benchmarks/memory.mjs --cells       # cells-stored table
node assets/make_figures.py              # regenerate the three PNGs
```

The test suite compares against an **independent oracle** (a full-matrix
implementation written in a different style from both versions), not against the
new version's own symmetry — a symmetry assertion is a tautology for any
implementation that swaps its arguments up front.

Poison-tested: injecting `return 0`, `+1`, an off-by-one, or dropping
`currRow[0] = i` each makes the suite fail. Deleting `src/levenshteinDistance.js`
fails with a module-not-found error, which is the check that catches the most
common failure mode in this genre — a verification script that quietly tests its
own inlined copy of the code instead of the deliverable.

---

## Upstream readiness

This file is written to be submitted to
[trekhleb/javascript-algorithms](https://github.com/trekhleb/javascript-algorithms),
which lints with airbnb and runs `npm run ci` = `npm run lint && npm run coverage`.

Verified inside a real clone of that repo (not a hand-assembled eslint config):

| check | result |
|---|---|
| `eslint` on the modified file | exit 0 |
| `eslint ./src/**` (whole repo) | **exit 0, no output** |
| `jest` (whole repo) | **178 suites / 587 tests passed** |
| file sha1 before/after the run | identical (`050840612175…`) |

The argument swap is written as `const long` / `const short` bindings rather than
reassigning the parameters, because `no-param-reassign` (airbnb) rejects the
reassignment form — a detail that costs two lint errors and a rejected PR if you
find out at CI time instead of beforehand.

---

## Files

```
src/levenshteinDistance.js        shipped implementation
src/levenshteinDistance.orig.js   upstream, byte-identical (sha1 dd633691…)
benchmarks/arms.mjs               the four arms, one change each
benchmarks/run_all.mjs            headline benchmark -> results.json
benchmarks/swap_probe.mjs         31-round swap measurement -> swap-probe.json
benchmarks/confirm_256.mjs        three-process confirmation of the 256/2000 case
benchmarks/memory.mjs             heap delta and the OOM cliff
tests/levenshtein.test.mjs        node:test, 7 tests
assets/make_figures.py            regenerates the figures from the JSON
docs/CLAIMS.md                    every claim with the command that produced it
```

MIT. Upstream copyright (c) 2018 Oleksii Trekhleb retained — see `LICENSE`.
