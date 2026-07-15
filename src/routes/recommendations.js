'use strict';

/**
 * @module routes/recommendations
 * @description Express router for remediation recommendations.
 *
 * Endpoints:
 *   GET /    – All recommendations with filters.
 *   GET /:id – Single recommendation with full remediation detail.
 */

const { Router } = require('express');
const { getDb } = require('../db/database');

const router = Router();

// ---------------------------------------------------------------------------
// GET / – List recommendations
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/recommendations
 * @desc    Return all recommendations, optionally filtered.
 * @query   {string}  [status]    – Filter by status (pending|accepted|rejected|applied|failed).
 * @query   {number}  [priority]  – Filter by priority (1–5).
 * @query   {string}  [effort]    – Filter by effort (low|medium|high).
 * @query   {number}  [issue_id]  – Filter by parent issue.
 * @returns {{ data: Object[], count: number }}
 */
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const conditions = [];
    const params = {};

    if (req.query.status) {
      conditions.push('r.status = @status');
      params.status = req.query.status;
    }
    if (req.query.priority) {
      conditions.push('r.priority = @priority');
      params.priority = Number(req.query.priority);
    }
    if (req.query.effort) {
      conditions.push('r.effort = @effort');
      params.effort = req.query.effort;
    }
    if (req.query.issue_id) {
      conditions.push('r.issue_id = @issue_id');
      params.issue_id = Number(req.query.issue_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT r.*,
             i.title AS issue_title,
             i.severity AS issue_severity,
             i.system_id,
             s.name AS system_name,
             s.type AS system_type
      FROM recommendations r
      JOIN issues i ON i.id = r.issue_id
      JOIN systems s ON s.id = i.system_id
      ${where}
      ORDER BY r.priority ASC, r.created_at DESC
    `;

    const data = db.prepare(sql).all(params);
    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /:id – Recommendation detail
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/recommendations/:id
 * @desc    Return a single recommendation with remediation steps, CLI commands,
 *          and the parent issue context.
 * @param   {string} id – Recommendation primary key.
 * @returns {{ data: Object }}
 */
router.get('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);

    const rec = db.prepare(`
      SELECT r.*,
             i.title AS issue_title,
             i.severity AS issue_severity,
             i.description AS issue_description,
             i.resource_type,
             i.resource_id,
             i.system_id,
             s.name AS system_name,
             s.type AS system_type,
             s.hostname AS system_hostname
      FROM recommendations r
      JOIN issues i ON i.id = r.issue_id
      JOIN systems s ON s.id = i.system_id
      WHERE r.id = @id
    `).get({ id });

    if (!rec) {
      return res.status(404).json({ error: 'Recommendation not found.' });
    }

    // Look up the originating best-practice rule for richer remediation
    let rule = null;
    const issue = db.prepare('SELECT rule_id FROM issues WHERE id = @id').get({ id: rec.issue_id });
    if (issue && issue.rule_id) {
      rule = db.prepare('SELECT * FROM best_practice_rules WHERE id = @ruleId').get({ ruleId: issue.rule_id });
    }

    res.json({
      data: {
        ...rec,
        remediation_steps: rec.description || null,
        cli_command: rec.fix_command || null,
        best_practice_rule: rule || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
