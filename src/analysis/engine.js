'use strict';

/**
 * @module analysis/engine
 * @description Best-practice rules engine for AIQwhisper.
 *
 * Loads enabled rules from the `best_practice_rules` table, executes each
 * rule's `check_query` (a SQL SELECT that returns rows when a problem is
 * detected), and creates or resolves issue records accordingly.
 *
 * Built-in rules are seeded from JSON files shipped in the `rules/`
 * subdirectory the first time the engine is initialised.
 */

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the current UTC datetime as an ISO-8601 string (no "T", no millis),
 * matching SQLite's `datetime('now')` output.
 *
 * @returns {string} e.g. "2026-07-15 16:45:00"
 */
function nowUtc() {
  return new Date().toISOString().replace('T', ' ').replace(/\.?\d{3}Z$/, '');
}

/**
 * Mapping from JSON rule file names to the rule set they represent.
 * @type {string[]}
 */
const RULE_FILES = [
  'ontap-rules.json',
  'storagegrid-rules.json',
  'eseries-rules.json',
  'capacity-rules.json',
  'currency-rules.json',
];

// ---------------------------------------------------------------------------
// RulesEngine
// ---------------------------------------------------------------------------

/**
 * Best-practice rules engine.
 *
 * Loads rules from the database, executes their check queries against a
 * given system's collected data, and manages the lifecycle of detected
 * issues (creation, deduplication, auto-resolution).
 *
 * @class RulesEngine
 */
class RulesEngine {
  /**
   * Create a RulesEngine.
   *
   * @param {import('better-sqlite3').Database} [db] - Database handle.
   *   Defaults to the singleton returned by `getDb()`.
   */
  constructor(db) {
    /** @type {import('better-sqlite3').Database} */
    this.db = db || getDb();
  }

  // -----------------------------------------------------------------------
  // Rule loading
  // -----------------------------------------------------------------------

  /**
   * Load all enabled rules from the `best_practice_rules` table.
   *
   * @returns {Array<Object>} Array of rule rows.
   */
  loadRules() {
    return this.db.prepare(`
      SELECT * FROM best_practice_rules
      WHERE enabled = 1
      ORDER BY platform, category, severity
    `).all();
  }

  /**
   * Load enabled rules that apply to a specific platform.
   *
   * Returns rules whose platform matches the given value **or** is `'all'`.
   *
   * @param {string} platform - `'ontap'` | `'storagegrid'` | `'eseries'`
   * @returns {Array<Object>}
   */
  loadRulesForPlatform(platform) {
    return this.db.prepare(`
      SELECT * FROM best_practice_rules
      WHERE enabled = 1
        AND (platform = @platform OR platform = 'all')
      ORDER BY category, severity
    `).all({ platform });
  }

  // -----------------------------------------------------------------------
  // Analysis
  // -----------------------------------------------------------------------

  /**
   * Run all applicable rules against a single registered system.
   *
   * 1. Determine the system's platform type.
   * 2. Load rules for that platform plus cross-platform (`'all'`) rules.
   * 3. For each rule, execute its `check_query` with the system id.
   * 4. If the query returns rows, create (or deduplicate) issue records.
   * 5. Auto-resolve any previously-open issues that are no longer detected.
   *
   * @param {number} systemId - Primary key of the system to analyse.
   * @returns {Promise<{issuesCreated: number, issuesResolved: number}>}
   */
  async analyze(systemId) {
    const system = this.db.prepare('SELECT * FROM systems WHERE id = ?').get(systemId);
    if (!system) {
      logger.warn(`[RulesEngine] System id=${systemId} not found — skipping`);
      return { issuesCreated: 0, issuesResolved: 0 };
    }

    const platform = system.type;
    const rules = this.loadRulesForPlatform(platform);
    logger.debug(`[RulesEngine] Evaluating ${rules.length} rules for system "${system.name}" (${platform})`);

    let issuesCreated = 0;
    let issuesResolved = 0;

    /** @type {Set<string>} Keys of issues detected in this run. */
    const detectedKeys = new Set();

    for (const rule of rules) {
      if (!rule.check_query) continue;

      let rows;
      try {
        rows = this.db.prepare(rule.check_query).all(systemId);
      } catch (err) {
        logger.error(
          `[RulesEngine] Query failed for rule "${rule.rule_name}" (id=${rule.id}): ${err.message}`
        );
        continue;
      }

      for (const row of rows) {
        const resourceName = row.affected_resource || row.name || row.resource_id || 'unknown';
        const resourceType = rule.category || 'general';
        const resourceId = String(resourceName);
        const issueKey = `${rule.id}:${systemId}:${resourceId}`;
        detectedKeys.add(issueKey);

        // Check for existing open issue to avoid duplicates
        const existing = this.db.prepare(`
          SELECT id FROM issues
          WHERE system_id = @systemId
            AND rule_id = @ruleId
            AND resource_id = @resourceId
            AND status NOT IN ('resolved', 'dismissed')
          LIMIT 1
        `).get({ systemId, ruleId: rule.id, resourceId });

        if (existing) {
          // Issue already tracked — update the timestamp
          const now = nowUtc();
          this.db.prepare(`
            UPDATE issues SET updated_at = @now WHERE id = @id
          `).run({ now, id: existing.id });
          continue;
        }

        // Build description from rule + query result
        const details = Object.entries(row)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        const description = `${rule.description || rule.rule_name}. Detected: ${details}`;
        const now = nowUtc();

        this.db.prepare(`
          INSERT INTO issues
            (system_id, resource_type, resource_id, severity, category,
             title, description, rule_id, status, detected_at, created_at, updated_at)
          VALUES
            (@systemId, @resourceType, @resourceId, @severity, @category,
             @title, @description, @ruleId, 'open', @now, @now, @now)
        `).run({
          systemId,
          resourceType,
          resourceId,
          severity: rule.severity,
          category: rule.category,
          title: `${rule.rule_name}: ${resourceName}`,
          description,
          ruleId: rule.id,
          now,
        });
        issuesCreated++;
      }
    }

    // -----------------------------------------------------------------------
    // Auto-resolve issues that are no longer detected
    // -----------------------------------------------------------------------
    const ruleIds = rules.map((r) => r.id);
    if (ruleIds.length > 0) {
      const openIssues = this.db.prepare(`
        SELECT id, rule_id, resource_id FROM issues
        WHERE system_id = @systemId
          AND rule_id IN (${ruleIds.join(',')})
          AND status NOT IN ('resolved', 'dismissed')
      `).all({ systemId });

      const now = nowUtc();
      const resolveStmt = this.db.prepare(`
        UPDATE issues
        SET status = 'resolved', resolved_at = @now, updated_at = @now
        WHERE id = @id
      `);

      for (const issue of openIssues) {
        const key = `${issue.rule_id}:${systemId}:${issue.resource_id}`;
        if (!detectedKeys.has(key)) {
          resolveStmt.run({ now, id: issue.id });
          issuesResolved++;
        }
      }
    }

    logger.info(
      `[RulesEngine] System "${system.name}": ${issuesCreated} new issues, ${issuesResolved} resolved`
    );
    return { issuesCreated, issuesResolved };
  }

  /**
   * Run analysis for every registered system.
   *
   * @returns {Promise<{total: {issuesCreated: number, issuesResolved: number}, perSystem: Object[]}>}
   */
  async analyzeAll() {
    const systems = this.db.prepare('SELECT id, name FROM systems').all();
    const perSystem = [];
    let totalCreated = 0;
    let totalResolved = 0;

    for (const sys of systems) {
      const result = await this.analyze(sys.id);
      perSystem.push({ systemId: sys.id, name: sys.name, ...result });
      totalCreated += result.issuesCreated;
      totalResolved += result.issuesResolved;
    }

    logger.info(
      `[RulesEngine] analyzeAll complete: ${totalCreated} created, ${totalResolved} resolved across ${systems.length} systems`
    );
    return {
      total: { issuesCreated: totalCreated, issuesResolved: totalResolved },
      perSystem,
    };
  }

  // -----------------------------------------------------------------------
  // Seeding
  // -----------------------------------------------------------------------

  /**
   * Seed the `best_practice_rules` table with built-in rules shipped as
   * JSON files in the `rules/` subdirectory.
   *
   * Uses `INSERT OR IGNORE` so existing rules (matched by rule_name +
   * platform) are never overwritten.  This makes the function safe to call
   * on every startup.
   *
   * @returns {number} Total number of rules inserted (ignoring duplicates).
   */
  seedBuiltinRules() {
    const rulesDir = path.join(__dirname, 'rules');
    if (!fs.existsSync(rulesDir)) {
      logger.warn(`[RulesEngine] Rules directory not found: ${rulesDir}`);
      return 0;
    }

    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO best_practice_rules
        (platform, category, rule_name, description, severity,
         check_query, remediation, enabled, created_at, updated_at)
      VALUES
        (@platform, @category, @rule_name, @description, @severity,
         @check_query, @remediation, @enabled, @created_at, @updated_at)
    `);

    let totalInserted = 0;
    const now = nowUtc();

    const seed = this.db.transaction((files) => {
      for (const fileName of files) {
        const filePath = path.join(rulesDir, fileName);
        if (!fs.existsSync(filePath)) {
          logger.debug(`[RulesEngine] Rule file not found, skipping: ${fileName}`);
          continue;
        }

        let rules;
        try {
          rules = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (err) {
          logger.error(`[RulesEngine] Failed to parse ${fileName}: ${err.message}`);
          continue;
        }

        if (!Array.isArray(rules)) {
          logger.warn(`[RulesEngine] ${fileName} does not contain a JSON array — skipping`);
          continue;
        }

        for (const rule of rules) {
          const info = insertStmt.run({
            platform: rule.platform || 'all',
            category: rule.category || 'general',
            rule_name: rule.name || rule.id,
            description: rule.description || '',
            severity: rule.severity || 'medium',
            check_query: rule.check_query || null,
            remediation: rule.remediation_template || rule.remediation || null,
            enabled: rule.enabled !== false ? 1 : 0,
            created_at: now,
            updated_at: now,
          });
          totalInserted += info.changes;
        }

        logger.debug(`[RulesEngine] Processed rule file: ${fileName} (${rules.length} rules)`);
      }
    });

    seed(RULE_FILES);
    logger.info(`[RulesEngine] Seeded ${totalInserted} new built-in rules`);
    return totalInserted;
  }
}

module.exports = RulesEngine;
