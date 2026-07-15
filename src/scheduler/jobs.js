'use strict';

/**
 * @module scheduler/jobs
 * @description Job execution wrappers for scheduled tasks. Each exported function
 * encapsulates its work in try/catch with elapsed-time tracking and structured
 * logging so callers never need to handle errors directly.
 */

const logger = require('../utils/logger');
const { systems } = require('../db/models');
const { getDb } = require('../db/database');
const OntapCollector = require('../collectors/ontap');
const StorageGridCollector = require('../collectors/storagegrid');
const ESeriesCollector = require('../collectors/eseries');
const RulesEngine = require('../analysis/engine');
const { calculateAllProjections } = require('../analysis/projections');
const { calculateAllHealthScores } = require('../analysis/healthScore');
const { runLearningCycle } = require('../analysis/autoLearner');
const { rollupHourly, rollupDaily, rollupWeekly } = require('../db/rollup');
const { purgeExpiredData } = require('../db/retention');

/**
 * Map of system type identifiers to their corresponding collector classes.
 * @type {Object<string, Function>}
 */
const COLLECTOR_MAP = {
  ontap: OntapCollector,
  storagegrid: StorageGridCollector,
  eseries: ESeriesCollector,
};

/**
 * Returns the current high-resolution timestamp in milliseconds.
 * @returns {number} Monotonic timestamp in ms.
 */
function now() {
  const [sec, ns] = process.hrtime();
  return sec * 1e3 + ns / 1e6;
}

/**
 * Runs the full collection cycle across all registered systems.
 *
 * For every system returned by `systems.getAll()`, the appropriate collector
 * class is resolved from {@link COLLECTOR_MAP}, instantiated, and its
 * `collect()` method awaited. Success and failure counts are tracked and
 * logged at the end of the run.
 *
 * @async
 * @returns {Promise<{success: number, errors: number, elapsed: number}>}
 *   Outcome summary with counts and elapsed time in milliseconds.
 */
async function runCollectionJob() {
  const start = now();
  let success = 0;
  let errors = 0;

  logger.info('[jobs] Collection job started');

  try {
    const allSystems = systems.getAll();
    const db = getDb();

    for (const system of allSystems) {
      const CollectorClass = COLLECTOR_MAP[system.type];

      if (!CollectorClass) {
        logger.warn(`[jobs] Unknown system type "${system.type}" for system "${system.name}" (id=${system.id}), skipping`);
        errors++;
        continue;
      }

      try {
        const collector = new CollectorClass(system, db);
        await collector.collect();
        success++;
        logger.debug(`[jobs] Collected system "${system.name}" (type=${system.type})`);
      } catch (err) {
        errors++;
        logger.error(`[jobs] Collection failed for system "${system.name}" (type=${system.type}): ${err.message}`);
      }
    }
  } catch (err) {
    logger.error(`[jobs] Collection job encountered a fatal error: ${err.message}`);
  }

  const elapsed = Math.round(now() - start);
  logger.info(`[jobs] Collection job finished — success=${success} errors=${errors} elapsed=${elapsed}ms`);

  return { success, errors, elapsed };
}

/**
 * Runs the analysis pipeline: rule evaluation followed by health-score
 * calculation.
 *
 * A new {@link RulesEngine} is created, `analyzeAll()` is invoked to
 * evaluate every active rule, and then `calculateAllHealthScores()` is
 * called to refresh per-system health scores.
 *
 * @async
 * @returns {Promise<{elapsed: number}>} Elapsed time in milliseconds.
 */
async function runAnalysisJob() {
  const start = now();

  logger.info('[jobs] Analysis job started');

  try {
    const db = getDb();
    const engine = new RulesEngine(db);
    await engine.analyzeAll();
    logger.debug('[jobs] Rule analysis complete');

    await calculateAllHealthScores();
    logger.debug('[jobs] Health-score calculation complete');
  } catch (err) {
    logger.error(`[jobs] Analysis job failed: ${err.message}`);
  }

  const elapsed = Math.round(now() - start);
  logger.info(`[jobs] Analysis job finished — elapsed=${elapsed}ms`);

  return { elapsed };
}

/**
 * Runs the full maintenance pipeline in a single pass:
 *   1. Hourly rollup
 *   2. Daily rollup
 *   3. Weekly rollup
 *   4. Expired-data purge
 *   5. Capacity projections
 *
 * Each step is executed sequentially so that rollups complete before
 * dependent projections are calculated.
 *
 * @async
 * @returns {Promise<{elapsed: number}>} Elapsed time in milliseconds.
 */
async function runMaintenanceJob() {
  const start = now();

  logger.info('[jobs] Maintenance job started');

  try {
    await rollupHourly();
    logger.debug('[jobs] Hourly rollup complete');

    await rollupDaily();
    logger.debug('[jobs] Daily rollup complete');

    await rollupWeekly();
    logger.debug('[jobs] Weekly rollup complete');

    await purgeExpiredData();
    logger.debug('[jobs] Expired-data purge complete');

    await calculateAllProjections();
    logger.debug('[jobs] Projections calculation complete');
  } catch (err) {
    logger.error(`[jobs] Maintenance job failed: ${err.message}`);
  }

  const elapsed = Math.round(now() - start);
  logger.info(`[jobs] Maintenance job finished — elapsed=${elapsed}ms`);

  return { elapsed };
}

/**
 * Runs the automated learning cycle (EOL data refresh, pattern detection,
 * etc.) via the autoLearner module.
 *
 * @async
 * @returns {Promise<{elapsed: number}>} Elapsed time in milliseconds.
 */
async function runLearningJob() {
  const start = now();

  logger.info('[jobs] Learning job started');

  try {
    await runLearningCycle();
    logger.debug('[jobs] Learning cycle complete');
  } catch (err) {
    logger.error(`[jobs] Learning job failed: ${err.message}`);
  }

  const elapsed = Math.round(now() - start);
  logger.info(`[jobs] Learning job finished — elapsed=${elapsed}ms`);

  return { elapsed };
}

module.exports = {
  runCollectionJob,
  runAnalysisJob,
  runMaintenanceJob,
  runLearningJob,
};
