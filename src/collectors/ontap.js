/**
 * @module collectors/ontap
 * @description ONTAP REST API collector extending BaseCollector.
 *
 * Connects via Basic Authentication to the ONTAP REST API and collects:
 *   - Inventory: cluster, nodes, aggregates, volumes, SVMs, LIFs, ports,
 *     disks, shelves, LUNs, export policies, CIFS shares, SnapMirror,
 *     EMS events, licenses, QoS policies, security, and software info.
 *   - Performance: counter tables (node, volume, aggregate, lun).
 *   - Capacity: aggregate and volume space snapshots.
 */

'use strict';

const BaseCollector = require('./base');
const { createClient } = require('../utils/httpClient');
const { collectAllCounters } = require('./ontapCounters');
const logger = require('../utils/logger');

/**
 * Inventory endpoint definitions.
 * Each entry maps an ONTAP REST API path to a database table, specifying
 * query fields and the unique key columns for upsert.
 *
 * @typedef {Object} EndpointDef
 * @property {string}   path       - ONTAP API path.
 * @property {Object}   [params]   - Extra query parameters (e.g. fields).
 * @property {string}   table      - Target DB table name.
 * @property {string[]} uniqueKeys - Columns forming the uniqueness constraint.
 * @property {Function} mapRow     - Transform an API record to a DB row.
 */

/**
 * @param {number} systemId - The parent system id.
 * @returns {EndpointDef[]} Ordered list of inventory endpoints.
 */
function buildInventoryEndpoints(systemId) {
  return [
    {
      path: '/cluster',
      table: 'ontap_clusters',
      uniqueKeys: ['system_id', 'uuid'],
      mapRow: (d) => ({
        system_id: systemId,
        uuid: d.uuid,
        name: d.name,
        version: d.version ? `${d.version.full}` : null,
        location: d.location || null,
        contact: d.contact || null,
        dns_domains: d.dns_domains ? JSON.stringify(d.dns_domains) : null,
        ntp_servers: d.ntp_servers ? JSON.stringify(d.ntp_servers) : null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/cluster/nodes',
      table: 'ontap_nodes',
      uniqueKeys: ['system_id', 'uuid'],
      mapRow: (d) => ({
        system_id: systemId,
        uuid: d.uuid,
        name: d.name,
        model: d.model || null,
        serial_number: d.serial_number || null,
        system_id_str: d.system_id || null,
        uptime: d.uptime || null,
        location: d.location || null,
        is_epsilon: d.cluster_interface ? d.cluster_interface.ip_address : null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/storage/aggregates',
      params: { fields: 'space,state,node' },
      table: 'ontap_aggregates',
      uniqueKeys: ['system_id', 'uuid'],
      mapRow: (d) => ({
        system_id: systemId,
        uuid: d.uuid,
        name: d.name,
        node_name: d.node ? d.node.name : null,
        state: d.state || null,
        total_bytes: d.space ? d.space.block_storage.size : null,
        used_bytes: d.space ? d.space.block_storage.used : null,
        available_bytes: d.space ? d.space.block_storage.available : null,
        utilization_pct: d.space && d.space.block_storage.size
          ? ((d.space.block_storage.used / d.space.block_storage.size) * 100).toFixed(2)
          : null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/storage/volumes',
      params: { fields: 'space,svm,aggregates,encryption,snapshot_policy,tiering,autosize' },
      table: 'ontap_volumes',
      uniqueKeys: ['system_id', 'uuid'],
      mapRow: (d) => ({
        system_id: systemId,
        uuid: d.uuid,
        name: d.name,
        svm_name: d.svm ? d.svm.name : null,
        aggregate_name: d.aggregates && d.aggregates[0] ? d.aggregates[0].name : null,
        state: d.state || null,
        style: d.style || null,
        type: d.type || null,
        total_bytes: d.space ? d.space.size : null,
        used_bytes: d.space ? d.space.used : null,
        available_bytes: d.space ? d.space.available : null,
        snapshot_used_bytes: d.space ? d.space.snapshot ? d.space.snapshot.used : null : null,
        utilization_pct: d.space && d.space.size
          ? ((d.space.used / d.space.size) * 100).toFixed(2)
          : null,
        encryption_enabled: d.encryption ? d.encryption.enabled : null,
        snapshot_policy: d.snapshot_policy ? d.snapshot_policy.name : null,
        tiering_policy: d.tiering ? d.tiering.policy : null,
        autosize_mode: d.autosize ? d.autosize.mode : null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/svm/svms',
      table: 'ontap_svms',
      uniqueKeys: ['system_id', 'uuid'],
      mapRow: (d) => ({
        system_id: systemId,
        uuid: d.uuid,
        name: d.name,
        state: d.state || null,
        subtype: d.subtype || null,
        language: d.language || null,
        protocols: d.allowed_protocols ? JSON.stringify(d.allowed_protocols) : null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/network/ip/interfaces',
      params: { fields: 'location,state,ip' },
      table: 'ontap_lifs',
      uniqueKeys: ['system_id', 'uuid'],
      mapRow: (d) => ({
        system_id: systemId,
        uuid: d.uuid,
        name: d.name,
        svm_name: d.svm ? d.svm.name : null,
        ip_address: d.ip ? d.ip.address : null,
        netmask: d.ip ? d.ip.netmask : null,
        state: d.state || null,
        home_node: d.location ? d.location.home_node ? d.location.home_node.name : null : null,
        home_port: d.location ? d.location.home_port ? d.location.home_port.name : null : null,
        current_node: d.location ? d.location.node ? d.location.node.name : null : null,
        current_port: d.location ? d.location.port ? d.location.port.name : null : null,
        is_home: d.location ? d.location.is_home : null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/network/ethernet/ports',
      params: { fields: 'state,speed' },
      table: 'ontap_ports',
      uniqueKeys: ['system_id', 'uuid'],
      mapRow: (d) => ({
        system_id: systemId,
        uuid: d.uuid,
        name: d.name,
        node_name: d.node ? d.node.name : null,
        state: d.state || null,
        speed: d.speed || null,
        type: d.type || null,
        mtu: d.mtu || null,
        broadcast_domain: d.broadcast_domain ? d.broadcast_domain.name : null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/storage/disks',
      table: 'ontap_disks',
      uniqueKeys: ['system_id', 'name'],
      mapRow: (d) => ({
        system_id: systemId,
        name: d.name,
        uid: d.uid || null,
        serial_number: d.serial_number || null,
        model: d.model || null,
        vendor: d.vendor || null,
        type: d.type || null,
        class: d.class || null,
        container_type: d.container_type || null,
        node_name: d.node ? d.node.name : null,
        bay: d.bay || null,
        shelf_uid: d.shelf ? d.shelf.uid : null,
        usable_size: d.usable_size || null,
        state: d.state || null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/storage/shelves',
      table: 'ontap_shelves',
      uniqueKeys: ['system_id', 'uid'],
      mapRow: (d) => ({
        system_id: systemId,
        uid: d.uid,
        name: d.name || null,
        serial_number: d.serial_number || null,
        model: d.model || null,
        module_type: d.module_type || null,
        state: d.state || null,
        disk_count: d.disk_count || null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/storage/luns',
      params: { fields: 'space,location' },
      table: 'ontap_luns',
      uniqueKeys: ['system_id', 'uuid'],
      mapRow: (d) => ({
        system_id: systemId,
        uuid: d.uuid,
        name: d.name,
        svm_name: d.svm ? d.svm.name : null,
        volume_name: d.location ? d.location.volume ? d.location.volume.name : null : null,
        total_bytes: d.space ? d.space.size : null,
        used_bytes: d.space ? d.space.used : null,
        os_type: d.os_type || null,
        serial_number: d.serial_number || null,
        status_mapped: d.status ? d.status.mapped : null,
        status_state: d.status ? d.status.state : null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/protocols/nfs/export-policies',
      table: 'ontap_exports',
      uniqueKeys: ['system_id', 'policy_id'],
      mapRow: (d) => ({
        system_id: systemId,
        policy_id: d.id,
        name: d.name,
        svm_name: d.svm ? d.svm.name : null,
        rules_count: d.rules ? d.rules.length : 0,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/protocols/cifs/shares',
      table: 'ontap_cifs_shares',
      uniqueKeys: ['system_id', 'svm_name', 'name'],
      mapRow: (d) => ({
        system_id: systemId,
        name: d.name,
        svm_name: d.svm ? d.svm.name : null,
        path: d.path || null,
        comment: d.comment || null,
        encryption: d.encryption || null,
        acls: d.acls ? JSON.stringify(d.acls) : null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/snapmirror/relationships',
      params: { fields: 'healthy,state,transfer' },
      table: 'ontap_snapmirror',
      uniqueKeys: ['system_id', 'uuid'],
      mapRow: (d) => ({
        system_id: systemId,
        uuid: d.uuid,
        source_path: d.source ? d.source.path : null,
        destination_path: d.destination ? d.destination.path : null,
        state: d.state || null,
        healthy: d.healthy != null ? (d.healthy ? 1 : 0) : null,
        policy_type: d.policy ? d.policy.type : null,
        lag_time: d.lag_time || null,
        transfer_state: d.transfer ? d.transfer.state : null,
        transfer_bytes: d.transfer ? d.transfer.bytes_transferred : null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/support/ems/events',
      params: { severity: 'alert,emergency', max_records: 100 },
      table: 'ontap_ems_events',
      uniqueKeys: ['system_id', 'index'],
      mapRow: (d) => ({
        system_id: systemId,
        index: d.index,
        node_name: d.node ? d.node.name : null,
        severity: d.severity || null,
        message_name: d.message ? d.message.name : null,
        message_text: d.log_message || null,
        timestamp: d.time || null,
        source: d.source || null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/cluster/licensing/licenses',
      table: 'ontap_licenses',
      uniqueKeys: ['system_id', 'name'],
      mapRow: (d) => ({
        system_id: systemId,
        name: d.name,
        scope: d.scope || null,
        state: d.state || null,
        compliance_state: d.licenses && d.licenses[0]
          ? d.licenses[0].compliance ? d.licenses[0].compliance.state : null
          : null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/storage/qos/policies',
      table: 'ontap_qos_policies',
      uniqueKeys: ['system_id', 'uuid'],
      mapRow: (d) => ({
        system_id: systemId,
        uuid: d.uuid,
        name: d.name,
        svm_name: d.svm ? d.svm.name : null,
        policy_group: d.policy_group || null,
        max_throughput_iops: d.fixed ? d.fixed.max_throughput_iops : null,
        max_throughput_mbps: d.fixed ? d.fixed.max_throughput_mbps : null,
        min_throughput_iops: d.fixed ? d.fixed.min_throughput_iops : null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/security',
      table: 'ontap_security',
      uniqueKeys: ['system_id'],
      mapRow: (d) => ({
        system_id: systemId,
        fips_enabled: d.fips ? (d.fips.enabled ? 1 : 0) : null,
        tls_protocols: d.tls ? JSON.stringify(d.tls) : null,
        onboard_key_manager_enabled: d.onboard_key_manager_configurable_status
          ? (d.onboard_key_manager_configurable_status.supported ? 1 : 0)
          : null,
        raw_json: JSON.stringify(d),
      }),
    },
    {
      path: '/cluster/software',
      table: 'ontap_software',
      uniqueKeys: ['system_id'],
      mapRow: (d) => ({
        system_id: systemId,
        current_version: d.version || null,
        update_state: d.state || null,
        pending_version: d.pending_version || null,
        status_details: d.status_details ? JSON.stringify(d.status_details) : null,
        update_history: d.update_history ? JSON.stringify(d.update_history) : null,
        raw_json: JSON.stringify(d),
      }),
    },
  ];
}

/**
 * ONTAP REST API collector.
 *
 * @class OntapCollector
 * @extends BaseCollector
 */
class OntapCollector extends BaseCollector {
  /**
   * @param {Object} system - System row from the database.
   * @param {Object} [db]   - Database models instance.
   */
  constructor(system, db) {
    super(system, db);
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /**
   * Connect to an ONTAP cluster via Basic Authentication.
   *
   * Creates an Axios client with `baseURL = https://<hostname>/api`
   * and Basic Auth headers derived from decrypted credentials.
   *
   * @returns {Promise<void>}
   */
  async connect() {
    const creds = this.credentials || this.decryptCredentials();
    const protocol = this.system.port === 80 ? 'http' : 'https';
    const baseURL = `${protocol}://${this.system.hostname}:${this.system.port || 443}/api`;

    this.client = createClient(baseURL, {
      type: 'basic',
      username: creds.username,
      password: creds.password,
    }, {
      timeout: 60000,
    });

    // Verify connectivity with a lightweight call
    const { data } = await this.client.get('/cluster', { params: { fields: 'name,version' } });
    if (data && data.version) {
      this.system.version = data.version.full || data.version.generation;
      this.db.systems.updateStatus(this.system.id, 'online', this.system.version);
    }

    logger.info(`${this.systemLabel} Connected to ONTAP ${this.system.version || 'unknown'}`);
  }

  // ---------------------------------------------------------------------------
  // Inventory
  // ---------------------------------------------------------------------------

  /**
   * Collect inventory data from all ONTAP REST API categories.
   *
   * For each endpoint definition, fetches the data (with pagination),
   * maps records to DB row format, and performs a bulk upsert.
   *
   * @returns {Promise<void>}
   */
  async collectInventory() {
    const endpoints = buildInventoryEndpoints(this.system.id);

    for (const ep of endpoints) {
      try {
        logger.debug(`${this.systemLabel} Inventory: ${ep.path} -> ${ep.table}`);
        const data = await this.collectEndpoint(ep.path, ep.params || {});

        // Normalise: single-object endpoints (e.g. /cluster, /security) are not arrays
        const records = Array.isArray(data) ? data : [data];
        const rows = records.map(ep.mapRow);

        if (rows.length > 0) {
          this.db.bulkUpsert(ep.table, rows, ep.uniqueKeys);
          this.recordsCollected += rows.length;
        }

        logger.debug(`${this.systemLabel} ${ep.table}: ${rows.length} record(s) upserted`);
      } catch (err) {
        // Log but continue with remaining endpoints
        logger.error(`${this.systemLabel} Error collecting ${ep.path}: ${err.message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------

  /**
   * Collect ONTAP performance counters.
   *
   * Delegates to the dedicated ontapCounters module which handles
   * counter table enumeration, row parsing, and pagination.
   *
   * @returns {Promise<void>}
   */
  async collectPerformance() {
    try {
      const records = await collectAllCounters(
        this.client,
        this.system.id,
        this.systemLabel
      );

      if (records.length > 0) {
        const inserted = this.db.metrics.insertRaw(records);
        this.recordsCollected += inserted;
        logger.info(`${this.systemLabel} Inserted ${inserted} performance metric(s)`);
      }
    } catch (err) {
      logger.error(`${this.systemLabel} Performance collection failed: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Capacity
  // ---------------------------------------------------------------------------

  /**
   * Collect capacity snapshots for aggregates and volumes.
   *
   * Reads space data from aggregates and volumes (already fetched fields)
   * and creates capacity_snapshots records.
   *
   * @returns {Promise<void>}
   */
  async collectCapacity() {
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    // ----- Aggregate capacity -----
    try {
      const aggregates = await this.collectEndpoint('/storage/aggregates', {
        fields: 'space,node',
      });
      const aggrArray = Array.isArray(aggregates) ? aggregates : [];

      for (const aggr of aggrArray) {
        if (!aggr.space || !aggr.space.block_storage) continue;
        const bs = aggr.space.block_storage;

        this.db.capacity.insertSnapshot({
          system_id: this.system.id,
          resource_type: 'aggregate',
          resource_id: aggr.uuid || aggr.name,
          resource_name: aggr.name,
          total_bytes: bs.size || 0,
          used_bytes: bs.used || 0,
          available_bytes: bs.available || 0,
          utilization_pct: bs.size ? ((bs.used / bs.size) * 100).toFixed(2) : 0,
          snapshot_timestamp: timestamp,
        });
        this.recordsCollected += 1;
      }

      logger.debug(`${this.systemLabel} Aggregate capacity: ${aggrArray.length} snapshot(s)`);
    } catch (err) {
      logger.error(`${this.systemLabel} Aggregate capacity failed: ${err.message}`);
    }

    // ----- Volume capacity -----
    try {
      const volumes = await this.collectEndpoint('/storage/volumes', {
        fields: 'space,name,svm',
      });
      const volArray = Array.isArray(volumes) ? volumes : [];

      for (const vol of volArray) {
        if (!vol.space) continue;

        this.db.capacity.insertSnapshot({
          system_id: this.system.id,
          resource_type: 'volume',
          resource_id: vol.uuid || vol.name,
          resource_name: vol.name,
          total_bytes: vol.space.size || 0,
          used_bytes: vol.space.used || 0,
          available_bytes: vol.space.available || 0,
          utilization_pct: vol.space.size ? ((vol.space.used / vol.space.size) * 100).toFixed(2) : 0,
          snapshot_timestamp: timestamp,
        });
        this.recordsCollected += 1;
      }

      logger.debug(`${this.systemLabel} Volume capacity: ${volArray.length} snapshot(s)`);
    } catch (err) {
      logger.error(`${this.systemLabel} Volume capacity failed: ${err.message}`);
    }
  }
}

module.exports = OntapCollector;
