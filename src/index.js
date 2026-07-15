/**
 * @fileoverview AIQwhisper — Express server entry point.
 *
 * Bootstraps the entire application:
 *  1. Loads configuration
 *  2. Initializes the SQLite database
 *  3. Seeds built-in rules via the RulesEngine
 *  4. Creates the Express app with middleware, routes, and error handling
 *  5. Starts the HTTP server and the background polling scheduler
 *  6. Registers graceful-shutdown handlers (SIGTERM / SIGINT)
 *
 * @module index
 */

'use strict';

const path = require('path');
const express = require('express');

/* ------------------------------------------------------------------ */
/*  Configuration & package metadata                                  */
/* ------------------------------------------------------------------ */

/** @type {import('./config')} */
const config = require('./config');

/** @type {{ version: string }} */
const pkg = require('../package.json');

/* ------------------------------------------------------------------ */
/*  Database & rules                                                  */
/* ------------------------------------------------------------------ */

const database = require('./db/database');
const RulesEngine = require('./rules/RulesEngine');

/* ------------------------------------------------------------------ */
/*  Middleware                                                        */
/* ------------------------------------------------------------------ */

const corsMiddleware = require('./middleware/cors');
const loggingMiddleware = require('./middleware/logging');
const errorHandler = require('./middleware/errorHandler');

/* ------------------------------------------------------------------ */
/*  Route modules                                                     */
/* ------------------------------------------------------------------ */

const systemsRouter = require('./routes/systems');
const dashboardRouter = require('./routes/dashboard');
const inventoryRouter = require('./routes/inventory');
const issuesRouter = require('./routes/issues');
const recommendationsRouter = require('./routes/recommendations');
const eventsRouter = require('./routes/events');
const performanceRouter = require('./routes/performance');
const capacityRouter = require('./routes/capacity');
const reportsRouter = require('./routes/reports');
const learningRouter = require('./routes/learning');
const catalogRouter = require('./routes/catalog');

/* ------------------------------------------------------------------ */
/*  Scheduler                                                         */
/* ------------------------------------------------------------------ */

const poller = require('./scheduler/poller');

/* ------------------------------------------------------------------ */
/*  Logger helper (falls back to console)                             */
/* ------------------------------------------------------------------ */

const logger = config.logger || console;

/* ================================================================== */
/*  Bootstrap                                                         */
/* ================================================================== */

/**
 * Initialise all subsystems and start the HTTP server.
 *
 * @async
 * @returns {Promise<void>}
 */
async function main() {
  /* ---- 1. Initialise database ------------------------------------ */
  await database.initialize();
  logger.info('[boot] Database initialised');

  /* ---- 2. Seed built-in rules ------------------------------------ */
  const rulesEngine = new RulesEngine();
  await rulesEngine.seedBuiltinRules();
  logger.info('[boot] Built-in rules seeded');

  /* ---- 3. Create Express app ------------------------------------- */
  const app = express();

  /* ---- 4. Apply middleware (order matters) ------------------------ */
  app.use(corsMiddleware);
  app.use(express.json({ limit: '10mb' }));
  app.use(loggingMiddleware);

  /* ---- 5. Static files ------------------------------------------- */
  app.use(express.static(path.join(__dirname, '..', 'public')));

  /* ---- 6. Health endpoint ---------------------------------------- */
  /**
   * @route   GET /health
   * @returns {{ status: string, version: string, uptime: number, database: string }}
   */
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: pkg.version,
      uptime: process.uptime(),
      database: 'connected',
    });
  });

  /* ---- 7. API routes --------------------------------------------- */
  app.use('/api/systems', systemsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/issues', issuesRouter);
  app.use('/api/recommendations', recommendationsRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/performance', performanceRouter);
  app.use('/api/capacity', capacityRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/learning', learningRouter);
  app.use('/api/catalog', catalogRouter);

  /* ---- 8. SPA fallback (client-side routing) --------------------- */
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  /* ---- 9. Centralised error handler ------------------------------ */
  app.use(errorHandler);

  /* ---- 10. Start HTTP server ------------------------------------- */
  const server = app.listen(config.port, config.bindAddress, () => {
    printBanner();
    logger.info(
      `[boot] AIQwhisper listening on http://${config.bindAddress}:${config.port}`
    );
  });

  /* ---- 11. Start background scheduler ---------------------------- */
  poller.start();
  logger.info('[boot] Polling scheduler started');

  /* ---- 12. Graceful shutdown ------------------------------------- */
  /**
   * Perform a clean shutdown: stop the scheduler, close the database,
   * and drain open HTTP connections before exiting.
   *
   * @param {string} signal - The OS signal that triggered shutdown.
   */
  function shutdown(signal) {
    logger.info(`[shutdown] Received ${signal} — shutting down gracefully…`);

    poller.stop();
    logger.info('[shutdown] Scheduler stopped');

    server.close(async () => {
      logger.info('[shutdown] HTTP server closed');

      try {
        await database.close();
        logger.info('[shutdown] Database connection closed');
      } catch (err) {
        logger.error('[shutdown] Error closing database:', err);
      }

      process.exit(0);
    });

    /* Force-kill if graceful shutdown stalls (10 s timeout) */
    setTimeout(() => {
      logger.error('[shutdown] Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/* ================================================================== */
/*  Startup banner                                                    */
/* ================================================================== */

/**
 * Print the ASCII-art startup banner to the console.
 */
function printBanner() {
  const banner = `
    _    ___ ___           _     _                   
   / \\  |_ _/ _ \\__      _| |__ (_)___ _ __   ___ _ __ 
  / _ \\  | | | | \\ \\ /\\ / / '_ \\| / __| '_ \\ / _ \\ '__|
 / ___ \\ | | |_| |\\ V  V /| | | | \\__ \\ |_) |  __/ |   
/_/   \\_\\___\\__\\_\\ \\_/\\_/ |_| |_|_|___/ .__/ \\___|_|   
                                       |_|              

  v${pkg.version}  •  ${config.bindAddress}:${config.port}
`;
  console.log(banner);
}

/* ================================================================== */
/*  Run                                                               */
/* ================================================================== */

main().catch((err) => {
  logger.error('[boot] Fatal error during startup:', err);
  process.exit(1);
});
