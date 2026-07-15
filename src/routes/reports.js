'use strict';

/**
 * @module routes/reports
 * @description Express router for on-demand report generation and retrieval.
 *
 * Endpoints:
 *   POST /generate – Generate a new report.
 *   GET  /         – List all generated reports.
 *   GET  /:id      – Retrieve a single report.
 */

const { Router } = require('express');
const { getDb } = require('../db/database');
const models = require('../db/models');
const logger = require('../utils/logger');

const router = Router();

/** @constant {Set<string>} VALID_REPORT_TYPES Allowed report types. */
const VALID_REPORT_TYPES = new Set([
  'executive',
  'capacity',
  'firmware',
  'issues',
  'security',
]);

/**
 * Return the current UTC datetime as an ISO-8601 string (no "T" separator).
 *
 * @returns {string}
 */
function nowUtc() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

// ---------------------------------------------------------------------------
// POST /generate – Generate report
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/reports/generate
 * @desc    Generate a new report.  The report is built synchronously from the
 *          current database state and stored for later retrieval.
 * @body    {Object} body
 * @body    {string} body.type      – "executive" | "capacity" | "firmware" | "issues" | "security"
 * @body    {number} [body.system_id] – Optional system scope.
 * @returns {{ data: { id: number, status: string } }}
 */
router.post('/generate', (req, res, next) => {
  try {
    const db = getDb();
    const { type, system_id } = req.body;

    if (!type || !VALID_REPORT_TYPES.has(type)) {
      return res.status(400).json({
        error: `Invalid or missing type. Must be one of: ${[...VALID_REPORT_TYPES].join(', ')}`,
      });
    }

    // Validate system_id if provided
    if (system_id !== undefined) {
      const system = models.systems.getById(Number(system_id));
      if (!system) {
        return res.status(404).json({ error: 'System not found.' });
      }
    }

    const now = nowUtc();

    // Map the request type to the schema's allowed report types
    const typeMap = {
      executive: 'health',
      capacity: 'capacity',
      firmware: 'inventory',
      issues: 'security',
      security: 'security',
    };

    const reportName = `${type}_report_${now.replace(/[: ]/g, '_')}`;
    const info = db.prepare(`
      INSERT INTO reports (name, type, parameters_json, generated_at, format, status, created_at)
      VALUES (@name, @reportType, @params, @now, 'json', 'pending', @now)
    `).run({
      name: reportName,
      reportType: typeMap[type] || 'custom',
      params: JSON.stringify({ type, system_id: system_id || null }),
      now,
    });

    const reportId = Number(info.lastInsertRowid);

    // Build report data synchronously
    try {
      const reportData = buildReportData(db, type, system_id ? Number(system_id) : null);

      db.prepare(`
        UPDATE reports
        SET status = 'completed',
            file_path = @filePath,
            file_size_bytes = @fileSize
        WHERE id = @id
      `).run({
        id: reportId,
        filePath: JSON.stringify(reportData),
        fileSize: JSON.stringify(reportData).length,
      });

      res.status(201).json({ data: { id: reportId, status: 'completed' } });
    } catch (genErr) {
      db.prepare(`
        UPDATE reports SET status = 'failed' WHERE id = @id
      `).run({ id: reportId });
      logger.error(`[reports] Report generation failed: ${genErr.message}`);
      res.status(201).json({ data: { id: reportId, status: 'failed' } });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * Build the JSON payload for a report.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} type
 * @param {number|null} systemId
 * @returns {Object}
 */
function buildReportData(db, type, systemId) {
  const sysFilter = systemId ? 'WHERE system_id = @systemId' : '';
  const params = systemId ? { systemId } : {};

  switch (type) {
    case 'executive': {
      const summary = models.dashboard.getSummary();
      const health = db.prepare(`
        SELECT hs.*, s.name AS system_name
        FROM health_scores hs
        JOIN systems s ON s.id = hs.system_id
        WHERE hs.id IN (SELECT MAX(id) FROM health_scores GROUP BY system_id)
        ORDER BY hs.overall_score ASC
      `).all();
      const issues = models.issues.getAll(systemId ? { system_id: systemId } : {});
      return { summary, health, issues: issues.slice(0, 50), generated: nowUtc() };
    }

    case 'capacity': {
      const projections = db.prepare(
        `SELECT * FROM capacity_projections ${sysFilter} ORDER BY days_until_full ASC`,
      ).all(params);
      const snapshots = db.prepare(
        `SELECT * FROM capacity_snapshots ${sysFilter} ORDER BY snapshot_timestamp DESC LIMIT 100`,
      ).all(params);
      return { projections, snapshots, generated: nowUtc() };
    }

    case 'firmware': {
      const software = db.prepare('SELECT * FROM kb_software_versions ORDER BY platform, version').all();
      const firmware = db.prepare('SELECT * FROM kb_firmware_matrix ORDER BY platform, component_type').all();
      const ontapSoftware = db.prepare(
        `SELECT * FROM ontap_software ${sysFilter} ORDER BY version`,
      ).all(params);
      return { software, firmware, ontapSoftware, generated: nowUtc() };
    }

    case 'issues': {
      const allIssues = models.issues.getAll(systemId ? { system_id: systemId } : {});
      const recs = db.prepare(`
        SELECT r.*, i.title AS issue_title, i.severity
        FROM recommendations r
        JOIN issues i ON i.id = r.issue_id
        ORDER BY r.priority ASC
      `).all();
      return { issues: allIssues, recommendations: recs, generated: nowUtc() };
    }

    case 'security': {
      const advisories = db.prepare('SELECT * FROM kb_security_advisories ORDER BY severity, published_at DESC').all();
      const ontapSecurity = db.prepare(
        `SELECT os.*, s.name AS system_name FROM ontap_security os JOIN systems s ON s.id = os.system_id ${systemId ? 'WHERE os.system_id = @systemId' : ''}`,
      ).all(params);
      return { advisories, security: ontapSecurity, generated: nowUtc() };
    }

    default:
      return { message: 'Unknown report type', generated: nowUtc() };
  }
}

// ---------------------------------------------------------------------------
// GET / – List generated reports
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/reports
 * @desc    Return all generated reports (metadata only, not full payloads).
 * @returns {{ data: Object[], count: number }}
 */
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const data = db.prepare(`
      SELECT id, name, type, parameters_json, generated_at, format,
             file_size_bytes, created_by, status, created_at
      FROM reports
      ORDER BY generated_at DESC
    `).all();
    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /:id – Get report detail
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/reports/:id
 * @desc    Return a single report including its full generated data.
 * @param   {string} id – Report primary key.
 * @returns {{ data: Object }}
 */
router.get('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);

    const report = db.prepare('SELECT * FROM reports WHERE id = @id').get({ id });
    if (!report) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    // Parse the stored JSON payload from file_path
    let reportData = null;
    if (report.file_path) {
      try {
        reportData = JSON.parse(report.file_path);
      } catch (_) {
        reportData = report.file_path;
      }
    }

    res.json({
      data: {
        id: report.id,
        name: report.name,
        type: report.type,
        parameters: report.parameters_json ? JSON.parse(report.parameters_json) : null,
        generated_at: report.generated_at,
        format: report.format,
        status: report.status,
        created_by: report.created_by,
        report: reportData,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id – Delete a report
// ---------------------------------------------------------------------------

/**
 * @route   DELETE /api/reports/:id
 * @desc    Delete a report by ID.
 * @param   {string} id – Report primary key.
 * @returns {void} 204 on success
 */
router.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);

    const report = db.prepare('SELECT id FROM reports WHERE id = @id').get({ id });
    if (!report) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    db.prepare('DELETE FROM reports WHERE id = @id').run({ id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
