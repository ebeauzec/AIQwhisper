'use strict';

/**
 * @module routes/capacity
 * @description Express router for capacity planning and trending endpoints.
 *
 * Endpoints:
 *   GET /projections – All capacity projections.
 *   GET /runway      – Resources sorted by days-to-full.
 *   GET /growth      – Growth-rate trending per resource.
 *   GET /efficiency  – Storage efficiency ratios.
 */

const { Router } = require('express');
const { getDb } = require('../db/database');

const router = Router();

// ---------------------------------------------------------------------------
// GET /projections – All capacity projections
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/capacity/projections
 * @desc    Return all capacity projections.  Filterable by ?system_id.
 * @query   {number} [system_id] – Restrict to a single system.
 * @returns {{ data: Object[], count: number }}
 */
router.get('/projections', (req, res, next) => {
  try {
    const db = getDb();
    const conditions = [];
    const params = {};

    if (req.query.system_id) {
      conditions.push('cp.system_id = @system_id');
      params.system_id = Number(req.query.system_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT cp.*,
             s.name AS system_name,
             s.type AS system_type
      FROM capacity_projections cp
      JOIN systems s ON s.id = cp.system_id
      ${where}
      ORDER BY cp.days_until_full ASC
    `;

    const data = db.prepare(sql).all(params);
    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /runway – Resources sorted by days-to-full
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/capacity/runway
 * @desc    Return resources approaching a utilisation threshold, sorted by
 *          days-until-full ascending (worst first).
 * @query   {number} [threshold=90] – Utilisation-percentage trigger.
 * @returns {{ data: Object[], count: number }}
 */
router.get('/runway', (req, res, next) => {
  try {
    const db = getDb();
    const threshold = Number(req.query.threshold) || 90;

    const data = db.prepare(`
      SELECT cp.*,
             s.name AS system_name,
             s.type AS system_type,
             cs.utilization_pct AS current_utilization
      FROM capacity_projections cp
      JOIN systems s ON s.id = cp.system_id
      LEFT JOIN capacity_snapshots cs
        ON  cs.system_id     = cp.system_id
        AND cs.resource_type = cp.resource_type
        AND cs.resource_id   = cp.resource_id
        AND cs.id = (
          SELECT MAX(cs2.id) FROM capacity_snapshots cs2
          WHERE cs2.system_id     = cp.system_id
            AND cs2.resource_type = cp.resource_type
            AND cs2.resource_id   = cp.resource_id
        )
      WHERE cp.days_until_full IS NOT NULL
        AND (cs.utilization_pct >= @threshold OR cp.days_until_full <= 90)
      ORDER BY cp.days_until_full ASC
    `).all({ threshold });

    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /growth – Growth rate trending
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/capacity/growth
 * @desc    Return growth-rate data per resource, computed from capacity
 *          projections.
 * @query   {number} [system_id] – Restrict to a single system.
 * @returns {{ data: Object[], count: number }}
 */
router.get('/growth', (req, res, next) => {
  try {
    const db = getDb();
    const conditions = [];
    const params = {};

    if (req.query.system_id) {
      conditions.push('cp.system_id = @system_id');
      params.system_id = Number(req.query.system_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT cp.system_id,
             s.name AS system_name,
             s.type AS system_type,
             cp.resource_type,
             cp.resource_id,
             cp.resource_name,
             cp.current_used_bytes,
             cp.growth_rate_bytes_per_day,
             cp.projected_full_date,
             cp.confidence_pct,
             cp.days_until_full,
             cp.analysis_timestamp
      FROM capacity_projections cp
      JOIN systems s ON s.id = cp.system_id
      ${where}
      ORDER BY ABS(cp.growth_rate_bytes_per_day) DESC
    `;

    const data = db.prepare(sql).all(params);
    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /efficiency – Storage efficiency ratios
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/capacity/efficiency
 * @desc    Return storage-efficiency ratios per system, derived from the
 *          latest capacity snapshots (total vs used, aggregated per system).
 * @query   {number} [system_id] – Restrict to a single system.
 * @returns {{ data: Object[], count: number }}
 */
router.get('/efficiency', (req, res, next) => {
  try {
    const db = getDb();
    const conditions = [];
    const params = {};

    if (req.query.system_id) {
      conditions.push('cs.system_id = @system_id');
      params.system_id = Number(req.query.system_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT cs.system_id,
             s.name AS system_name,
             s.type AS system_type,
             cs.resource_type,
             COUNT(DISTINCT cs.resource_id) AS resource_count,
             SUM(cs.total_bytes)            AS total_bytes,
             SUM(cs.used_bytes)             AS used_bytes,
             SUM(cs.available_bytes)        AS available_bytes,
             ROUND(
               CASE WHEN SUM(cs.total_bytes) > 0
                 THEN CAST(SUM(cs.used_bytes) AS REAL) / SUM(cs.total_bytes) * 100
                 ELSE 0
               END,
               2
             ) AS utilization_pct,
             ROUND(
               CASE WHEN SUM(cs.used_bytes) > 0
                 THEN CAST(SUM(cs.total_bytes) AS REAL) / SUM(cs.used_bytes)
                 ELSE 0
               END,
               2
             ) AS efficiency_ratio
      FROM capacity_snapshots cs
      JOIN systems s ON s.id = cs.system_id
      ${where}
      GROUP BY cs.system_id, cs.resource_type
      ORDER BY utilization_pct DESC
    `;

    const data = db.prepare(sql).all(params);
    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
