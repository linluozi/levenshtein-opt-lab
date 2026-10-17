# Claims, and the command that produced each one

Every number in the README traces back to a command here. If a number is not in
this file, it should not be in the README.

Environment for all measurements: Windows 11 / Node 22.22.2 (V8) / 2026-10-17.

---

## 1. Correctness

| Claim | Command | Result |
|---|---|---|
| 11 upstream test cases pass | `node --test tests/levenshtein.test.mjs` | pass |
| 2,000 random pairs match an independent oracle | same | pass |
| 100 extreme-asymmetry pairs (both orders) match | same | pass |
| All four arms agree | same | pass |
| UTF-16 code units preserved (`'😀'` → 2) | same | pass |
| 20,400 differential cases, zero mismatches | see `_inspect` note below | 0 mismatches |

The 20,400-case run compared the shipped file against the upstream file directly
(20,000 random pairs of length 0–60 over `a-zA-Z`, space, `.`, `,`, tab; 400
extreme-asymmetry pairs of 1–5 vs 300–500 in both orders).

---

## 2. Memory

| Claim | Command | Result |
|---|---|---|
| 4,004,001 cells at n=2000 (full matrix) | `node benchmarks/memory.mjs --cells` | 4,004,001 |
| 4,002 cells at n=2000 (two rows) | same | 4,002 |
| Upstream OOMs between 1200 and 1500 chars under 16 MiB | `node --max-old-space-size=16 benchmarks/memory.mjs A 1200` then `... A 1500` | ok / OOM exit 134 |
| Shipped version runs at 50,000 chars | `node --max-old-space-size=16 benchmarks/memory.mjs D 50000` | 0.89 MiB |
| Heap delta at n=2000: 30.7 MiB vs 0.05 MiB | `--expose-gc` + `heapUsed` delta | 30.7 / 0.05 MiB |

The 30.7 MiB figure came from an `--expose-gc` run with an explicit `gc()`
before the measurement; the table in the README uses the plain heap delta under
the 16 MiB cap, which is why the numbers differ slightly in form (4.76 vs ~5 MiB
at n=800) — both are real, measured under different conditions.

---

## 3. Speed

| Claim | Command | Result |
|---|---|---|
| D/A = 2.53x–3.69x over n=100..2000 | `node benchmarks/run_all.mjs` | see `results.json` |
| C/B = 1.28x–1.97x (the two-row change) | same | see `results.json` |
| B/A = 1.65x–2.40x (micro-opt only) | same | see `results.json` |
| Noise floor 0.96–1.04 | same, `nullControl` field | 0.96–1.04 |

Method: 9–11 interleaved rounds per case, arm order reversed on alternate
rounds, median of per-round ratios with p10/p90, plus a null control (arm A
against itself) in every round.

Why ratios and not milliseconds: absolute wall-clock drifts by several times
across cases inside one process as allocator state accumulates. Only the
per-round ratio is stable enough to compare across runs.

---

## 4. The swap is a speed loss

| Claim | Command | Result |
|---|---|---|
| 256/2000 short-first: swap is ~20% slower | `node benchmarks/swap_probe.mjs` | C/D = 0.722 [0.68–0.83] |
| Same, confirmed in 3 processes | `node benchmarks/confirm_256.mjs` ×3 | 0.807 / 0.793 / 0.823 |
| 64/2000 short-first: swap loses | `swap_probe` | 0.892 [0.84–0.93] |
| 1000/2000 short-first: swap loses | `swap_probe` | 0.845 [0.76–0.93] |
| Equal length: swap is noise | `swap_probe` | 1.045 [0.96–1.15] |
| Memory at 8/2000: 222x fewer cells | `swap_probe` memory table | 4,002 → 18 |

Verdict rule was fixed before looking at the numbers: `p10 > 1.00` → wins,
`p90 < 1.00` → loses, otherwise noise.

The mechanism, stated plainly: both arms compute `(n+1)(m+1)` cells, so no work
is saved. The swap changes row width and outer loop count, and on short-first
asymmetric input the extra outer iterations outweigh the narrower rows.

---

## 5. Upstream CI

| Claim | Command | Result |
|---|---|---|
| Modified file passes airbnb lint | `npx eslint src/algorithms/string/levenshtein-distance/levenshteinDistance.js` in a real clone | exit 0 |
| Whole repo still lints | `npx eslint "./src/**"` | exit 0, no output |
| Whole repo tests still pass | `npx jest --silent` | 178 suites / 587 tests |
| The file under test was really the modified one | `sha1sum` before and after | identical |

Run inside `codeload.github.com/trekhleb/javascript-algorithms/tar.gz/refs/heads/master`
with `npm install` first. A hand-assembled eslint config cannot answer "does
this break the whole-repo lint", which is the question that matters at PR time.

---

## What is deliberately absent

- No claim of improved time complexity. Both versions are O(n·m) time.
- No comparison against `fast-levenshtein` / `leven`. Different trade-offs,
  different question, and a comparison across them would be apples to oranges
  unless both are re-tuned for the same workload.
- No claim that the shipped version is universally faster. On asymmetric input
  with the short string first, arm C is up to 28% faster and uses 222x more
  memory. Both facts are in the README.
