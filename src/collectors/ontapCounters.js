/**
 * @module collectors/ontapCounters
 * @description Dedicated ONTAP performance counter collector.
 *
 * ONTAP exposes per-object performance counters via the
 * `/api/cluster/counter/tables/{table}/rows` endpoint. This module
 * defines the set of counter tables to collect, fetches their rows,
 * and normalises them into the flat metric record format expected by
 * the metrics model.
 */

'use strict';

const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Counter table definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CounterTableDef
 * @property {string} name         - ONTAP counter table name (e.g. "system:node").
 * @property {string} resourceType - Normalised resource type for the metrics table.
 * @property {string[]} counters   - Counter names to extract from each row.
 */

/**
 * Ordered list of counter tables to collect.
 * @type {CounterTableDef[]}
 */
const COUNTER_TABLES = [
  {
    name: 'system:node',
    resourceType: 'node',
    counters: [
      'cpu_busy',
      'cpu_elapsed_time',
      'total_data',
      'read_data',
      'write_data',
      'read_ops',
      'write_ops',
      'total_ops',
      'read_latency',
      'write_latency',
      'avg_latency',
      'network_data_received',
      'network_data_sent',
      'disk_data_read',
      'disk_data_written',
      'hdd_data_read',
      'hdd_data_written',
      'ssd_data_read',
      'ssd_data_written',
    ],
  },
  {
    name: 'volume',
    resourceType: 'volume',
    counters: [
      'total_ops',
      'read_ops',
      'write_ops',
      'other_ops',
      'total_data',
      'read_data',
      'write_data',
      'read_latency',
      'write_latency',
      'avg_latency',
      'bytes_read',
      'bytes_written',
    ],
  },
  {
    name: 'aggregate',
    resourceType: 'aggregate',
    counters: [
      'total_transfers',
      'user_reads',
      'user_writes',
      'cp_reads',
      'user_read_blocks',
      'user_write_blocks',
      'cp_read_blocks',
    ],
  },
  {
    name: 'lun',
    resourceType: 'lun',
    counters: [
      'total_ops',
      'read_ops',
      'write_ops',
      'read_data',
      'write_data',
      'avg_read_latency',
      'avg_write_latency',
      'avg_latency',
      'queue_full',
    ],
  },
];

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single ONTAP counter row into an array of flat metric records.
 *
 * Each ONTAP counter row has the structure:
 * ```json
 * {
 *   "id": "node-uuid:table",
 *   "properties": [{ "name": "...", "value": "..." }],
 *   "counters": [{ "name": "cpu_busy", "value": 12345, "labels": [...] }]
 * }
 * ```
 *
 * @param {CounterTableDef} tableDef  - The counter table definition.
 * @param {Object}          row       - A single counter row from the API.
 * @param {number}          systemId  - The system id for tagging metrics.
 * @returns {Object[]} Array of metric record objects ready for insertion.
 */
function parseCounterRow(tableDef, row, systemId) {
  const records = [];
  const resourceId = row.id || 'unknown';
  const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  // Build a property lookup for quick access
  const props = {};
  if (Array.isArray(row.properties)) {
    for (const prop of row.properties) {
      props[prop.name] = prop.value;
    }
  }

  // Determine a friendly resource name from properties
  const resourceName = props.node || props.name || props.instance_name || resourceId;

  if (!Array.isArray(row.counters)) {
    return records;
  }

  for (const counter of row.counters) {
    // Only collect counters we care about
    if (!tableDef.counters.includes(counter.name)) {
      continue;
    }

    // Handle labelled (array) counters by emitting one record per label
    if (Array.isArray(counter.labels) && counter.labels.length > 0 && Array.isArray(counter.values)) {
      for (let i = 0; i < counter.labels.length; i++) {
        records.push({
          system_id: systemId,
          resource_type: tableDef.resourceType,
          resource_id: `${resourceName}:${counter.labels[i]}`,
          metric_name: counter.name,
          metric_value: Number(counter.values[i]) || 0,
          unit: counter.unit || 'none',
          timestamp,
        });
      }
    } else {
      // Scalar counter
      records.push({
        system_id: systemId,
        resource_type: tableDef.resourceType,
        resource_id: resourceName,
        metric_name: counter.name,
        metric_value: Number(counter.value) || 0,
        unit: counter.unit || 'none',
        timestamp,
      });
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// Table-level collection
// ---------------------------------------------------------------------------

/**
 * Collect all rows from a single ONTAP counter table.
 *
 * Issues a GET to `/api/cluster/counter/tables/{tableName}/rows`
 * and paginates through `_links.next` until all rows have been fetched.
 *
 * @param {import('axios').AxiosInstance} client    - Authenticated Axios client.
 * @param {CounterTableDef}              tableDef  - Counter table definition.
 * @param {number}                       systemId  - System id for tagging.
 * @param {string}                       label     - Human label for logging.
 * @returns {Promise<Object[]>} Array of flat metric records.
 */
async function collectCounterTable(client, tableDef, systemId, label) {
  const records = [];
  let url = `/cluster/counter/tables/${tableDef.name}/rows`;
  let pageCount = 0;

  while (url) {
    try {
      const response = await client.get(url, {
        params: url.includes('?') ? {} : { 'return_records': true },
      });
      pageCount += 1;
      const data = response.data;

      if (data && Array.isArray(data.records)) {
        for (const row of data.records) {
          const parsed = parseCounterRow(tableDef, row, systemId);
          records.push(...parsed);
        }
      }

      // Follow ONTAP pagination
      if (data && data._links && data._links.next && data._links.next.href) {
        url = data._links.next.href;
      } else {
        url = null;
      }
    } catch (err) {
      logger.error(`${label} Error collecting counter table ${tableDef.name}: ${err.message}`);
      break;
    }
  }

  logger.debug(
    `${label} Counter table "${tableDef.name}": ` +
    `${pageCount} page(s), ${records.length} metric record(s)`
  );

  return records;
}

// ---------------------------------------------------------------------------
// Bulk collection
// ---------------------------------------------------------------------------

/**
 * Collect performance counters from all defined counter tables.
 *
 * @param {import('axios').AxiosInstance} client   - Authenticated Axios client.
 * @param {number}                       systemId - System id for tagging.
 * @param {string}                       label    - Human label for logging.
 * @returns {Promise<Object[]>} Combined array of all metric records.
 */
async function collectAllCounters(client, systemId, label) {
  const allRecords = [];

  for (const tableDef of COUNTER_TABLES) {
    logger.info(`${label} Collecting counter table: ${tableDef.name}`);
    const records = await collectCounterTable(client, tableDef, systemId, label);
    allRecords.push(...records);
  }

  logger.info(`${label} Collected ${allRecords.length} total counter metrics`);
  return allRecords;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  COUNTER_TABLES,
  collectCounterTable,
  parseCounterRow,
  collectAllCounters,
};
