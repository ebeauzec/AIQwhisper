'use strict';

/**
 * @module routes/performance
 * @description Express router for per-system performance metrics.
 *
 * Endpoints:
 *   GET /:systemId/overview   – System-level aggregated metrics.
 *   GET /:systemId/resources  – List resource types with available metrics.
 *   GET /:systemId/timeseries – Time-series data with automatic tier selection.
 */

const { Router } = require('express');
const { getDb } = require('../db/database');
const models = require('../db/models');

const router = Router();

/** @constant {number} MS_PER_HOUR Milliseconds in one hour. */
const MS_PER_HOUR = 3_600_000;

/**
 * Auto-select the best metrics tier based on the requested time range.
 *
 * | Range           | Tier    |
 * |-----------------|---------|
 * | ≤ 6 hours       | raw     |
 * | ≤ 3 days        | hourly  |
 * | ≤ 30 days       | daily   |
 * | > 30 days       | weekly  |
 *
 * @param {string} start – ISO-8601 start timestamp.
 * @param {string} end   – ISO-8601 end timestamp.
 * @returns {'raw'|'hourly'|'daily'|'weekly'}
 */
function autoSelectTier(start, end) {
  const rangeMs = new Date(end).getTime() - new Date(start).getTime();
  const hours = rangeMs / MS_PER_HOUR;

  if (hours <= 6) return 'raw';
  if (hours <= 72) return 'hourly';
  if (hours <= 720) return 'daily';
  return 'weekly';
}

// ---------------------------------------------------------------------------
// GET /:systemId/overview – System-level aggregated metrics
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/performance/:systemId/overview
 * @desc    Return aggregated latest metrics for a system (most-recent raw sample
 *          per resource_type + metric_name).
 * @param   {string} systemId – System primary key.
 * @returns {{ data: Object[] }}
 */
router.get('/:systemId/overview', (req, res, next) => {
  try {
    const db = getDb();
    const systemId = Number(req.params.systemId);

    // Verify system exists
    const system = models.systems.getById(systemId);
    if (!system) {
      return res.status(404).json({ error: 'System not found.' });
    }

    const data = db.prepare(`
      SELECT resource_type,
             metric_name,
             unit,
             AVG(metric_value) AS avg_value,
             MIN(metric_value) AS min_value,
             MAX(metric_value) AS max_value,
             COUNT(*)          AS sample_count,
             MAX(timestamp)    AS latest_timestamp
      FROM metrics_raw
      WHERE system_id = @systemId
        AND timestamp >= datetime('now', '-1 hour')
      GROUP BY resource_type, metric_name
      ORDER BY resource_type, metric_name
    `).all({ systemId });

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /:systemId/resources – Available resource types & metrics
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/performance/:systemId/resources
 * @desc    List distinct resource types and their available metric names.
 * @param   {string} systemId – System primary key.
 * @returns {{ data: Object[] }}
 */
router.get('/:systemId/resources', (req, res, next) => {
  try {
    const db = getDb();
    const systemId = Number(req.params.systemId);

    const system = models.systems.getById(systemId);
    if (!system) {
      return res.status(404).json({ error: 'System not found.' });
    }

    const rows = db.prepare(`
      SELECT resource_type,
             resource_id,
             GROUP_CONCAT(DISTINCT metric_name) AS metric_names,
             COUNT(DISTINCT metric_name)        AS metric_count,
             MIN(timestamp)                     AS earliest,
             MAX(timestamp)                     AS latest
      FROM metrics_raw
      WHERE system_id = @systemId
      GROUP BY resource_type, resource_id
      ORDER BY resource_type, resource_id
    `).all({ systemId });

    // Transform into a nested structure grouped by resource_type
    /** @type {Record<string, Object[]>} */
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.resource_type]) {
        grouped[row.resource_type] = [];
      }
      grouped[row.resource_type].push({
        resource_id: row.resource_id,
        metric_names: row.metric_names ? row.metric_names.split(',') : [],
        metric_count: row.metric_count,
        earliest: row.earliest,
        latest: row.latest,
      });
    }

    const data = Object.entries(grouped).map(([type, resources]) => ({
      resource_type: type,
      resource_count: resources.length,
      resources,
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /:systemId/timeseries – Time-series data
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/performance/:systemId/timeseries
 * @desc    Return time-series metric data.  The metrics tier is auto-selected
 *          based on the time range unless explicitly provided.
 * @param   {string} systemId            – System primary key.
 * @query   {string} resource_type       – Resource type (e.g. "volume").
 * @query   {string} resource_id         – Specific resource identifier.
 * @query   {string} metric_name         – Metric to retrieve (e.g. "read_iops").
 * @query   {string} [start]             – ISO-8601 start (default: 1 hour ago).
 * @query   {string} [end]               – ISO-8601 end   (default: now).
 * @query   {string} [tier=auto]         – "raw" | "hourly" | "daily" | "weekly".
 * @returns {{ data: Object[], tier: string }}
 */
router.get('/:systemId/timeseries', (req, res, next) => {
  try {
    const systemId = Number(req.params.systemId);
    const { resource_type, resource_id, metric_name } = req.query;

    if (!resource_type || !resource_id || !metric_name) {
      return res.status(400).json({
        error: 'resource_type, resource_id, and metric_name are required.',
      });
    }

    const system = models.systems.getById(systemId);
    if (!system) {
      return res.status(404).json({ error: 'System not found.' });
    }

    const end = req.query.end || new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const start = req.query.start || new Date(Date.now() - MS_PER_HOUR).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    const tier = req.query.tier && req.query.tier !== 'auto'
      ? req.query.tier
      : autoSelectTier(start, end);

    const data = models.metrics.getTimeSeries(
      systemId,
      resource_type,
      resource_id,
      metric_name,
      start,
      end,
      tier,
    );

    res.json({ data, tier });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
