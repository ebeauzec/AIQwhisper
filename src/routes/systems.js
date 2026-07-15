'use strict';

/**
 * @module routes/systems
 * @description Express router for storage-system management.
 *
 * Endpoints:
 *   GET    /           – List all registered systems.
 *   POST   /           – Register a new system.
 *   GET    /:id        – Retrieve a single system by ID.
 *   PUT    /:id        – Update an existing system (partial).
 *   DELETE /:id        – Remove a system (cascading).
 *   POST   /:id/test   – Test connectivity to a system.
 *   POST   /:id/collect – Trigger an immediate data-collection run.
 */

const { Router } = require('express');
const models = require('../db/models');
const { encrypt } = require('../utils/crypto');
const config = require('../config');
const logger = require('../utils/logger');

const router = Router();

/** @constant {Set<string>} VALID_TYPES Allowed system types. */
const VALID_TYPES = new Set(['ontap', 'storagegrid', 'eseries']);

/**
 * Map a system type string to its collector class.
 *
 * @param {string} type - "ontap" | "storagegrid" | "eseries"
 * @returns {typeof import('../collectors/base')} Collector constructor.
 */
function getCollectorClass(type) {
  switch (type) {
    case 'ontap':
      return require('../collectors/ontap');
    case 'storagegrid':
      return require('../collectors/storagegrid');
    case 'eseries':
      return require('../collectors/eseries');
    default:
      throw new Error(`Unknown system type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// GET / – List all systems
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/systems
 * @desc    Return every registered system.
 * @returns {{ data: Object[] }}
 */
router.get('/', (req, res, next) => {
  try {
    const data = models.systems.getAll();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST / – Register a new system
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/systems
 * @desc    Register a new storage system.
 * @body    {Object} body
 * @body    {string} body.type     – "ontap" | "storagegrid" | "eseries"
 * @body    {string} body.name     – Human-readable label.
 * @body    {string} body.hostname – FQDN or IP of the management interface.
 * @body    {number} [body.port=443]
 * @body    {string} [body.username]
 * @body    {string} [body.password]
 * @returns {{ data: { id: number } }}
 */
router.post('/', (req, res, next) => {
  try {
    const { type, name, hostname, port, username, password } = req.body;

    // --- validation ---
    if (!type || !VALID_TYPES.has(type)) {
      return res.status(400).json({
        error: `Invalid or missing type. Must be one of: ${[...VALID_TYPES].join(', ')}`,
      });
    }
    if (!name || !hostname) {
      return res.status(400).json({ error: 'name and hostname are required.' });
    }

    // Encrypt credentials when both username and password are provided
    let credentialsEncrypted = null;
    if (username && password) {
      const passphrase = config.masterPassphrase;
      if (!passphrase) {
        return res.status(500).json({
          error: 'Server master passphrase is not configured (MASTER_PASSPHRASE).',
        });
      }
      credentialsEncrypted = encrypt(
        JSON.stringify({ username, password }),
        passphrase,
      );
    }

    const id = models.systems.create({
      type,
      name,
      hostname,
      port: port || 443,
      credentialsEncrypted,
    });

    res.status(201).json({ data: { id } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /:id – Get system by ID
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/systems/:id
 * @desc    Retrieve a single system.
 * @param   {string} id – System primary key.
 * @returns {{ data: Object }}
 */
router.get('/:id', (req, res, next) => {
  try {
    const system = models.systems.getById(Number(req.params.id));
    if (!system) {
      return res.status(404).json({ error: 'System not found.' });
    }
    res.json({ data: system });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /:id – Update system
// ---------------------------------------------------------------------------

/**
 * @route   PUT /api/systems/:id
 * @desc    Update one or more fields on an existing system.
 *          Only fields present in the request body are modified.
 * @param   {string} id – System primary key.
 * @body    {Object} body – Partial update payload.
 * @returns {{ data: { changes: number } }}
 */
router.put('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const system = models.systems.getById(id);
    if (!system) {
      return res.status(404).json({ error: 'System not found.' });
    }

    const { type, name, hostname, port, username, password } = req.body;
    const fields = {};

    if (type !== undefined) {
      if (!VALID_TYPES.has(type)) {
        return res.status(400).json({
          error: `Invalid type. Must be one of: ${[...VALID_TYPES].join(', ')}`,
        });
      }
      fields.type = type;
    }
    if (name !== undefined) fields.name = name;
    if (hostname !== undefined) fields.hostname = hostname;
    if (port !== undefined) fields.port = port;

    // Re-encrypt credentials when either username or password changes
    if (username !== undefined || password !== undefined) {
      const passphrase = config.masterPassphrase;
      if (!passphrase) {
        return res.status(500).json({
          error: 'Server master passphrase is not configured (MASTER_PASSPHRASE).',
        });
      }
      // Merge with existing credentials where possible
      const newUsername = username || 'admin';
      const newPassword = password || '';
      fields.credentials_encrypted = encrypt(
        JSON.stringify({ username: newUsername, password: newPassword }),
        passphrase,
      );
    }

    const changes = models.systems.update(id, fields);
    res.json({ data: { changes } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id – Delete system
// ---------------------------------------------------------------------------

/**
 * @route   DELETE /api/systems/:id
 * @desc    Remove a system and all related data (cascade).
 * @param   {string} id – System primary key.
 * @returns {{ data: { deleted: number } }}
 */
router.delete('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const deleted = models.systems.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'System not found.' });
    }
    res.json({ data: { deleted } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/test – Test connectivity
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/systems/:id/test
 * @desc    Instantiate the appropriate collector and attempt to connect.
 * @param   {string} id – System primary key.
 * @returns {{ data: { success: boolean, message: string } }}
 */
router.post('/:id/test', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const system = models.systems.getById(id);
    if (!system) {
      return res.status(404).json({ error: 'System not found.' });
    }

    const CollectorClass = getCollectorClass(system.type);
    const collector = new CollectorClass(system);

    try {
      await collector.connect();
      models.systems.updateStatus(id, 'online', collector.system.version || system.version);
      res.json({ data: { success: true, message: 'Connection successful.' } });
    } catch (connErr) {
      models.systems.updateStatus(id, 'offline');
      res.json({
        data: { success: false, message: connErr.message },
      });
    } finally {
      try {
        await collector.disconnect();
      } catch (_) {
        // swallow disconnect errors
      }
    }
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/collect – Trigger immediate collection
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/systems/:id/collect
 * @desc    Trigger an immediate data-collection run for this system.
 * @param   {string} id – System primary key.
 * @returns {{ data: { runId: number, status: string } }}
 */
router.post('/:id/collect', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const system = models.systems.getById(id);
    if (!system) {
      return res.status(404).json({ error: 'System not found.' });
    }

    const CollectorClass = getCollectorClass(system.type);
    const collector = new CollectorClass(system);

    const runId = models.collectionRuns.create(id);

    // Run collection asynchronously so we can return the runId immediately
    (async () => {
      try {
        await collector.connect();
        await collector.collectInventory();
        await collector.collectPerformance();
        await collector.collectCapacity();
        models.collectionRuns.complete(runId, {
          status: 'completed',
          endpointsQueried: collector.endpointsQueried,
          recordsCollected: collector.recordsCollected,
        });
        models.systems.updateStatus(id, 'online', collector.system.version || system.version);
        models.systems.updateLastPolled(id);
        logger.info(`[systems] Collection run ${runId} completed for system ${id}`);
      } catch (collectErr) {
        models.collectionRuns.complete(runId, {
          status: 'failed',
          endpointsQueried: collector.endpointsQueried,
          recordsCollected: collector.recordsCollected,
          errorMessage: collectErr.message,
        });
        models.systems.updateStatus(id, 'degraded');
        logger.error(`[systems] Collection run ${runId} failed for system ${id}: ${collectErr.message}`);
      } finally {
        try {
          await collector.disconnect();
        } catch (_) {
          // swallow disconnect errors
        }
      }
    })();

    res.status(202).json({ data: { runId, status: 'running' } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
