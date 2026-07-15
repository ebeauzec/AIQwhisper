/**
 * @module collectors/eseries
 * @description E-Series (SANtricity) REST API collector extending BaseCollector.
 *
 * Connects via Basic Authentication to the SANtricity Web Services Proxy
 * or embedded API and collects:
 *   - Inventory: storage systems, controller graph, controllers, drives,
 *     storage pools, volumes, host definitions, and LUN mappings.
 *   - Performance: analysed statistics for volumes, controllers, drives,
 *     and whole system.
 *   - Capacity: pool and volume space utilization snapshots.
 */

'use strict';

const BaseCollector = require('./base');
const { createClient } = require('../utils/httpClient');
const logger = require('../utils/logger');

/**
 * E-Series (SANtricity) REST API collector.
 *
 * @class ESeriesCollector
 * @extends BaseCollector
 */
class ESeriesCollector extends BaseCollector {
  /**
   * @param {Object} system - System row from the database.
   * @param {Object} [db]   - Database models instance.
   */
  constructor(system, db) {
    super(system, db);

    /**
     * Discovered storage system IDs managed by the proxy.
     * @type {string[]}
     */
    this.storageSystemIds = [];
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /**
   * Connect to the E-Series Web Services Proxy via Basic Authentication.
   *
   * Creates an Axios client with:
   *   `baseURL = https://<hostname>:<port>/devmgr/v2`
   *
   * @returns {Promise<void>}
   */
  async connect() {
    const creds = this.credentials || this.decryptCredentials();
    const port = this.system.port || 8443;
    const protocol = port === 80 || port === 8080 ? 'http' : 'https';
    const baseURL = `${protocol}://${this.system.hostname}:${port}/devmgr/v2`;

    this.client = createClient(baseURL, {
      type: 'basic',
      username: creds.username,
      password: creds.password,
    }, {
      timeout: 60000,
    });

    // Discover managed storage systems
    const { data } = await this.client.get('/storage-systems');
    this.storageSystemIds = [];

    if (Array.isArray(data)) {
      for (const ss of data) {
        this.storageSystemIds.push(ss.id || ss.wwn);
      }
    }

    // Capture version from the first array, if available
    if (data && data.length > 0) {
      const first = data[0];
      this.system.version = first.fwVersion || first.codeLevel || null;
      if (this.system.version) {
        this.db.systems.updateStatus(this.system.id, 'online', this.system.version);
      }
    }

    logger.info(
      `${this.systemLabel} Connected to E-Series proxy — ` +
      `${this.storageSystemIds.length} managed array(s)`
    );
  }

  // ---------------------------------------------------------------------------
  // Inventory
  // ---------------------------------------------------------------------------

  /**
   * Collect inventory data from all managed E-Series arrays.
   *
   * For each storage system managed by the proxy, collects the full
   * configuration graph, controllers, drives, pools, volumes, host
   * definitions, and LUN mappings.
   *
   * @returns {Promise<void>}
   */
  async collectInventory() {
    const systemId = this.system.id;

    // ----- Top-level storage systems -----
    try {
      const systems = await this.collectEndpoint('/storage-systems');
      const rows = systems.map((ss) => ({
        system_id: systemId,
        array_id: ss.id || ss.wwn,
        name: ss.name || null,
        wwn: ss.wwn || null,
        status: ss.status || null,
        ip1: ss.ip1 || null,
        ip2: ss.ip2 || null,
        fw_version: ss.fwVersion || null,
        chassis_serial: ss.chassisSerialNumber || null,
        model: ss.model || null,
        boot_time: ss.bootTime || null,
        raw_json: JSON.stringify(ss),
      }));

      if (rows.length > 0) {
        this.db.bulkUpsert('eseries_arrays', rows, ['system_id', 'array_id']);
        this.recordsCollected += rows.length;
      }
    } catch (err) {
      logger.error(`${this.systemLabel} Storage systems collection failed: ${err.message}`);
    }

    // ----- Per-array detailed inventory -----
    for (const arrayId of this.storageSystemIds) {
      const arrayLabel = `${this.systemLabel}[${arrayId}]`;

      // Configuration graph (full device topology)
      await this._collectArrayEndpoint(
        arrayId, '/graph', 'eseries_graph', ['system_id', 'array_id'],
        (d) => ({
          system_id: systemId,
          array_id: arrayId,
          sa_data: d.sa ? JSON.stringify(d.sa) : null,
          controller_count: d.sa ? d.sa.saData ? d.sa.saData.controllerCount : null : null,
          raw_json: JSON.stringify(d),
        }),
        arrayLabel, true // graph is single-object
      );

      // Controllers
      await this._collectArrayEndpoint(
        arrayId, '/controllers', 'eseries_controllers', ['system_id', 'array_id', 'controller_id'],
        (d) => ({
          system_id: systemId,
          array_id: arrayId,
          controller_id: d.controllerRef || d.id,
          name: d.name || d.physicalLocation ? `Controller ${d.physicalLocation.slot}` : null,
          serial_number: d.serialNumber || null,
          status: d.status || null,
          fw_version: d.appVersion || null,
          model: d.modelName || null,
          slot: d.physicalLocation ? d.physicalLocation.slot : null,
          raw_json: JSON.stringify(d),
        }),
        arrayLabel
      );

      // Drives
      await this._collectArrayEndpoint(
        arrayId, '/drives', 'eseries_drives', ['system_id', 'array_id', 'drive_id'],
        (d) => ({
          system_id: systemId,
          array_id: arrayId,
          drive_id: d.driveRef || d.id,
          serial_number: d.serialNumber || null,
          manufacturer: d.manufacturer || null,
          product_id: d.productID || null,
          status: d.status || null,
          drive_media_type: d.driveMediaType || null,
          interface_type: d.interfaceType ? d.interfaceType.driveType : null,
          raw_capacity: d.rawCapacity ? Number(d.rawCapacity) : null,
          usable_capacity: d.usableCapacity ? Number(d.usableCapacity) : null,
          tray_ref: d.physicalLocation ? d.physicalLocation.trayRef : null,
          slot: d.physicalLocation ? d.physicalLocation.slot : null,
          fw_version: d.firmwareVersion || null,
          raw_json: JSON.stringify(d),
        }),
        arrayLabel
      );

      // Storage pools (volume groups / disk pools)
      await this._collectArrayEndpoint(
        arrayId, '/storage-pools', 'eseries_pools', ['system_id', 'array_id', 'pool_id'],
        (d) => ({
          system_id: systemId,
          array_id: arrayId,
          pool_id: d.volumeGroupRef || d.id,
          name: d.name || d.label || null,
          raid_level: d.raidLevel || null,
          state: d.state || null,
          total_bytes: d.totalRaidedSpace ? Number(d.totalRaidedSpace) : null,
          used_bytes: d.usedSpace ? Number(d.usedSpace) : null,
          free_bytes: d.freeSpace ? Number(d.freeSpace) : null,
          drive_count: d.driveCount || null,
          disk_pool: d.diskPool != null ? (d.diskPool ? 1 : 0) : null,
          raw_json: JSON.stringify(d),
        }),
        arrayLabel
      );

      // Volumes
      await this._collectArrayEndpoint(
        arrayId, '/volumes', 'eseries_volumes', ['system_id', 'array_id', 'volume_id'],
        (d) => ({
          system_id: systemId,
          array_id: arrayId,
          volume_id: d.volumeRef || d.id,
          name: d.name || d.label || null,
          wwn: d.wwn || null,
          capacity: d.capacity ? Number(d.capacity) : null,
          status: d.status || null,
          pool_id: d.volumeGroupRef || null,
          segment_size: d.segmentSize || null,
          cache_read_ahead: d.cache ? d.cache.readCacheActive : null,
          cache_write: d.cache ? d.cache.writeCacheActive : null,
          mapped: d.mapped != null ? (d.mapped ? 1 : 0) : null,
          raw_json: JSON.stringify(d),
        }),
        arrayLabel
      );

      // Hosts
      await this._collectArrayEndpoint(
        arrayId, '/hosts', 'eseries_hosts', ['system_id', 'array_id', 'host_id'],
        (d) => ({
          system_id: systemId,
          array_id: arrayId,
          host_id: d.hostRef || d.id,
          name: d.name || d.label || null,
          host_type_name: d.hostType ? d.hostType.name : null,
          host_type_index: d.hostTypeIndex || null,
          ports: d.hostSidePorts ? JSON.stringify(d.hostSidePorts) : null,
          cluster_ref: d.clusterRef || null,
          raw_json: JSON.stringify(d),
        }),
        arrayLabel
      );

      // LUN mappings
      await this._collectArrayEndpoint(
        arrayId, '/volume-mappings', 'eseries_mappings', ['system_id', 'array_id', 'mapping_id'],
        (d) => ({
          system_id: systemId,
          array_id: arrayId,
          mapping_id: d.lunMappingRef || d.id,
          volume_ref: d.volumeRef || null,
          lun_number: d.lun != null ? d.lun : null,
          host_ref: d.mapRef || null,
          type: d.type || null,
          raw_json: JSON.stringify(d),
        }),
        arrayLabel
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------

  /**
   * Collect analysed performance statistics from each managed E-Series array.
   *
   * Endpoints:
   *   - /analysed-volume-statistics
   *   - /analysed-controller-statistics
   *   - /analysed-drive-statistics
   *   - /analysed-system-statistics
   *
   * @returns {Promise<void>}
   */
  async collectPerformance() {
    const systemId = this.system.id;
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    /** @type {{path: string, resourceType: string, idField: string}[]} */
    const statEndpoints = [
      { path: '/analysed-volume-statistics', resourceType: 'eseries_volume', idField: 'volumeId' },
      { path: '/analysed-controller-statistics', resourceType: 'eseries_controller', idField: 'controllerId' },
      { path: '/analysed-drive-statistics', resourceType: 'eseries_drive', idField: 'diskId' },
      { path: '/analysed-system-statistics', resourceType: 'eseries_system', idField: 'systemId' },
    ];

    for (const arrayId of this.storageSystemIds) {
      for (const sep of statEndpoints) {
        try {
          const fullPath = `/storage-systems/${arrayId}${sep.path}`;
          const data = await this.collectEndpoint(fullPath);
          const stats = Array.isArray(data) ? data : [data];
          const records = [];

          for (const stat of stats) {
            if (!stat) continue;
            const resourceId = stat[sep.idField] || arrayId;

            // Extract key numeric fields from the statistics object
            const numericFields = [
              'readIOps', 'writeIOps', 'otherIOps', 'combinedIOps',
              'readThroughput', 'writeThroughput', 'combinedThroughput',
              'readResponseTime', 'writeResponseTime', 'combinedResponseTime',
              'averageReadOpSize', 'averageWriteOpSize',
              'readHitOps', 'writeHitOps', 'readHitResponseTime',
              'readCacheUtilization', 'writeCacheUtilization',
              'flashCacheReadHitPct', 'flashCacheReadThroughput',
            ];

            for (const field of numericFields) {
              if (stat[field] != null && !isNaN(Number(stat[field]))) {
                records.push({
                  system_id: systemId,
                  resource_type: sep.resourceType,
                  resource_id: resourceId,
                  metric_name: field,
                  metric_value: Number(stat[field]),
                  unit: field.includes('Throughput') ? 'bytes/s'
                    : field.includes('ResponseTime') ? 'ms'
                    : field.includes('Ops') || field.includes('IOps') ? 'iops'
                    : field.includes('Pct') || field.includes('Utilization') ? 'percent'
                    : 'value',
                  timestamp,
                });
              }
            }
          }

          if (records.length > 0) {
            const inserted = this.db.metrics.insertRaw(records);
            this.recordsCollected += inserted;
          }

          logger.debug(
            `${this.systemLabel}[${arrayId}] ${sep.path}: ${records.length} metric(s)`
          );
        } catch (err) {
          logger.warn(
            `${this.systemLabel}[${arrayId}] ${sep.path} failed: ${err.message}`
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Capacity
  // ---------------------------------------------------------------------------

  /**
   * Collect capacity snapshots for storage pools and volumes from each array.
   *
   * @returns {Promise<void>}
   */
  async collectCapacity() {
    const systemId = this.system.id;
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    for (const arrayId of this.storageSystemIds) {
      const arrayLabel = `${this.systemLabel}[${arrayId}]`;

      // ----- Pool capacity -----
      try {
        const pools = await this.collectEndpoint(`/storage-systems/${arrayId}/storage-pools`);
        const poolArray = Array.isArray(pools) ? pools : [];

        for (const pool of poolArray) {
          const total = Number(pool.totalRaidedSpace) || 0;
          const used = Number(pool.usedSpace) || 0;
          const free = Number(pool.freeSpace) || (total - used);

          this.db.capacity.insertSnapshot({
            system_id: systemId,
            resource_type: 'eseries_pool',
            resource_id: pool.volumeGroupRef || pool.id,
            resource_name: pool.name || pool.label || pool.id,
            total_bytes: total,
            used_bytes: used,
            available_bytes: free,
            utilization_pct: total > 0 ? ((used / total) * 100).toFixed(2) : 0,
            snapshot_timestamp: timestamp,
          });
          this.recordsCollected += 1;
        }

        logger.debug(`${arrayLabel} Pool capacity: ${poolArray.length} pool(s)`);
      } catch (err) {
        logger.error(`${arrayLabel} Pool capacity failed: ${err.message}`);
      }

      // ----- Volume capacity -----
      try {
        const volumes = await this.collectEndpoint(`/storage-systems/${arrayId}/volumes`);
        const volArray = Array.isArray(volumes) ? volumes : [];

        for (const vol of volArray) {
          const total = Number(vol.capacity) || 0;
          // E-Series volumes don't always expose used; use totalSizeInBytes if available
          const used = Number(vol.currentVolumeCapacity) || 0;
          const available = total - used;

          this.db.capacity.insertSnapshot({
            system_id: systemId,
            resource_type: 'eseries_volume',
            resource_id: vol.volumeRef || vol.id,
            resource_name: vol.name || vol.label || vol.id,
            total_bytes: total,
            used_bytes: used,
            available_bytes: available > 0 ? available : 0,
            utilization_pct: total > 0 ? ((used / total) * 100).toFixed(2) : 0,
            snapshot_timestamp: timestamp,
          });
          this.recordsCollected += 1;
        }

        logger.debug(`${arrayLabel} Volume capacity: ${volArray.length} volume(s)`);
      } catch (err) {
        logger.error(`${arrayLabel} Volume capacity failed: ${err.message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetch a per-array endpoint and upsert results into a database table.
   *
   * @param {string}   arrayId      - E-Series storage system id.
   * @param {string}   subPath      - Path under `/storage-systems/{id}/`.
   * @param {string}   table        - Target DB table.
   * @param {string[]} uniqueKeys   - Uniqueness constraint columns.
   * @param {Function} mapRow       - Row mapper function.
   * @param {string}   label        - Human label for logging.
   * @param {boolean}  [isSingle=false] - True if endpoint returns a single object.
   * @returns {Promise<void>}
   * @private
   */
  async _collectArrayEndpoint(arrayId, subPath, table, uniqueKeys, mapRow, label, isSingle = false) {
    try {
      const fullPath = `/storage-systems/${arrayId}${subPath}`;
      logger.debug(`${label} Inventory: ${fullPath} -> ${table}`);
      const data = await this.collectEndpoint(fullPath);

      const records = isSingle
        ? [data]
        : (Array.isArray(data) ? data : [data]);
      const rows = records.map(mapRow);

      if (rows.length > 0) {
        this.db.bulkUpsert(table, rows, uniqueKeys);
        this.recordsCollected += rows.length;
      }

      logger.debug(`${label} ${table}: ${rows.length} record(s) upserted`);
    } catch (err) {
      logger.error(`${label} Error collecting ${subPath}: ${err.message}`);
    }
  }
}

module.exports = ESeriesCollector;
