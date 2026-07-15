/**
 * @module collectors/storagegrid
 * @description StorageGRID REST API collector extending BaseCollector.
 *
 * Connects via token-based authentication (POST /api/v4/authorize) and
 * collects:
 *   - Inventory: grid topology, nodes, alerts, ILM policies, storage pools,
 *     buckets, admin users, network config, certificates, compliance, and
 *     traffic classification policies.
 *   - Performance: grid-level metrics.
 *   - Capacity: per-node and per-bucket storage usage.
 */

'use strict';

const BaseCollector = require('./base');
const { createClient } = require('../utils/httpClient');
const logger = require('../utils/logger');

/**
 * StorageGRID REST API collector.
 *
 * @class StorageGridCollector
 * @extends BaseCollector
 */
class StorageGridCollector extends BaseCollector {
  /**
   * @param {Object} system - System row from the database.
   * @param {Object} [db]   - Database models instance.
   */
  constructor(system, db) {
    super(system, db);

    /** @type {string|null} Bearer token obtained during connect(). */
    this.token = null;
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /**
   * Authenticate to the StorageGRID management API.
   *
   * Posts credentials to `/api/v4/authorize` to obtain a Bearer token,
   * then creates an Axios client with the token set in the Authorization header.
   *
   * @returns {Promise<void>}
   */
  async connect() {
    const creds = this.credentials || this.decryptCredentials();
    const protocol = this.system.port === 80 ? 'http' : 'https';
    const baseURL = `${protocol}://${this.system.hostname}:${this.system.port || 443}`;

    // Create a temporary unauthenticated client for the authorize call
    const tempClient = createClient(baseURL, null, { timeout: 30000 });

    const authResponse = await tempClient.post('/api/v4/authorize', {
      accountId: creds.accountId || '',
      username: creds.username,
      password: creds.password,
    });

    this.token = authResponse.data.data || authResponse.data;
    if (typeof this.token === 'object' && this.token.token) {
      this.token = this.token.token;
    }

    // Create the authenticated client with Bearer token
    this.client = createClient(`${baseURL}/api/v4`, {
      type: 'bearer',
      token: this.token,
    }, {
      timeout: 60000,
    });

    // Verify connectivity and capture version
    try {
      const { data } = await this.client.get('/grid/config/product-version');
      const version = data.data || data;
      if (typeof version === 'string') {
        this.system.version = version;
      } else if (version && version.productVersion) {
        this.system.version = version.productVersion;
      }
    } catch (versionErr) {
      logger.warn(`${this.systemLabel} Could not determine StorageGRID version: ${versionErr.message}`);
    }

    logger.info(`${this.systemLabel} Connected to StorageGRID ${this.system.version || 'unknown'}`);
  }

  /**
   * Disconnect from StorageGRID by revoking the Bearer token.
   *
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.client && this.token) {
      try {
        await this.client.post('/grid/authorize/revoke');
        logger.debug(`${this.systemLabel} Token revoked`);
      } catch (err) {
        logger.warn(`${this.systemLabel} Token revocation failed: ${err.message}`);
      }
    }
    this.token = null;
    await super.disconnect();
  }

  // ---------------------------------------------------------------------------
  // Inventory
  // ---------------------------------------------------------------------------

  /**
   * Collect full inventory from the StorageGRID management API.
   *
   * @returns {Promise<void>}
   */
  async collectInventory() {
    const systemId = this.system.id;

    // ----- Grid health / topology -----
    await this._collectEndpointToTable('/grid/health/topology', {}, 'sg_grid_topology', ['system_id'], (d) => ({
      system_id: systemId,
      topology: JSON.stringify(d),
    }));

    // ----- Grid health -----
    await this._collectEndpointToTable('/grid/health', {}, 'sg_grid_health', ['system_id'], (d) => ({
      system_id: systemId,
      status: d.status || null,
      alerts_summary: d.alerts ? JSON.stringify(d.alerts) : null,
      raw_json: JSON.stringify(d),
    }));

    // ----- Nodes -----
    await this._collectEndpointToTable('/grid/node-health', {}, 'sg_nodes', ['system_id', 'node_id'], (d) => ({
      system_id: systemId,
      node_id: d.id,
      name: d.name || null,
      type: d.type || null,
      site: d.siteId || d.site || null,
      state: d.severity || d.state || null,
      connection_state: d.connectionState || null,
      software_version: d.softwareVersion || null,
      raw_json: JSON.stringify(d),
    }));

    // ----- Active alerts -----
    await this._collectEndpointToTable('/grid/alarms', {}, 'sg_alerts', ['system_id', 'alert_id'], (d) => ({
      system_id: systemId,
      alert_id: d.id || d.alertId || JSON.stringify(d).substring(0, 64),
      rule_name: d.ruleName || d.name || null,
      severity: d.severity || null,
      status: d.status || null,
      node_id: d.nodeId || null,
      start_time: d.startTime || null,
      description: d.description || null,
      raw_json: JSON.stringify(d),
    }));

    // ----- ILM policies -----
    await this._collectEndpointToTable('/grid/ilm-policies', {}, 'sg_ilm_policies', ['system_id', 'policy_id'], (d) => ({
      system_id: systemId,
      policy_id: d.id || d.name,
      name: d.name || null,
      active: d.active != null ? (d.active ? 1 : 0) : null,
      rules_count: d.rules ? d.rules.length : 0,
      raw_json: JSON.stringify(d),
    }));

    // ----- ILM rules -----
    await this._collectEndpointToTable('/grid/ilm-rules', {}, 'sg_ilm_rules', ['system_id', 'rule_id'], (d) => ({
      system_id: systemId,
      rule_id: d.id || d.name,
      name: d.name || null,
      type: d.type || null,
      raw_json: JSON.stringify(d),
    }));

    // ----- Storage pools / Erasure coding profiles -----
    await this._collectEndpointToTable('/grid/ilm-criteria', {}, 'sg_storage_pools', ['system_id', 'pool_id'], (d) => ({
      system_id: systemId,
      pool_id: d.id || d.name,
      name: d.name || null,
      type: d.type || null,
      site_count: d.sites ? d.sites.length : null,
      raw_json: JSON.stringify(d),
    }));

    // ----- S3 Buckets -----
    await this._collectEndpointToTable('/org/containers', {}, 'sg_buckets', ['system_id', 'bucket_name'], (d) => ({
      system_id: systemId,
      bucket_name: d.name || d.bucketName,
      region: d.region || null,
      s3_object_lock: d.s3ObjectLockEnabled != null ? (d.s3ObjectLockEnabled ? 1 : 0) : null,
      versioning: d.versioning || null,
      created_at: d.creationTime || null,
      raw_json: JSON.stringify(d),
    }));

    // ----- Admin / tenant users -----
    await this._collectEndpointToTable('/grid/accounts', {}, 'sg_accounts', ['system_id', 'account_id'], (d) => ({
      system_id: systemId,
      account_id: d.id,
      name: d.name || null,
      type: d.type || null,
      capabilities: d.capabilities ? JSON.stringify(d.capabilities) : null,
      policy: d.policy ? JSON.stringify(d.policy) : null,
      raw_json: JSON.stringify(d),
    }));

    // ----- Network config -----
    await this._collectEndpointToTable('/grid/config/networking', {}, 'sg_network_config', ['system_id'], (d) => ({
      system_id: systemId,
      dns_servers: d.dnsServers ? JSON.stringify(d.dnsServers) : null,
      ntp_servers: d.ntpServers ? JSON.stringify(d.ntpServers) : null,
      raw_json: JSON.stringify(d),
    }));

    // ----- Certificates -----
    await this._collectEndpointToTable('/grid/config/server-certificates', {}, 'sg_certificates', ['system_id', 'cert_type'], (d) => ({
      system_id: systemId,
      cert_type: d.type || 'management',
      subject: d.subject || null,
      issuer: d.issuer || null,
      not_after: d.notAfter || null,
      serial_number: d.serialNumber || null,
      raw_json: JSON.stringify(d),
    }));

    // ----- Compliance config -----
    await this._collectEndpointToTable('/grid/compliance-global', {}, 'sg_compliance', ['system_id'], (d) => ({
      system_id: systemId,
      global_compliance: d.complianceEnabled != null ? (d.complianceEnabled ? 1 : 0) : null,
      raw_json: JSON.stringify(d),
    }));

    // ----- Traffic classification policies -----
    await this._collectEndpointToTable('/grid/traffic-classes/policies', {}, 'sg_traffic_classes', ['system_id', 'policy_id'], (d) => ({
      system_id: systemId,
      policy_id: d.id || d.name,
      name: d.name || null,
      description: d.description || null,
      matchers: d.matchers ? JSON.stringify(d.matchers) : null,
      limits: d.limits ? JSON.stringify(d.limits) : null,
      raw_json: JSON.stringify(d),
    }));
  }

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------

  /**
   * Collect grid-level performance metrics from StorageGRID.
   *
   * @returns {Promise<void>}
   */
  async collectPerformance() {
    const systemId = this.system.id;
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    // Metric queries
    const metricEndpoints = [
      { path: '/grid/metric-query', params: { query: 'storagegrid_s3_operations_successful' }, name: 's3_ops_successful' },
      { path: '/grid/metric-query', params: { query: 'storagegrid_s3_operations_failed' }, name: 's3_ops_failed' },
      { path: '/grid/metric-query', params: { query: 'storagegrid_http_sessions_incoming_attempted' }, name: 'http_sessions_attempted' },
      { path: '/grid/metric-query', params: { query: 'storagegrid_node_cpu_utilization_percentage' }, name: 'node_cpu_pct' },
      { path: '/grid/metric-query', params: { query: 'storagegrid_node_memory_utilization_percentage' }, name: 'node_memory_pct' },
      { path: '/grid/metric-query', params: { query: 'storagegrid_network_received_bytes' }, name: 'network_rx_bytes' },
      { path: '/grid/metric-query', params: { query: 'storagegrid_network_transmitted_bytes' }, name: 'network_tx_bytes' },
      { path: '/grid/metric-query', params: { query: 'storagegrid_ilm_objects_awaiting_evaluation' }, name: 'ilm_pending_objects' },
    ];

    const metricRecords = [];

    for (const mep of metricEndpoints) {
      try {
        const data = await this.collectEndpoint(mep.path, mep.params);
        const results = data && data.data && data.data.result ? data.data.result : [];

        for (const result of results) {
          const labels = result.metric || {};
          const nodeId = labels.node || labels.instance || 'grid';
          const value = Array.isArray(result.value) && result.value.length >= 2
            ? result.value[1]
            : 0;

          metricRecords.push({
            system_id: systemId,
            resource_type: 'storagegrid_node',
            resource_id: nodeId,
            metric_name: mep.name,
            metric_value: Number(value) || 0,
            unit: 'gauge',
            timestamp,
          });
        }
      } catch (err) {
        logger.warn(`${this.systemLabel} Metric query ${mep.name} failed: ${err.message}`);
      }
    }

    if (metricRecords.length > 0) {
      const inserted = this.db.metrics.insertRaw(metricRecords);
      this.recordsCollected += inserted;
      logger.info(`${this.systemLabel} Inserted ${inserted} StorageGRID metric(s)`);
    }
  }

  // ---------------------------------------------------------------------------
  // Capacity
  // ---------------------------------------------------------------------------

  /**
   * Collect storage capacity from StorageGRID nodes and buckets.
   *
   * @returns {Promise<void>}
   */
  async collectCapacity() {
    const systemId = this.system.id;
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    // ----- Node-level storage usage -----
    try {
      const nodes = await this.collectEndpoint('/grid/node-health');
      const nodeArray = Array.isArray(nodes) ? nodes : (nodes && nodes.data ? nodes.data : []);

      for (const node of nodeArray) {
        if (!node.dataUsed && !node.dataAvailable && !node.dataTotal) continue;

        const total = Number(node.dataTotal) || 0;
        const used = Number(node.dataUsed) || 0;
        const available = Number(node.dataAvailable) || (total - used);

        this.db.capacity.insertSnapshot({
          system_id: systemId,
          resource_type: 'storagegrid_node',
          resource_id: node.id || node.name,
          resource_name: node.name || node.id,
          total_bytes: total,
          used_bytes: used,
          available_bytes: available,
          utilization_pct: total > 0 ? ((used / total) * 100).toFixed(2) : 0,
          snapshot_timestamp: timestamp,
        });
        this.recordsCollected += 1;
      }

      logger.debug(`${this.systemLabel} Node capacity: ${nodeArray.length} node(s)`);
    } catch (err) {
      logger.error(`${this.systemLabel} Node capacity collection failed: ${err.message}`);
    }

    // ----- Bucket-level storage usage -----
    try {
      const buckets = await this.collectEndpoint('/org/containers');
      const bucketArray = Array.isArray(buckets) ? buckets : (buckets && buckets.data ? buckets.data : []);

      for (const bucket of bucketArray) {
        const name = bucket.name || bucket.bucketName;
        const used = Number(bucket.dataBytes || bucket.objectBytes || 0);
        const objectCount = Number(bucket.objectCount || 0);

        this.db.capacity.insertSnapshot({
          system_id: systemId,
          resource_type: 'storagegrid_bucket',
          resource_id: name,
          resource_name: name,
          total_bytes: 0, // buckets don't have a hard total
          used_bytes: used,
          available_bytes: 0,
          utilization_pct: 0,
          snapshot_timestamp: timestamp,
        });
        this.recordsCollected += 1;

        // Also record object count as a metric
        if (objectCount > 0) {
          this.db.metrics.insertRaw([{
            system_id: systemId,
            resource_type: 'storagegrid_bucket',
            resource_id: name,
            metric_name: 'object_count',
            metric_value: objectCount,
            unit: 'count',
            timestamp,
          }]);
          this.recordsCollected += 1;
        }
      }

      logger.debug(`${this.systemLabel} Bucket capacity: ${bucketArray.length} bucket(s)`);
    } catch (err) {
      logger.error(`${this.systemLabel} Bucket capacity collection failed: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetch an endpoint and upsert the results into a database table.
   *
   * Handles both single-object and array responses. Errors are logged
   * but do not abort the overall inventory run.
   *
   * @param {string}   path       - API path.
   * @param {Object}   params     - Query parameters.
   * @param {string}   table      - Target DB table.
   * @param {string[]} uniqueKeys - Uniqueness constraint columns.
   * @param {Function} mapRow     - Row mapper function.
   * @returns {Promise<void>}
   * @private
   */
  async _collectEndpointToTable(path, params, table, uniqueKeys, mapRow) {
    try {
      logger.debug(`${this.systemLabel} Inventory: ${path} -> ${table}`);
      let data = await this.collectEndpoint(path, params);

      // Unwrap StorageGRID `{ data: [...] }` envelope
      if (data && !Array.isArray(data) && data.data) {
        data = Array.isArray(data.data) ? data.data : [data.data];
      }

      const records = Array.isArray(data) ? data : [data];
      const rows = records.map(mapRow);

      if (rows.length > 0) {
        this.db.bulkUpsert(table, rows, uniqueKeys);
        this.recordsCollected += rows.length;
      }

      logger.debug(`${this.systemLabel} ${table}: ${rows.length} record(s) upserted`);
    } catch (err) {
      logger.error(`${this.systemLabel} Error collecting ${path}: ${err.message}`);
    }
  }
}

module.exports = StorageGridCollector;
