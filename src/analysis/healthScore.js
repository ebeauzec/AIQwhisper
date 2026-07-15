'use strict';

/**
 * @module analysis/healthScore
 * @description Composite health-scoring engine for AIQwhisper.
 *
 * Computes a weighted 0–100 health score for each system based on six
 * dimensions: Issues, Capacity, Currency, Protection, Performance, and
 * Security.  Scores are persisted in the `health_scores` table.
 */

const { getDb } = require('../db/database');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Weights for each scoring dimension. Must sum to 1.0. */
const WEIGHTS = {
  issues: 0.30,
  capacity: 0.20,
  currency: 0.15,
  protection: 0.15,
  performance: 0.10,
  security: 0.10,
};

/** Per-severity deductions applied to the issues sub-score (out of 100). */
const ISSUE_DEDUCTIONS = {
  critical: 20,
  high: 10,
  medium: 5,
  low: 2,
  info: 1,
};

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
 * Clamp a number to the inclusive range [min, max].
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Scoring Helpers
// ---------------------------------------------------------------------------

/**
 * Issues sub-score.
 *
 * Starts at 100 and deducts points for each open issue, weighted by
 * severity.  Clamped to [0, 100].
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} systemId
 * @returns {number}
 */
function scoreIssues(db, systemId) {
  const rows = db.prepare(`
    SELECT severity, COUNT(*) AS cnt
    FROM issues
    WHERE system_id = @systemId
      AND status NOT IN ('resolved', 'dismissed')
    GROUP BY severity
  `).all({ systemId });

  let score = 100;
  for (const row of rows) {
    const deduction = ISSUE_DEDUCTIONS[row.severity] || 1;
    score -= deduction * row.cnt;
  }
  return clamp(score, 0, 100);
}

/**
 * Capacity sub-score.
 *
 * Based on the worst (highest) utilisation percentage across all capacity
 * snapshots for this system.
 *
 * - < 70 %  → 100
 * - 70–100% → linear decrease from 100 → 0
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} systemId
 * @returns {number}
 */
function scoreCapacity(db, systemId) {
  const row = db.prepare(`
    SELECT MAX(utilization_pct) AS worst_pct
    FROM capacity_snapshots
    WHERE system_id = @systemId
      AND snapshot_timestamp >= datetime('now', '-1 day')
  `).get({ systemId });

  if (!row || row.worst_pct === null) return 100;

  const pct = row.worst_pct;
  if (pct < 70) return 100;
  if (pct >= 100) return 0;

  // Linear interpolation: 70 → 100 score, 100 → 0 score
  return Math.round(((100 - pct) / 30) * 100);
}

/**
 * Currency sub-score.
 *
 * Compares the system's detected version against the knowledge base.
 *
 * - Running the recommended version → 100
 * - Running a non-recommended but supported version → 70
 * - Running EOL software → 0
 * - Unknown / no data → 50
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} systemId
 * @param {string} systemType
 * @returns {number}
 */
function scoreCurrency(db, systemId, systemType) {
  // Determine the installed version from the platform-specific table
  let installedVersion = null;

  if (systemType === 'ontap') {
    const row = db.prepare(
      'SELECT version FROM ontap_clusters WHERE system_id = ? LIMIT 1'
    ).get(systemId);
    installedVersion = row ? row.version : null;
  } else if (systemType === 'storagegrid') {
    const row = db.prepare(
      'SELECT version FROM sg_grids WHERE system_id = ? LIMIT 1'
    ).get(systemId);
    installedVersion = row ? row.version : null;
  } else if (systemType === 'eseries') {
    const row = db.prepare(
      'SELECT firmware_version AS version FROM es_arrays WHERE system_id = ? LIMIT 1'
    ).get(systemId);
    installedVersion = row ? row.version : null;
  }

  if (!installedVersion) return 50; // No version data

  // Check if EOL
  const kbRow = db.prepare(`
    SELECT end_of_support, is_recommended
    FROM kb_software_versions
    WHERE platform = @platform AND version = @version
    LIMIT 1
  `).get({ platform: systemType, version: installedVersion });

  if (!kbRow) return 50; // Version not in KB

  // Check EOL
  if (kbRow.end_of_support) {
    const now = nowUtc();
    if (kbRow.end_of_support < now) return 0; // EOL
  }

  // Check if recommended
  if (kbRow.is_recommended === 1) return 100;

  // Known version, supported but not recommended — check how far behind
  const recommended = db.prepare(`
    SELECT version FROM kb_software_versions
    WHERE platform = @platform AND is_recommended = 1
    ORDER BY release_date DESC
    LIMIT 1
  `).get({ platform: systemType });

  if (!recommended) return 70; // No recommended version known

  // Simple heuristic: if we have a recommended version and we're not on it
  // Count how many versions are between us and recommended
  const versionsBehind = db.prepare(`
    SELECT COUNT(*) AS cnt FROM kb_software_versions
    WHERE platform = @platform
      AND release_date > (
        SELECT release_date FROM kb_software_versions
        WHERE platform = @platform AND version = @currentVersion
      )
  `).get({ platform: systemType, currentVersion: installedVersion });

  const behind = versionsBehind ? versionsBehind.cnt : 0;
  if (behind <= 1) return 70;
  if (behind <= 2) return 40;
  return 20;
}

/**
 * Protection sub-score.
 *
 * Evaluates SnapMirror health and snapshot compliance (ONTAP-specific).
 * For other platforms, checks replication/mirror status.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} systemId
 * @param {string} systemType
 * @returns {number}
 */
function scoreProtection(db, systemId, systemType) {
  let score = 100;

  if (systemType === 'ontap') {
    // SnapMirror health
    const unhealthyMirrors = db.prepare(`
      SELECT COUNT(*) AS cnt FROM ontap_snapmirror
      WHERE system_id = @systemId AND healthy = 0
    `).get({ systemId });
    if (unhealthyMirrors) {
      score -= unhealthyMirrors.cnt * 25;
    }

    // Volumes without recent snapshots (last 24 hours)
    const volsWithoutSnaps = db.prepare(`
      SELECT COUNT(*) AS cnt FROM ontap_volumes v
      WHERE v.system_id = @systemId
        AND v.type = 'rw'
        AND v.state = 'online'
        AND NOT EXISTS (
          SELECT 1 FROM ontap_snapshots s
          WHERE s.volume_id = v.id
            AND s.created_at >= datetime('now', '-1 day')
        )
    `).get({ systemId });
    if (volsWithoutSnaps && volsWithoutSnaps.cnt > 0) {
      score -= Math.min(volsWithoutSnaps.cnt * 5, 40);
    }
  } else if (systemType === 'eseries') {
    // Mirror health
    const unhealthyMirrors = db.prepare(`
      SELECT COUNT(*) AS cnt FROM es_mirrors
      WHERE system_id = @systemId AND state != 'optimal'
    `).get({ systemId });
    if (unhealthyMirrors) {
      score -= unhealthyMirrors.cnt * 25;
    }
  } else if (systemType === 'storagegrid') {
    // ILM policy check — must have an active policy
    const activeIlm = db.prepare(`
      SELECT COUNT(*) AS cnt FROM sg_ilm_policies
      WHERE system_id = @systemId AND status = 'active'
    `).get({ systemId });
    if (!activeIlm || activeIlm.cnt === 0) {
      score -= 50;
    }
  }

  return clamp(score, 0, 100);
}

/**
 * Performance sub-score.
 *
 * Evaluates recent latency metrics against baseline thresholds.
 * Falls back to a neutral score if no metrics are available.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} systemId
 * @returns {number}
 */
function scorePerformance(db, systemId) {
  // Check for latency metrics in the last hour
  const row = db.prepare(`
    SELECT AVG(metric_value) AS avg_latency
    FROM metrics_raw
    WHERE system_id = @systemId
      AND metric_name IN ('latency', 'avg_latency', 'read_latency', 'write_latency')
      AND timestamp >= datetime('now', '-1 hour')
  `).get({ systemId });

  if (!row || row.avg_latency === null) return 100; // No data → assume healthy

  const latencyMs = row.avg_latency;

  // Baseline thresholds (milliseconds)
  if (latencyMs <= 1) return 100;      // Excellent
  if (latencyMs <= 5) return 85;       // Good
  if (latencyMs <= 10) return 70;      // Acceptable
  if (latencyMs <= 20) return 50;      // Degraded
  if (latencyMs <= 50) return 25;      // Poor
  return 0;                             // Critical
}

/**
 * Security sub-score.
 *
 * Checks encryption, FIPS, certificate expiry, and platform-specific
 * security features.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} systemId
 * @param {string} systemType
 * @returns {number}
 */
function scoreSecurity(db, systemId, systemType) {
  let score = 100;

  if (systemType === 'ontap') {
    // FIPS check
    const security = db.prepare(`
      SELECT fips_enabled FROM ontap_security
      WHERE system_id = @systemId
      LIMIT 1
    `).get({ systemId });
    if (security && security.fips_enabled === 0) {
      score -= 15;
    }

    // Unencrypted volumes
    const unencryptedVols = db.prepare(`
      SELECT COUNT(*) AS cnt FROM ontap_volumes
      WHERE system_id = @systemId AND is_encrypted = 0 AND type = 'rw' AND state = 'online'
    `).get({ systemId });
    if (unencryptedVols && unencryptedVols.cnt > 0) {
      score -= Math.min(unencryptedVols.cnt * 2, 20);
    }

    // License/cert expiry within 30 days
    const expiringCerts = db.prepare(`
      SELECT COUNT(*) AS cnt FROM ontap_licenses
      WHERE system_id = @systemId
        AND expiry_date IS NOT NULL
        AND expiry_date <= datetime('now', '+30 days')
        AND expiry_date > datetime('now')
    `).get({ systemId });
    if (expiringCerts && expiringCerts.cnt > 0) {
      score -= expiringCerts.cnt * 10;
    }
  } else if (systemType === 'storagegrid') {
    // Certificate expiry
    const expiringCerts = db.prepare(`
      SELECT COUNT(*) AS cnt FROM sg_certificates
      WHERE system_id = @systemId
        AND not_after IS NOT NULL
        AND not_after <= datetime('now', '+30 days')
        AND not_after > datetime('now')
    `).get({ systemId });
    if (expiringCerts && expiringCerts.cnt > 0) {
      score -= expiringCerts.cnt * 15;
    }
  }

  return clamp(score, 0, 100);
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Calculate and persist a composite health score for a system.
 *
 * The score is a weighted sum of six dimensions:
 *
 * | Dimension    | Weight |
 * |-------------|--------|
 * | Issues       | 30 %   |
 * | Capacity     | 20 %   |
 * | Currency     | 15 %   |
 * | Protection   | 15 %   |
 * | Performance  | 10 %   |
 * | Security     | 10 %   |
 *
 * @param {number} systemId - Primary key of the system.
 * @returns {{
 *   systemId: number,
 *   overall: number,
 *   issues: number,
 *   capacity: number,
 *   currency: number,
 *   protection: number,
 *   performance: number,
 *   security: number,
 * }}
 */
function calculateHealthScore(systemId) {
  const db = getDb();

  const system = db.prepare('SELECT * FROM systems WHERE id = ?').get(systemId);
  if (!system) {
    logger.warn(`[HealthScore] System id=${systemId} not found`);
    return null;
  }

  const systemType = system.type;

  // Calculate each dimension
  const issuesScore = scoreIssues(db, systemId);
  const capacityScore = scoreCapacity(db, systemId);
  const currencyScore = scoreCurrency(db, systemId, systemType);
  const protectionScore = scoreProtection(db, systemId, systemType);
  const performanceScore = scorePerformance(db, systemId);
  const securityScore = scoreSecurity(db, systemId, systemType);

  // Weighted overall score
  const overall = clamp(
    Math.round(
      issuesScore * WEIGHTS.issues +
      capacityScore * WEIGHTS.capacity +
      currencyScore * WEIGHTS.currency +
      protectionScore * WEIGHTS.protection +
      performanceScore * WEIGHTS.performance +
      securityScore * WEIGHTS.security
    ),
    0,
    100
  );

  const now = nowUtc();
  const details = {
    issues: issuesScore,
    capacity: capacityScore,
    currency: currencyScore,
    protection: protectionScore,
    performance: performanceScore,
    security: securityScore,
  };

  // Insert into health_scores
  db.prepare(`
    INSERT INTO health_scores
      (system_id, overall_score, performance_score, capacity_score,
       protection_score, security_score, configuration_score,
       details_json, scored_at, created_at)
    VALUES
      (@systemId, @overall, @performanceScore, @capacityScore,
       @protectionScore, @securityScore, @configurationScore,
       @detailsJson, @now, @now)
  `).run({
    systemId,
    overall,
    performanceScore,
    capacityScore,
    protectionScore,
    securityScore,
    configurationScore: currencyScore, // map currency → configuration in schema
    detailsJson: JSON.stringify(details),
    now,
  });

  logger.info(
    `[HealthScore] System "${system.name}": overall=${overall} ` +
    `(issues=${issuesScore} cap=${capacityScore} cur=${currencyScore} ` +
    `prot=${protectionScore} perf=${performanceScore} sec=${securityScore})`
  );

  return {
    systemId,
    overall,
    ...details,
  };
}

/**
 * Calculate and persist health scores for every registered system.
 *
 * @returns {Object[]} Array of score results, one per system.
 */
function calculateAllHealthScores() {
  const db = getDb();
  const systems = db.prepare('SELECT id, name FROM systems').all();
  const results = [];

  for (const sys of systems) {
    try {
      const score = calculateHealthScore(sys.id);
      if (score) results.push(score);
    } catch (err) {
      logger.error(`[HealthScore] Failed for system "${sys.name}": ${err.message}`);
    }
  }

  logger.info(
    `[HealthScore] calculateAllHealthScores complete: ${results.length}/${systems.length} systems scored`
  );
  return results;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  calculateHealthScore,
  calculateAllHealthScores,
};
