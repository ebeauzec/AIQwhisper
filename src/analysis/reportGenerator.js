'use strict';

/**
 * @module analysis/reportGenerator
 * @description MSP report generator for AIQwhisper.
 *
 * Produces structured report data for executive summaries, capacity
 * planning, firmware currency, issue tracking, and security posture.
 * Reports are stored in the `reports` table for later retrieval.
 */

const { getDb } = require('../db/database');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the current UTC datetime as an ISO-8601 string (no "T", no millis).
 *
 * @returns {string}
 */
function nowUtc() {
  return new Date().toISOString().replace('T', ' ').replace(/\.?\d{3}Z$/, '');
}

/**
 * Return today's date as a human-readable string.
 *
 * @returns {string} e.g. "2026-07-15"
 */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Map the user-facing report type to the schema's CHECK-constrained
 * `type` column value.
 *
 * @param {string} type - User-facing type.
 * @returns {string} Schema-compatible type.
 */
function schemaType(type) {
  const map = {
    executive: 'health',
    capacity: 'capacity',
    firmware: 'inventory',
    issues: 'custom',
    security: 'security',
  };
  return map[type] || 'custom';
}

// ---------------------------------------------------------------------------
// Report Builders
// ---------------------------------------------------------------------------

/**
 * Build an executive summary report.
 *
 * Includes system counts, health scores, top issues, and capacity warnings.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number|null} systemId
 * @returns {Object}
 */
function buildExecutiveReport(db, systemId) {
  // System counts by type and status
  const systemsByType = db.prepare(`
    SELECT type, COUNT(*) AS cnt FROM systems GROUP BY type
  `).all();

  const systemsByStatus = db.prepare(`
    SELECT status, COUNT(*) AS cnt FROM systems GROUP BY status
  `).all();

  const totalSystems = db.prepare('SELECT COUNT(*) AS cnt FROM systems').get().cnt;

  // Latest health scores
  let healthScoresQuery = `
    SELECT hs.*, s.name AS system_name, s.type AS system_type
    FROM health_scores hs
    JOIN systems s ON s.id = hs.system_id
    WHERE hs.id IN (
      SELECT MAX(id) FROM health_scores GROUP BY system_id
    )
    ORDER BY hs.overall_score ASC
  `;
  const healthScores = db.prepare(healthScoresQuery).all();

  // Average health score
  const avgScore = healthScores.length > 0
    ? Math.round(healthScores.reduce((sum, h) => sum + h.overall_score, 0) / healthScores.length)
    : null;

  // Top 10 open issues by severity
  const topIssuesParams = {};
  let topIssuesWhere = "WHERE i.status NOT IN ('resolved', 'dismissed')";
  if (systemId) {
    topIssuesWhere += ' AND i.system_id = @systemId';
    topIssuesParams.systemId = systemId;
  }
  const topIssues = db.prepare(`
    SELECT i.*, s.name AS system_name
    FROM issues i
    JOIN systems s ON s.id = i.system_id
    ${topIssuesWhere}
    ORDER BY
      CASE i.severity
        WHEN 'critical' THEN 1
        WHEN 'high'     THEN 2
        WHEN 'medium'   THEN 3
        WHEN 'low'      THEN 4
        WHEN 'info'     THEN 5
      END,
      i.detected_at DESC
    LIMIT 10
  `).all(topIssuesParams);

  // Issue counts by severity
  const issueCounts = db.prepare(`
    SELECT severity, COUNT(*) AS cnt
    FROM issues
    WHERE status NOT IN ('resolved', 'dismissed')
    GROUP BY severity
  `).all();

  // Capacity warnings (days_until_full <= 30)
  const capacityWarnings = db.prepare(`
    SELECT cp.*, s.name AS system_name
    FROM capacity_projections cp
    JOIN systems s ON s.id = cp.system_id
    WHERE cp.days_until_full IS NOT NULL AND cp.days_until_full <= 30
    ORDER BY cp.days_until_full ASC
    LIMIT 10
  `).all();

  return {
    summary: {
      totalSystems,
      systemsByType: Object.fromEntries(systemsByType.map((r) => [r.type, r.cnt])),
      systemsByStatus: Object.fromEntries(systemsByStatus.map((r) => [r.status, r.cnt])),
      averageHealthScore: avgScore,
    },
    healthScores,
    topIssues,
    issueCounts: Object.fromEntries(issueCounts.map((r) => [r.severity, r.cnt])),
    capacityWarnings,
  };
}

/**
 * Build a capacity report with per-resource projections and growth rates.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number|null} systemId
 * @returns {Object}
 */
function buildCapacityReport(db, systemId) {
  const params = {};
  let whereClause = '';
  if (systemId) {
    whereClause = 'WHERE cp.system_id = @systemId';
    params.systemId = systemId;
  }

  // All projections
  const projections = db.prepare(`
    SELECT cp.*, s.name AS system_name, s.type AS system_type
    FROM capacity_projections cp
    JOIN systems s ON s.id = cp.system_id
    ${whereClause}
    ORDER BY
      CASE WHEN cp.days_until_full IS NULL THEN 1 ELSE 0 END,
      cp.days_until_full ASC
  `).all(params);

  // Overall capacity summary
  const capacitySummary = db.prepare(`
    SELECT
      s.type,
      SUM(cs.total_bytes) AS total_capacity,
      SUM(cs.used_bytes) AS total_used,
      ROUND(CAST(SUM(cs.used_bytes) AS REAL) / NULLIF(SUM(cs.total_bytes), 0) * 100, 1) AS overall_pct
    FROM capacity_snapshots cs
    JOIN systems s ON s.id = cs.system_id
    WHERE cs.id IN (
      SELECT MAX(id) FROM capacity_snapshots GROUP BY system_id, resource_type, resource_id
    )
    GROUP BY s.type
  `).all();

  // Resources at risk (< 30 days runway)
  const atRisk = projections.filter(
    (p) => p.days_until_full !== null && p.days_until_full <= 30
  );

  // Top growers
  const topGrowers = projections
    .filter((p) => p.growth_rate_bytes_per_day > 0)
    .sort((a, b) => b.growth_rate_bytes_per_day - a.growth_rate_bytes_per_day)
    .slice(0, 10);

  return {
    capacitySummary,
    projections,
    atRisk,
    topGrowers,
    totalResources: projections.length,
    resourcesAtRisk: atRisk.length,
  };
}

/**
 * Build a firmware / software currency report.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number|null} systemId
 * @returns {Object}
 */
function buildFirmwareReport(db, systemId) {
  // Installed versions per platform
  const ontapVersions = db.prepare(`
    SELECT c.system_id, s.name AS system_name, c.name AS cluster_name, c.version,
           kv.is_recommended, kv.end_of_support, kv.release_date
    FROM ontap_clusters c
    JOIN systems s ON s.id = c.system_id
    LEFT JOIN kb_software_versions kv ON kv.platform = 'ontap' AND kv.version = c.version
    ${systemId ? 'WHERE c.system_id = @systemId' : ''}
    ORDER BY c.version
  `).all(systemId ? { systemId } : {});

  const sgVersions = db.prepare(`
    SELECT g.system_id, s.name AS system_name, g.name AS grid_name, g.version,
           kv.is_recommended, kv.end_of_support, kv.release_date
    FROM sg_grids g
    JOIN systems s ON s.id = g.system_id
    LEFT JOIN kb_software_versions kv ON kv.platform = 'storagegrid' AND kv.version = g.version
    ${systemId ? 'WHERE g.system_id = @systemId' : ''}
    ORDER BY g.version
  `).all(systemId ? { systemId } : {});

  const esVersions = db.prepare(`
    SELECT a.system_id, s.name AS system_name, a.name AS array_name,
           a.firmware_version AS version,
           kv.is_recommended, kv.end_of_support, kv.release_date
    FROM es_arrays a
    JOIN systems s ON s.id = a.system_id
    LEFT JOIN kb_software_versions kv ON kv.platform = 'eseries' AND kv.version = a.firmware_version
    ${systemId ? 'WHERE a.system_id = @systemId' : ''}
    ORDER BY a.firmware_version
  `).all(systemId ? { systemId } : {});

  // Latest available versions
  const latestVersions = db.prepare(`
    SELECT platform, version, release_date
    FROM kb_software_versions
    WHERE is_recommended = 1
    ORDER BY platform
  `).all();

  // EOL systems
  const now = nowUtc();
  const eolSystems = [
    ...ontapVersions.filter((v) => v.end_of_support && v.end_of_support < now),
    ...sgVersions.filter((v) => v.end_of_support && v.end_of_support < now),
    ...esVersions.filter((v) => v.end_of_support && v.end_of_support < now),
  ];

  return {
    ontapVersions,
    storagegridVersions: sgVersions,
    eseriesVersions: esVersions,
    latestVersions: Object.fromEntries(latestVersions.map((v) => [v.platform, v])),
    eolSystems,
    totalSystems: ontapVersions.length + sgVersions.length + esVersions.length,
    eolCount: eolSystems.length,
  };
}

/**
 * Build an issues report with open/resolved breakdowns.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number|null} systemId
 * @returns {Object}
 */
function buildIssuesReport(db, systemId) {
  const params = {};
  let whereClause = '';
  if (systemId) {
    whereClause = 'WHERE i.system_id = @systemId';
    params.systemId = systemId;
  }

  // Open issues by category and severity
  const openByCategory = db.prepare(`
    SELECT i.category, i.severity, COUNT(*) AS cnt
    FROM issues i
    ${whereClause ? whereClause + " AND i.status NOT IN ('resolved', 'dismissed')" : "WHERE i.status NOT IN ('resolved', 'dismissed')"}
    GROUP BY i.category, i.severity
    ORDER BY i.category, i.severity
  `).all(params);

  // Recently resolved (last 7 days)
  const recentlyResolved = db.prepare(`
    SELECT i.*, s.name AS system_name
    FROM issues i
    JOIN systems s ON s.id = i.system_id
    ${systemId ? 'WHERE i.system_id = @systemId AND' : 'WHERE'} i.status = 'resolved'
      AND i.resolved_at >= datetime('now', '-7 days')
    ORDER BY i.resolved_at DESC
    LIMIT 50
  `).all(params);

  // All open issues
  const openIssues = db.prepare(`
    SELECT i.*, s.name AS system_name
    FROM issues i
    JOIN systems s ON s.id = i.system_id
    ${systemId ? 'WHERE i.system_id = @systemId AND' : 'WHERE'}
      i.status NOT IN ('resolved', 'dismissed')
    ORDER BY
      CASE i.severity
        WHEN 'critical' THEN 1
        WHEN 'high'     THEN 2
        WHEN 'medium'   THEN 3
        WHEN 'low'      THEN 4
        WHEN 'info'     THEN 5
      END,
      i.detected_at DESC
  `).all(params);

  // Issue trend (new issues per day, last 30 days)
  const trend = db.prepare(`
    SELECT DATE(i.detected_at) AS day, COUNT(*) AS cnt
    FROM issues i
    ${whereClause}
    ${whereClause ? 'AND' : 'WHERE'} i.detected_at >= datetime('now', '-30 days')
    GROUP BY DATE(i.detected_at)
    ORDER BY day
  `).all(params);

  return {
    openByCategory,
    openIssues,
    recentlyResolved,
    trend,
    totalOpen: openIssues.length,
    totalResolvedRecently: recentlyResolved.length,
  };
}

/**
 * Build a security posture report.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number|null} systemId
 * @returns {Object}
 */
function buildSecurityReport(db, systemId) {
  const params = {};
  let systemFilter = '';
  if (systemId) {
    systemFilter = 'WHERE system_id = @systemId';
    params.systemId = systemId;
  }

  // ONTAP security settings
  const ontapSecurity = db.prepare(`
    SELECT sec.*, s.name AS system_name
    FROM ontap_security sec
    JOIN systems s ON s.id = sec.system_id
    ${systemId ? 'WHERE sec.system_id = @systemId' : ''}
  `).all(params);

  // Certificate expiry — ONTAP licenses with expiry
  const expiringCertsOntap = db.prepare(`
    SELECT l.*, s.name AS system_name
    FROM ontap_licenses l
    JOIN systems s ON s.id = l.system_id
    WHERE l.expiry_date IS NOT NULL
      AND l.expiry_date <= datetime('now', '+90 days')
      ${systemId ? 'AND l.system_id = @systemId' : ''}
    ORDER BY l.expiry_date ASC
  `).all(params);

  // Certificate expiry — StorageGRID
  const expiringCertsSg = db.prepare(`
    SELECT c.*, s.name AS system_name
    FROM sg_certificates c
    JOIN systems s ON s.id = c.system_id
    WHERE c.not_after IS NOT NULL
      AND c.not_after <= datetime('now', '+90 days')
      ${systemId ? 'AND c.system_id = @systemId' : ''}
    ORDER BY c.not_after ASC
  `).all(params);

  // Encryption status
  const encryptionStatus = db.prepare(`
    SELECT
      s.name AS system_name,
      s.id AS system_id,
      COUNT(*) AS total_volumes,
      SUM(CASE WHEN v.is_encrypted = 1 THEN 1 ELSE 0 END) AS encrypted_volumes,
      ROUND(CAST(SUM(CASE WHEN v.is_encrypted = 1 THEN 1 ELSE 0 END) AS REAL)
            / NULLIF(COUNT(*), 0) * 100, 1) AS encryption_pct
    FROM ontap_volumes v
    JOIN systems s ON s.id = v.system_id
    WHERE v.type = 'rw' AND v.state = 'online'
    ${systemId ? 'AND v.system_id = @systemId' : ''}
    GROUP BY s.id
  `).all(params);

  // Open security issues
  const securityIssues = db.prepare(`
    SELECT i.*, s.name AS system_name
    FROM issues i
    JOIN systems s ON s.id = i.system_id
    WHERE i.category = 'security'
      AND i.status NOT IN ('resolved', 'dismissed')
      ${systemId ? 'AND i.system_id = @systemId' : ''}
    ORDER BY
      CASE i.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END
  `).all(params);

  // FIPS compliance summary
  const fipsStatus = ontapSecurity.map((sec) => ({
    systemName: sec.system_name,
    fipsEnabled: sec.fips_enabled === 1,
    multiAdminVerify: sec.multi_admin_verify === 1,
    clusterPeerEncryption: sec.cluster_peer_encryption === 1,
  }));

  return {
    ontapSecurity: fipsStatus,
    expiringCertificates: [...expiringCertsOntap, ...expiringCertsSg],
    encryptionStatus,
    securityIssues,
    totalExpiringCerts: expiringCertsOntap.length + expiringCertsSg.length,
    totalSecurityIssues: securityIssues.length,
  };
}

// ---------------------------------------------------------------------------
// Report type → builder mapping
// ---------------------------------------------------------------------------

/** @type {Record<string, Function>} */
const REPORT_BUILDERS = {
  executive: buildExecutiveReport,
  capacity: buildCapacityReport,
  firmware: buildFirmwareReport,
  issues: buildIssuesReport,
  security: buildSecurityReport,
};

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Generate a report and store it in the `reports` table.
 *
 * @param {string} type - Report type: `'executive'` | `'capacity'` |
 *   `'firmware'` | `'issues'` | `'security'`.
 * @param {number|null} [systemId=null] - Optional system filter.
 * @returns {{id: number, type: string, title: string, data: Object, generatedAt: string}}
 * @throws {Error} If the report type is not recognised.
 */
function generateReport(type, systemId = null) {
  const db = getDb();
  const builder = REPORT_BUILDERS[type];
  if (!builder) {
    throw new Error(`Unknown report type: "${type}". Valid types: ${Object.keys(REPORT_BUILDERS).join(', ')}`);
  }

  logger.info(`[ReportGenerator] Generating "${type}" report${systemId ? ` for system ${systemId}` : ''}`);

  const data = builder(db, systemId);
  const now = nowUtc();
  const title = `${type.charAt(0).toUpperCase() + type.slice(1)} Report — ${todayStr()}`;

  const info = db.prepare(`
    INSERT INTO reports
      (name, type, parameters_json, generated_at, format, created_by, status, created_at)
    VALUES
      (@name, @type, @parametersJson, @now, 'json', 'system', 'completed', @now)
  `).run({
    name: title,
    type: schemaType(type),
    parametersJson: JSON.stringify({
      reportType: type,
      systemId,
      data,
    }),
    now,
  });

  const id = Number(info.lastInsertRowid);

  logger.info(`[ReportGenerator] Report "${title}" stored with id=${id}`);

  return {
    id,
    type,
    title,
    data,
    generatedAt: now,
  };
}

/**
 * Fetch a previously stored report by id.
 *
 * @param {number} id - Report primary key.
 * @returns {Object|null} The report row with parsed `parameters_json`,
 *   or `null` if not found.
 */
function getReport(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  if (!row) return null;

  // Parse parameters_json for convenience
  try {
    row.parameters = JSON.parse(row.parameters_json);
  } catch {
    row.parameters = null;
  }
  return row;
}

/**
 * List stored reports with optional filters.
 *
 * @param {Object}  [filters={}]
 * @param {string}  [filters.type]     - Filter by report type.
 * @param {number}  [filters.systemId] - Filter by system id (searches
 *   within `parameters_json`).
 * @param {number}  [filters.limit=50] - Maximum number of results.
 * @returns {Array<Object>}
 */
function listReports(filters = {}) {
  const db = getDb();
  const conditions = [];
  const params = {};

  if (filters.type) {
    const mapped = schemaType(filters.type);
    conditions.push('type = @type');
    params.type = mapped;
  }

  if (filters.systemId) {
    // JSON contains check — SQLite LIKE on the JSON string
    conditions.push("parameters_json LIKE @systemPattern");
    params.systemPattern = `%"systemId":${filters.systemId}%`;
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const limit = filters.limit || 50;
  params.limit = limit;

  const rows = db.prepare(`
    SELECT * FROM reports
    ${whereClause}
    ORDER BY generated_at DESC
    LIMIT @limit
  `).all(params);

  // Parse parameters_json for each row
  for (const row of rows) {
    try {
      row.parameters = JSON.parse(row.parameters_json);
    } catch {
      row.parameters = null;
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  generateReport,
  getReport,
  listReports,
};
