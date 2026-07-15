'use strict';

/**
 * @module routes/issues
 * @description Express router for issue management.
 *
 * Endpoints:
 *   GET    /                    – All issues with optional filters.
 *   GET    /:id                 – Single issue detail.
 *   PATCH  /:id/acknowledge     – Mark an issue as acknowledged.
 *   PATCH  /:id/resolve         – Mark an issue as resolved.
 */

const { Router } = require('express');
const models = require('../db/models');
const { getDb } = require('../db/database');

const router = Router();

// ---------------------------------------------------------------------------
// GET / – List issues with filters
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/issues
 * @desc    Return all issues, optionally filtered.
 * @query   {string}  [severity]  – Filter by severity (critical|high|medium|low|info).
 * @query   {string}  [category]  – Filter by category.
 * @query   {number}  [system_id] – Filter by system.
 * @query   {string}  [status]    – Filter by status (open|acknowledged|in_progress|resolved|dismissed).
 * @returns {{ data: Object[], count: number }}
 */
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const conditions = [];
    const params = {};

    if (req.query.severity) { conditions.push('i.severity = @severity'); params.severity = req.query.severity; }
    if (req.query.category) { conditions.push('i.category = @category'); params.category = req.query.category; }
    if (req.query.system_id) { conditions.push('i.system_id = @system_id'); params.system_id = Number(req.query.system_id); }
    if (req.query.status) { conditions.push('i.status = @status'); params.status = req.query.status; }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const data = db.prepare(`
      SELECT i.*, s.name AS system_name, s.type AS system_type
      FROM issues i
      JOIN systems s ON s.id = i.system_id
      ${where}
      ORDER BY i.detected_at DESC
    `).all(params);
    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /:id – Issue detail
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/issues/:id
 * @desc    Return a single issue with related system info.
 * @param   {string} id – Issue primary key.
 * @returns {{ data: Object }}
 */
router.get('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);

    const issue = db.prepare(`
      SELECT i.*, s.name AS system_name, s.type AS system_type
      FROM issues i
      JOIN systems s ON s.id = i.system_id
      WHERE i.id = @id
    `).get({ id });

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found.' });
    }

    // Attach related recommendations
    const recommendations = db.prepare(
      'SELECT * FROM recommendations WHERE issue_id = @id ORDER BY priority',
    ).all({ id });

    res.json({ data: { ...issue, recommendations } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id/acknowledge – Mark acknowledged
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/issues/:id/acknowledge
 * @desc    Set the issue status to "acknowledged".
 * @param   {string} id – Issue primary key.
 * @returns {{ data: { changes: number } }}
 */
router.patch('/:id/acknowledge', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const changes = models.issues.acknowledge(id);
    if (!changes) {
      return res.status(404).json({ error: 'Issue not found.' });
    }
    res.json({ data: { changes } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id/resolve – Mark resolved
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/issues/:id/resolve
 * @desc    Set the issue status to "resolved" and record a resolved_at timestamp.
 * @param   {string} id – Issue primary key.
 * @returns {{ data: { changes: number } }}
 */
router.patch('/:id/resolve', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const changes = models.issues.resolve(id);
    if (!changes) {
      return res.status(404).json({ error: 'Issue not found.' });
    }
    res.json({ data: { changes } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id/reopen – Reopen a resolved/dismissed issue
// ---------------------------------------------------------------------------

/**
 * @route   PATCH /api/issues/:id/reopen
 * @desc    Set the issue status back to "open" and clear resolved_at.
 * @param   {string} id – Issue primary key.
 * @returns {{ data: { changes: number } }}
 */
router.patch('/:id/reopen', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const result = db.prepare(`
      UPDATE issues SET status = 'open', resolved_at = NULL, updated_at = @now
      WHERE id = @id AND status IN ('resolved', 'dismissed')
    `).run({ id, now });
    if (!result.changes) {
      return res.status(404).json({ error: 'Issue not found or not in a reopenable state.' });
    }
    res.json({ data: { changes: result.changes } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
