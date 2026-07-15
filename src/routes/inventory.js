'use strict';

/**
 * @module routes/inventory
 * @description Express router for cross-platform inventory browsing.
 *
 * Every endpoint queries its respective table and supports an optional
 * `?system_id` filter.  Responses have the shape `{ data: [...], count: N }`.
 *
 * Endpoints:
 *   GET /clusters   – ONTAP clusters
 *   GET /nodes      – ONTAP nodes
 *   GET /aggregates – ONTAP aggregates (also ?system_id)
 *   GET /volumes    – ONTAP volumes (also ?system_id, ?svm_name)
 *   GET /disks      – ONTAP disks / E-Series drives
 *   GET /luns       – ONTAP LUNs
 *   GET /lifs       – ONTAP LIFs
 *   GET /svms       – ONTAP SVMs
 *   GET /grids      – StorageGRID grids
 *   GET /arrays     – E-Series arrays
 *   GET /buckets    – StorageGRID S3 buckets
 */

const { Router } = require('express');
const { getDb } = require('../db/database');

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a simple query with optional WHERE clauses from query-string params.
 *
 * @param {string}   table   – Table name to SELECT from.
 * @param {Object}   filters – Key → value map of column filters.
 * @param {string}   [orderBy='id'] – ORDER BY column.
 * @returns {{ sql: string, params: Record<string, *> }}
 */
function buildQuery(table, filters, orderBy = 'id') {
  const conditions = [];
  const params = {};

  for (const [col, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null && val !== '') {
      conditions.push(`${col} = @${col}`);
      params[col] = val;
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM ${table} ${where} ORDER BY ${orderBy}`;
  return { sql, params };
}

/**
 * Generic inventory handler factory.
 *
 * @param {string}   table       – Table name.
 * @param {Function} [filtersFn] – (req) => filter-map.  Defaults to system_id only.
 * @param {string}   [orderBy]   – ORDER BY column.
 * @returns {import('express').RequestHandler}
 */
function inventoryHandler(table, filtersFn, orderBy) {
  return (req, res, next) => {
    try {
      const db = getDb();
      const filters = filtersFn
        ? filtersFn(req)
        : { system_id: req.query.system_id ? Number(req.query.system_id) : undefined };
      const { sql, params } = buildQuery(table, filters, orderBy);
      const data = db.prepare(sql).all(params);
      res.json({ data, count: data.length });
    } catch (err) {
      next(err);
    }
  };
}

// ---------------------------------------------------------------------------
// ONTAP inventory
// ---------------------------------------------------------------------------

/**
 * @route GET /api/inventory/clusters
 * @desc  Return all ONTAP clusters.
 */
router.get('/clusters', inventoryHandler('ontap_clusters'));

/**
 * @route GET /api/inventory/nodes
 * @desc  Return all ONTAP nodes.
 */
router.get('/nodes', inventoryHandler('ontap_nodes'));

/**
 * @route GET /api/inventory/aggregates
 * @desc  Return all ONTAP aggregates.  Filterable by ?system_id.
 */
router.get('/aggregates', (req, res, next) => {
  try {
    const db = getDb();
    const sysFilter = req.query.system_id ? 'WHERE system_id = @system_id' : '';
    const params = req.query.system_id ? { system_id: Number(req.query.system_id) } : {};
    const sql = `SELECT *, size_bytes AS total_bytes FROM ontap_aggregates ${sysFilter} ORDER BY id`;
    const data = db.prepare(sql).all(params);
    res.json({ data, count: data.length });
  } catch (err) { next(err); }
});

/**
 * @route GET /api/inventory/volumes
 * @desc  Return all ONTAP volumes.  Filterable by ?system_id, ?svm_name.
 */
router.get('/volumes', (req, res, next) => {
  try {
    const db = getDb();
    const conditions = [];
    const params = {};

    if (req.query.system_id) {
      conditions.push('v.system_id = @system_id');
      params.system_id = Number(req.query.system_id);
    }
    if (req.query.svm_name) {
      conditions.push('s.name = @svm_name');
      params.svm_name = req.query.svm_name;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT v.*, v.size_bytes AS total_bytes, s.name AS svm_name
      FROM ontap_volumes v
      LEFT JOIN ontap_svms s ON s.id = v.svm_id
      ${where}
      ORDER BY v.id
    `;
    const data = db.prepare(sql).all(params);
    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
});

/**
 * @route GET /api/inventory/disks
 * @desc  Return all ONTAP disks and E-Series drives.
 */
router.get('/disks', (req, res, next) => {
  try {
    const db = getDb();
    const conditions = [];
    const params = {};

    if (req.query.system_id) {
      params.system_id = Number(req.query.system_id);
    }

    const sysFilter = params.system_id !== undefined ? 'WHERE system_id = @system_id' : '';

    const sql = `
      SELECT id, system_id, name, type AS media_type, model,
             serial_number, firmware_version, state AS status,
             usable_size_bytes AS capacity_bytes, 'ontap' AS platform
      FROM ontap_disks ${sysFilter}
      UNION ALL
      SELECT id, system_id, product_id AS name, media_type, NULL AS model,
             serial_number, firmware_version, status,
             capacity_bytes, 'eseries' AS platform
      FROM es_drives ${sysFilter}
      ORDER BY platform, id
    `;
    const data = db.prepare(sql).all(params);
    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
});

/**
 * @route GET /api/inventory/luns
 * @desc  Return all ONTAP LUNs.  Filterable by ?system_id.
 */
router.get('/luns', (req, res, next) => {
  try {
    const db = getDb();
    const sysFilter = req.query.system_id ? 'WHERE system_id = @system_id' : '';
    const params = req.query.system_id ? { system_id: Number(req.query.system_id) } : {};
    const sql = `SELECT *, size_bytes AS total_bytes, state AS status FROM ontap_luns ${sysFilter} ORDER BY id`;
    const data = db.prepare(sql).all(params);
    res.json({ data, count: data.length });
  } catch (err) { next(err); }
});

/**
 * @route GET /api/inventory/lifs
 * @desc  Return all ONTAP LIFs.  Filterable by ?system_id.
 */
router.get('/lifs', inventoryHandler('ontap_lifs'));

/**
 * @route GET /api/inventory/svms
 * @desc  Return all ONTAP SVMs.  Filterable by ?system_id.
 */
router.get('/svms', inventoryHandler('ontap_svms'));

// ---------------------------------------------------------------------------
// StorageGRID inventory
// ---------------------------------------------------------------------------

/**
 * @route GET /api/inventory/grids
 * @desc  Return all StorageGRID grids.  Filterable by ?system_id.
 */
router.get('/grids', inventoryHandler('sg_grids'));

/**
 * @route GET /api/inventory/buckets
 * @desc  Return all StorageGRID S3 buckets.  Filterable by ?system_id.
 */
router.get('/buckets', inventoryHandler('sg_buckets'));

// ---------------------------------------------------------------------------
// E-Series inventory
// ---------------------------------------------------------------------------

/**
 * @route GET /api/inventory/arrays
 * @desc  Return all E-Series arrays.  Filterable by ?system_id.
 */
router.get('/arrays', inventoryHandler('es_arrays'));

module.exports = router;
