'use strict';

/**
 * @module db/retention
 * @description Retention manager that purges expired data from time-series
 * and event tables according to the configured retention policy.
 *
 * Retention windows are read from `config.retention`:
 * - `rawDays`    — metrics_raw
 * - `hourlyDays` — metrics_hourly
 * - `dailyDays`  — metrics_daily, capacity_snapshots
 * - `weeklyDays` — metrics_weekly
 *
 * Additionally:
 * - `collection_runs` older than 30 days are purged.
 * - `capacity_snapshots` older than `dailyDays` are purged.
 */

const { getDb } = require('./database');
const config = require('../config');
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
 * Return a UTC datetime string offset by the given number of days in the
 * past relative to the current time.
 *
 * @param {number} days - Number of days to subtract.
 * @returns {string} ISO-8601 datetime string.
 */
function cutoffDate(days) {
  const ms = Date.now() - days * 86400 * 1000;
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

/**
 * Delete data older than the configured retention windows.
 *
 * Affected tables and their governing retention settings:
 *
 * | Table               | Retention setting            |
 * | ------------------- | ---------------------------- |
 * | metrics_raw         | `config.retention.rawDays`   |
 * | metrics_hourly      | `config.retention.hourlyDays`|
 * | metrics_daily       | `config.retention.dailyDays` |
 * | metrics_weekly      | `config.retention.weeklyDays`|
 * | collection_runs     | 30 days (hard-coded)         |
 * | capacity_snapshots  | `config.retention.dailyDays` |
 *
 * @returns {Object} Summary with `{ metricsRaw, metricsHourly, metricsDaily,
 *   metricsWeekly, collectionRuns, capacitySnapshots, totalDeleted }`.
 */
function purgeExpiredData() {
  const db = getDb();
  const retention = config.retention;

  const rawCutoff = cutoffDate(retention.rawDays);
  const hourlyCutoff = cutoffDate(retention.hourlyDays);
  const dailyCutoff = cutoffDate(retention.dailyDays);
  const weeklyCutoff = cutoffDate(retention.weeklyDays);
  const collectionRunsCutoff = cutoffDate(30);
  const capacityCutoff = cutoffDate(retention.dailyDays);

  // Prepare all DELETE statements up front
  const delRaw = db.prepare(`
    DELETE FROM metrics_raw WHERE timestamp < @cutoff
  `);

  const delHourly = db.prepare(`
    DELETE FROM metrics_hourly WHERE hour_timestamp < @cutoff
  `);

  const delDaily = db.prepare(`
    DELETE FROM metrics_daily WHERE day_timestamp < @cutoff
  `);

  const delWeekly = db.prepare(`
    DELETE FROM metrics_weekly WHERE week_timestamp < @cutoff
  `);

  const delRuns = db.prepare(`
    DELETE FROM collection_runs WHERE started_at < @cutoff
  `);

  const delCapacity = db.prepare(`
    DELETE FROM capacity_snapshots WHERE snapshot_timestamp < @cutoff
  `);

  // Execute everything in a single transaction for atomicity
  const summary = { metricsRaw: 0, metricsHourly: 0, metricsDaily: 0, metricsWeekly: 0, collectionRuns: 0, capacitySnapshots: 0, totalDeleted: 0 };

  const run = db.transaction(() => {
    summary.metricsRaw = delRaw.run({ cutoff: rawCutoff }).changes;
    summary.metricsHourly = delHourly.run({ cutoff: hourlyCutoff }).changes;
    summary.metricsDaily = delDaily.run({ cutoff: dailyCutoff }).changes;
    summary.metricsWeekly = delWeekly.run({ cutoff: weeklyCutoff }).changes;
    summary.collectionRuns = delRuns.run({ cutoff: collectionRunsCutoff }).changes;
    summary.capacitySnapshots = delCapacity.run({ cutoff: capacityCutoff }).changes;
  });

  run();

  summary.totalDeleted =
    summary.metricsRaw +
    summary.metricsHourly +
    summary.metricsDaily +
    summary.metricsWeekly +
    summary.collectionRuns +
    summary.capacitySnapshots;

  // Log per-table counts
  logger.info('retention: purge complete', {
    metricsRaw: summary.metricsRaw,
    metricsHourly: summary.metricsHourly,
    metricsDaily: summary.metricsDaily,
    metricsWeekly: summary.metricsWeekly,
    collectionRuns: summary.collectionRuns,
    capacitySnapshots: summary.capacitySnapshots,
    totalDeleted: summary.totalDeleted,
    cutoffs: {
      raw: rawCutoff,
      hourly: hourlyCutoff,
      daily: dailyCutoff,
      weekly: weeklyCutoff,
      collectionRuns: collectionRunsCutoff,
      capacitySnapshots: capacityCutoff,
    },
  });

  return summary;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  purgeExpiredData,
};
