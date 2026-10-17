import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import levenshteinDistance from '../src/levenshteinDistance.js';
import { ARMS } from '../benchmarks/arms.mjs';

// Independent oracle: explicit full matrix, written in a different style from
// both the upstream and the shipped version, so a shared bug cannot hide.
function oracle(a, b) {
  const rows = b.length + 1;
  const cols = a.length + 1;

  const d = [];
  for (let r = 0; r < rows; r += 1) d.push(new Array(cols).fill(0));
  for (let c = 0; c < cols; c += 1) d[0][c] = c;
  for (let r = 0; r < rows; r += 1) d[r][0] = r;

  for (let r = 1; r < rows; r += 1) {
    for (let c = 1; c < cols; c += 1) {
      const substitute = d[r - 1][c - 1] + (a[c - 1] === b[r - 1] ? 0 : 1);
      d[r][c] = Math.min(substitute, d[r][c - 1] + 1, d[r - 1][c] + 1);
    }
  }

  return d[b.length][a.length];
}

function lcg(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('levenshteinDistance', () => {
  it('matches the upstream test suite cases', () => {
    const cases = [
      ['', '', 0],
      ['a', '', 1],
      ['', 'a', 1],
      ['abc', '', 3],
      ['', 'abc', 3],
      ['islander', 'slander', 1],
      ['mart', 'karma', 3],
      ['kitten', 'sitting', 3],
      ['ball', 'football', 4],
      ['football', 'foot', 4],
      ['intention', 'execution', 5],
    ];

    for (const [a, b, want] of cases) {
      assert.equal(levenshteinDistance(a, b), want, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
  });

  it('agrees with the oracle on 2000 random pairs', () => {
    const rand = lcg(20261017);
    const alphabet = 'abcde .,';

    for (let k = 0; k < 2000; k += 1) {
      const make = (n) => {
        let s = '';
        for (let i = 0; i < n; i += 1) s += alphabet[Math.floor(rand() * alphabet.length)];
        return s;
      };

      const a = make(Math.floor(rand() * 40));
      const b = make(Math.floor(rand() * 40));

      assert.equal(levenshteinDistance(a, b), oracle(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
  });

  it('handles extreme length asymmetry in both argument orders', () => {
    // An inner loop bounded by the longer string would read past the row arrays,
    // get undefined, and silently produce NaN. Only asymmetric input exposes it.
    const rand = lcg(7);

    for (let k = 0; k < 50; k += 1) {
      const make = (n) => {
        let s = '';
        for (let i = 0; i < n; i += 1) s += String.fromCharCode(97 + Math.floor(rand() * 26));
        return s;
      };

      const short = make(1 + Math.floor(rand() * 3));
      const long = make(300 + Math.floor(rand() * 100));

      assert.equal(levenshteinDistance(short, long), oracle(short, long));
      assert.equal(levenshteinDistance(long, short), oracle(long, short));
    }
  });

  it('is symmetric', () => {
    const rand = lcg(99);
    const make = (n) => {
      let s = '';
      for (let i = 0; i < n; i += 1) s += String.fromCharCode(97 + Math.floor(rand() * 26));
      return s;
    };

    for (let k = 0; k < 200; k += 1) {
      const a = make(Math.floor(rand() * 30));
      const b = make(Math.floor(rand() * 30));
      assert.equal(levenshteinDistance(a, b), levenshteinDistance(b, a));
    }
  });

  it('counts UTF-16 code units, matching upstream', () => {
    // Upstream indexes with [i - 1] on a string, so an astral character counts
    // as two. The rewrite must not silently "fix" this into code points.
    assert.equal(levenshteinDistance('', ''), 0);
    assert.equal(levenshteinDistance('\u{1F600}', ''), 2);
    assert.equal(levenshteinDistance('\u{1F600}', '\u{1F600}'), 0);
    assert.equal(levenshteinDistance('\u{1F600}a', 'a'), 2);
  });

  it('does not mutate its arguments', () => {
    // The shipped version swaps arguments internally; if it ever did so by
    // mutating a caller-owned array this would catch it.
    const a = ['k', 'i', 't', 't', 'e', 'n'];
    const b = ['s', 'i', 't'];
    const aCopy = [...a];
    const bCopy = [...b];

    levenshteinDistance(a, b);

    assert.deepEqual(a, aCopy);
    assert.deepEqual(b, bCopy);
  });
});

describe('benchmark arms', () => {
  it('all four arms agree with each other', () => {
    const rand = lcg(4242);
    const make = (n) => {
      let s = '';
      for (let i = 0; i < n; i += 1) s += String.fromCharCode(97 + Math.floor(rand() * 26));
      return s;
    };

    for (let k = 0; k < 300; k += 1) {
      const a = make(Math.floor(rand() * 30));
      const b = make(Math.floor(rand() * 30));
      const want = oracle(a, b);

      for (const arm of ARMS) {
        assert.equal(arm.fn(a, b), want, `arm ${arm.key} (${arm.name}) on ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
      }
    }
  });
});
