'use strict';

/**
 * @module analysis/projections
 * @description Capacity projection calculator for AIQwhisper.
 *
 * Fetches daily capacity snapshots for each resource, runs linear regression
 * to determine growth trends, and projects when resources will hit capacity
 * thresholds (85 %, 90 %, 95 %, 100 %).  Results are persisted in the
 * `capacity_projections` table.
 */

const { getDb } = require('../db/database');
const { linearRegression, projectDaysToThreshold } = require('../utils/regression');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum number of daily snapshots required before we attempt a projection. */
const MIN_DATA_POINTS = 2;

/**
 * Number of days of history to look back when building the regression dataset.
 * @type {number}
 */
const LOOKBACK_DAYS = 90;

/** Threshold for considering growth effectively zero (bytes/day). */
const STABLE_THRESHOLD = 1024; // 1 KiB/day

/** Capacity thresholds to project against. */
const THRESHOLDS = [
  { label: 'days_to_85', pct: 0.85 },
  { label: 'days_to_90', pct: 0.90 },
  { label: 'days_to_95', pct: 0.95 },
  { label: 'days_to_100', pct: 1.00 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the current UTC datetime as an ISO-8601 string (no "T", no millis).
 *
 * @returns {string}
 */
function nowUtc() {
  return new Date().toISOString().replace('T', ' ').replace(/\.?\d{3}Z$/, '');
}

/**
 * Return a UTC datetime string N days in the past.
 *
 * @param {number} days
 * @returns {string}
 */
function daysAgo(days) {
  const ms = Date.now() - days * 86_400_000;
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.?\d{3}Z$/, '');
}

/**
 * Add N days to a date string and return an ISO-8601 date.
 *
 * @param {string} fromDate - ISO-8601 datetime string.
 * @param {number} days
 * @returns {string}
 */
function addDays(fromDate, days) {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().replace('T', ' ').replace(/\.?\d{3}Z$/, '');
}

/**
 * Determine the trend direction from a regression slope.
 *
 * @param {number} slope - Bytes per day.
 * @returns {'growing'|'stable'|'shrinking'}
 */
function trendDirection(slope) {
  if (slope > STABLE_THRESHOLD) return 'growing';
  if (slope < -STABLE_THRESHOLD) return 'shrinking';
  return 'stable';
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Calculate capacity projections for every resource tracked under a system.
 *
 * For each unique (resource_type, resource_id) in `capacity_snapshots`:
 *
 * 1. Fetch daily snapshots from the last {@link LOOKBACK_DAYS} days.
 * 2. If there are fewer than {@link MIN_DATA_POINTS}, skip.
 * 3. Build a linear regression on `{x: dayIndex, y: used_bytes}`.
 * 4. Project days until 85 %, 90 %, 95 %, 100 % utilisation.
 * 5. Upsert results into `capacity_projections`.
 *
 * @param {number} systemId - Primary key of the system.
 * @returns {Array<Object>} Array of projection records created/updated.
 */
function calculateProjections(systemId) {
  const db = getDb();
  const cutoff = daysAgo(LOOKBACK_DAYS);
  const now = nowUtc();

  // Discover distinct resources
  const resources = db.prepare(`
    SELECT DISTINCT resource_type, resource_id, resource_name
    FROM capacity_snapshots
    WHERE system_id = @systemId
      AND snapshot_timestamp >= @cutoff
  `).all({ systemId, cutoff });

  if (resources.length === 0) {
    logger.debug(`[Projections] No capacity data for system id=${systemId}`);
    return [];
  }

  const upsertStmt = db.prepare(`
    INSERT INTO capacity_projections
      (system_id, resource_type, resource_id, resource_name,
       current_used_bytes, growth_rate_bytes_per_day,
       projected_full_date, confidence_pct, analysis_timestamp,
       days_until_full, created_at)
    VALUES
      (@system_id, @resource_type, @resource_id, @resource_name,
       @current_used_bytes, @growth_rate_bytes_per_day,
       @projected_full_date, @confidence_pct, @analysis_timestamp,
       @days_until_full, @created_at)
    ON CONFLICT (system_id, resource_type, resource_id) DO UPDATE SET
      resource_name            = excluded.resource_name,
      current_used_bytes       = excluded.current_used_bytes,
      growth_rate_bytes_per_day = excluded.growth_rate_bytes_per_day,
      projected_full_date      = excluded.projected_full_date,
      confidence_pct           = excluded.confidence_pct,
      analysis_timestamp       = excluded.analysis_timestamp,
      days_until_full          = excluded.days_until_full
  `);

  const projections = [];

  const runAll = db.transaction(() => {
    for (const res of resources) {
      // Fetch daily snapshots ordered by time
      const snapshots = db.prepare(`
        SELECT used_bytes, total_bytes, snapshot_timestamp
        FROM capacity_snapshots
        WHERE system_id = @systemId
          AND resource_type = @resourceType
          AND resource_id = @resourceId
          AND snapshot_timestamp >= @cutoff
        ORDER BY snapshot_timestamp ASC
      `).all({
        systemId,
        resourceType: res.resource_type,
        resourceId: res.resource_id,
        cutoff,
      });

      if (snapshots.length < MIN_DATA_POINTS) continue;

      // Build regression dataset
      const firstTs = new Date(snapshots[0].snapshot_timestamp).getTime();
      const points = snapshots.map((s) => ({
        x: (new Date(s.snapshot_timestamp).getTime() - firstTs) / 86_400_000,
        y: s.used_bytes,
      }));

      let regression;
      try {
        regression = linearRegression(points);
      } catch (err) {
        logger.debug(
          `[Projections] Regression failed for ${res.resource_type}/${res.resource_id}: ${err.message}`
        );
        continue;
      }

      const latest = snapshots[snapshots.length - 1];
      const currentUsed = latest.used_bytes;
      const totalCapacity = latest.total_bytes;
      const growthPerDay = regression.slope;
      const trend = trendDirection(growthPerDay);

      // Project days until each threshold
      const dayMap = {};
      for (const { label, pct } of THRESHOLDS) {
        dayMap[label] = projectDaysToThreshold(currentUsed, totalCapacity, growthPerDay, pct);
      }

      // Use days_to_100 as the canonical "days_until_full"
      const daysUntilFull = dayMap.days_to_100 !== null
        ? Math.round(dayMap.days_to_100)
        : null;

      const projectedFullDate = daysUntilFull !== null
        ? addDays(now, daysUntilFull)
        : null;

      const record = {
        system_id: systemId,
        resource_type: res.resource_type,
        resource_id: res.resource_id,
        resource_name: res.resource_name || res.resource_id,
        current_used_bytes: currentUsed,
        growth_rate_bytes_per_day: Math.round(growthPerDay * 100) / 100,
        projected_full_date: projectedFullDate,
        confidence_pct: Math.round(regression.r2 * 10000) / 100, // e.g. 0.95 → 95.00
        analysis_timestamp: now,
        days_until_full: daysUntilFull,
        created_at: now,
      };

      upsertStmt.run(record);

      projections.push({
        ...record,
        trend,
        thresholds: dayMap,
      });
    }
  });

  runAll();

  logger.info(
    `[Projections] Calculated ${projections.length} projections for system id=${systemId}`
  );
  return projections;
}

/**
 * Run capacity projections for every registered system.
 *
 * @returns {Object} Summary keyed by system id.
 */
function calculateAllProjections() {
  const db = getDb();
  const systems = db.prepare('SELECT id, name FROM systems').all();
  const results = {};

  for (const sys of systems) {
    try {
      const projections = calculateProjections(sys.id);
      results[sys.id] = { name: sys.name, count: projections.length };
    } catch (err) {
      logger.error(`[Projections] Failed for system "${sys.name}": ${err.message}`);
      results[sys.id] = { name: sys.name, count: 0, error: err.message };
    }
  }

  const totalCount = Object.values(results).reduce((sum, r) => sum + r.count, 0);
  logger.info(
    `[Projections] calculateAllProjections complete: ${totalCount} projections across ${systems.length} systems`
  );
  return results;
}

/**
 * Return resources sorted by days-to-threshold, ascending (most urgent
 * first).  Resources with `null` days (no growth / shrinking) are listed
 * last.
 *
 * @param {number} systemId - Filter by system.
 * @param {number} [threshold] - Optional maximum days filter (e.g. 30 to
 *   return only resources filling within 30 days).
 * @returns {Array<Object>}
 */
function getRunway(systemId, threshold) {
  const db = getDb();

  if (threshold !== undefined && threshold !== null) {
    return db.prepare(`
      SELECT * FROM capacity_projections
      WHERE system_id = @systemId
        AND days_until_full IS NOT NULL
        AND days_until_full <= @threshold
      ORDER BY days_until_full ASC
    `).all({ systemId, threshold });
  }

  return db.prepare(`
    SELECT * FROM capacity_projections
    WHERE system_id = @systemId
    ORDER BY
      CASE WHEN days_until_full IS NULL THEN 1 ELSE 0 END,
      days_until_full ASC
  `).all({ systemId });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  calculateProjections,
  calculateAllProjections,
  getRunway,
};
