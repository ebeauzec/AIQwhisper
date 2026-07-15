'use strict';

/**
 * @module db/models
 * @description Data access layer for the AIQwhisper SQLite database.
 *
 * Every query uses `db.prepare()` for safety and performance.
 * Bulk mutations are wrapped in `db.transaction()` for atomicity.
 * Timestamps follow the ISO-8601 TEXT format used by the schema
 * (e.g. `datetime('now')` → `"2026-07-15 12:00:00"`).
 */

const { getDb } = require('./database');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the current UTC datetime as an ISO-8601 string without the "T"
 * separator, matching SQLite's `datetime('now')` output.
 *
 * @returns {string} e.g. "2026-07-15 16:45:00"
 */
function nowUtc() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * Build a SET clause and parameter object from a plain key-value map.
 * Only keys whose values are not `undefined` are included.
 *
 * @param {Record<string, *>} fields
 * @returns {{ clause: string, params: Record<string, *> }}
 */
function buildSetClause(fields) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  const clause = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = {};
  for (const k of keys) {
    params[k] = fields[k];
  }
  return { clause, params };
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

/** @type {import('./models').SystemsDao} */
const systems = {
  /**
   * Return every registered system.
   *
   * @returns {Array<Object>} All rows from the `systems` table.
   */
  getAll() {
    const db = getDb();
    return db.prepare('SELECT * FROM systems ORDER BY name').all();
  },

  /**
   * Return a single system by primary key.
   *
   * @param {number} id
   * @returns {Object|undefined}
   */
  getById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM systems WHERE id = ?').get(id);
  },

  /**
   * Insert a new system and return its generated id.
   *
   * @param {Object} opts
   * @param {string} opts.type              - "ontap" | "storagegrid" | "eseries"
   * @param {string} opts.name
   * @param {string} opts.hostname
   * @param {number} [opts.port=443]
   * @param {string} [opts.authType="basic"] - "basic" | "certificate" | "token"
   * @param {string} [opts.credentialsEncrypted]
   * @returns {number} The `lastInsertRowid` of the new row.
   */
  create({ type, name, hostname, port = 443, authType = 'basic', credentialsEncrypted = null }) {
    const db = getDb();
    const now = nowUtc();
    const info = db.prepare(`
      INSERT INTO systems (type, name, hostname, port, auth_type, credentials_encrypted, created_at, updated_at)
      VALUES (@type, @name, @hostname, @port, @authType, @credentialsEncrypted, @now, @now)
    `).run({ type, name, hostname, port, authType, credentialsEncrypted, now });
    return Number(info.lastInsertRowid);
  },

  /**
   * Update one or more fields on an existing system.
   *
   * @param {number} id
   * @param {Object} fields - Column-name → value map (snake_case keys).
   * @returns {number} Number of rows changed (0 or 1).
   */
  update(id, fields) {
    const db = getDb();
    fields.updated_at = nowUtc();
    const { clause, params } = buildSetClause(fields);
    if (!clause) return 0;
    params.id = id;
    const info = db.prepare(`UPDATE systems SET ${clause} WHERE id = @id`).run(params);
    return info.changes;
  },

  /**
   * Delete a system by id.  Cascading deletes remove related data.
   *
   * @param {number} id
   * @returns {number} Number of rows deleted (0 or 1).
   */
  delete(id) {
    const db = getDb();
    const info = db.prepare('DELETE FROM systems WHERE id = ?').run(id);
    return info.changes;
  },

  /**
   * Update the connectivity status and detected software version.
   *
   * @param {number} id
   * @param {string} status  - "online" | "offline" | "degraded" | "unknown"
   * @param {string} [version]
   * @returns {number} Number of rows changed.
   */
  updateStatus(id, status, version) {
    const db = getDb();
    const now = nowUtc();
    if (version !== undefined) {
      return db.prepare(`
        UPDATE systems SET status = @status, version = @version, updated_at = @now WHERE id = @id
      `).run({ id, status, version, now }).changes;
    }
    return db.prepare(`
      UPDATE systems SET status = @status, updated_at = @now WHERE id = @id
    `).run({ id, status, now }).changes;
  },

  /**
   * Set the `last_polled` timestamp to the current UTC time.
   *
   * @param {number} id
   * @returns {number} Number of rows changed.
   */
  updateLastPolled(id) {
    const db = getDb();
    const now = nowUtc();
    return db.prepare(`
      UPDATE systems SET last_polled = @now, updated_at = @now WHERE id = @id
    `).run({ id, now }).changes;
  },
};

// ---------------------------------------------------------------------------
// Collection Runs
// ---------------------------------------------------------------------------

/** @type {import('./models').CollectionRunsDao} */
const collectionRuns = {
  /**
   * Start a new collection run for the given system.
   *
   * @param {number} systemId
   * @returns {number} The id of the new collection run.
   */
  create(systemId) {
    const db = getDb();
    const now = nowUtc();
    const info = db.prepare(`
      INSERT INTO collection_runs (system_id, started_at, status)
      VALUES (@systemId, @now, 'running')
    `).run({ systemId, now });
    return Number(info.lastInsertRowid);
  },

  /**
   * Mark a collection run as completed (or failed).
   *
   * @param {number} id
   * @param {Object} result
   * @param {string}  result.status            - "completed" | "failed" | "cancelled"
   * @param {number}  [result.endpointsQueried=0]
   * @param {number}  [result.recordsCollected=0]
   * @param {string}  [result.errorMessage]
   * @returns {number} Number of rows changed.
   */
  complete(id, { status, endpointsQueried = 0, recordsCollected = 0, errorMessage = null }) {
    const db = getDb();
    const now = nowUtc();
    return db.prepare(`
      UPDATE collection_runs
      SET completed_at = @now,
          status = @status,
          endpoints_queried = @endpointsQueried,
          records_collected = @recordsCollected,
          error_message = @errorMessage
      WHERE id = @id
    `).run({ id, now, status, endpointsQueried, recordsCollected, errorMessage }).changes;
  },

  /**
   * Return the most recent collection runs for a system.
   *
   * @param {number} systemId
   * @param {number} [limit=10]
   * @returns {Array<Object>}
   */
  getRecent(systemId, limit = 10) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM collection_runs
      WHERE system_id = @systemId
      ORDER BY started_at DESC
      LIMIT @limit
    `).all({ systemId, limit });
  },
};

// ---------------------------------------------------------------------------
// Generic Upsert
// ---------------------------------------------------------------------------

/**
 * Insert or replace a single row.  Conflict detection is based on the
 * supplied `uniqueKeys` array.  Non-conflicting rows are inserted normally;
 * conflicting rows have all non-unique columns updated.
 *
 * @param {string}   tableName  - Target table.
 * @param {Object}   data       - Column-name → value map.
 * @param {string[]} uniqueKeys - Columns that form the uniqueness constraint.
 * @returns {number} The `lastInsertRowid` of the upserted row.
 */
function upsert(tableName, data, uniqueKeys) {
  const db = getDb();
  data.updated_at = nowUtc();
  if (!data.created_at) {
    data.created_at = data.updated_at;
  }

  const cols = Object.keys(data);
  const placeholders = cols.map((c) => `@${c}`).join(', ');
  const updateCols = cols.filter((c) => !uniqueKeys.includes(c) && c !== 'id');
  const updateClause = updateCols.map((c) => `${c} = excluded.${c}`).join(', ');

  const sql = `
    INSERT INTO ${tableName} (${cols.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (${uniqueKeys.join(', ')})
    DO UPDATE SET ${updateClause}
  `;

  const info = db.prepare(sql).run(data);
  return Number(info.lastInsertRowid);
}

/**
 * Bulk upsert an array of rows inside a single transaction.
 *
 * @param {string}   tableName  - Target table.
 * @param {Object[]} dataArray  - Array of column-name → value maps.
 * @param {string[]} uniqueKeys - Columns that form the uniqueness constraint.
 * @returns {number[]} Array of `lastInsertRowid` values.
 */
function bulkUpsert(tableName, dataArray, uniqueKeys) {
  const db = getDb();
  const ids = [];

  const run = db.transaction((rows) => {
    for (const row of rows) {
      ids.push(upsert(tableName, row, uniqueKeys));
    }
  });

  run(dataArray);
  logger.debug(`bulkUpsert: inserted/updated ${ids.length} rows into ${tableName}`);
  return ids;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** @type {import('./models').MetricsDao} */
const metrics = {
  /**
   * Bulk-insert raw metric samples inside a single transaction.
   *
   * Each record must contain: `system_id`, `resource_type`, `resource_id`,
   * `metric_name`, `metric_value`, `unit`, `timestamp`.
   *
   * @param {Object[]} records
   * @returns {number} Number of rows inserted.
   */
  insertRaw(records) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO metrics_raw
        (system_id, resource_type, resource_id, metric_name, metric_value, unit, timestamp, created_at)
      VALUES
        (@system_id, @resource_type, @resource_id, @metric_name, @metric_value, @unit, @timestamp, @created_at)
    `);

    const now = nowUtc();
    const run = db.transaction((rows) => {
      for (const row of rows) {
        row.created_at = now;
        stmt.run(row);
      }
    });

    run(records);
    logger.debug(`metrics.insertRaw: inserted ${records.length} samples`);
    return records.length;
  },

  /**
   * Retrieve a time-series for a specific metric.
   *
   * @param {number} systemId
   * @param {string} resourceType
   * @param {string} resourceId
   * @param {string} metricName
   * @param {string} startTime  - ISO-8601 lower bound (inclusive).
   * @param {string} endTime    - ISO-8601 upper bound (inclusive).
   * @param {string} [tier="raw"] - "raw" | "hourly" | "daily" | "weekly"
   * @returns {Array<Object>}
   */
  getTimeSeries(systemId, resourceType, resourceId, metricName, startTime, endTime, tier = 'raw') {
    const db = getDb();

    if (tier === 'raw') {
      return db.prepare(`
        SELECT timestamp, metric_value AS value
        FROM metrics_raw
        WHERE system_id = @systemId
          AND resource_type = @resourceType
          AND resource_id = @resourceId
          AND metric_name = @metricName
          AND timestamp >= @startTime
          AND timestamp <= @endTime
        ORDER BY timestamp
      `).all({ systemId, resourceType, resourceId, metricName, startTime, endTime });
    }

    const tableMap = {
      hourly: { table: 'metrics_hourly', col: 'hour_timestamp' },
      daily: { table: 'metrics_daily', col: 'day_timestamp' },
      weekly: { table: 'metrics_weekly', col: 'week_timestamp' },
    };

    const target = tableMap[tier];
    if (!target) {
      throw new Error(`Unknown metrics tier: ${tier}`);
    }

    return db.prepare(`
      SELECT ${target.col} AS timestamp, min_value, max_value, avg_value, sample_count
      FROM ${target.table}
      WHERE system_id = @systemId
        AND resource_type = @resourceType
        AND resource_id = @resourceId
        AND metric_name = @metricName
        AND ${target.col} >= @startTime
        AND ${target.col} <= @endTime
      ORDER BY ${target.col}
    `).all({ systemId, resourceType, resourceId, metricName, startTime, endTime });
  },
};

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/** @type {import('./models').CapacityDao} */
const capacity = {
  /**
   * Insert a single capacity snapshot.
   *
   * @param {Object} record - Must include system_id, resource_type,
   *   resource_id, total_bytes, used_bytes, available_bytes,
   *   utilization_pct, snapshot_timestamp.
   * @returns {number} The id of the new row.
   */
  insertSnapshot(record) {
    const db = getDb();
    const now = nowUtc();
    record.created_at = now;

    const cols = Object.keys(record);
    const placeholders = cols.map((c) => `@${c}`).join(', ');

    const info = db.prepare(`
      INSERT INTO capacity_snapshots (${cols.join(', ')})
      VALUES (${placeholders})
    `).run(record);
    return Number(info.lastInsertRowid);
  },

  /**
   * Get all capacity projections for a given system.
   *
   * @param {number} systemId
   * @returns {Array<Object>}
   */
  getProjections(systemId) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM capacity_projections
      WHERE system_id = @systemId
      ORDER BY days_until_full ASC
    `).all({ systemId });
  },

  /**
   * Insert or update a capacity projection.
   *
   * Conflicts are detected on (system_id, resource_type, resource_id).
   *
   * @param {Object} data - Must include system_id, resource_type,
   *   resource_id, resource_name, current_used_bytes,
   *   growth_rate_bytes_per_day, projected_full_date, confidence_pct,
   *   analysis_timestamp, days_until_full.
   * @returns {number} The id of the upserted row.
   */
  upsertProjection(data) {
    return upsert('capacity_projections', data, ['system_id', 'resource_type', 'resource_id']);
  },
};

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

/** @type {import('./models').IssuesDao} */
const issues = {
  /**
   * Return issues matching the supplied filters.
   *
   * @param {Object}  [filters]
   * @param {number}  [filters.system_id]
   * @param {string}  [filters.severity]
   * @param {string}  [filters.status]
   * @param {string}  [filters.category]
   * @returns {Array<Object>}
   */
  getAll(filters = {}) {
    const db = getDb();
    const conditions = [];
    const params = {};

    if (filters.system_id !== undefined) {
      conditions.push('system_id = @system_id');
      params.system_id = filters.system_id;
    }
    if (filters.severity !== undefined) {
      conditions.push('severity = @severity');
      params.severity = filters.severity;
    }
    if (filters.status !== undefined) {
      conditions.push('status = @status');
      params.status = filters.status;
    }
    if (filters.category !== undefined) {
      conditions.push('category = @category');
      params.category = filters.category;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM issues ${where} ORDER BY detected_at DESC`).all(params);
  },

  /**
   * Create a new issue.
   *
   * @param {Object} issue - Must include system_id, resource_type,
   *   resource_id, severity, category, title.  Optional: description,
   *   rule_id, status.
   * @returns {number} The id of the new issue.
   */
  create(issue) {
    const db = getDb();
    const now = nowUtc();
    issue.detected_at = issue.detected_at || now;
    issue.status = issue.status || 'open';
    issue.created_at = now;
    issue.updated_at = now;

    const cols = Object.keys(issue);
    const placeholders = cols.map((c) => `@${c}`).join(', ');

    const info = db.prepare(`
      INSERT INTO issues (${cols.join(', ')})
      VALUES (${placeholders})
    `).run(issue);
    return Number(info.lastInsertRowid);
  },

  /**
   * Mark an issue as acknowledged.
   *
   * @param {number} id
   * @returns {number} Number of rows changed.
   */
  acknowledge(id) {
    const db = getDb();
    const now = nowUtc();
    return db.prepare(`
      UPDATE issues SET status = 'acknowledged', updated_at = @now WHERE id = @id
    `).run({ id, now }).changes;
  },

  /**
   * Mark an issue as resolved and set the resolved_at timestamp.
   *
   * @param {number} id
   * @returns {number} Number of rows changed.
   */
  resolve(id) {
    const db = getDb();
    const now = nowUtc();
    return db.prepare(`
      UPDATE issues SET status = 'resolved', resolved_at = @now, updated_at = @now WHERE id = @id
    `).run({ id, now }).changes;
  },

  /**
   * Return a count of open issues grouped by severity.
   *
   * @returns {Object} e.g. `{ critical: 2, high: 5, medium: 10, low: 3, info: 0 }`
   */
  getOpenCount() {
    const db = getDb();
    const rows = db.prepare(`
      SELECT severity, COUNT(*) AS cnt
      FROM issues
      WHERE status NOT IN ('resolved', 'dismissed')
      GROUP BY severity
    `).all();

    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const row of rows) {
      counts[row.severity] = row.cnt;
    }
    return counts;
  },
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** @type {import('./models').DashboardDao} */
const dashboard = {
  /**
   * Produce an aggregated summary suitable for a dashboard landing page.
   *
   * @returns {Object} `{ systems, issues, capacityWarnings }`
   */
  getSummary() {
    const db = getDb();

    // System counts by status
    const systemRows = db.prepare(`
      SELECT status, COUNT(*) AS cnt FROM systems GROUP BY status
    `).all();
    const systemCounts = { total: 0, online: 0, offline: 0, degraded: 0, unknown: 0 };
    for (const row of systemRows) {
      systemCounts[row.status] = row.cnt;
      systemCounts.total += row.cnt;
    }

    // Open issue counts by severity
    const issueCounts = issues.getOpenCount();

    // Capacity warnings: projections where days_until_full <= 30
    const capacityWarnings = db.prepare(`
      SELECT COUNT(*) AS cnt FROM capacity_projections WHERE days_until_full <= 30
    `).get().cnt;

    return {
      systems: systemCounts,
      issues: issueCounts,
      capacityWarnings,
    };
  },

  /**
   * Return the most recent events across all tables that act as event logs
   * (collection runs, issues, EMS events).
   *
   * @param {number} [limit=20]
   * @returns {Array<Object>} Ordered by timestamp descending.
   */
  getRecentEvents(limit = 20) {
    const db = getDb();
    return db.prepare(`
      SELECT
        'collection_run' AS event_type,
        cr.id,
        cr.system_id,
        s.name AS system_name,
        cr.status AS detail,
        cr.started_at AS event_time
      FROM collection_runs cr
      JOIN systems s ON s.id = cr.system_id

      UNION ALL

      SELECT
        'issue' AS event_type,
        i.id,
        i.system_id,
        s.name AS system_name,
        i.severity || ': ' || i.title AS detail,
        i.detected_at AS event_time
      FROM issues i
      JOIN systems s ON s.id = i.system_id

      ORDER BY event_time DESC
      LIMIT @limit
    `).all({ limit });
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  systems,
  collectionRuns,
  upsert,
  bulkUpsert,
  metrics,
  capacity,
  issues,
  dashboard,
};
