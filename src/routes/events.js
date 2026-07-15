'use strict';

/**
 * @module routes/events
 * @description Express router for a unified event log.
 *
 * Merges events from three platform-specific tables via a UNION query:
 *   - `ontap_ems_events`  (ONTAP EMS messages)
 *   - `sg_alerts`         (StorageGRID alerts)
 *   - `es_mel_events`     (E-Series Major Event Log)
 *
 * Endpoint:
 *   GET / – Unified event timeline with filters.
 */

const { Router } = require('express');
const { getDb } = require('../db/database');

const router = Router();

// ---------------------------------------------------------------------------
// GET / – Unified event log
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/events
 * @desc    Return a unified, chronologically-sorted event log across all
 *          platforms.
 * @query   {number} [system_id]  – Restrict to a single system.
 * @query   {string} [severity]   – Filter by severity level.
 * @query   {string} [start_time] – ISO-8601 lower bound (inclusive).
 * @query   {string} [end_time]   – ISO-8601 upper bound (inclusive).
 * @query   {number} [limit=100]  – Max rows to return (capped at 1000).
 * @returns {{ data: Object[], count: number }}
 */
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const limit = Math.min(Number(req.query.limit) || 100, 1000);

    // ----- Build per-table WHERE fragments -----
    const ontapConditions = [];
    const sgConditions = [];
    const esConditions = [];
    const params = { limit };

    if (req.query.system_id) {
      const systemId = Number(req.query.system_id);
      ontapConditions.push('e.system_id = @system_id');
      sgConditions.push('a.system_id = @system_id');
      esConditions.push('m.system_id = @system_id');
      params.system_id = systemId;
    }

    if (req.query.severity) {
      ontapConditions.push('e.severity = @severity');
      sgConditions.push('a.severity = @severity');
      esConditions.push('m.priority = @severity');
      params.severity = req.query.severity;
    }

    if (req.query.start_time) {
      ontapConditions.push('e.time >= @start_time');
      sgConditions.push('a.triggered_at >= @start_time');
      esConditions.push('m.time_stamp >= @start_time');
      params.start_time = req.query.start_time;
    }

    if (req.query.end_time) {
      ontapConditions.push('e.time <= @end_time');
      sgConditions.push('a.triggered_at <= @end_time');
      esConditions.push('m.time_stamp <= @end_time');
      params.end_time = req.query.end_time;
    }

    const ontapWhere = ontapConditions.length
      ? `WHERE ${ontapConditions.join(' AND ')}`
      : '';
    const sgWhere = sgConditions.length
      ? `WHERE ${sgConditions.join(' AND ')}`
      : '';
    const esWhere = esConditions.length
      ? `WHERE ${esConditions.join(' AND ')}`
      : '';

    const sql = `
      SELECT
        'ems' AS source,
        e.id,
        e.system_id,
        s.name AS system_name,
        e.severity,
        e.message_name AS title,
        e.message_text AS description,
        e.node AS component,
        e.time AS event_time
      FROM ontap_ems_events e
      JOIN systems s ON s.id = e.system_id
      ${ontapWhere}

      UNION ALL

      SELECT
        'alert' AS source,
        a.id,
        a.system_id,
        s.name AS system_name,
        a.severity,
        a.rule_name AS title,
        a.message AS description,
        a.node_id AS component,
        a.triggered_at AS event_time
      FROM sg_alerts a
      JOIN systems s ON s.id = a.system_id
      ${sgWhere}

      UNION ALL

      SELECT
        'mel' AS source,
        m.id,
        m.system_id,
        s.name AS system_name,
        m.priority AS severity,
        m.event_type AS title,
        m.description,
        m.component_type AS component,
        m.time_stamp AS event_time
      FROM es_mel_events m
      JOIN systems s ON s.id = m.system_id
      ${esWhere}

      ORDER BY event_time DESC
      LIMIT @limit
    `;

    const data = db.prepare(sql).all(params);
    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
