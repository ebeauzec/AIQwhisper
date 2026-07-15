/**
 * @module utils/regression
 * @description Statistical utilities for capacity forecasting and
 * performance analysis — linear regression, threshold projection,
 * and percentile calculations.
 */

'use strict';

/**
 * @typedef {Object} RegressionResult
 * @property {number} slope     - Slope of the best-fit line (Δy / Δx).
 * @property {number} intercept - Y-intercept of the best-fit line.
 * @property {number} r2        - Coefficient of determination (0–1).
 */

/**
 * Compute an ordinary least-squares linear regression for a set of (x, y) points.
 *
 * @param {Array<{x: number, y: number}>} points - Data points.
 * @returns {RegressionResult}
 * @throws {Error} If fewer than 2 points are supplied.
 *
 * @example
 *   const result = linearRegression([
 *     { x: 1, y: 2 },
 *     { x: 2, y: 4 },
 *     { x: 3, y: 5 },
 *   ]);
 *   // result ≈ { slope: 1.5, intercept: 0.333, r2: 0.964 }
 */
function linearRegression(points) {
  const n = points.length;
  if (n < 2) {
    throw new Error('linearRegression requires at least 2 data points');
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    sumYY += y * y;
  }

  const denominator = n * sumXX - sumX * sumX;

  // All x values identical → undefined slope
  if (denominator === 0) {
    return { slope: 0, intercept: sumY / n, r2: 0 };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // Coefficient of determination (R²)
  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const { x, y } of points) {
    const predicted = slope * x + intercept;
    ssRes += (y - predicted) ** 2;
    ssTot += (y - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
}

/**
 * Project the number of days until used capacity reaches a threshold
 * percentage of total capacity, given a constant daily growth rate.
 *
 * @param {number} currentUsed   - Current used capacity (same unit as totalCapacity).
 * @param {number} totalCapacity - Total available capacity.
 * @param {number} growthPerDay  - Growth per day (same unit).
 * @param {number} thresholdPct  - Threshold as a fraction (e.g. 0.90 for 90 %).
 * @returns {number|null} Days until the threshold is reached, or `null` if
 *   growth is zero / negative (threshold will never be reached) or already exceeded.
 *
 * @example
 *   const days = projectDaysToThreshold(700, 1000, 2, 0.90);
 *   // days === 100  (need 200 more units at 2/day)
 */
function projectDaysToThreshold(currentUsed, totalCapacity, growthPerDay, thresholdPct) {
  const target = totalCapacity * thresholdPct;

  // Already at or above threshold
  if (currentUsed >= target) return 0;

  // No growth or shrinking — threshold will never be reached
  if (growthPerDay <= 0) return null;

  const remaining = target - currentUsed;
  return remaining / growthPerDay;
}

/**
 * Calculate specific percentile values from an array of numbers.
 *
 * Uses the linear interpolation method (same as NumPy's default).
 *
 * @param {number[]} values      - Array of numeric observations.
 * @param {number[]} percentiles - Percentiles to compute, each in 0–100.
 * @returns {Object<string, number>} Keyed by `p{percentile}`, e.g. `{ p50: 12, p95: 47 }`.
 * @throws {Error} If values array is empty.
 *
 * @example
 *   const result = calculatePercentiles([3, 1, 4, 1, 5, 9], [50, 95]);
 *   // result ≈ { p50: 3.5, p95: 8.0 }
 */
function calculatePercentiles(values, percentiles) {
  if (!values || values.length === 0) {
    throw new Error('calculatePercentiles requires a non-empty array of values');
  }

  // Sort a copy ascending
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const result = {};

  for (const p of percentiles) {
    if (p < 0 || p > 100) {
      throw new Error(`Percentile must be between 0 and 100, got ${p}`);
    }

    if (n === 1) {
      result[`p${p}`] = sorted[0];
      continue;
    }

    // Linear interpolation
    const rank = (p / 100) * (n - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);
    const fraction = rank - lower;

    result[`p${p}`] = sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
  }

  return result;
}

module.exports = {
  linearRegression,
  projectDaysToThreshold,
  calculatePercentiles,
};
