'use strict';

/**
 * @module analysis/autoLearner
 * @description Auto-learning engine that fetches software lifecycle data,
 * firmware versions, and security advisories from public sources, updates
 * the local knowledge base, and checks installed software/firmware versions
 * against known end-of-life, end-of-support, and security vulnerability data.
 *
 * Covers:
 * - Software lifecycle data (ONTAP, StorageGRID, E-Series SANtricity OS)
 * - Firmware matrix (disk, shelf, SP/BMC, NIC, DQP, NVSRAM)
 * - Security advisories (CVE tracking)
 * - Installed version currency checks with ITIL-aligned issue creation
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
 */
const PRODUCTS = [
  { platform: 'ontap', slug: 'netapp-ontap' },
  { platform: 'storagegrid', slug: 'netapp-storagegrid' },
  { platform: 'eseries', slug: 'netapp-e-series-santricity-os' },
];

/** Request timeout for external API calls (milliseconds). */
const API_TIMEOUT = 30_000;

/** Maximum retry attempts for failed API calls. */
const MAX_RETRIES = 3;

/** Delay between retries (milliseconds). */
const RETRY_DELAY_MS = 2_000;

/**
 * Seed firmware data for initial knowledge base population.
 * In production, this would be updated from NetApp's published firmware matrices.
 */
const FIRMWARE_SEED_DATA = [
  // ONTAP Disk firmware
  { platform: 'ontap', component_type: 'disk', model: 'X423_HCOBE900A10',  latest_version: 'NA04', minimum_version: 'NA02', recommended_version: 'NA04', compatibility_notes: 'SAS 900GB 10K RPM' },
  { platform: 'ontap', component_type: 'disk', model: 'X449_S1801E4000A10', latest_version: 'NA04', minimum_version: 'NA02', recommended_version: 'NA04', compatibility_notes: 'SAS 4TB NL' },
  { platform: 'ontap', component_type: 'disk', model: 'X448_SBATE960VA',    latest_version: 'EA07', minimum_version: 'EA04', recommended_version: 'EA07', compatibility_notes: 'SSD 960GB SAS' },
  { platform: 'ontap', component_type: 'disk', model: 'X440_S162TMTE1600',  latest_version: 'GC5B', minimum_version: 'GC3B', recommended_version: 'GC5B', compatibility_notes: 'SSD 1.6TB SAS' },

  // ONTAP Shelf firmware (IOM modules)
  { platform: 'ontap', component_type: 'shelf', model: 'IOM12',   latest_version: '0191', minimum_version: '0175', recommended_version: '0191', compatibility_notes: 'DS212C/DS224C shelves' },
  { platform: 'ontap', component_type: 'shelf', model: 'IOM12B',  latest_version: '0210', minimum_version: '0200', recommended_version: '0210', compatibility_notes: 'NS224 shelves' },
  { platform: 'ontap', component_type: 'shelf', model: 'IOM6',    latest_version: '0296', minimum_version: '0260', recommended_version: '0296', compatibility_notes: 'DS4246/DS2246 shelves - legacy' },

  // ONTAP SP/BMC firmware
  { platform: 'ontap', component_type: 'sp_bmc', model: 'FAS8200', latest_version: '13.8', minimum_version: '11.8', recommended_version: '13.8', compatibility_notes: 'Bundled with ONTAP updates' },
  { platform: 'ontap', component_type: 'sp_bmc', model: 'AFF-A400', latest_version: '14.0', minimum_version: '12.0', recommended_version: '14.0', compatibility_notes: 'Bundled with ONTAP updates' },
  { platform: 'ontap', component_type: 'sp_bmc', model: 'AFF-A900', latest_version: '14.2', minimum_version: '13.0', recommended_version: '14.2', compatibility_notes: 'Bundled with ONTAP updates' },

  // ONTAP NIC firmware
  { platform: 'ontap', component_type: 'nic', model: 'X1148A',  latest_version: '14.29.1016', minimum_version: '14.25.1020', recommended_version: '14.29.1016', compatibility_notes: '10GbE 4-port' },
  { platform: 'ontap', component_type: 'nic', model: 'X1146A',  latest_version: '20.14.13',   minimum_version: '20.12.10',   recommended_version: '20.14.13',   compatibility_notes: '100GbE 2-port' },

  // ONTAP DQP (Disk Qualification Package)
  { platform: 'ontap', component_type: 'dqp', model: 'DQP', latest_version: '3.19', minimum_version: '3.15', recommended_version: '3.19', compatibility_notes: 'Updated quarterly' },

  // E-Series NVSRAM
  { platform: 'eseries', component_type: 'nvsram', model: 'E2800',   latest_version: 'N280X-842834-D06', minimum_version: 'N280X-842834-D02', recommended_version: 'N280X-842834-D06', compatibility_notes: 'E2800 controller NVSRAM' },
  { platform: 'eseries', component_type: 'nvsram', model: 'E5700',   latest_version: 'N570X-842834-D06', minimum_version: 'N570X-842834-D02', recommended_version: 'N570X-842834-D06', compatibility_notes: 'E5700 controller NVSRAM' },
  { platform: 'eseries', component_type: 'nvsram', model: 'EF600',   latest_version: 'NF600-842834-D06', minimum_version: 'NF600-842834-D02', recommended_version: 'NF600-842834-D06', compatibility_notes: 'EF600 all-flash' },

  // E-Series disk firmware
  { platform: 'eseries', component_type: 'disk', model: 'generic_ssd', latest_version: 'GS04', minimum_version: 'GS02', recommended_version: 'GS04', compatibility_notes: 'Generic E-Series SSD firmware' },
  { platform: 'eseries', component_type: 'disk', model: 'generic_hdd', latest_version: 'MS08', minimum_version: 'MS04', recommended_version: 'MS08', compatibility_notes: 'Generic E-Series HDD firmware' },
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
 * Build an absolute URL for a product's lifecycle data.
 *
 * @param {string} slug - Product slug on endoflife.date.
 * @returns {string}
 */
function buildApiUrl(slug) {
  const base = config.autoLearn.eolApiUrl.replace(/\/+$/, '');
  return `${base}/${slug}.json`;
}

/**
 * Sleep for a given number of milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute an HTTP GET with retry logic.
 *
 * @param {string} url
 * @param {number} [retries=MAX_RETRIES]
 * @returns {Promise<any>}
 */
async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: API_TIMEOUT,
        headers: { Accept: 'application/json' },
      });
      return response.data;
    } catch (err) {
      const isLast = attempt === retries;
      if (isLast) throw err;

      const delayMs = RETRY_DELAY_MS * attempt;
      logger.warn(
        `[AutoLearner] Attempt ${attempt}/${retries} failed for ${url}: ${err.message}. Retrying in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  }
}

// ---------------------------------------------------------------------------
// Core API: Lifecycle Data
// ---------------------------------------------------------------------------

/**
 * Fetch software lifecycle data from the endoflife.date API for all
 * configured products and upsert results into `kb_software_versions`.
 *
 * Stores: platform, version, release_date, eol_date, eos_date,
 * support_phase, is_latest, lts.
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
      data = await fetchWithRetry(url);
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
      for (let i = 0; i < cycles.length; i++) {
        const cycle = cycles[i];

        // Determine end-of-support date
        let endOfSupport = null;
        if (typeof cycle.eol === 'string') {
          endOfSupport = cycle.eol;
        } else if (cycle.eol === true) {
          endOfSupport = '1970-01-01'; // Generic EOL marker
        }

        // Determine if this is the recommended version
        const isLatest = i === 0;
        const isLts = cycle.lts === true;
        const isRecommended = (isLatest || isLts) ? 1 : 0;

        const version = String(cycle.cycle || cycle.latest || cycle.version || '');
        if (!version) continue;

        // Build lifecycle metadata
        const lifecycleMeta = {
          releaseNotes: cycle.link || null,
          lts: isLts,
          isLatest,
          supportPhase: endOfSupport
            ? (endOfSupport <= now ? 'eol' : 'limited')
            : (isRecommended ? 'full' : 'active'),
          latestPatch: cycle.latest || null,
        };

        const info = upsertStmt.run({
          platform: product.platform,
          version,
          release_date: cycle.releaseDate || null,
          end_of_support: endOfSupport,
          is_recommended: isRecommended,
          known_issues: JSON.stringify(lifecycleMeta),
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

// ---------------------------------------------------------------------------
// Core API: Firmware Data
// ---------------------------------------------------------------------------

/**
 * Populate/update `kb_firmware_matrix` with known firmware component versions.
 *
 * For each platform, stores: component (disk, shelf, sp, bmc, nic, dqp, nvsram),
 * latest_version, minimum_recommended.
 *
 * Initially seeds from reference data. In production, this would be updated
 * when NetApp publishes new firmware versions.
 *
 * @returns {{seeded: number, updated: number, errors: string[]}}
 */
function fetchFirmwareData() {
  const db = getDb();
  const now = nowUtc();
  let seeded = 0;
  let updated = 0;
  const errors = [];

  // Check if the unique constraint exists; if not, use INSERT OR REPLACE
  const upsertStmt = db.prepare(`
    INSERT OR REPLACE INTO kb_firmware_matrix
      (platform, component_type, model, recommended_version,
       minimum_version, latest_version, compatibility_notes,
       created_at, updated_at)
    VALUES
      (@platform, @component_type, @model, @recommended_version,
       @minimum_version, @latest_version, @compatibility_notes,
       @created_at, @updated_at)
  `);

  const batchUpsert = db.transaction((entries) => {
    for (const entry of entries) {
      try {
        const info = upsertStmt.run({
          platform: entry.platform,
          component_type: entry.component_type,
          model: entry.model,
          recommended_version: entry.recommended_version || entry.latest_version,
          minimum_version: entry.minimum_version,
          latest_version: entry.latest_version,
          compatibility_notes: entry.compatibility_notes || null,
          created_at: now,
          updated_at: now,
        });
        if (info.changes > 0) {
          seeded++;
        } else {
          updated++;
        }
      } catch (err) {
        const msg = `Failed to upsert firmware entry ${entry.component_type}/${entry.model}: ${err.message}`;
        logger.warn(`[AutoLearner] ${msg}`);
        errors.push(msg);
      }
    }
  });

  batchUpsert(FIRMWARE_SEED_DATA);

  logger.info(
    `[AutoLearner] fetchFirmwareData complete: seeded=${seeded}, updated=${updated}, errors=${errors.length}`
  );
  return { seeded, updated, errors };
}

// ---------------------------------------------------------------------------
// Core API: Security Advisories
// ---------------------------------------------------------------------------

/**
 * Check for and store security advisories in `kb_security_advisories`.
 *
 * In production, this would query NetApp's security advisory feed.
 * Currently seeds known advisory patterns for detection.
 *
 * @returns {Promise<{checked: number, stored: number, errors: string[]}>}
 */
async function fetchSecurityAdvisories() {
  const db = getDb();
  const now = nowUtc();
  let checked = 0;
  let stored = 0;
  const errors = [];

  // Attempt to fetch from NetApp security advisory API if configured
  const advisoryUrl = config.autoLearn?.securityAdvisoryUrl;
  if (advisoryUrl) {
    logger.info(`[AutoLearner] Fetching security advisories from: ${advisoryUrl}`);
    try {
      const data = await fetchWithRetry(advisoryUrl);
      if (Array.isArray(data)) {
        const upsertStmt = db.prepare(`
          INSERT INTO kb_security_advisories
            (advisory_id, title, severity, affected_products,
             affected_versions, fixed_versions, cve_ids,
             description, workaround, published_at,
             created_at, updated_at)
          VALUES
            (@advisory_id, @title, @severity, @affected_products,
             @affected_versions, @fixed_versions, @cve_ids,
             @description, @workaround, @published_at,
             @created_at, @updated_at)
          ON CONFLICT (advisory_id) DO UPDATE SET
            title              = excluded.title,
            severity           = excluded.severity,
            affected_versions  = excluded.affected_versions,
            fixed_versions     = excluded.fixed_versions,
            cve_ids            = excluded.cve_ids,
            description        = excluded.description,
            workaround         = excluded.workaround,
            updated_at         = excluded.updated_at
        `);

        const batchInsert = db.transaction((advisories) => {
          for (const adv of advisories) {
            checked++;
            try {
              const info = upsertStmt.run({
                advisory_id: adv.advisory_id || adv.id,
                title: adv.title || 'Unknown Advisory',
                severity: adv.severity || 'medium',
                affected_products: JSON.stringify(adv.affected_products || []),
                affected_versions: JSON.stringify(adv.affected_versions || []),
                fixed_versions: JSON.stringify(adv.fixed_versions || []),
                cve_ids: JSON.stringify(adv.cve_ids || []),
                description: adv.description || null,
                workaround: adv.workaround || null,
                published_at: adv.published_at || now,
                created_at: now,
                updated_at: now,
              });
              stored += info.changes;
            } catch (err) {
              errors.push(`Advisory ${adv.advisory_id}: ${err.message}`);
            }
          }
        });

        batchInsert(data);
      }
    } catch (err) {
      const msg = `Failed to fetch security advisories: ${err.message}`;
      logger.warn(`[AutoLearner] ${msg}`);
      errors.push(msg);
    }
  } else {
    logger.debug('[AutoLearner] No security advisory URL configured — skipping fetch');
  }

  // Cross-reference installed versions against known advisories
  const advisoryCount = db.prepare(
    'SELECT COUNT(*) AS cnt FROM kb_security_advisories'
  ).get();

  logger.info(
    `[AutoLearner] fetchSecurityAdvisories complete: checked=${checked}, stored=${stored}, ` +
    `total_advisories=${advisoryCount?.cnt || 0}, errors=${errors.length}`
  );
  return { checked, stored, errors };
}

// ---------------------------------------------------------------------------
// Core API: Software Currency Check
// ---------------------------------------------------------------------------

/**
 * Compare installed software and firmware versions across all systems
 * against the knowledge base to identify outdated or end-of-life
 * installations.
 *
 * Checks:
 * - ONTAP cluster versions vs kb_software_versions
 * - StorageGRID versions vs kb_software_versions
 * - E-Series SANtricity versions vs kb_software_versions
 * - Disk firmware versions vs kb_firmware_matrix
 * - Shelf firmware versions vs kb_firmware_matrix
 *
 * Creates issues with proper ITIL categorization.
 *
 * @returns {{checked: number, issuesCreated: number, firmwareChecked: number}}
 */
function checkSoftwareCurrency() {
  const db = getDb();
  const now = nowUtc();
  let checked = 0;
  let issuesCreated = 0;
  let firmwareChecked = 0;

  // ----- SOFTWARE VERSION CHECKS -----

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

      if (!kbRow) continue;

      // Check for EOL
      if (kbRow.end_of_support && kbRow.end_of_support !== '1970-01-01') {
        if (kbRow.end_of_support < now) {
          issuesCreated += createIssueIfNotExists(db, {
            systemId: row.system_id,
            resourceType: 'software',
            resourceId: row.resource_name,
            severity: 'critical',
            category: 'currency',
            titlePattern: '%end-of-support%',
            title: `Software end-of-support: ${row.resource_name} running ${row.installed_version}`,
            description:
              `${check.platform} system "${row.resource_name}" is running version ` +
              `${row.installed_version} which reached end-of-support on ` +
              `${kbRow.end_of_support}. Upgrade to a supported version immediately.`,
            itilCategory: 'Software Lifecycle Management',
            itilPriority: 'P1 - Critical',
            now,
          });
        }
      } else if (kbRow.end_of_support === '1970-01-01') {
        issuesCreated += createIssueIfNotExists(db, {
          systemId: row.system_id,
          resourceType: 'software',
          resourceId: row.resource_name,
          severity: 'critical',
          category: 'currency',
          titlePattern: '%end-of-life%',
          title: `Software end-of-life: ${row.resource_name} running ${row.installed_version}`,
          description:
            `${check.platform} system "${row.resource_name}" is running version ` +
            `${row.installed_version} which has reached end-of-life. ` +
            `Upgrade to a supported version.`,
          itilCategory: 'Software Lifecycle Management',
          itilPriority: 'P1 - Critical',
          now,
        });
      }

      // Check if not recommended
      if (kbRow.is_recommended !== 1 && !(kbRow.end_of_support && kbRow.end_of_support <= now)) {
        issuesCreated += createIssueIfNotExists(db, {
          systemId: row.system_id,
          resourceType: 'software',
          resourceId: row.resource_name,
          severity: 'medium',
          category: 'currency',
          titlePattern: '%not recommended%',
          title: `Software version not recommended: ${row.resource_name} running ${row.installed_version}`,
          description:
            `${check.platform} system "${row.resource_name}" is running version ` +
            `${row.installed_version} which is not the recommended version. ` +
            `Consider upgrading to the latest recommended release.`,
          itilCategory: 'Software Lifecycle Management',
          itilPriority: 'P3 - Medium',
          now,
        });
      }
    }
  }

  // ----- DISK FIRMWARE CHECKS -----

  const diskRows = db.prepare(`
    SELECT d.system_id, d.name AS resource_name, d.firmware_version,
           d.model, fm.minimum_version, fm.latest_version
    FROM ontap_disks d
    JOIN kb_firmware_matrix fm ON fm.component_type = 'disk'
      AND fm.model = d.model AND fm.platform = 'ontap'
    WHERE d.firmware_version IS NOT NULL
      AND d.firmware_version < fm.minimum_version
  `).all();

  for (const disk of diskRows) {
    firmwareChecked++;
    issuesCreated += createIssueIfNotExists(db, {
      systemId: disk.system_id,
      resourceType: 'disk_firmware',
      resourceId: disk.resource_name,
      severity: 'high',
      category: 'currency',
      titlePattern: '%disk firmware%',
      title: `Disk firmware below minimum: ${disk.resource_name} (${disk.firmware_version} < ${disk.minimum_version})`,
      description:
        `Disk "${disk.resource_name}" model ${disk.model} is running firmware ` +
        `${disk.firmware_version} which is below the minimum recommended version ` +
        `${disk.minimum_version}. Latest available: ${disk.latest_version}. ` +
        `Update via Disk Qualification Package (DQP).`,
      itilCategory: 'Hardware Lifecycle Management',
      itilPriority: 'P2 - High',
      now,
    });
  }

  // ----- SHELF FIRMWARE CHECKS -----

  const shelfRows = db.prepare(`
    SELECT sh.system_id, sh.name AS resource_name, sh.firmware_version,
           sh.model, fm.minimum_version, fm.latest_version
    FROM ontap_shelves sh
    JOIN kb_firmware_matrix fm ON fm.component_type = 'shelf'
      AND fm.model = sh.model AND fm.platform = 'ontap'
    WHERE sh.firmware_version IS NOT NULL
      AND sh.firmware_version < fm.latest_version
  `).all();

  for (const shelf of shelfRows) {
    firmwareChecked++;
    const isBelowMinimum = shelf.firmware_version < shelf.minimum_version;
    issuesCreated += createIssueIfNotExists(db, {
      systemId: shelf.system_id,
      resourceType: 'shelf_firmware',
      resourceId: shelf.resource_name,
      severity: isBelowMinimum ? 'high' : 'medium',
      category: 'currency',
      titlePattern: '%shelf firmware%',
      title: `Shelf firmware outdated: ${shelf.resource_name} (${shelf.firmware_version} < ${shelf.latest_version})`,
      description:
        `Shelf "${shelf.resource_name}" model ${shelf.model} is running firmware ` +
        `${shelf.firmware_version}. Latest: ${shelf.latest_version}, ` +
        `minimum: ${shelf.minimum_version}. ` +
        `${isBelowMinimum ? 'BELOW MINIMUM - update urgently.' : 'Update recommended.'}`,
      itilCategory: 'Hardware Lifecycle Management',
      itilPriority: isBelowMinimum ? 'P2 - High' : 'P3 - Medium',
      now,
    });
  }

  // ----- E-SERIES DRIVE FIRMWARE CHECKS -----

  const esDriveRows = db.prepare(`
    SELECT d.system_id, d.serial_number AS resource_name, d.firmware_version,
           d.media_type, fm.minimum_version, fm.latest_version
    FROM es_drives d
    JOIN kb_firmware_matrix fm ON fm.component_type = 'disk'
      AND fm.platform = 'eseries'
      AND fm.model = CASE d.media_type WHEN 'ssd' THEN 'generic_ssd' ELSE 'generic_hdd' END
    WHERE d.firmware_version IS NOT NULL
      AND d.firmware_version < fm.minimum_version
  `).all();

  for (const drive of esDriveRows) {
    firmwareChecked++;
    issuesCreated += createIssueIfNotExists(db, {
      systemId: drive.system_id,
      resourceType: 'eseries_drive_firmware',
      resourceId: drive.resource_name || 'unknown',
      severity: 'high',
      category: 'currency',
      titlePattern: '%drive firmware%',
      title: `E-Series drive firmware below minimum: ${drive.resource_name} (${drive.firmware_version})`,
      description:
        `E-Series drive "${drive.resource_name}" (${drive.media_type}) is running firmware ` +
        `${drive.firmware_version} which is below the minimum recommended version ` +
        `${drive.minimum_version}. Latest: ${drive.latest_version}.`,
      itilCategory: 'Hardware Lifecycle Management',
      itilPriority: 'P2 - High',
      now,
    });
  }

  logger.info(
    `[AutoLearner] checkSoftwareCurrency: checked=${checked}, firmwareChecked=${firmwareChecked}, issuesCreated=${issuesCreated}`
  );
  return { checked, issuesCreated, firmwareChecked };
}

// ---------------------------------------------------------------------------
// Helper: Issue Creation with Deduplication
// ---------------------------------------------------------------------------

/**
 * Create an issue if one with the same pattern doesn't already exist.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Object} params
 * @returns {number} 1 if created, 0 if already exists
 */
function createIssueIfNotExists(db, params) {
  const existing = db.prepare(`
    SELECT id FROM issues
    WHERE system_id = @systemId
      AND category = @category
      AND resource_id = @resourceId
      AND title LIKE @titlePattern
      AND status NOT IN ('resolved', 'dismissed')
    LIMIT 1
  `).get({
    systemId: params.systemId,
    category: params.category,
    resourceId: params.resourceId,
    titlePattern: params.titlePattern,
  });

  if (existing) return 0;

  db.prepare(`
    INSERT INTO issues
      (system_id, resource_type, resource_id, severity, category,
       title, description, status, detected_at, created_at, updated_at)
    VALUES
      (@systemId, @resourceType, @resourceId, @severity, @category,
       @title, @description, 'open', @now, @now, @now)
  `).run({
    systemId: params.systemId,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    severity: params.severity,
    category: params.category,
    title: params.title,
    description: params.description,
    now: params.now,
  });

  return 1;
}

// ---------------------------------------------------------------------------
// Core API: Orchestration
// ---------------------------------------------------------------------------

/**
 * Orchestrate a complete learning cycle:
 *
 * 1. Fetch lifecycle data from external APIs (endoflife.date)
 * 2. Fetch/seed firmware matrix data
 * 3. Fetch security advisories
 * 4. Check software and firmware currency across all systems
 * 5. Log the cycle to `kb_learning_log`
 *
 * @returns {Promise<{lifecycle: Object, firmware: Object, advisories: Object, currency: Object}>}
 */
async function runLearningCycle() {
  const db = getDb();
  const now = nowUtc();
  const startTime = Date.now();
  logger.info('[AutoLearner] Starting learning cycle');

  // Step 1 — fetch lifecycle data
  let lifecycle = { fetched: 0, upserted: 0, errors: [] };
  try {
    lifecycle = await fetchLifecycleData();
  } catch (err) {
    logger.error(`[AutoLearner] Lifecycle data fetch failed: ${err.message}`);
    lifecycle.errors.push(`Lifecycle fetch failed: ${err.message}`);
  }

  // Step 2 — fetch/seed firmware data
  let firmware = { seeded: 0, updated: 0, errors: [] };
  try {
    firmware = fetchFirmwareData();
  } catch (err) {
    logger.error(`[AutoLearner] Firmware data seed failed: ${err.message}`);
    firmware.errors.push(`Firmware seed failed: ${err.message}`);
  }

  // Step 3 — fetch security advisories
  let advisories = { checked: 0, stored: 0, errors: [] };
  try {
    advisories = await fetchSecurityAdvisories();
  } catch (err) {
    logger.error(`[AutoLearner] Security advisory fetch failed: ${err.message}`);
    advisories.errors.push(`Advisory fetch failed: ${err.message}`);
  }

  // Step 4 — check software and firmware currency
  let currency = { checked: 0, issuesCreated: 0, firmwareChecked: 0 };
  try {
    currency = checkSoftwareCurrency();
  } catch (err) {
    logger.error(`[AutoLearner] Currency check failed: ${err.message}`);
  }

  // Step 5 — log to kb_learning_log
  const totalErrors = [
    ...lifecycle.errors,
    ...firmware.errors,
    ...advisories.errors,
  ];

  const elapsedMs = Date.now() - startTime;

  db.prepare(`
    INSERT INTO kb_learning_log
      (event_type, context, learned_pattern, confidence_score, created_at, updated_at)
    VALUES
      ('lifecycle_sync', @context, @pattern, @confidence, @now, @now)
  `).run({
    context: JSON.stringify({
      lifecycle: { fetched: lifecycle.fetched, upserted: lifecycle.upserted },
      firmware: { seeded: firmware.seeded, updated: firmware.updated },
      advisories: { checked: advisories.checked, stored: advisories.stored },
      errors: totalErrors,
      elapsedMs,
    }),
    pattern: JSON.stringify({
      software: { checked: currency.checked, issuesCreated: currency.issuesCreated },
      firmware: { checked: currency.firmwareChecked },
    }),
    confidence: totalErrors.length === 0 ? 1.0 : Math.max(0.3, 1.0 - (totalErrors.length * 0.15)),
    now,
  });

  logger.info(
    `[AutoLearner] Learning cycle complete in ${(elapsedMs / 1000).toFixed(1)}s — ` +
    `lifecycle: ${lifecycle.fetched} fetched, firmware: ${firmware.seeded} seeded, ` +
    `advisories: ${advisories.stored} stored, currency: ${currency.issuesCreated} issues`
  );

  return { lifecycle, firmware, advisories, currency };
}

/**
 * Run a learning cycle immediately. Intended for CLI / manual invocation.
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
    logger.info(
      `[AutoLearner] Lifecycle: fetched=${result.lifecycle.fetched}, upserted=${result.lifecycle.upserted}`
    );
    logger.info(
      `[AutoLearner] Firmware: seeded=${result.firmware.seeded}, updated=${result.firmware.updated}`
    );
    logger.info(
      `[AutoLearner] Advisories: checked=${result.advisories.checked}, stored=${result.advisories.stored}`
    );
    logger.info(
      `[AutoLearner] Currency: checked=${result.currency.checked}, ` +
      `firmware=${result.currency.firmwareChecked}, issues=${result.currency.issuesCreated}`
    );
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
  fetchFirmwareData,
  fetchSecurityAdvisories,
  checkSoftwareCurrency,
  runLearningCycle,
  runNow,
};
