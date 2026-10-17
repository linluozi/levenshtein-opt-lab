/**
 * MODIFIED: 2026-10-17 - Optimization of levenshteinDistance.
 * Original implementation (upstream trekhleb/javascript-algorithms, MIT License,
 * Copyright (c) 2018 Oleksii Trekhleb) allocated a full (n+1) x (m+1) edit-distance
 * matrix, requiring O(n*m) memory. It is replaced by a two-row (rolling array)
 * dynamic programming variant that only needs O(min(n, m)) memory while returning
 * identical results. The original logic is preserved in levenshteinDistance.orig.js.
 * Project license (MIT) and copyright are retained unchanged (see LICENSE).
 */

/**
 * @param {string} a
 * @param {string} b
 * @return {number}
 */
export default function levenshteinDistance(a, b) {
  // Index the inner loop over the shorter string so the two rows are as small
  // as possible. Swapping the arguments does not change the result.
  // Written as const bindings instead of reassigning the parameters, to satisfy
  // the project's airbnb `no-param-reassign` rule.
  const long = a.length >= b.length ? a : b;
  const short = a.length >= b.length ? b : a;

  const shortLen = short.length;

  // Only two rows of the DP matrix are ever needed.
  let prevRow = new Array(shortLen + 1);
  let currRow = new Array(shortLen + 1);

  // Row 0: transforming the empty string into substrings of `short`.
  for (let j = 0; j <= shortLen; j += 1) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= long.length; i += 1) {
    currRow[0] = i;
    const longChar = long[i - 1];

    for (let j = 1; j <= shortLen; j += 1) {
      const indicator = longChar === short[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // insertion
        currRow[j - 1] + 1, // deletion
        prevRow[j - 1] + indicator, // substitution
      );
    }

    // Swap the row references instead of allocating a new row.
    const tmp = prevRow;
    prevRow = currRow;
    currRow = tmp;
  }

  return prevRow[shortLen];
}
