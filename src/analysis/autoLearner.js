'use strict';

/**
 * @module analysis/autoLearner
 * @description Auto-learning engine that fetches software lifecycle data
 * from public sources (endoflife.date API), updates the local knowledge
 * base, and checks installed software versions against known end-of-life
 * and end-of-support dates.
 */

const axios = require('axios');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');
const config = require('../config');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Products to query from the endoflife.date API, mapped to AIQwhisper
 * platform identifiers.
 *
 * @type {Array<{platform: string, slug: string}>}
 */
const PRODUCTS = [
  { platform: 'ontap', slug: 'netapp-ontap' },
  { platform: 'storagegrid', slug: 'netapp-storagegrid' },
  { platform: 'eseries', slug: 'netapp-e-series-santricity-os' },
];

/** Request timeout for external API calls (milliseconds). */
const API_TIMEOUT = 30_000;

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
 * Build an absolute URL for a product's lifecycle data.
 *
 * @param {string} slug - Product slug on endoflife.date.
 * @returns {string}
 */
function buildApiUrl(slug) {
  const base = config.autoLearn.eolApiUrl.replace(/\/+$/, '');
  return `${base}/${slug}.json`;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Fetch software lifecycle data from the endoflife.date API for all
 * configured products and upsert results into `kb_software_versions`.
 *
 * The API returns an array of version objects with fields like:
 * - `cycle` (version string)
 * - `releaseDate`
 * - `eol` (boolean or date string)
 * - `lts` (boolean)
 * - `latest` (latest patch version in this cycle)
 *
 * @returns {Promise<{fetched: number, upserted: number, errors: string[]}>}
 */
async function fetchLifecycleData() {
  const db = getDb();
  let totalFetched = 0;
  let totalUpserted = 0;
  const errors = [];

  const upsertStmt = db.prepare(`
    INSERT INTO kb_software_versions
      (platform, version, release_date, end_of_support,
       is_recommended, known_issues, created_at, updated_at)
    VALUES
      (@platform, @version, @release_date, @end_of_support,
       @is_recommended, @known_issues, @created_at, @updated_at)
    ON CONFLICT (platform, version) DO UPDATE SET
      release_date    = excluded.release_date,
      end_of_support  = excluded.end_of_support,
      is_recommended  = excluded.is_recommended,
      known_issues    = excluded.known_issues,
      updated_at      = excluded.updated_at
  `);

  for (const product of PRODUCTS) {
    const url = buildApiUrl(product.slug);
    logger.info(`[AutoLearner] Fetching lifecycle data: ${url}`);

    let data;
    try {
      const response = await axios.get(url, {
        timeout: API_TIMEOUT,
        headers: { Accept: 'application/json' },
      });
      data = response.data;
    } catch (err) {
      const msg = `Failed to fetch ${product.slug}: ${err.message}`;
      logger.warn(`[AutoLearner] ${msg}`);
      errors.push(msg);
      continue;
    }

    if (!Array.isArray(data)) {
      const msg = `Unexpected response format for ${product.slug} — expected array`;
      logger.warn(`[AutoLearner] ${msg}`);
      errors.push(msg);
      continue;
    }

    totalFetched += data.length;
    const now = nowUtc();

    const batchInsert = db.transaction((cycles) => {
      for (const cycle of cycles) {
        // Determine end-of-support date
        let endOfSupport = null;
        if (typeof cycle.eol === 'string') {
          endOfSupport = cycle.eol;
        } else if (cycle.eol === true) {
          // Product is EOL but no specific date — mark as past
          endOfSupport = '1970-01-01';
        }

        // Determine if this is the recommended version
        // The first entry (index 0) in the array is typically the latest
        const isLatest = cycle === cycles[0];
        const isRecommended = (isLatest || cycle.lts === true) ? 1 : 0;

        const version = String(cycle.cycle || cycle.latest || cycle.version || '');
        if (!version) continue;

        const info = upsertStmt.run({
          platform: product.platform,
          version,
          release_date: cycle.releaseDate || null,
          end_of_support: endOfSupport,
          is_recommended: isRecommended,
          known_issues: cycle.link ? JSON.stringify({ releaseNotes: cycle.link }) : null,
          created_at: now,
          updated_at: now,
        });

        totalUpserted += info.changes;
      }
    });

    batchInsert(data);
    logger.info(
      `[AutoLearner] Processed ${data.length} cycles for ${product.platform}`
    );
  }

  logger.info(
    `[AutoLearner] fetchLifecycleData complete: fetched=${totalFetched}, upserted=${totalUpserted}, errors=${errors.length}`
  );
  return { fetched: totalFetched, upserted: totalUpserted, errors };
}

/**
 * Compare installed software versions across all systems against the
 * knowledge base to identify outdated or end-of-life installations.
 *
 * Creates issues for:
 * - Systems running EOL / EOS software (critical)
 * - Systems not running the recommended version (warning)
 *
 * @returns {{checked: number, issuesCreated: number}}
 */
function checkSoftwareCurrency() {
  const db = getDb();
  const now = nowUtc();
  let checked = 0;
  let issuesCreated = 0;

  /**
   * @type {Array<{table: string, versionCol: string, platform: string, nameCol: string}>}
   */
  const platformChecks = [
    { table: 'ontap_clusters', versionCol: 'version', platform: 'ontap', nameCol: 'name' },
    { table: 'sg_grids', versionCol: 'version', platform: 'storagegrid', nameCol: 'name' },
    { table: 'es_arrays', versionCol: 'firmware_version', platform: 'eseries', nameCol: 'name' },
  ];

  for (const check of platformChecks) {
    const rows = db.prepare(`
      SELECT p.system_id, p.${check.nameCol} AS resource_name, p.${check.versionCol} AS installed_version
      FROM ${check.table} p
      WHERE p.${check.versionCol} IS NOT NULL
    `).all();

    for (const row of rows) {
      checked++;

      const kbRow = db.prepare(`
        SELECT end_of_support, is_recommended
        FROM kb_software_versions
        WHERE platform = @platform AND version = @version
        LIMIT 1
      `).get({ platform: check.platform, version: row.installed_version });

      if (!kbRow) continue; // Version not in KB — can't assess

      // Check for EOL
      if (kbRow.end_of_support && kbRow.end_of_support !== '1970-01-01') {
        if (kbRow.end_of_support < now) {
          // EOL — check if issue already exists
          const existing = db.prepare(`
            SELECT id FROM issues
            WHERE system_id = @systemId
              AND category = 'currency'
              AND resource_id = @resourceId
              AND title LIKE '%end-of-support%'
              AND status NOT IN ('resolved', 'dismissed')
            LIMIT 1
          `).get({
            systemId: row.system_id,
            resourceId: row.resource_name,
          });

          if (!existing) {
            db.prepare(`
              INSERT INTO issues
                (system_id, resource_type, resource_id, severity, category,
                 title, description, status, detected_at, created_at, updated_at)
              VALUES
                (@systemId, 'software', @resourceId, 'critical', 'currency',
                 @title, @description, 'open', @now, @now, @now)
            `).run({
              systemId: row.system_id,
              resourceId: row.resource_name,
              title: `Software end-of-support: ${row.resource_name} running ${row.installed_version}`,
              description:
                `${check.platform} system "${row.resource_name}" is running version ` +
                `${row.installed_version} which reached end-of-support on ` +
                `${kbRow.end_of_support}. Upgrade to a supported version immediately.`,
              now,
            });
            issuesCreated++;
          }
        }
      } else if (kbRow.end_of_support === '1970-01-01') {
        // Generic EOL marker
        const existing = db.prepare(`
          SELECT id FROM issues
          WHERE system_id = @systemId
            AND category = 'currency'
            AND resource_id = @resourceId
            AND title LIKE '%end-of-life%'
            AND status NOT IN ('resolved', 'dismissed')
          LIMIT 1
        `).get({
          systemId: row.system_id,
          resourceId: row.resource_name,
        });

        if (!existing) {
          db.prepare(`
            INSERT INTO issues
              (system_id, resource_type, resource_id, severity, category,
               title, description, status, detected_at, created_at, updated_at)
            VALUES
              (@systemId, 'software', @resourceId, 'critical', 'currency',
               @title, @description, 'open', @now, @now, @now)
          `).run({
            systemId: row.system_id,
            resourceId: row.resource_name,
            title: `Software end-of-life: ${row.resource_name} running ${row.installed_version}`,
            description:
              `${check.platform} system "${row.resource_name}" is running version ` +
              `${row.installed_version} which has reached end-of-life. ` +
              `Upgrade to a supported version.`,
            now,
          });
          issuesCreated++;
        }
      }

      // Check if not recommended
      if (kbRow.is_recommended !== 1) {
        const existing = db.prepare(`
          SELECT id FROM issues
          WHERE system_id = @systemId
            AND category = 'currency'
            AND resource_id = @resourceId
            AND title LIKE '%not recommended%'
            AND status NOT IN ('resolved', 'dismissed')
          LIMIT 1
        `).get({
          systemId: row.system_id,
          resourceId: row.resource_name,
        });

        if (!existing) {
          db.prepare(`
            INSERT INTO issues
              (system_id, resource_type, resource_id, severity, category,
               title, description, status, detected_at, created_at, updated_at)
            VALUES
              (@systemId, 'software', @resourceId, 'medium', 'currency',
               @title, @description, 'open', @now, @now, @now)
          `).run({
            systemId: row.system_id,
            resourceId: row.resource_name,
            title: `Software version not recommended: ${row.resource_name} running ${row.installed_version}`,
            description:
              `${check.platform} system "${row.resource_name}" is running version ` +
              `${row.installed_version} which is not the recommended version. ` +
              `Consider upgrading to the latest recommended release.`,
            now,
          });
          issuesCreated++;
        }
      }
    }
  }

  logger.info(
    `[AutoLearner] checkSoftwareCurrency: checked=${checked}, issuesCreated=${issuesCreated}`
  );
  return { checked, issuesCreated };
}

/**
 * Orchestrate a complete learning cycle:
 *
 * 1. Fetch lifecycle data from external APIs.
 * 2. Check software currency across all systems.
 * 3. Log the cycle to `kb_learning_log`.
 *
 * @returns {Promise<{lifecycle: Object, currency: Object}>}
 */
async function runLearningCycle() {
  const db = getDb();
  const now = nowUtc();
  logger.info('[AutoLearner] Starting learning cycle');

  // Step 1 — fetch lifecycle data
  const lifecycle = await fetchLifecycleData();

  // Step 2 — check software currency
  const currency = checkSoftwareCurrency();

  // Step 3 — log to kb_learning_log
  db.prepare(`
    INSERT INTO kb_learning_log
      (event_type, context, learned_pattern, confidence_score, created_at, updated_at)
    VALUES
      ('lifecycle_sync', @context, @pattern, @confidence, @now, @now)
  `).run({
    context: JSON.stringify({
      fetched: lifecycle.fetched,
      upserted: lifecycle.upserted,
      errors: lifecycle.errors,
    }),
    pattern: JSON.stringify({
      checked: currency.checked,
      issuesCreated: currency.issuesCreated,
    }),
    confidence: lifecycle.errors.length === 0 ? 1.0 : 0.5,
    now,
  });

  logger.info('[AutoLearner] Learning cycle complete');
  return { lifecycle, currency };
}

/**
 * Run a learning cycle immediately.  Intended for CLI / manual invocation.
 *
 * @returns {Promise<void>}
 */
async function runNow() {
  logger.info('[AutoLearner] Manual run triggered');
  const startTime = Date.now();

  try {
    const result = await runLearningCycle();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[AutoLearner] Manual run complete in ${elapsed}s`);
    logger.info(`[AutoLearner] Lifecycle: fetched=${result.lifecycle.fetched}, upserted=${result.lifecycle.upserted}`);
    logger.info(`[AutoLearner] Currency: checked=${result.currency.checked}, issues=${result.currency.issuesCreated}`);
    return result;
  } catch (err) {
    logger.error(`[AutoLearner] Manual run failed: ${err.message}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  fetchLifecycleData,
  checkSoftwareCurrency,
  runLearningCycle,
  runNow,
};
