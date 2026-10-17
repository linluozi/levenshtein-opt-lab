// The four arms used by every benchmark in this repo.
//
// Each arm differs from its neighbour by exactly ONE change, so every speedup
// reported in the README can be traced to the pair of arms that isolates it.
// An "optimized vs original" comparison hides how many changes the optimized
// version actually made; this file exists to stop that.
//
//   A  upstream as-is
//   B  A + two mundane micro-optimizations (hoist row refs, packed allocation)
//   C  B + two-row rolling array
//   D  C + argument swap (the shipped version)
//
// D vs C is the only arm that changes memory complexity. C vs B is where the
// real algorithmic win lives. B vs A is the part nobody wants to claim but
// which pays for roughly half the headline number.

/**
 * A: upstream, byte-for-byte. Full (m+1) x (n+1) matrix.
 * @param {string} a
 * @param {string} b
 * @return {number}
 */
export function armAUpstream(a, b) {
  const distanceMatrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i += 1) {
    distanceMatrix[0][i] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    distanceMatrix[j][0] = j;
  }

  for (let j = 1; j <= b.length; j += 1) {
    for (let i = 1; i <= a.length; i += 1) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      distanceMatrix[j][i] = Math.min(
        distanceMatrix[j][i - 1] + 1,
        distanceMatrix[j - 1][i] + 1,
        distanceMatrix[j - 1][i - 1] + indicator,
      );
    }
  }

  return distanceMatrix[b.length][a.length];
}

/**
 * B: full matrix retained, but rows are hoisted into locals and allocated with
 * fill(0) instead of fill(null).map(). Two changes that apply to any DP code.
 * @param {string} a
 * @param {string} b
 * @return {number}
 */
export function armBMicro(a, b) {
  const matrix = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) {
    matrix[j] = new Array(a.length + 1).fill(0);
  }

  for (let i = 0; i <= a.length; i += 1) {
    matrix[0][i] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= b.length; j += 1) {
    const row = matrix[j];
    const above = matrix[j - 1];
    const bChar = b[j - 1];

    for (let i = 1; i <= a.length; i += 1) {
      const indicator = a[i - 1] === bChar ? 0 : 1;
      row[i] = Math.min(row[i - 1] + 1, above[i] + 1, above[i - 1] + indicator);
    }
  }

  return matrix[b.length][a.length];
}

/**
 * C: two-row rolling array, no argument swap. Inner loop is bounded by b.length.
 * @param {string} a
 * @param {string} b
 * @return {number}
 */
export function armCTwoRow(a, b) {
  const bLen = b.length;
  const aLen = a.length;

  let prevRow = new Array(bLen + 1).fill(0);
  let currRow = new Array(bLen + 1).fill(0);

  for (let j = 0; j <= bLen; j += 1) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= aLen; i += 1) {
    currRow[0] = i;
    const aChar = a[i - 1];

    for (let j = 1; j <= bLen; j += 1) {
      const indicator = aChar === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(prevRow[j] + 1, currRow[j - 1] + 1, prevRow[j - 1] + indicator);
    }

    const tmp = prevRow;
    prevRow = currRow;
    currRow = tmp;
  }

  return prevRow[bLen];
}

/**
 * D: shipped version. C + index the inner loop over the shorter string, so the
 * rows shrink to min(n, m) + 1.
 * @param {string} a
 * @param {string} b
 * @return {number}
 */
export function armDShipped(a, b) {
  const long = a.length >= b.length ? a : b;
  const short = a.length >= b.length ? b : a;

  const shortLen = short.length;

  let prevRow = new Array(shortLen + 1).fill(0);
  let currRow = new Array(shortLen + 1).fill(0);

  for (let j = 0; j <= shortLen; j += 1) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= long.length; i += 1) {
    currRow[0] = i;
    const longChar = long[i - 1];

    for (let j = 1; j <= shortLen; j += 1) {
      const indicator = longChar === short[j - 1] ? 0 : 1;
      currRow[j] = Math.min(prevRow[j] + 1, currRow[j - 1] + 1, prevRow[j - 1] + indicator);
    }

    const tmp = prevRow;
    prevRow = currRow;
    currRow = tmp;
  }

  return prevRow[shortLen];
}

export const ARMS = [
  { key: 'A', name: 'upstream', fn: armAUpstream, note: 'full matrix, fill(null).map' },
  { key: 'B', name: 'micro-opt', fn: armBMicro, note: 'full matrix, hoisted rows, packed' },
  { key: 'C', name: 'two-row', fn: armCTwoRow, note: 'rolling rows, no swap' },
  { key: 'D', name: 'shipped', fn: armDShipped, note: 'rolling rows + swap to shorter' },
];
