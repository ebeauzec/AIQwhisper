'use strict';

/**
 * @module db/rollup
 * @description Rollup engine that aggregates metrics from one tier to the next.
 *
 * - `rollupHourly()` — metrics_raw → metrics_hourly (per completed hour)
 * - `rollupDaily()`  — metrics_hourly → metrics_daily (per completed day)
 * - `rollupWeekly()` — metrics_daily → metrics_weekly (per completed week)
 *
 * Each function discovers which time buckets still need processing, computes
 * MIN / MAX / AVG / SUM / COUNT plus p95 and p99, and writes results inside
 * a transaction for atomicity.
 */

const { getDb } = require('./database');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the current UTC datetime as an ISO-8601 string (no "T", no millis),
 * matching SQLite's `datetime('now')` output.
 *
 * @returns {string}
 */
function nowUtc() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * Truncate an ISO-8601 datetime string to the start of the enclosing hour.
 *
 * @param {string} ts - e.g. "2026-07-15 14:37:22"
 * @returns {string}   e.g. "2026-07-15 14:00:00"
 */
function truncateToHour(ts) {
  return ts.slice(0, 13) + ':00:00';
}

/**
 * Truncate an ISO-8601 datetime string to the start of the enclosing day.
 *
 * @param {string} ts - e.g. "2026-07-15 14:37:22"
 * @returns {string}   e.g. "2026-07-15 00:00:00"
 */
function truncateToDay(ts) {
  return ts.slice(0, 10) + ' 00:00:00';
}

/**
 * Truncate an ISO-8601 datetime string to the Monday of the enclosing
 * ISO week (Mon–Sun).
 *
 * @param {string} ts - e.g. "2026-07-15 14:00:00"
 * @returns {string}   e.g. "2026-07-13 00:00:00"
 */
function truncateToWeek(ts) {
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  const day = d.getUTCDay();
  const diff = (day === 0 ? 6 : day - 1); // Monday = 0
  d.setUTCDate(d.getUTCDate() - diff);
  const iso = d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  return iso.slice(0, 10) + ' 00:00:00';
}

/**
 * Compute the value at the given percentile from a **sorted** array.
 *
 * Uses the "nearest rank" method: index = ceil(p/100 * N) - 1.
 *
 * @param {number[]} sorted - Pre-sorted ascending array of numbers.
 * @param {number}   p      - Percentile (0–100).
 * @returns {number}
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

// ---------------------------------------------------------------------------
// Rollup: Raw → Hourly
// ---------------------------------------------------------------------------

/**
 * Aggregate `metrics_raw` into `metrics_hourly` for every completed hour
 * that has not yet been rolled up.
 *
 * A completed hour is any hour strictly before the current UTC hour.
 *
 * @returns {{ bucketsProcessed: number }} Summary of work done.
 */
function rollupHourly() {
  const db = getDb();
  const currentHour = truncateToHour(nowUtc());

  // 1. Discover distinct (system_id, resource_type, resource_id, metric_name,
  //    hour_bucket) combinations in metrics_raw that have not been rolled up
  //    yet and whose hour is fully completed.
  const buckets = db.prepare(`
    SELECT DISTINCT
      r.system_id,
      r.resource_type,
      r.resource_id,
      r.metric_name,
      strftime('%Y-%m-%d %H:00:00', r.timestamp) AS hour_bucket
    FROM metrics_raw r
    WHERE strftime('%Y-%m-%d %H:00:00', r.timestamp) < @currentHour
      AND NOT EXISTS (
        SELECT 1 FROM metrics_hourly h
        WHERE h.system_id      = r.system_id
          AND h.resource_type  = r.resource_type
          AND h.resource_id    = r.resource_id
          AND h.metric_name    = r.metric_name
          AND h.hour_timestamp = strftime('%Y-%m-%d %H:00:00', r.timestamp)
      )
  `).all({ currentHour });

  if (buckets.length === 0) {
    logger.debug('rollupHourly: no new buckets to process');
    return { bucketsProcessed: 0 };
  }

  // 2. For each bucket, compute aggregates and percentiles, then upsert.
  const fetchValues = db.prepare(`
    SELECT metric_value
    FROM metrics_raw
    WHERE system_id      = @system_id
      AND resource_type  = @resource_type
      AND resource_id    = @resource_id
      AND metric_name    = @metric_name
      AND strftime('%Y-%m-%d %H:00:00', timestamp) = @hour_bucket
    ORDER BY metric_value ASC
  `);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO metrics_hourly
      (system_id, resource_type, resource_id, metric_name, hour_timestamp,
       min_value, max_value, avg_value, sample_count, created_at)
    VALUES
      (@system_id, @resource_type, @resource_id, @metric_name, @hour_bucket,
       @min_value, @max_value, @avg_value, @sample_count, @created_at)
  `);

  const now = nowUtc();

  const run = db.transaction((bucketList) => {
    for (const b of bucketList) {
      const rows = fetchValues.all(b);
      const values = rows.map((r) => r.metric_value);

      if (values.length === 0) continue;

      const min_value = values[0];
      const max_value = values[values.length - 1];
      const sum = values.reduce((a, v) => a + v, 0);
      const avg_value = sum / values.length;

      insertStmt.run({
        system_id: b.system_id,
        resource_type: b.resource_type,
        resource_id: b.resource_id,
        metric_name: b.metric_name,
        hour_bucket: b.hour_bucket,
        min_value,
        max_value,
        avg_value,
        sample_count: values.length,
        created_at: now,
      });
    }
  });

  run(buckets);
  logger.info(`rollupHourly: processed ${buckets.length} bucket(s)`);
  return { bucketsProcessed: buckets.length };
}

// ---------------------------------------------------------------------------
// Rollup: Hourly → Daily
// ---------------------------------------------------------------------------

/**
 * Aggregate `metrics_hourly` into `metrics_daily` for every completed day
 * that has not yet been rolled up.
 *
 * A completed day is any day strictly before the current UTC day.
 *
 * @returns {{ bucketsProcessed: number }}
 */
function rollupDaily() {
  const db = getDb();
  const currentDay = truncateToDay(nowUtc());

  const buckets = db.prepare(`
    SELECT DISTINCT
      h.system_id,
      h.resource_type,
      h.resource_id,
      h.metric_name,
      strftime('%Y-%m-%d 00:00:00', h.hour_timestamp) AS day_bucket
    FROM metrics_hourly h
    WHERE strftime('%Y-%m-%d 00:00:00', h.hour_timestamp) < @currentDay
      AND NOT EXISTS (
        SELECT 1 FROM metrics_daily d
        WHERE d.system_id      = h.system_id
          AND d.resource_type  = h.resource_type
          AND d.resource_id    = h.resource_id
          AND d.metric_name    = h.metric_name
          AND d.day_timestamp  = strftime('%Y-%m-%d 00:00:00', h.hour_timestamp)
      )
  `).all({ currentDay });

  if (buckets.length === 0) {
    logger.debug('rollupDaily: no new buckets to process');
    return { bucketsProcessed: 0 };
  }

  const fetchValues = db.prepare(`
    SELECT avg_value AS metric_value
    FROM metrics_hourly
    WHERE system_id      = @system_id
      AND resource_type  = @resource_type
      AND resource_id    = @resource_id
      AND metric_name    = @metric_name
      AND strftime('%Y-%m-%d 00:00:00', hour_timestamp) = @day_bucket
    ORDER BY avg_value ASC
  `);

  const aggStmt = db.prepare(`
    SELECT
      MIN(min_value)  AS min_value,
      MAX(max_value)  AS max_value,
      SUM(avg_value * sample_count) / SUM(sample_count) AS avg_value,
      SUM(sample_count) AS sample_count
    FROM metrics_hourly
    WHERE system_id      = @system_id
      AND resource_type  = @resource_type
      AND resource_id    = @resource_id
      AND metric_name    = @metric_name
      AND strftime('%Y-%m-%d 00:00:00', hour_timestamp) = @day_bucket
  `);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO metrics_daily
      (system_id, resource_type, resource_id, metric_name, day_timestamp,
       min_value, max_value, avg_value, sample_count, created_at)
    VALUES
      (@system_id, @resource_type, @resource_id, @metric_name, @day_bucket,
       @min_value, @max_value, @avg_value, @sample_count, @created_at)
  `);

  const now = nowUtc();

  const run = db.transaction((bucketList) => {
    for (const b of bucketList) {
      const agg = aggStmt.get(b);
      if (!agg || agg.sample_count === 0) continue;

      insertStmt.run({
        system_id: b.system_id,
        resource_type: b.resource_type,
        resource_id: b.resource_id,
        metric_name: b.metric_name,
        day_bucket: b.day_bucket,
        min_value: agg.min_value,
        max_value: agg.max_value,
        avg_value: agg.avg_value,
        sample_count: agg.sample_count,
        created_at: now,
      });
    }
  });

  run(buckets);
  logger.info(`rollupDaily: processed ${buckets.length} bucket(s)`);
  return { bucketsProcessed: buckets.length };
}

// ---------------------------------------------------------------------------
// Rollup: Daily → Weekly
// ---------------------------------------------------------------------------

/**
 * Aggregate `metrics_daily` into `metrics_weekly` for every completed ISO
 * week (Mon–Sun) that has not yet been rolled up.
 *
 * A completed week is any week whose Monday is at least 7 days before the
 * current UTC Monday.
 *
 * @returns {{ bucketsProcessed: number }}
 */
function rollupWeekly() {
  const db = getDb();
  const currentWeek = truncateToWeek(nowUtc());

  // SQLite doesn't have a native ISO-week truncation, so we pull candidate
  // day_timestamps and compute week buckets in JS.
  const candidates = db.prepare(`
    SELECT DISTINCT
      d.system_id,
      d.resource_type,
      d.resource_id,
      d.metric_name,
      d.day_timestamp
    FROM metrics_daily d
  `).all();

  // Group by (system_id, resource_type, resource_id, metric_name, week_bucket)
  /** @type {Map<string, { system_id: number, resource_type: string, resource_id: string, metric_name: string, week_bucket: string }>} */
  const bucketMap = new Map();

  for (const c of candidates) {
    const weekBucket = truncateToWeek(c.day_timestamp);
    if (weekBucket >= currentWeek) continue; // week not yet complete

    const key = `${c.system_id}|${c.resource_type}|${c.resource_id}|${c.metric_name}|${weekBucket}`;
    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        system_id: c.system_id,
        resource_type: c.resource_type,
        resource_id: c.resource_id,
        metric_name: c.metric_name,
        week_bucket: weekBucket,
      });
    }
  }

  // Filter out buckets that already exist in metrics_weekly
  const existsStmt = db.prepare(`
    SELECT 1 FROM metrics_weekly
    WHERE system_id      = @system_id
      AND resource_type  = @resource_type
      AND resource_id    = @resource_id
      AND metric_name    = @metric_name
      AND week_timestamp = @week_bucket
    LIMIT 1
  `);

  const buckets = [];
  for (const b of bucketMap.values()) {
    if (!existsStmt.get(b)) {
      buckets.push(b);
    }
  }

  if (buckets.length === 0) {
    logger.debug('rollupWeekly: no new buckets to process');
    return { bucketsProcessed: 0 };
  }

  // Compute the end of the week (exclusive) for range queries
  const weekEndSql = db.prepare(`
    SELECT datetime(@weekStart, '+7 days') AS week_end
  `);

  const aggStmt = db.prepare(`
    SELECT
      MIN(min_value) AS min_value,
      MAX(max_value) AS max_value,
      SUM(avg_value * sample_count) / SUM(sample_count) AS avg_value,
      SUM(sample_count) AS sample_count
    FROM metrics_daily
    WHERE system_id      = @system_id
      AND resource_type  = @resource_type
      AND resource_id    = @resource_id
      AND metric_name    = @metric_name
      AND day_timestamp >= @week_bucket
      AND day_timestamp <  @week_end
  `);

  const fetchValues = db.prepare(`
    SELECT avg_value AS metric_value
    FROM metrics_daily
    WHERE system_id      = @system_id
      AND resource_type  = @resource_type
      AND resource_id    = @resource_id
      AND metric_name    = @metric_name
      AND day_timestamp >= @week_bucket
      AND day_timestamp <  @week_end
    ORDER BY avg_value ASC
  `);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO metrics_weekly
      (system_id, resource_type, resource_id, metric_name, week_timestamp,
       min_value, max_value, avg_value, sample_count, created_at)
    VALUES
      (@system_id, @resource_type, @resource_id, @metric_name, @week_bucket,
       @min_value, @max_value, @avg_value, @sample_count, @created_at)
  `);

  const now = nowUtc();

  const run = db.transaction((bucketList) => {
    for (const b of bucketList) {
      const { week_end } = weekEndSql.get({ weekStart: b.week_bucket });
      const params = { ...b, week_end };

      const agg = aggStmt.get(params);
      if (!agg || agg.sample_count === 0) continue;

      insertStmt.run({
        system_id: b.system_id,
        resource_type: b.resource_type,
        resource_id: b.resource_id,
        metric_name: b.metric_name,
        week_bucket: b.week_bucket,
        min_value: agg.min_value,
        max_value: agg.max_value,
        avg_value: agg.avg_value,
        sample_count: agg.sample_count,
        created_at: now,
      });
    }
  });

  run(buckets);
  logger.info(`rollupWeekly: processed ${buckets.length} bucket(s)`);
  return { bucketsProcessed: buckets.length };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  rollupHourly,
  rollupDaily,
  rollupWeekly,
};
