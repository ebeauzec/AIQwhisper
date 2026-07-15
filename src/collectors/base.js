/**
 * @module collectors/base
 * @description Abstract base class for all platform collectors.
 *
 * Provides the shared lifecycle for connecting to a storage system,
 * collecting inventory / performance / capacity data, recording
 * collection runs, and gracefully handling errors.
 *
 * Subclasses MUST implement:
 *   - {@link BaseCollector#collectInventory}
 *   - {@link BaseCollector#collectPerformance}
 *   - {@link BaseCollector#collectCapacity}
 */

'use strict';

const config = require('../config');
const logger = require('../utils/logger');
const { decrypt } = require('../utils/crypto');
const { createClient } = require('../utils/httpClient');
const models = require('../db/models');

/**
 * Abstract base class for platform-specific data collectors.
 *
 * @class BaseCollector
 * @property {Object}  system       - Row from the `systems` table.
 * @property {Object}  db           - Database instance (models facade).
 * @property {import('axios').AxiosInstance|null} client - HTTP client (set by {@link connect}).
 * @property {Object}  credentials  - Decrypted credential object.
 * @property {number}  runId        - Current collection_run id.
 * @property {number}  endpointsQueried  - Counter for endpoints fetched.
 * @property {number}  recordsCollected  - Counter for records written.
 */
class BaseCollector {
  /**
   * Create a BaseCollector.
   *
   * @param {Object} system - Row from the `systems` table.
   * @param {Object} db     - Database / models instance.
   */
  constructor(system, db) {
    if (new.target === BaseCollector) {
      throw new Error('BaseCollector is abstract and cannot be instantiated directly');
    }

    /** @type {Object} */
    this.system = system;

    /** @type {Object} */
    this.db = db || models;

    /** @type {import('axios').AxiosInstance|null} */
    this.client = null;

    /** @type {Object|null} */
    this.credentials = null;

    /** @type {number} */
    this.runId = 0;

    /** @type {number} */
    this.endpointsQueried = 0;

    /** @type {number} */
    this.recordsCollected = 0;

    /** @type {string} */
    this.systemLabel = `[${system.type}:${system.name}]`;
  }

  // ---------------------------------------------------------------------------
  // Credential handling
  // ---------------------------------------------------------------------------

  /**
   * Decrypt the stored credentials using the master passphrase.
   *
   * The encrypted blob is expected to be a JSON-serialised object
   * (e.g. `{ username, password }`) encrypted with AES-256-GCM via
   * the crypto utility.
   *
   * @returns {Object} Decrypted credentials object.
   * @throws {Error} If decryption fails or credentials are missing.
   */
  decryptCredentials() {
    if (!this.system.credentials_encrypted) {
      throw new Error(`${this.systemLabel} No encrypted credentials stored`);
    }

    const passphrase = config.masterPassphrase;
    if (!passphrase) {
      throw new Error('Master passphrase is not configured (MASTER_PASSPHRASE)');
    }

    try {
      const json = decrypt(this.system.credentials_encrypted, passphrase);
      this.credentials = JSON.parse(json);
      return this.credentials;
    } catch (err) {
      throw new Error(`${this.systemLabel} Failed to decrypt credentials: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Authenticate to the target system and set `this.client`.
   *
   * Subclasses override this to configure auth type, base URL, and
   * any platform-specific handshake (e.g. token exchange).
   *
   * @abstract
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error(`${this.systemLabel} connect() must be implemented by subclass`);
  }

  /**
   * Cleanup resources after collection (close sessions, revoke tokens, etc.).
   *
   * Default implementation is a no-op; subclasses may override.
   *
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.client = null;
    logger.debug(`${this.systemLabel} Disconnected`);
  }

  // ---------------------------------------------------------------------------
  // Abstract collection methods
  // ---------------------------------------------------------------------------

  /**
   * Collect configuration and inventory data from the target system.
   *
   * @abstract
   * @returns {Promise<void>}
   */
  async collectInventory() {
    throw new Error(`${this.systemLabel} collectInventory() must be implemented by subclass`);
  }

  /**
   * Collect performance counter / metric data from the target system.
   *
   * @abstract
   * @returns {Promise<void>}
   */
  async collectPerformance() {
    throw new Error(`${this.systemLabel} collectPerformance() must be implemented by subclass`);
  }

  /**
   * Collect capacity / space utilization snapshots from the target system.
   *
   * @abstract
   * @returns {Promise<void>}
   */
  async collectCapacity() {
    throw new Error(`${this.systemLabel} collectCapacity() must be implemented by subclass`);
  }

  // ---------------------------------------------------------------------------
  // Endpoint fetching with pagination & retry
  // ---------------------------------------------------------------------------

  /**
   * Fetch data from a REST endpoint with automatic pagination and retry.
   *
   * Pagination strategies:
   *   - **ONTAP** — follows `_links.next.href` until exhausted.
   *   - **E-Series** — if the response is an array at the top level it is
   *     returned as-is (no server-side pagination).
   *
   * On a 401 response the collector will attempt to re-authenticate once
   * via {@link connect} and replay the request.
   *
   * @param {string} path            - API path relative to baseURL.
   * @param {Object} [params={}]     - Query-string parameters.
   * @returns {Promise<Object|Array>} Aggregated response data.
   */
  async collectEndpoint(path, params = {}) {
    let allRecords = [];
    let url = path;
    let hasRetried = false;

    while (url) {
      try {
        logger.debug(`${this.systemLabel} GET ${url}`);
        const response = await this.client.get(url, { params: url === path ? params : {} });
        this.endpointsQueried += 1;
        const data = response.data;

        // ----- E-Series: top-level array, no pagination -----
        if (Array.isArray(data)) {
          allRecords = allRecords.concat(data);
          break;
        }

        // ----- ONTAP-style: { records: [...], _links: { next: { href } } } -----
        if (data && data.records) {
          allRecords = allRecords.concat(data.records);

          if (data._links && data._links.next && data._links.next.href) {
            // next.href can be a full URL or a relative path
            const nextHref = data._links.next.href;
            url = nextHref.startsWith('http') ? nextHref : nextHref;
            continue;
          }
          break;
        }

        // ----- Single-object response (e.g. /cluster, /security) -----
        return data;

      } catch (err) {
        // Re-authenticate once on 401, then retry the same request
        if (err.response && err.response.status === 401 && !hasRetried) {
          logger.warn(`${this.systemLabel} 401 on ${url} — re-authenticating`);
          hasRetried = true;
          await this.connect();
          continue;
        }
        logger.error(`${this.systemLabel} Failed to fetch ${url}: ${err.message}`);
        throw err;
      }
    }

    return allRecords;
  }

  // ---------------------------------------------------------------------------
  // Full collection orchestration
  // ---------------------------------------------------------------------------

  /**
   * Orchestrate a complete collection run.
   *
   * Lifecycle:
   *   1. Create a `collection_runs` record.
   *   2. Decrypt credentials and connect to the system.
   *   3. Run inventory, performance, and capacity collectors.
   *   4. Update the collection run with final results.
   *   5. Update the system status and `last_polled` timestamp.
   *   6. Disconnect.
   *
   * Errors in any phase are caught, logged, and recorded against the
   * collection run. The system status is set to `'offline'` on failure.
   *
   * @returns {Promise<{runId: number, status: string, endpointsQueried: number, recordsCollected: number}>}
   */
  async collect() {
    const startTime = Date.now();
    let status = 'completed';
    let errorMessage = null;

    // Step 1: Create collection run record
    try {
      this.runId = this.db.collectionRuns.create(this.system.id);
      logger.info(`${this.systemLabel} Collection run #${this.runId} started`);
    } catch (err) {
      logger.error(`${this.systemLabel} Failed to create collection run: ${err.message}`);
      throw err;
    }

    try {
      // Step 2: Connect
      this.decryptCredentials();
      await this.connect();
      logger.info(`${this.systemLabel} Connected successfully`);

      // Step 3: Collect inventory
      logger.info(`${this.systemLabel} Collecting inventory…`);
      await this.collectInventory();
      logger.info(`${this.systemLabel} Inventory complete`);

      // Step 4: Collect performance
      logger.info(`${this.systemLabel} Collecting performance metrics…`);
      await this.collectPerformance();
      logger.info(`${this.systemLabel} Performance complete`);

      // Step 5: Collect capacity
      logger.info(`${this.systemLabel} Collecting capacity snapshots…`);
      await this.collectCapacity();
      logger.info(`${this.systemLabel} Capacity complete`);

      // Update system status to online
      this.db.systems.updateStatus(this.system.id, 'online', this.system.version);
      this.db.systems.updateLastPolled(this.system.id);

    } catch (err) {
      status = 'failed';
      errorMessage = err.message || String(err);
      logger.error(`${this.systemLabel} Collection failed: ${errorMessage}`);

      // Mark system as offline on failure
      try {
        this.db.systems.updateStatus(this.system.id, 'offline');
      } catch (statusErr) {
        logger.error(`${this.systemLabel} Could not update system status: ${statusErr.message}`);
      }

    } finally {
      // Step 6: Update collection run record
      try {
        this.db.collectionRuns.complete(this.runId, {
          status,
          endpointsQueried: this.endpointsQueried,
          recordsCollected: this.recordsCollected,
          errorMessage,
        });
      } catch (completeErr) {
        logger.error(`${this.systemLabel} Failed to complete collection run: ${completeErr.message}`);
      }

      // Disconnect
      try {
        await this.disconnect();
      } catch (disconnErr) {
        logger.warn(`${this.systemLabel} Error during disconnect: ${disconnErr.message}`);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(
        `${this.systemLabel} Collection run #${this.runId} ${status} ` +
        `in ${elapsed}s — ${this.endpointsQueried} endpoints, ${this.recordsCollected} records`
      );
    }

    return {
      runId: this.runId,
      status,
      endpointsQueried: this.endpointsQueried,
      recordsCollected: this.recordsCollected,
    };
  }
}

module.exports = BaseCollector;
