# 📡 AIQwhisper — API Reference

> Complete REST API documentation for AIQwhisper v2.0.0

---

## Table of Contents

- [Overview](#overview)
- [Health](#health)
- [Systems](#systems)
- [Dashboard](#dashboard)
- [Inventory](#inventory)
- [Issues](#issues)
- [Recommendations](#recommendations)
- [Events](#events)
- [Performance](#performance)
- [Capacity](#capacity)
- [Reports](#reports)
- [Learning](#learning)
- [Common Query Parameters](#common-query-parameters)
- [Error Response Format](#error-response-format)
- [Pagination](#pagination)

---

## Overview

### Base URL

```
http://localhost:3080
```

All API endpoints are prefixed with `/api/` except for the health check endpoint (`/health`).

### Response Format

All responses use a consistent JSON envelope:

```json
{
  "success": true,
  "data": { },
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 142,
    "totalPages": 3
  }
}
```

Error responses:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "System with id 99 not found"
  }
}
```

### Authentication

AIQwhisper does not implement application-level authentication. Security is achieved through network-level controls (bind address, firewall, reverse proxy). See the [Security Hardening](INSTALLATION.md#10-security-hardening) section for best practices.

### Content Type

All request bodies must be sent as `application/json`. All responses are `application/json`.

### CORS

Cross-Origin Resource Sharing (CORS) is enabled for all origins, allowing integration from any web application.

### Rate Limiting

AIQwhisper does not enforce rate limiting. As an on-premises tool, it is designed for trusted network environments. Exercise caution when scripting high-frequency API calls to avoid overloading the embedded SQLite database.

---

## Health

### `GET /health`

Returns the server health status, version, and basic statistics.

**Query Parameters:** None

**Example Request:**

```bash
curl http://localhost:3080/health
```

**Response:**

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "2.0.0",
    "uptime": 86400,
    "database": "connected",
    "systems": 12,
    "lastCollection": "2026-07-15T16:00:00.000Z",
    "collectors": {
      "inventory": { "status": "idle", "lastRun": "2026-07-15T16:00:00.000Z" },
      "performance": { "status": "idle", "lastRun": "2026-07-15T16:05:00.000Z" },
      "capacity": { "status": "idle", "lastRun": "2026-07-15T16:00:00.000Z" }
    }
  }
}
```

---

## Systems

### `GET /api/systems`

List all registered storage systems.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | string | — | Filter by system type: `ontap`, `storagegrid`, `eseries` |
| `status` | string | — | Filter by status: `online`, `offline`, `error`, `pending` |
| `page` | integer | `1` | Page number |
| `limit` | integer | `50` | Results per page (max 500) |
| `sort_by` | string | `name` | Sort field: `name`, `type`, `status`, `created_at`, `last_collected` |
| `sort_order` | string | `asc` | Sort direction: `asc`, `desc` |

**Example Request:**

```bash
curl "http://localhost:3080/api/systems?type=ontap&sort_by=name"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "prod-ontap-01",
      "type": "ontap",
      "hostname": "10.0.1.100",
      "port": 443,
      "status": "online",
      "health_score": 87,
      "version": "9.14.1",
      "model": "AFF A400",
      "serial": "941823456789",
      "last_collected": "2026-07-15T16:00:00.000Z",
      "created_at": "2026-06-01T10:00:00.000Z",
      "updated_at": "2026-07-15T16:00:00.000Z"
    },
    {
      "id": 2,
      "name": "prod-ontap-02",
      "type": "ontap",
      "hostname": "10.0.1.101",
      "port": 443,
      "status": "online",
      "health_score": 92,
      "version": "9.15.1",
      "model": "FAS8200",
      "serial": "941823456790",
      "last_collected": "2026-07-15T16:00:00.000Z",
      "created_at": "2026-06-01T10:05:00.000Z",
      "updated_at": "2026-07-15T16:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 2,
    "totalPages": 1
  }
}
```

---

### `POST /api/systems`

Register a new storage system.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Display name for the system |
| `type` | string | ✅ | Platform type: `ontap`, `storagegrid`, `eseries` |
| `hostname` | string | ✅ | IP address or FQDN |
| `port` | integer | — | Port number (defaults: ONTAP 443, StorageGRID 443, E-Series 8443) |
| `username` | string | ✅ | Authentication username |
| `password` | string | ✅ | Authentication password (encrypted at rest) |
| `proxy_url` | string | — | E-Series Web Services Proxy URL (if applicable) |

**Example Request:**

```bash
curl -X POST http://localhost:3080/api/systems \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "prod-ontap-01",
    "type": "ontap",
    "hostname": "10.0.1.100",
    "username": "aiqwhisper",
    "password": "SecurePass123!"
  }'
```

**Response** (`201 Created`):

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "prod-ontap-01",
    "type": "ontap",
    "hostname": "10.0.1.100",
    "port": 443,
    "status": "pending",
    "created_at": "2026-07-15T16:00:00.000Z"
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Missing required fields or invalid type |
| 409 | `DUPLICATE_SYSTEM` | A system with this hostname already exists |

---

### `GET /api/systems/:id`

Get detailed information about a specific system.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | integer | System ID |

**Example Request:**

```bash
curl http://localhost:3080/api/systems/1
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "prod-ontap-01",
    "type": "ontap",
    "hostname": "10.0.1.100",
    "port": 443,
    "status": "online",
    "health_score": 87,
    "version": "9.14.1",
    "model": "AFF A400",
    "serial": "941823456789",
    "location": "DC1-Rack-A12",
    "last_collected": "2026-07-15T16:00:00.000Z",
    "collection_duration_ms": 4523,
    "created_at": "2026-06-01T10:00:00.000Z",
    "updated_at": "2026-07-15T16:00:00.000Z",
    "health": {
      "score": 87,
      "factors": {
        "issues": 90,
        "capacity": 85,
        "software_currency": 80,
        "data_protection": 95,
        "performance": 88,
        "security": 82
      }
    },
    "summary": {
      "nodes": 2,
      "aggregates": 8,
      "volumes": 156,
      "svms": 4,
      "lifs": 12,
      "luns": 34,
      "total_capacity_tb": 48.5,
      "used_capacity_tb": 31.2,
      "issues_critical": 1,
      "issues_warning": 5,
      "issues_info": 12
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `NOT_FOUND` | System not found |

---

### `PUT /api/systems/:id`

Update a system's configuration.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | — | Updated display name |
| `hostname` | string | — | Updated IP or FQDN |
| `port` | integer | — | Updated port |
| `username` | string | — | Updated username |
| `password` | string | — | Updated password |

**Example Request:**

```bash
curl -X PUT http://localhost:3080/api/systems/1 \
  -H 'Content-Type: application/json' \
  -d '{"name": "prod-ontap-primary", "password": "NewSecurePass!"}'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "prod-ontap-primary",
    "type": "ontap",
    "hostname": "10.0.1.100",
    "port": 443,
    "status": "online",
    "updated_at": "2026-07-15T16:30:00.000Z"
  }
}
```

---

### `DELETE /api/systems/:id`

Remove a system and all associated data (inventory, metrics, issues).

**Example Request:**

```bash
curl -X DELETE http://localhost:3080/api/systems/3
```

**Response:**

```json
{
  "success": true,
  "data": {
    "message": "System 'dev-eseries-01' and all associated data deleted",
    "deleted": {
      "inventory_records": 245,
      "performance_records": 18456,
      "issues": 8,
      "events": 34
    }
  }
}
```

---

### `POST /api/systems/:id/test`

Test connectivity and authentication to a registered system.

**Example Request:**

```bash
curl -X POST http://localhost:3080/api/systems/1/test
```

**Response:**

```json
{
  "success": true,
  "data": {
    "reachable": true,
    "latency_ms": 45,
    "api_version": "9.14",
    "cluster_name": "prod-ontap-01",
    "ssl_valid": false,
    "ssl_issuer": "self-signed",
    "message": "Connection successful"
  }
}
```

**Failure Response:**

```json
{
  "success": true,
  "data": {
    "reachable": false,
    "latency_ms": null,
    "message": "Connection refused - verify hostname and port"
  }
}
```

---

### `POST /api/systems/:id/collect`

Trigger an immediate data collection for a specific system.

**Example Request:**

```bash
curl -X POST http://localhost:3080/api/systems/1/collect
```

**Response:**

```json
{
  "success": true,
  "data": {
    "message": "Collection started for prod-ontap-01",
    "job_id": "collect-1-1721059200",
    "types": ["inventory", "performance", "capacity"]
  }
}
```

---

## Dashboard

### `GET /api/dashboard/summary`

Returns aggregated dashboard data across all registered systems.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `system_id` | integer | — | Filter to a specific system |
| `type` | string | — | Filter by platform type |

**Example Request:**

```bash
curl http://localhost:3080/api/dashboard/summary
```

**Response:**

```json
{
  "success": true,
  "data": {
    "systems": {
      "total": 12,
      "online": 11,
      "offline": 1,
      "by_type": {
        "ontap": 8,
        "storagegrid": 2,
        "eseries": 2
      }
    },
    "health": {
      "average_score": 84,
      "critical": 1,
      "warning": 3,
      "healthy": 8,
      "distribution": [
        { "range": "90-100", "count": 4 },
        { "range": "80-89", "count": 5 },
        { "range": "70-79", "count": 2 },
        { "range": "0-69", "count": 1 }
      ]
    },
    "capacity": {
      "total_tb": 385.4,
      "used_tb": 241.8,
      "available_tb": 143.6,
      "utilization_pct": 62.7,
      "systems_above_85_pct": 3,
      "systems_above_90_pct": 1
    },
    "issues": {
      "total": 47,
      "critical": 5,
      "warning": 18,
      "informational": 24
    },
    "performance": {
      "total_iops": 125430,
      "total_throughput_mbps": 4562,
      "average_latency_ms": 1.8
    },
    "recent_events": [
      {
        "id": 1234,
        "system_name": "prod-ontap-01",
        "severity": "warning",
        "message": "Aggregate aggr1 is 87% full",
        "timestamp": "2026-07-15T15:30:00.000Z"
      }
    ],
    "last_updated": "2026-07-15T16:05:00.000Z"
  }
}
```

---

## Inventory

### `GET /api/inventory/:resource`

Retrieve inventory data by resource type across all systems or filtered to a specific system.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `resource` | string | Resource type (see table below) |

**Available Resource Types:**

| Resource | Platform | Description |
|----------|----------|-------------|
| `clusters` | ONTAP | Cluster configuration and details |
| `nodes` | ONTAP | Controller nodes |
| `aggregates` | ONTAP | Storage aggregates |
| `volumes` | ONTAP | FlexVol and FlexGroup volumes |
| `svms` | ONTAP | Storage Virtual Machines |
| `lifs` | ONTAP | Logical Interfaces |
| `disks` | ONTAP | Physical disks |
| `shelves` | ONTAP | Disk shelves |
| `luns` | ONTAP | LUN mappings |
| `exports` | ONTAP | NFS export policies |
| `cifs-shares` | ONTAP | CIFS/SMB shares |
| `igroups` | ONTAP | Initiator groups |
| `snapmirror` | ONTAP | SnapMirror relationships |
| `grids` | StorageGRID | Grid topology and configuration |
| `grid-nodes` | StorageGRID | Individual grid nodes |
| `s3-buckets` | StorageGRID | S3 bucket inventory |
| `ilm-policies` | StorageGRID | ILM policies and rules |
| `arrays` | E-Series | Storage array overview |
| `controllers` | E-Series | Controller modules |
| `drives` | E-Series | Physical drives |
| `pools` | E-Series | Disk pools |
| `volume-groups` | E-Series | Volume groups |
| `eseries-volumes` | E-Series | E-Series volumes |
| `hosts` | E-Series | Host definitions and mappings |

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `system_id` | integer | — | Filter to a specific system |
| `page` | integer | `1` | Page number |
| `limit` | integer | `50` | Results per page (max 500) |
| `sort_by` | string | `name` | Sort field (varies by resource) |
| `sort_order` | string | `asc` | Sort direction |
| `search` | string | — | Full-text search across key fields |

**Example Request (ONTAP Volumes):**

```bash
curl "http://localhost:3080/api/inventory/volumes?system_id=1&limit=10"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "vol-001",
      "system_id": 1,
      "system_name": "prod-ontap-01",
      "name": "vol_prod_db01",
      "svm": "svm_prod",
      "aggregate": "aggr1_data",
      "state": "online",
      "type": "rw",
      "style": "flexvol",
      "size_bytes": 1099511627776,
      "used_bytes": 824633720832,
      "available_bytes": 274877906944,
      "utilization_pct": 75.0,
      "snapshot_reserve_pct": 5,
      "encryption": true,
      "tiering_policy": "auto",
      "junction_path": "/vol_prod_db01",
      "export_policy": "default",
      "snapshot_policy": "daily",
      "collected_at": "2026-07-15T16:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 156,
    "totalPages": 16
  }
}
```

**Example Request (StorageGRID S3 Buckets):**

```bash
curl "http://localhost:3080/api/inventory/s3-buckets?system_id=9"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "bucket-001",
      "system_id": 9,
      "system_name": "prod-sgrid-01",
      "name": "archive-2026",
      "tenant": "acme-corp",
      "region": "us-east-1",
      "object_count": 2456789,
      "size_bytes": 5497558138880,
      "versioning": "enabled",
      "encryption": "SSE-S3",
      "ilm_policy": "2-copy-erasure",
      "compliance_mode": false,
      "created_at": "2025-01-15T08:00:00.000Z",
      "collected_at": "2026-07-15T16:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 24,
    "totalPages": 1
  }
}
```

**Example Request (E-Series Drives):**

```bash
curl "http://localhost:3080/api/inventory/drives?system_id=11"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "drive-001",
      "system_id": 11,
      "system_name": "prod-eseries-01",
      "tray": 0,
      "slot": 1,
      "status": "optimal",
      "media_type": "ssd",
      "interface_type": "sas",
      "capacity_bytes": 3840000000000,
      "used_bytes": 2880000000000,
      "firmware_version": "GS0F",
      "manufacturer": "NETAPP",
      "model": "PX04SVB384",
      "serial_number": "S4GANX0N123456",
      "temperature_c": 32,
      "wear_life_pct": 98,
      "pool": "DiskPool1",
      "collected_at": "2026-07-15T16:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 48,
    "totalPages": 1
  }
}
```

---

## Issues

### `GET /api/issues`

List all detected issues across all systems.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `system_id` | integer | — | Filter to a specific system |
| `severity` | string | — | Filter: `critical`, `warning`, `informational` |
| `category` | string | — | Filter: `capacity`, `performance`, `availability`, `protection`, `security`, `software` |
| `status` | string | — | Filter: `open`, `acknowledged`, `resolved` |
| `page` | integer | `1` | Page number |
| `limit` | integer | `50` | Results per page |
| `sort_by` | string | `severity` | Sort field |
| `sort_order` | string | `desc` | Sort direction |

**Example Request:**

```bash
curl "http://localhost:3080/api/issues?severity=critical&status=open"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": 42,
      "system_id": 1,
      "system_name": "prod-ontap-01",
      "system_type": "ontap",
      "rule_id": "ONTAP-CAP-001",
      "severity": "critical",
      "category": "capacity",
      "status": "open",
      "title": "Aggregate aggr1_data is above 95% utilization",
      "description": "Aggregate aggr1_data on node prod-ontap-01-node1 is at 96.2% utilization. This can lead to performance degradation and potential data unavailability.",
      "resource_type": "aggregate",
      "resource_name": "aggr1_data",
      "remediation": "Add disks to the aggregate or move volumes to an aggregate with more free space.",
      "cli_command": "storage aggregate add-disks -aggregate aggr1_data -diskcount 4",
      "kb_article": "https://kb.netapp.com/Advice_and_Troubleshooting/Data_Storage_Software/ONTAP_OS/FAQ%3A_Aggregate_nearly_full",
      "detected_at": "2026-07-15T12:00:00.000Z",
      "last_seen": "2026-07-15T16:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 5,
    "totalPages": 1
  }
}
```

---

### `GET /api/issues/:id`

Get detailed information about a specific issue.

**Example Request:**

```bash
curl http://localhost:3080/api/issues/42
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": 42,
    "system_id": 1,
    "system_name": "prod-ontap-01",
    "system_type": "ontap",
    "rule_id": "ONTAP-CAP-001",
    "severity": "critical",
    "category": "capacity",
    "status": "open",
    "title": "Aggregate aggr1_data is above 95% utilization",
    "description": "Aggregate aggr1_data on node prod-ontap-01-node1 is at 96.2% utilization. This can lead to performance degradation and potential data unavailability.",
    "resource_type": "aggregate",
    "resource_name": "aggr1_data",
    "current_value": "96.2%",
    "threshold": "95%",
    "remediation": "Add disks to the aggregate or move volumes to an aggregate with more free space.",
    "cli_command": "storage aggregate add-disks -aggregate aggr1_data -diskcount 4",
    "kb_article": "https://kb.netapp.com/Advice_and_Troubleshooting/Data_Storage_Software/ONTAP_OS/FAQ%3A_Aggregate_nearly_full",
    "history": [
      { "timestamp": "2026-07-14T12:00:00.000Z", "value": "94.8%" },
      { "timestamp": "2026-07-15T00:00:00.000Z", "value": "95.5%" },
      { "timestamp": "2026-07-15T12:00:00.000Z", "value": "96.2%" }
    ],
    "detected_at": "2026-07-15T12:00:00.000Z",
    "last_seen": "2026-07-15T16:00:00.000Z"
  }
}
```

---

## Recommendations

### `GET /api/recommendations`

List best-practice recommendations across all systems.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `system_id` | integer | — | Filter to a specific system |
| `category` | string | — | Filter by category |
| `priority` | string | — | Filter: `high`, `medium`, `low` |
| `page` | integer | `1` | Page number |
| `limit` | integer | `50` | Results per page |

**Example Request:**

```bash
curl "http://localhost:3080/api/recommendations?system_id=1&priority=high"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": 15,
      "system_id": 1,
      "system_name": "prod-ontap-01",
      "rule_id": "ONTAP-SEC-003",
      "priority": "high",
      "category": "security",
      "title": "Enable FIPS mode on cluster",
      "description": "FIPS 140-2 compliance mode is not enabled. Enabling FIPS mode ensures that only FIPS-approved cryptographic algorithms are used for SSL/TLS connections.",
      "impact": "Improves security posture and may be required for regulatory compliance (PCI-DSS, HIPAA, FedRAMP).",
      "remediation": "Enable FIPS mode using the ONTAP CLI.",
      "cli_command": "security config modify -interface SSL -is-fips-enabled true",
      "effort": "low",
      "risk": "low",
      "kb_article": "https://docs.netapp.com/ontap-9/topic/com.netapp.doc.pow-nve/GUID-FIPS.html",
      "detected_at": "2026-07-15T12:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 8,
    "totalPages": 1
  }
}
```

---

## Events

### `GET /api/events`

Retrieve the unified event log across all systems.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `system_id` | integer | — | Filter to a specific system |
| `severity` | string | — | Filter: `critical`, `warning`, `informational` |
| `type` | string | — | Event type: `collection`, `issue`, `health`, `system`, `learning` |
| `from` | string | — | Start time (ISO 8601) |
| `to` | string | — | End time (ISO 8601) |
| `page` | integer | `1` | Page number |
| `limit` | integer | `50` | Results per page |
| `sort_order` | string | `desc` | Sort direction (newest first by default) |

**Example Request:**

```bash
curl "http://localhost:3080/api/events?from=2026-07-15T00:00:00Z&severity=warning"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": 5678,
      "system_id": 1,
      "system_name": "prod-ontap-01",
      "type": "issue",
      "severity": "warning",
      "message": "New issue detected: Volume vol_prod_db01 snapshot reserve is 100% consumed",
      "details": {
        "rule_id": "ONTAP-PROT-002",
        "resource": "vol_prod_db01"
      },
      "timestamp": "2026-07-15T14:30:00.000Z"
    },
    {
      "id": 5677,
      "system_id": 2,
      "system_name": "prod-ontap-02",
      "type": "collection",
      "severity": "warning",
      "message": "Performance collection timeout for prod-ontap-02 (exceeded 30s)",
      "details": {
        "duration_ms": 32456,
        "timeout_ms": 30000
      },
      "timestamp": "2026-07-15T12:05:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 12,
    "totalPages": 1
  }
}
```

---

## Performance

### `GET /api/performance/:systemId/:metricType`

Retrieve performance metrics for a specific system and metric type.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `systemId` | integer | System ID |
| `metricType` | string | Metric type (see table below) |

**Available Metric Types:**

| Metric Type | Platform | Description |
|-------------|----------|-------------|
| `system` | ONTAP | Cluster-level IOPS, throughput, latency |
| `volume` | ONTAP | Per-volume performance |
| `aggregate` | ONTAP | Aggregate-level I/O statistics |
| `lun` | ONTAP | LUN read/write metrics |
| `disk` | ONTAP | Physical disk busy, latency |
| `processor` | ONTAP | CPU utilization per node |
| `wafl` | ONTAP | WAFL layer statistics |
| `port` | ONTAP | Network port throughput |
| `nfs` | ONTAP | NFS operations per second |
| `cifs` | ONTAP | CIFS/SMB operations per second |
| `iscsi` | ONTAP | iSCSI session metrics |
| `fcp` | ONTAP | Fibre Channel metrics |
| `nvme` | ONTAP | NVMe-oF metrics |
| `qos` | ONTAP | QoS policy group metrics |
| `flashcache` | ONTAP | FlashCache hit/miss ratios |
| `s3` | StorageGRID | S3 operations, ingest/retrieve rates |
| `controller` | E-Series | Controller-level performance |
| `drive` | E-Series | Drive I/O statistics |

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `from` | string | 1 hour ago | Start time (ISO 8601) |
| `to` | string | now | End time (ISO 8601) |
| `interval` | string | `raw` | Aggregation interval: `raw`, `hourly`, `daily`, `weekly` |
| `resource_id` | string | — | Filter to a specific resource (e.g., volume name) |

**Example Request:**

```bash
curl "http://localhost:3080/api/performance/1/system?from=2026-07-15T12:00:00Z&to=2026-07-15T16:00:00Z&interval=hourly"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "system_id": 1,
    "system_name": "prod-ontap-01",
    "metric_type": "system",
    "interval": "hourly",
    "from": "2026-07-15T12:00:00.000Z",
    "to": "2026-07-15T16:00:00.000Z",
    "metrics": [
      {
        "timestamp": "2026-07-15T12:00:00.000Z",
        "total_iops": { "avg": 12450, "min": 8200, "max": 18900, "p95": 17200, "p99": 18500, "samples": 12 },
        "read_iops": { "avg": 8100, "min": 5400, "max": 12300, "p95": 11200, "p99": 12000, "samples": 12 },
        "write_iops": { "avg": 4350, "min": 2800, "max": 6600, "p95": 6000, "p99": 6400, "samples": 12 },
        "throughput_read_mbps": { "avg": 524, "min": 320, "max": 780 },
        "throughput_write_mbps": { "avg": 215, "min": 140, "max": 340 },
        "latency_avg_ms": { "avg": 1.2, "min": 0.8, "max": 2.1, "p95": 1.9, "p99": 2.0 },
        "cpu_utilization_pct": { "avg": 45, "min": 30, "max": 62 }
      },
      {
        "timestamp": "2026-07-15T13:00:00.000Z",
        "total_iops": { "avg": 15200, "min": 10100, "max": 22400, "p95": 20800, "p99": 21900, "samples": 12 },
        "read_iops": { "avg": 9800, "min": 6500, "max": 14500 },
        "write_iops": { "avg": 5400, "min": 3600, "max": 7900 },
        "throughput_read_mbps": { "avg": 612, "min": 380, "max": 920 },
        "throughput_write_mbps": { "avg": 278, "min": 180, "max": 410 },
        "latency_avg_ms": { "avg": 1.5, "min": 0.9, "max": 2.8 },
        "cpu_utilization_pct": { "avg": 55, "min": 38, "max": 72 }
      }
    ]
  }
}
```

**Example Request (Per-Volume):**

```bash
curl "http://localhost:3080/api/performance/1/volume?resource_id=vol_prod_db01&interval=daily&from=2026-07-01T00:00:00Z"
```

---

## Capacity

### `GET /api/capacity/projections`

Retrieve capacity runway projections for all systems or a specific system.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `system_id` | integer | — | Filter to a specific system |
| `resource_type` | string | — | Filter: `aggregate`, `volume`, `pool`, `bucket` |
| `threshold` | integer | — | Filter by threshold: `85`, `90`, `95`, `100` |
| `sort_by` | string | `days_to_full` | Sort field |
| `sort_order` | string | `asc` | Sort direction (nearest to full first) |
| `page` | integer | `1` | Page number |
| `limit` | integer | `50` | Results per page |

**Example Request:**

```bash
curl "http://localhost:3080/api/capacity/projections?threshold=90&sort_by=days_to_full"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "system_id": 1,
      "system_name": "prod-ontap-01",
      "resource_type": "aggregate",
      "resource_name": "aggr1_data",
      "current_used_bytes": 4398046511104,
      "total_bytes": 4831838208000,
      "utilization_pct": 91.0,
      "growth_rate_gb_per_day": 2.4,
      "growth_rate_gb_per_week": 16.8,
      "growth_rate_gb_per_month": 72.0,
      "projections": {
        "days_to_85_pct": -15,
        "days_to_90_pct": -3,
        "days_to_95_pct": 42,
        "days_to_100_pct": 89
      },
      "regression": {
        "r_squared": 0.94,
        "confidence": "high",
        "slope": 2.4,
        "intercept": 3800.0,
        "data_points": 180
      },
      "recommendation": "At current growth rate, this aggregate will reach 95% in 42 days. Plan capacity expansion within the next 30 days.",
      "last_calculated": "2026-07-15T16:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 3,
    "totalPages": 1
  }
}
```

---

### `GET /api/capacity/trends`

Retrieve historical capacity trend data.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `system_id` | integer | — | Filter to a specific system |
| `resource_type` | string | — | Resource type filter |
| `resource_name` | string | — | Specific resource name |
| `from` | string | 30 days ago | Start time (ISO 8601) |
| `to` | string | now | End time (ISO 8601) |
| `interval` | string | `daily` | Aggregation: `hourly`, `daily`, `weekly` |

**Example Request:**

```bash
curl "http://localhost:3080/api/capacity/trends?system_id=1&resource_name=aggr1_data&from=2026-06-01T00:00:00Z&interval=daily"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "system_id": 1,
    "system_name": "prod-ontap-01",
    "resource_type": "aggregate",
    "resource_name": "aggr1_data",
    "total_bytes": 4831838208000,
    "trends": [
      {
        "timestamp": "2026-06-01T00:00:00.000Z",
        "used_bytes": 4100000000000,
        "utilization_pct": 84.8
      },
      {
        "timestamp": "2026-06-15T00:00:00.000Z",
        "used_bytes": 4200000000000,
        "utilization_pct": 86.9
      },
      {
        "timestamp": "2026-07-01T00:00:00.000Z",
        "used_bytes": 4320000000000,
        "utilization_pct": 89.4
      },
      {
        "timestamp": "2026-07-15T00:00:00.000Z",
        "used_bytes": 4398046511104,
        "utilization_pct": 91.0
      }
    ]
  }
}
```

---

## Reports

### `POST /api/reports/generate`

Generate an MSP-grade report.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | ✅ | Report type (see table below) |
| `system_ids` | array | — | Array of system IDs to include (default: all) |
| `from` | string | — | Report period start (ISO 8601) |
| `to` | string | — | Report period end (ISO 8601) |
| `format` | string | — | Output format: `json` (default), `html` |

**Report Types:**

| Type | Description |
|------|-------------|
| `health-summary` | Overall health scores and status for all systems |
| `firmware-currency` | Software and firmware version analysis |
| `capacity-planning` | Capacity utilization, projections, and recommendations |
| `issue-summary` | All open issues grouped by severity and category |
| `risk-heatmap` | Risk assessment matrix across all systems |
| `license-compliance` | License and feature entitlement analysis |
| `security-posture` | Security configuration audit |
| `executive-overview` | High-level executive summary of all metrics |

**Example Request:**

```bash
curl -X POST http://localhost:3080/api/reports/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "executive-overview",
    "system_ids": [1, 2, 3],
    "from": "2026-07-01T00:00:00Z",
    "to": "2026-07-15T23:59:59Z"
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "report_id": "rpt-20260715-001",
    "type": "executive-overview",
    "generated_at": "2026-07-15T16:30:00.000Z",
    "period": {
      "from": "2026-07-01T00:00:00.000Z",
      "to": "2026-07-15T23:59:59.000Z"
    },
    "systems_included": 3,
    "content": {
      "summary": {
        "overall_health": 88,
        "health_trend": "+3 from last period",
        "systems_online": 3,
        "systems_total": 3,
        "critical_issues": 1,
        "issues_resolved": 4,
        "capacity_utilization_avg": 72.3
      },
      "health_scores": [
        { "system": "prod-ontap-01", "score": 87, "trend": "-2" },
        { "system": "prod-ontap-02", "score": 92, "trend": "+1" },
        { "system": "prod-ontap-03", "score": 85, "trend": "+5" }
      ],
      "top_risks": [
        {
          "system": "prod-ontap-01",
          "risk": "Aggregate aggr1_data nearing capacity (91%)",
          "severity": "critical",
          "recommendation": "Expand aggregate within 30 days"
        }
      ],
      "capacity_summary": {
        "total_tb": 144.5,
        "used_tb": 104.5,
        "growth_tb_per_month": 4.2,
        "months_until_full": 9.5
      },
      "performance_highlights": {
        "peak_iops": 45200,
        "avg_latency_ms": 1.4,
        "busiest_system": "prod-ontap-01"
      }
    }
  }
}
```

---

## Learning

### `GET /api/learning/status`

Get the current status of the auto-learning engine.

**Example Request:**

```bash
curl http://localhost:3080/api/learning/status
```

**Response:**

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "schedule": "0 2 * * 0",
    "last_run": "2026-07-14T02:00:00.000Z",
    "last_status": "success",
    "next_run": "2026-07-21T02:00:00.000Z",
    "catalog_stats": {
      "ontap_versions": 45,
      "storagegrid_versions": 18,
      "eseries_versions": 22,
      "eol_entries": 85,
      "security_advisories": 34,
      "last_updated": "2026-07-14T02:01:23.000Z"
    },
    "sources": [
      { "name": "endoflife.date", "status": "active", "last_fetch": "2026-07-14T02:00:05.000Z" },
      { "name": "NetApp Security Advisories", "status": "active", "last_fetch": "2026-07-14T02:00:45.000Z" }
    ]
  }
}
```

---

### `POST /api/learning/update`

Trigger an immediate auto-learning update.

**Example Request:**

```bash
curl -X POST http://localhost:3080/api/learning/update
```

**Response:**

```json
{
  "success": true,
  "data": {
    "message": "Learning update started",
    "job_id": "learn-1721059200",
    "sources": ["endoflife.date", "NetApp Security Advisories"]
  }
}
```

---

### `GET /api/learning/catalog`

Retrieve the auto-learning knowledge catalog (versions, EOL dates, advisories).

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `product` | string | — | Filter: `ontap`, `storagegrid`, `eseries` |
| `type` | string | — | Filter: `version`, `eol`, `advisory` |
| `page` | integer | `1` | Page number |
| `limit` | integer | `50` | Results per page |

**Example Request:**

```bash
curl "http://localhost:3080/api/learning/catalog?product=ontap&type=eol"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "product": "ontap",
      "version": "9.9.1",
      "release_date": "2021-06-17",
      "eol_date": "2024-06-17",
      "eos_date": "2025-06-17",
      "status": "end-of-life",
      "lts": false,
      "latest_patch": "9.9.1P22",
      "source": "endoflife.date",
      "updated_at": "2026-07-14T02:00:05.000Z"
    },
    {
      "product": "ontap",
      "version": "9.12.1",
      "release_date": "2022-12-08",
      "eol_date": "2025-12-08",
      "eos_date": "2026-12-08",
      "status": "approaching-eol",
      "lts": true,
      "latest_patch": "9.12.1P16",
      "source": "endoflife.date",
      "updated_at": "2026-07-14T02:00:05.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 45,
    "totalPages": 1
  }
}
```

---

## Common Query Parameters

The following query parameters are available across most list endpoints:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number (1-indexed) |
| `limit` | integer | `50` | Results per page (1–500) |
| `sort_by` | string | varies | Field to sort by |
| `sort_order` | string | `asc` | Sort direction: `asc` or `desc` |
| `system_id` | integer | — | Filter results to a specific system |
| `from` | string | — | Start of time range (ISO 8601 format) |
| `to` | string | — | End of time range (ISO 8601 format) |
| `search` | string | — | Full-text search (where supported) |

---

## Error Response Format

All errors follow a consistent envelope:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error description"
  }
}
```

### HTTP Status Codes

| Status | Meaning | Usage |
|--------|---------|-------|
| `200` | OK | Successful GET, PUT, DELETE |
| `201` | Created | Successful POST (resource created) |
| `400` | Bad Request | Validation errors, malformed JSON, missing required fields |
| `404` | Not Found | Resource does not exist |
| `409` | Conflict | Duplicate resource (e.g., system with same hostname) |
| `500` | Internal Server Error | Unexpected server-side error |

### Example Error Responses

**400 — Validation Error:**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Field 'type' is required and must be one of: ontap, storagegrid, eseries"
  }
}
```

**404 — Not Found:**

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "System with id 99 not found"
  }
}
```

**409 — Conflict:**

```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_SYSTEM",
    "message": "A system with hostname '10.0.1.100' is already registered"
  }
}
```

**500 — Internal Error:**

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred. Check server logs for details."
  }
}
```

---

## Pagination

List endpoints return pagination metadata in the `meta` field:

```json
{
  "meta": {
    "page": 2,
    "limit": 50,
    "total": 142,
    "totalPages": 3
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `page` | integer | Current page number (1-indexed) |
| `limit` | integer | Maximum results per page |
| `total` | integer | Total number of matching records |
| `totalPages` | integer | Total number of pages |

### Navigating Pages

```bash
# First page
curl "http://localhost:3080/api/inventory/volumes?page=1&limit=50"

# Next page
curl "http://localhost:3080/api/inventory/volumes?page=2&limit=50"

# Last page
curl "http://localhost:3080/api/inventory/volumes?page=3&limit=50"
```

When `page` exceeds `totalPages`, an empty `data` array is returned.

---

<p align="center">
  <sub>AIQwhisper v2.0.0 — API Reference</sub>
</p>
