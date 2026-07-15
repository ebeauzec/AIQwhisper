'use strict';

/**
 * @module scheduler/poller
 * @description Scheduled polling orchestrator. Registers node-cron jobs for
 * inventory collection, performance polling, data rollups, retention purges,
 * projection calculations, and optional auto-learning. Provides lifecycle
 * helpers (`start`, `stop`) and operational introspection (`getStatus`,
 * `runNow`).
 */

const cron = require('node-cron');
const config = require('../config');
const logger = require('../utils/logger');
const { systems } = require('../db/models');
const { getDb } = require('../db/database');
const OntapCollector = require('../collectors/ontap');
const StorageGridCollector = require('../collectors/storagegrid');
const ESeriesCollector = require('../collectors/eseries');
const { rollupHourly, rollupDaily, rollupWeekly } = require('../db/rollup');
const { purgeExpiredData } = require('../db/retention');
const { calculateAllProjections } = require('../analysis/projections');
const {
  runCollectionJob,
  runAnalysisJob,
  runLearningJob,
} = require('./jobs');

/**
 * Map of system type identifiers to their corresponding collector classes.
 * Used by the lightweight performance-only collection path.
 * @type {Object<string, Function>}
 */
const COLLECTOR_MAP = {
  ontap: OntapCollector,
  storagegrid: StorageGridCollector,
  eseries: ESeriesCollector,
};

/**
 * Registry of active cron tasks keyed by job name.
 * @type {Map<string, import('node-cron').ScheduledTask>}
 */
const tasks = new Map();

/**
 * Tracks the last-run timestamp and status for every registered job.
 * @type {Map<string, {lastRun: string|null, status: string, elapsed: number|null}>}
 */
const jobStatus = new Map();

/** Whether the scheduler has been started. */
let running = false;

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Converts a poll interval in minutes to a cron expression that fires
 * on the corresponding minute boundaries (e.g. every 5 min → `*\/5 * * * *`).
 *
 * @param {number} minutes - Interval in minutes (must be ≥ 1).
 * @returns {string} A valid node-cron expression.
 */
function minutesToCron(minutes) {
  if (minutes <= 0) {
    return '* * * * *';
  }
  if (minutes === 1) {
    return '* * * * *';
  }
  return `*/${minutes} * * * *`;
}

/**
 * Returns a high-resolution monotonic timestamp in milliseconds.
 * @returns {number}
 */
function now() {
  const [sec, ns] = process.hrtime();
  return sec * 1e3 + ns / 1e6;
}

/**
 * Wraps an async job function with status tracking and error isolation.
 *
 * @param {string} name  - Human-readable job name (used as status key).
 * @param {Function} fn  - Async function to execute.
 * @returns {Function} A zero-argument async wrapper safe for use as a cron
 *                     callback.
 */
function wrap(name, fn) {
  return async () => {
    const start = now();
    jobStatus.set(name, {
      lastRun: new Date().toISOString(),
      status: 'running',
      elapsed: null,
    });

    try {
      await fn();
      const elapsed = Math.round(now() - start);
      jobStatus.set(name, {
        lastRun: new Date().toISOString(),
        status: 'ok',
        elapsed,
      });
      logger.debug(`[poller] Job "${name}" completed in ${elapsed}ms`);
    } catch (err) {
      const elapsed = Math.round(now() - start);
      jobStatus.set(name, {
        lastRun: new Date().toISOString(),
        status: 'error',
        elapsed,
      });
      logger.error(`[poller] Job "${name}" failed after ${elapsed}ms: ${err.message}`);
    }
  };
}

/**
 * Lightweight performance-only collection.
 *
 * Iterates every registered system, instantiates the matching collector, and
 * calls `collect()`. This mirrors {@link runCollectionJob} but is kept
 * intentionally minimal — no analysis pass follows — so it can run at a
 * higher frequency without overloading downstream processing.
 *
 * @async
 * @returns {Promise<void>}
 */
async function runPerformanceCollection() {
  const allSystems = systems.getAll();
  const db = getDb();
  let success = 0;
  let errors = 0;

  for (const system of allSystems) {
    const CollectorClass = COLLECTOR_MAP[system.type];

    if (!CollectorClass) {
      logger.warn(`[poller] Perf collection — unknown type "${system.type}" for system "${system.name}", skipping`);
      errors++;
      continue;
    }

    try {
      const collector = new CollectorClass(system, db);
      await collector.collect();
      success++;
    } catch (err) {
      errors++;
      logger.error(`[poller] Perf collection failed for "${system.name}": ${err.message}`);
    }
  }

  logger.info(`[poller] Performance collection complete — success=${success} errors=${errors}`);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Registers and starts all cron jobs defined by the application
 * configuration. Calling `start()` more than once is a no-op.
 *
 * Jobs registered:
 * | Name             | Schedule                           | Action                              |
 * |------------------|------------------------------------|-------------------------------------|
 * | inventory        | every `pollIntervalMinutes`        | Full collection → analysis          |
 * | performance      | every `perfPollIntervalMinutes`    | Lightweight perf collection         |
 * | hourly-rollup    | top of every hour                  | `rollupHourly()`                    |
 * | daily-rollup     | 00:15 daily                        | `rollupDaily()`                     |
 * | weekly-rollup    | 00:30 every Sunday                 | `rollupWeekly()`                    |
 * | retention        | 01:00 daily                        | `purgeExpiredData()`                |
 * | projections      | 02:00 daily                        | `calculateAllProjections()`         |
 * | auto-learn       | `config.autoLearn.schedule`        | `runLearningJob()` (if enabled)     |
 */
function start() {
  if (running) {
    logger.warn('[poller] Scheduler already running — ignoring duplicate start()');
    return;
  }

  logger.info('[poller] Starting scheduler');

  // -- Inventory: full collection + analysis ----------------------------------
  const inventoryCron = minutesToCron(config.pollIntervalMinutes);
  tasks.set(
    'inventory',
    cron.schedule(inventoryCron, wrap('inventory', async () => {
      await runCollectionJob();
      await runAnalysisJob();
    }), { scheduled: true })
  );
  logger.info(`[poller] Registered "inventory" — ${inventoryCron}`);

  // -- Performance: lightweight collection ------------------------------------
  const perfCron = minutesToCron(config.perfPollIntervalMinutes);
  tasks.set(
    'performance',
    cron.schedule(perfCron, wrap('performance', runPerformanceCollection), { scheduled: true })
  );
  logger.info(`[poller] Registered "performance" — ${perfCron}`);

  // -- Hourly rollup ----------------------------------------------------------
  tasks.set(
    'hourly-rollup',
    cron.schedule('0 * * * *', wrap('hourly-rollup', rollupHourly), { scheduled: true })
  );
  logger.info('[poller] Registered "hourly-rollup" — 0 * * * *');

  // -- Daily rollup -----------------------------------------------------------
  tasks.set(
    'daily-rollup',
    cron.schedule('15 0 * * *', wrap('daily-rollup', rollupDaily), { scheduled: true })
  );
  logger.info('[poller] Registered "daily-rollup" — 15 0 * * *');

  // -- Weekly rollup ----------------------------------------------------------
  tasks.set(
    'weekly-rollup',
    cron.schedule('30 0 * * 0', wrap('weekly-rollup', rollupWeekly), { scheduled: true })
  );
  logger.info('[poller] Registered "weekly-rollup" — 30 0 * * 0');

  // -- Retention purge --------------------------------------------------------
  tasks.set(
    'retention',
    cron.schedule('0 1 * * *', wrap('retention', purgeExpiredData), { scheduled: true })
  );
  logger.info('[poller] Registered "retention" — 0 1 * * *');

  // -- Projections ------------------------------------------------------------
  tasks.set(
    'projections',
    cron.schedule('0 2 * * *', wrap('projections', calculateAllProjections), { scheduled: true })
  );
  logger.info('[poller] Registered "projections" — 0 2 * * *');

  // -- Auto-learn (conditional) -----------------------------------------------
  if (config.autoLearn && config.autoLearn.enabled) {
    const learnCron = config.autoLearn.schedule || '0 2 * * 0';
    tasks.set(
      'auto-learn',
      cron.schedule(learnCron, wrap('auto-learn', runLearningJob), { scheduled: true })
    );
    logger.info(`[poller] Registered "auto-learn" — ${learnCron}`);
  } else {
    logger.info('[poller] Auto-learn is disabled — skipping registration');
  }

  running = true;
  logger.info(`[poller] Scheduler started — ${tasks.size} job(s) registered`);
}

/**
 * Stops all registered cron tasks and clears the internal registry.
 * Safe to call even if the scheduler is not running.
 */
function stop() {
  if (!running) {
    logger.warn('[poller] Scheduler is not running — ignoring stop()');
    return;
  }

  logger.info('[poller] Stopping scheduler');

  for (const [name, task] of tasks) {
    try {
      task.stop();
      logger.debug(`[poller] Stopped job "${name}"`);
    } catch (err) {
      logger.error(`[poller] Error stopping job "${name}": ${err.message}`);
    }
  }

  tasks.clear();
  running = false;
  logger.info('[poller] Scheduler stopped');
}

/**
 * Immediately triggers a registered job by name, bypassing its cron
 * schedule. The job executes asynchronously; the returned promise resolves
 * when it finishes.
 *
 * @async
 * @param {string} jobName - One of the registered job names (e.g.
 *   `'inventory'`, `'retention'`).
 * @returns {Promise<void>}
 * @throws {Error} If `jobName` is not recognised.
 */
async function runNow(jobName) {
  /** @type {Object<string, Function>} */
  const runnables = {
    'inventory': async () => {
      await runCollectionJob();
      await runAnalysisJob();
    },
    'performance': runPerformanceCollection,
    'hourly-rollup': rollupHourly,
    'daily-rollup': rollupDaily,
    'weekly-rollup': rollupWeekly,
    'retention': purgeExpiredData,
    'projections': calculateAllProjections,
    'auto-learn': runLearningJob,
  };

  const fn = runnables[jobName];

  if (!fn) {
    const known = Object.keys(runnables).join(', ');
    throw new Error(`Unknown job "${jobName}". Valid names: ${known}`);
  }

  logger.info(`[poller] Running job "${jobName}" on demand`);
  await wrap(jobName, fn)();
}

/**
 * Returns a snapshot of every registered job's current status.
 *
 * @returns {{running: boolean, jobs: Object<string, {lastRun: string|null, status: string, elapsed: number|null}>}}
 */
function getStatus() {
  const jobs = {};

  // Include all registered task names, falling back to "idle" for jobs
  // that have never executed.
  const allNames = new Set([...tasks.keys(), ...jobStatus.keys()]);

  for (const name of allNames) {
    jobs[name] = jobStatus.get(name) || {
      lastRun: null,
      status: 'idle',
      elapsed: null,
    };
  }

  return { running, jobs };
}

module.exports = {
  start,
  stop,
  runNow,
  getStatus,
};
