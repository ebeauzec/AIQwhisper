'use strict';

/**
 * @module routes/dashboard
 * @description Express router for dashboard overview endpoints.
 *
 * Endpoints:
 *   GET /summary       – Aggregated system / issue / capacity summary.
 *   GET /health        – Per-system health scores.
 *   GET /capacity      – Capacity overview (worst resources).
 *   GET /issues        – Open issue counts by severity.
 *   GET /recent-events – Latest events across all systems.
 */

const { Router } = require('express');
const models = require('../db/models');
const { getDb } = require('../db/database');

const router = Router();

// ---------------------------------------------------------------------------
// GET /summary
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/dashboard/summary
 * @desc    Return an aggregated dashboard summary (systems, issues, capacity).
 * @returns {{ data: Object }}
 */
router.get('/summary', (req, res, next) => {
  try {
    const data = models.dashboard.getSummary();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/dashboard/health
 * @desc    Return the most recent health score for each system.
 * @returns {{ data: Object[] }}
 */
router.get('/health', (req, res, next) => {
  try {
    const db = getDb();
    const data = db.prepare(`
      SELECT hs.*,
             s.name AS system_name,
             s.type AS system_type,
             s.status AS system_status
      FROM health_scores hs
      JOIN systems s ON s.id = hs.system_id
      WHERE hs.id IN (
        SELECT MAX(id) FROM health_scores GROUP BY system_id
      )
      ORDER BY hs.overall_score ASC
    `).all();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /capacity
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/dashboard/capacity
 * @desc    Return resources closest to running out of capacity.
 * @query   {number} [limit=10] – Max rows to return.
 * @returns {{ data: Object[] }}
 */
router.get('/capacity', (req, res, next) => {
  try {
    const db = getDb();
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    const data = db.prepare(`
      SELECT cp.*,
             s.name AS system_name,
             s.type AS system_type
      FROM capacity_projections cp
      JOIN systems s ON s.id = cp.system_id
      ORDER BY cp.days_until_full ASC
      LIMIT @limit
    `).all({ limit });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /issues
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/dashboard/issues
 * @desc    Return open issue counts grouped by severity.
 * @returns {{ data: Object }}
 */
router.get('/issues', (req, res, next) => {
  try {
    const data = models.issues.getOpenCount();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /recent-events
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/dashboard/recent-events
 * @desc    Return the latest events across all systems.
 * @query   {number} [limit=20] – Max events to return.
 * @returns {{ data: Object[] }}
 */
router.get('/recent-events', (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 200);
    const data = models.dashboard.getRecentEvents(limit);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
