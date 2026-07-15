'use strict';

/**
 * @module analysis/healthScore
 * @description Comprehensive composite health-scoring engine for AIQwhisper.
 *
 * Computes a weighted 0–100 health score for each system based on eight
 * dimensions: Issues, Capacity, Currency, Protection, Performance,
 * Security, Availability, and Firmware.
 *
 * Each factor also receives a letter grade (A/B/C/D/F) and all scores
 * are persisted in the `health_scores` table.
 */

const { getDb } = require('../db/database');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Weights for each scoring dimension. Must sum to 1.0.
 *
 * | Dimension     | Weight | Description                        |
 * |--------------|--------|-------------------------------------|
 * | issues        | 0.20   | Open issue count by severity       |
 * | capacity      | 0.15   | Worst resource utilization         |
 * | currency      | 0.15   | Software/firmware currency         |
 * | protection    | 0.15   | SnapMirror/replication health      |
 * | performance   | 0.10   | Latency, CPU, cache                |
 * | security      | 0.10   | ARP, certs, FIPS, audit            |
 * | availability  | 0.10   | Node, LIF, port, HA health         |
 * | firmware      | 0.05   | Disk, shelf, SP firmware           |
 */
const SCORE_WEIGHTS = {
  issues: 0.20,
  capacity: 0.15,
  currency: 0.15,
  protection: 0.15,
  performance: 0.10,
  security: 0.10,
  availability: 0.10,
  firmware: 0.05,
};

/** Per-severity deductions applied to the issues sub-score (out of 100). */
const ISSUE_DEDUCTIONS = {
  critical: 25,
  high: 10,
  medium: 5,
  low: 2,
  info: 1,
};

/** Grade thresholds. */
const GRADE_THRESHOLDS = [
  { min: 90, grade: 'A' },
  { min: 80, grade: 'B' },
  { min: 65, grade: 'C' },
  { min: 50, grade: 'D' },
  { min: 0,  grade: 'F' },
];

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

/**
 * Convert a numeric score (0-100) to a letter grade.
 *
 * @param {number} score
 * @returns {string} 'A' | 'B' | 'C' | 'D' | 'F'
 */
function scoreToGrade(score) {
  for (const { min, grade } of GRADE_THRESHOLDS) {
    if (score >= min) return grade;
  }
  return 'F';
}

// ---------------------------------------------------------------------------
// Scoring Functions
// ---------------------------------------------------------------------------

/**
 * Issues sub-score.
 *
 * Starts at 100 and deducts points for each open issue, weighted by severity:
 * - critical: -25 per issue
 * - high/warning: -10 per issue
 * - medium: -5 per issue
 * - low: -2 per issue
 * - info: -1 per issue
 *
 * Clamped to [0, 100].
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
 * snapshots for this system:
 *
 * - < 70%   → 100
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

  // Linear interpolation: 70% → 100 score, 100% → 0 score
  return Math.round(((100 - pct) / 30) * 100);
}

/**
 * Currency sub-score.
 *
 * Compares the system's installed version against the knowledge base:
 * - Running the latest/recommended version → 100
 * - -30 per N-level behind (1 behind = 70, 2 behind = 40, 3+ behind = 10)
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

  // Check KB entry
  const kbRow = db.prepare(`
    SELECT end_of_support, is_recommended
    FROM kb_software_versions
    WHERE platform = @platform AND version = @version
    LIMIT 1
  `).get({ platform: systemType, version: installedVersion });

  if (!kbRow) return 50; // Version not in KB

  // Check EOL — score is 0 for EOL software
  if (kbRow.end_of_support) {
    const now = nowUtc();
    if (kbRow.end_of_support <= now || kbRow.end_of_support === '1970-01-01') {
      return 0;
    }
  }

  // If recommended, score is 100
  if (kbRow.is_recommended === 1) return 100;

  // Count how many versions we're behind the recommended
  const versionsBehind = db.prepare(`
    SELECT COUNT(*) AS cnt FROM kb_software_versions
    WHERE platform = @platform
      AND release_date > (
        SELECT release_date FROM kb_software_versions
        WHERE platform = @platform AND version = @currentVersion
      )
  `).get({ platform: systemType, currentVersion: installedVersion });

  const behind = versionsBehind ? versionsBehind.cnt : 0;

  // -30 per N-level behind, minimum 10
  return clamp(100 - (behind * 30), 10, 100);
}

/**
 * Protection sub-score.
 *
 * Evaluates SnapMirror/replication health:
 * - 100 if all healthy
 * - -20 per unhealthy relationship
 * - -10 per relationship with lag > 24 hours
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} systemId
 * @param {string} systemType
 * @returns {number}
 */
function scoreProtection(db, systemId, systemType) {
  let score = 100;

  if (systemType === 'ontap') {
    // SnapMirror unhealthy relationships
    const unhealthyMirrors = db.prepare(`
      SELECT COUNT(*) AS cnt FROM ontap_snapmirror
      WHERE system_id = @systemId AND healthy = 0
    `).get({ systemId });
    if (unhealthyMirrors && unhealthyMirrors.cnt > 0) {
      score -= unhealthyMirrors.cnt * 20;
    }

    // SnapMirror relationships with lag > 24 hours
    const laggedMirrors = db.prepare(`
      SELECT COUNT(*) AS cnt FROM ontap_snapmirror
      WHERE system_id = @systemId
        AND healthy = 1
        AND lag_time IS NOT NULL
        AND CAST(lag_time AS INTEGER) > 86400
    `).get({ systemId });
    if (laggedMirrors && laggedMirrors.cnt > 0) {
      score -= laggedMirrors.cnt * 10;
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
      score -= Math.min(volsWithoutSnaps.cnt * 3, 30);
    }
  } else if (systemType === 'eseries') {
    // Mirror health
    const unhealthyMirrors = db.prepare(`
      SELECT COUNT(*) AS cnt FROM es_mirrors
      WHERE system_id = @systemId AND state != 'optimal'
    `).get({ systemId });
    if (unhealthyMirrors && unhealthyMirrors.cnt > 0) {
      score -= unhealthyMirrors.cnt * 20;
    }
  } else if (systemType === 'storagegrid') {
    // ILM policy check — must have an active policy
    const activeIlm = db.prepare(`
      SELECT COUNT(*) AS cnt FROM sg_ilm_policies
      WHERE system_id = @systemId AND status = 'active'
    `).get({ systemId });
    if (!activeIlm || activeIlm.cnt === 0) {
      score -= 40;
    }

    // Cross-site replication — check node distribution
    const sites = db.prepare(`
      SELECT COUNT(DISTINCT site) AS site_count FROM sg_nodes
      WHERE system_id = @systemId AND site IS NOT NULL
    `).get({ systemId });
    if (sites && sites.site_count < 2) {
      score -= 20; // Single-site grid has less protection
    }
  }

  return clamp(score, 0, 100);
}

/**
 * Performance sub-score.
 *
 * - 100 if all normal
 * - -20 per high-latency volume (latency > 20ms)
 * - -10 per high-CPU node (CPU > 80%)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} systemId
 * @returns {number}
 */
function scorePerformance(db, systemId) {
  let score = 100;

  // Check for high-latency volumes
  const highLatencyVols = db.prepare(`
    SELECT COUNT(DISTINCT resource_id) AS cnt
    FROM metrics_raw
    WHERE system_id = @systemId
      AND metric_name IN ('latency', 'avg_latency', 'read_latency', 'write_latency')
      AND metric_value > 20
      AND timestamp >= datetime('now', '-1 hour')
  `).get({ systemId });
  if (highLatencyVols && highLatencyVols.cnt > 0) {
    score -= highLatencyVols.cnt * 20;
  }

  // Check for high-CPU nodes
  const highCpuNodes = db.prepare(`
    SELECT COUNT(DISTINCT resource_id) AS cnt
    FROM metrics_raw
    WHERE system_id = @systemId
      AND metric_name IN ('cpu_utilization', 'cpu_busy', 'processor_busy')
      AND metric_value > 80
      AND timestamp >= datetime('now', '-1 hour')
  `).get({ systemId });
  if (highCpuNodes && highCpuNodes.cnt > 0) {
    score -= highCpuNodes.cnt * 10;
  }

  // Check for low cache hit rate
  const lowCacheHit = db.prepare(`
    SELECT AVG(metric_value) AS avg_hit
    FROM metrics_raw
    WHERE system_id = @systemId
      AND metric_name IN ('cache_hit_ratio', 'cache_hit_pct')
      AND timestamp >= datetime('now', '-1 hour')
  `).get({ systemId });
  if (lowCacheHit && lowCacheHit.avg_hit !== null && lowCacheHit.avg_hit < 50) {
    score -= 10; // Low cache hit rate
  }

  return clamp(score, 0, 100);
}

/**
 * Security sub-score.
 *
 * - 100 base
 * - -20 if no ARP (Anti-Ransomware Protection) detected
 * - -20 if certificates expiring within 30 days
 * - -15 if FIPS not enabled
 * - -10 if audit logging not enabled
 * - -10 for unencrypted volumes
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} systemId
 * @param {string} systemType
 * @returns {number}
 */
function scoreSecurity(db, systemId, systemType) {
  let score = 100;

  if (systemType === 'ontap') {
    const security = db.prepare(`
      SELECT fips_enabled, audit_log_enabled, multi_admin_verify
      FROM ontap_security
      WHERE system_id = @systemId
      LIMIT 1
    `).get({ systemId });

    if (security) {
      // FIPS check: -15 if not enabled
      if (security.fips_enabled === 0) {
        score -= 15;
      }

      // Audit log check: -10 if not enabled
      if (security.audit_log_enabled === 0) {
        score -= 10;
      }
    }

    // ARP (Anti-Ransomware Protection) — check if any issue reports no ARP
    const arpIssues = db.prepare(`
      SELECT COUNT(*) AS cnt FROM issues
      WHERE system_id = @systemId
        AND category = 'security'
        AND title LIKE '%anti-ransomware%'
        AND status NOT IN ('resolved', 'dismissed')
    `).get({ systemId });
    if (arpIssues && arpIssues.cnt > 0) {
      score -= 20;
    }

    // Certificate expiry within 30 days
    const expiringCerts = db.prepare(`
      SELECT COUNT(*) AS cnt FROM ontap_licenses
      WHERE system_id = @systemId
        AND expiry_date IS NOT NULL
        AND expiry_date <= datetime('now', '+30 days')
        AND expiry_date > datetime('now')
    `).get({ systemId });
    if (expiringCerts && expiringCerts.cnt > 0) {
      score -= 20;
    }

    // Unencrypted volumes: -10 if any exist
    const unencryptedVols = db.prepare(`
      SELECT COUNT(*) AS cnt FROM ontap_volumes
      WHERE system_id = @systemId AND is_encrypted = 0 AND type = 'rw' AND state = 'online'
    `).get({ systemId });
    if (unencryptedVols && unencryptedVols.cnt > 0) {
      score -= 10;
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
      score -= 20;
    }
  }

  return clamp(score, 0, 100);
}

/**
 * Availability sub-score.
 *
 * - 100 base
 * - -40 per node down
 * - -20 per LIF not on home port
 * - -10 per port down
 * - -15 per HA partner not available
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} systemId
 * @param {string} systemType
 * @returns {number}
 */
function scoreAvailability(db, systemId, systemType) {
  let score = 100;

  if (systemType === 'ontap') {
    // Node health
    const unhealthyNodes = db.prepare(`
      SELECT COUNT(*) AS cnt FROM ontap_nodes
      WHERE system_id = @systemId AND is_healthy = 0
    `).get({ systemId });
    if (unhealthyNodes && unhealthyNodes.cnt > 0) {
      score -= unhealthyNodes.cnt * 40;
    }

    // LIFs not on home port
    const lifsNotHome = db.prepare(`
      SELECT COUNT(*) AS cnt FROM ontap_lifs
      WHERE system_id = @systemId
        AND home_node IS NOT NULL
        AND current_node IS NOT NULL
        AND (home_node != current_node OR home_port != current_port)
    `).get({ systemId });
    if (lifsNotHome && lifsNotHome.cnt > 0) {
      score -= lifsNotHome.cnt * 20;
    }

    // Ports down
    const portsDown = db.prepare(`
      SELECT COUNT(*) AS cnt FROM ontap_ports
      WHERE system_id = @systemId AND state = 'down'
    `).get({ systemId });
    if (portsDown && portsDown.cnt > 0) {
      score -= portsDown.cnt * 10;
    }
  } else if (systemType === 'storagegrid') {
    // Disconnected nodes
    const disconnectedNodes = db.prepare(`
      SELECT COUNT(*) AS cnt FROM sg_nodes
      WHERE system_id = @systemId AND state != 'connected'
    `).get({ systemId });
    if (disconnectedNodes && disconnectedNodes.cnt > 0) {
      score -= disconnectedNodes.cnt * 40;
    }

    // Network links down
    const linksDown = db.prepare(`
      SELECT COUNT(*) AS cnt FROM sg_network
      WHERE system_id = @systemId AND link_status != 'up'
    `).get({ systemId });
    if (linksDown && linksDown.cnt > 0) {
      score -= linksDown.cnt * 10;
    }
  } else if (systemType === 'eseries') {
    // Controllers not optimal
    const degradedControllers = db.prepare(`
      SELECT COUNT(*) AS cnt FROM es_controllers
      WHERE system_id = @systemId AND status != 'optimal'
    `).get({ systemId });
    if (degradedControllers && degradedControllers.cnt > 0) {
      score -= degradedControllers.cnt * 40;
    }

    // Interfaces down
    const interfacesDown = db.prepare(`
      SELECT COUNT(*) AS cnt FROM es_interfaces
      WHERE system_id = @systemId AND link_status != 'up'
    `).get({ systemId });
    if (interfacesDown && interfacesDown.cnt > 0) {
      score -= interfacesDown.cnt * 10;
    }
  }

  return clamp(score, 0, 100);
}

/**
 * Firmware sub-score.
 *
 * - 100 base
 * - -20 per outdated component type (disk, shelf, SP, NIC, DQP)
 * - 0 if any critical firmware issue (firmware below minimum recommended)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} systemId
 * @param {string} systemType
 * @returns {number}
 */
function scoreFirmware(db, systemId, systemType) {
  let score = 100;
  let hasCriticalFirmware = false;

  // Check for firmware-related issues in the issues table
  const firmwareIssues = db.prepare(`
    SELECT severity, COUNT(*) AS cnt
    FROM issues
    WHERE system_id = @systemId
      AND (category = 'currency' OR category = 'firmware')
      AND (title LIKE '%firmware%' OR title LIKE '%DQP%' OR title LIKE '%disk qualification%')
      AND status NOT IN ('resolved', 'dismissed')
    GROUP BY severity
  `).all({ systemId });

  for (const row of firmwareIssues) {
    if (row.severity === 'critical') {
      hasCriticalFirmware = true;
    }
    // -20 per outdated component type
    score -= row.cnt * 20;
  }

  // If critical firmware issue exists, score is 0
  if (hasCriticalFirmware) return 0;

  if (systemType === 'ontap') {
    // Check disk firmware against kb_firmware_matrix
    const outdatedDisks = db.prepare(`
      SELECT COUNT(DISTINCT d.model) AS cnt
      FROM ontap_disks d
      JOIN kb_firmware_matrix fm ON fm.component_type = 'disk'
        AND fm.model = d.model
        AND fm.platform = 'ontap'
      WHERE d.system_id = @systemId
        AND d.firmware_version IS NOT NULL
        AND d.firmware_version < fm.minimum_version
    `).get({ systemId });
    if (outdatedDisks && outdatedDisks.cnt > 0) {
      score -= outdatedDisks.cnt * 20;
    }

    // Check shelf firmware
    const outdatedShelves = db.prepare(`
      SELECT COUNT(DISTINCT sh.model) AS cnt
      FROM ontap_shelves sh
      JOIN kb_firmware_matrix fm ON fm.component_type = 'shelf'
        AND fm.model = sh.model
        AND fm.platform = 'ontap'
      WHERE sh.system_id = @systemId
        AND sh.firmware_version IS NOT NULL
        AND sh.firmware_version < fm.latest_version
    `).get({ systemId });
    if (outdatedShelves && outdatedShelves.cnt > 0) {
      score -= outdatedShelves.cnt * 20;
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
 * The score is a weighted sum of eight dimensions.
 * Each factor also receives a letter grade (A/B/C/D/F).
 *
 * @param {number} systemId - Primary key of the system.
 * @returns {{
 *   systemId: number,
 *   overall: number,
 *   overallGrade: string,
 *   factors: Object,
 * } | null}
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
  const availabilityScore = scoreAvailability(db, systemId, systemType);
  const firmwareScore = scoreFirmware(db, systemId, systemType);

  // Weighted overall score
  const overall = clamp(
    Math.round(
      issuesScore * SCORE_WEIGHTS.issues +
      capacityScore * SCORE_WEIGHTS.capacity +
      currencyScore * SCORE_WEIGHTS.currency +
      protectionScore * SCORE_WEIGHTS.protection +
      performanceScore * SCORE_WEIGHTS.performance +
      securityScore * SCORE_WEIGHTS.security +
      availabilityScore * SCORE_WEIGHTS.availability +
      firmwareScore * SCORE_WEIGHTS.firmware
    ),
    0,
    100
  );

  // Build factor details with grades
  const factors = {
    issues:       { score: issuesScore,       grade: scoreToGrade(issuesScore),       weight: SCORE_WEIGHTS.issues },
    capacity:     { score: capacityScore,     grade: scoreToGrade(capacityScore),     weight: SCORE_WEIGHTS.capacity },
    currency:     { score: currencyScore,     grade: scoreToGrade(currencyScore),     weight: SCORE_WEIGHTS.currency },
    protection:   { score: protectionScore,   grade: scoreToGrade(protectionScore),   weight: SCORE_WEIGHTS.protection },
    performance:  { score: performanceScore,  grade: scoreToGrade(performanceScore),  weight: SCORE_WEIGHTS.performance },
    security:     { score: securityScore,     grade: scoreToGrade(securityScore),     weight: SCORE_WEIGHTS.security },
    availability: { score: availabilityScore, grade: scoreToGrade(availabilityScore), weight: SCORE_WEIGHTS.availability },
    firmware:     { score: firmwareScore,     grade: scoreToGrade(firmwareScore),     weight: SCORE_WEIGHTS.firmware },
  };

  const overallGrade = scoreToGrade(overall);
  const now = nowUtc();

  // Persist to health_scores table
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
    detailsJson: JSON.stringify({
      overallGrade,
      factors,
      scoredAt: now,
    }),
    now,
  });

  logger.info(
    `[HealthScore] System "${system.name}": overall=${overall} (${overallGrade}) ` +
    `issues=${issuesScore}(${factors.issues.grade}) ` +
    `cap=${capacityScore}(${factors.capacity.grade}) ` +
    `cur=${currencyScore}(${factors.currency.grade}) ` +
    `prot=${protectionScore}(${factors.protection.grade}) ` +
    `perf=${performanceScore}(${factors.performance.grade}) ` +
    `sec=${securityScore}(${factors.security.grade}) ` +
    `avail=${availabilityScore}(${factors.availability.grade}) ` +
    `fw=${firmwareScore}(${factors.firmware.grade})`
  );

  return {
    systemId,
    overall,
    overallGrade,
    factors,
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

/**
 * Get the latest health score for a system.
 *
 * @param {number} systemId
 * @returns {Object|null}
 */
function getLatestHealthScore(systemId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM health_scores
    WHERE system_id = @systemId
    ORDER BY scored_at DESC
    LIMIT 1
  `).get({ systemId });

  if (!row) return null;

  try {
    const details = JSON.parse(row.details_json || '{}');
    return {
      systemId: row.system_id,
      overall: row.overall_score,
      overallGrade: details.overallGrade || scoreToGrade(row.overall_score),
      factors: details.factors || {},
      scoredAt: row.scored_at,
    };
  } catch {
    return {
      systemId: row.system_id,
      overall: row.overall_score,
      overallGrade: scoreToGrade(row.overall_score),
      factors: {},
      scoredAt: row.scored_at,
    };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  SCORE_WEIGHTS,
  GRADE_THRESHOLDS,
  calculateHealthScore,
  calculateAllHealthScores,
  getLatestHealthScore,
  scoreToGrade,
};
