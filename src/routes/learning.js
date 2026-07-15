'use strict';

/**
 * @module routes/learning
 * @description Express router for the knowledge-base auto-learner subsystem.
 *
 * Endpoints:
 *   GET  /status    – Current auto-learner status.
 *   POST /update    – Trigger an immediate learning cycle.
 *   GET  /changelog – Recent KB changes from the learning log.
 *   GET  /versions  – Known software versions from the KB.
 */

const { Router } = require('express');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');

const router = Router();

/**
 * Return the current UTC datetime as an ISO-8601 string (no "T" separator).
 *
 * @returns {string}
 */
function nowUtc() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

// ---------------------------------------------------------------------------
// GET /status – Auto-learner status
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/learning/status
 * @desc    Return the auto-learner's current status including when it last ran
 *          and how many records have been learned.
 * @returns {{ data: Object }}
 */
router.get('/status', (req, res, next) => {
  try {
    const db = getDb();

    const totalRecords = db.prepare(
      'SELECT COUNT(*) AS cnt FROM kb_learning_log',
    ).get().cnt;

    const lastRun = db.prepare(
      'SELECT MAX(created_at) AS last_run FROM kb_learning_log',
    ).get().last_run;

    const recentCount = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM kb_learning_log
      WHERE created_at >= datetime('now', '-24 hours')
    `).get().cnt;

    const softwareVersions = db.prepare(
      'SELECT COUNT(*) AS cnt FROM kb_software_versions',
    ).get().cnt;

    const advisoryCount = db.prepare(
      'SELECT COUNT(*) AS cnt FROM kb_security_advisories',
    ).get().cnt;

    const firmwareEntries = db.prepare(
      'SELECT COUNT(*) AS cnt FROM kb_firmware_matrix',
    ).get().cnt;

    res.json({
      data: {
        last_run: lastRun,
        total_records_learned: totalRecords,
        records_last_24h: recentCount,
        knowledge_base: {
          software_versions: softwareVersions,
          security_advisories: advisoryCount,
          firmware_matrix_entries: firmwareEntries,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /update – Trigger immediate learning cycle
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/learning/update
 * @desc    Trigger an immediate knowledge-base learning cycle.  This is a
 *          stub that logs the request and returns a run token.  The actual
 *          learning engine is implemented elsewhere and scheduled via cron.
 * @returns {{ data: { status: string, started_at: string } }}
 */
router.post('/update', (req, res, next) => {
  try {
    const db = getDb();
    const now = nowUtc();

    // Insert a learning-log entry to mark the start of a manual cycle
    db.prepare(`
      INSERT INTO kb_learning_log
        (event_type, context, learned_pattern, confidence_score, created_at, updated_at)
      VALUES
        ('manual_trigger', 'API request', 'Learning cycle initiated', 0, @now, @now)
    `).run({ now });

    logger.info('[learning] Manual learning cycle triggered via API');

    res.status(202).json({
      data: {
        status: 'initiated',
        started_at: now,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /changelog – Recent KB changes
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/learning/changelog
 * @desc    Return recent knowledge-base changes from the learning log.
 * @query   {number} [limit=50] – Max entries to return (capped at 500).
 * @returns {{ data: Object[], count: number }}
 */
router.get('/changelog', (req, res, next) => {
  try {
    const db = getDb();
    const limit = Math.min(Number(req.query.limit) || 50, 500);

    const data = db.prepare(`
      SELECT ll.*,
             s.name AS system_name
      FROM kb_learning_log ll
      LEFT JOIN systems s ON s.id = ll.system_id
      ORDER BY ll.created_at DESC
      LIMIT @limit
    `).all({ limit });

    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /versions – Known software versions
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/learning/versions
 * @desc    Return all known software versions from the knowledge base.
 * @query   {string} [platform] – Filter by platform (ontap|storagegrid|eseries).
 * @returns {{ data: Object[], count: number }}
 */
router.get('/versions', (req, res, next) => {
  try {
    const db = getDb();
    const conditions = [];
    const params = {};

    if (req.query.platform) {
      conditions.push('platform = @platform');
      params.platform = req.query.platform;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT *
      FROM kb_software_versions
      ${where}
      ORDER BY platform, release_date DESC
    `;

    const data = db.prepare(sql).all(params);
    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
