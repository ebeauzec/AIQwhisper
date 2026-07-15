/**
 * @module config
 * @description Central configuration module for AIQwhisper.
 * Loads environment variables from .env via dotenv and exports
 * a frozen configuration object with sensible defaults.
 */

'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Load .env from the project root (one level above src/)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/**
 * Parse an integer from an environment variable with a fallback default.
 * @param {string} value - The raw environment variable value.
 * @param {number} defaultValue - Fallback if parsing fails.
 * @returns {number}
 */
function int(value, defaultValue) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse a boolean from an environment variable.
 * @param {string} value - The raw environment variable value.
 * @param {boolean} defaultValue - Fallback if value is undefined.
 * @returns {boolean}
 */
function bool(value, defaultValue) {
  if (value === undefined || value === '') return defaultValue;
  return value === 'true' || value === '1';
}

/**
 * @typedef {Object} RetentionConfig
 * @property {number} rawDays      - Days to keep raw (1-minute) metrics.
 * @property {number} hourlyDays   - Days to keep hourly roll-ups.
 * @property {number} dailyDays    - Days to keep daily roll-ups.
 * @property {number} weeklyDays   - Days to keep weekly roll-ups.
 */

/**
 * @typedef {Object} AutoLearnConfig
 * @property {boolean} enabled   - Whether automatic learning is active.
 * @property {string}  schedule  - Cron expression for the learning job.
 * @property {string}  eolApiUrl - URL for the end-of-life / end-of-support API.
 */

/**
 * @typedef {Object} NetAppConfig
 * @property {string} ontapApiPrefix       - ONTAP REST API prefix.
 * @property {string} storagegridApiPrefix  - StorageGRID REST API prefix.
 * @property {string} eseriesApiPrefix      - E-Series REST API prefix.
 */

/**
 * @typedef {Object} AppConfig
 * @property {number}          port                      - HTTP listen port.
 * @property {string}          bindAddress                - Address to bind the server to.
 * @property {string}          logLevel                   - Winston log level.
 * @property {string}          dbPath                     - Path to the SQLite database file.
 * @property {string}          masterPassphrase           - Master passphrase for credential encryption.
 * @property {number}          pollIntervalMinutes        - Interval for general polling jobs.
 * @property {number}          perfPollIntervalMinutes    - Interval for performance polling.
 * @property {number}          capacityPollIntervalMinutes - Interval for capacity polling.
 * @property {RetentionConfig} retention                  - Data retention policy.
 * @property {AutoLearnConfig} autoLearn                  - Automatic learning configuration.
 * @property {boolean}         rejectUnauthorized         - Whether to reject self-signed TLS certs.
 * @property {NetAppConfig}    netapp                     - NetApp API prefix overrides.
 */

/** @type {AppConfig} */
const config = {
  port: int(process.env.PORT, 3000),
  bindAddress: process.env.BIND_ADDRESS || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'aiqwhisper.db'),
  masterPassphrase: process.env.MASTER_PASSPHRASE || '',

  pollIntervalMinutes: int(process.env.POLL_INTERVAL_MINUTES, 5),
  perfPollIntervalMinutes: int(process.env.PERF_POLL_INTERVAL_MINUTES, 1),
  capacityPollIntervalMinutes: int(process.env.CAPACITY_POLL_INTERVAL_MINUTES, 60),

  retention: {
    rawDays: int(process.env.RETENTION_RAW_DAYS, 7),
    hourlyDays: int(process.env.RETENTION_HOURLY_DAYS, 30),
    dailyDays: int(process.env.RETENTION_DAILY_DAYS, 365),
    weeklyDays: int(process.env.RETENTION_WEEKLY_DAYS, 730),
  },

  autoLearn: {
    enabled: bool(process.env.AUTO_LEARN_ENABLED, true),
    schedule: process.env.AUTO_LEARN_SCHEDULE || '0 2 * * 0',
    eolApiUrl: process.env.EOL_API_URL || 'https://endoflife.date/api',
  },

  rejectUnauthorized: bool(process.env.REJECT_UNAUTHORIZED, false),

  netapp: {
    ontapApiPrefix: process.env.ONTAP_API_PREFIX || '/api',
    storagegridApiPrefix: process.env.STORAGEGRID_API_PREFIX || '/api/v4',
    eseriesApiPrefix: process.env.ESERIES_API_PREFIX || '/devmgr/v2',
  },
};

module.exports = Object.freeze(config);
