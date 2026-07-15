-- AIQwhisper Database Schema v2.0
-- On-Premises NetApp Infrastructure Manager
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS systems (
    id                    INTEGER PRIMARY KEY,
    type                  TEXT    NOT NULL CHECK(type IN ('ontap','storagegrid','eseries')),
    name                  TEXT    NOT NULL,
    hostname              TEXT    NOT NULL,
    port                  INTEGER NOT NULL DEFAULT 443,
    auth_type             TEXT    NOT NULL DEFAULT 'basic' CHECK(auth_type IN ('basic','certificate','token')),
    credentials_encrypted TEXT,
    last_polled           TEXT,
    poll_interval_seconds INTEGER NOT NULL DEFAULT 300,
    status                TEXT    NOT NULL DEFAULT 'unknown' CHECK(status IN ('online','offline','degraded','unknown')),
    version               TEXT,
    created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_systems_type   ON systems(type);
CREATE INDEX IF NOT EXISTS idx_systems_status ON systems(status);

CREATE TABLE IF NOT EXISTS collection_runs (
    id                INTEGER PRIMARY KEY,
    system_id         INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    started_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    completed_at      TEXT,
    status            TEXT    NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed','cancelled')),
    error_message     TEXT,
    endpoints_queried INTEGER NOT NULL DEFAULT 0,
    records_collected INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_collection_runs_system  ON collection_runs(system_id);
CREATE INDEX IF NOT EXISTS idx_collection_runs_status  ON collection_runs(status);
CREATE INDEX IF NOT EXISTS idx_collection_runs_started ON collection_runs(started_at);

-- ============================================================================
-- ONTAP TABLES (19 tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ontap_clusters (
    id              INTEGER PRIMARY KEY,
    system_id       INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    uuid            TEXT,
    name            TEXT    NOT NULL,
    serial_number   TEXT,
    location        TEXT,
    contact         TEXT,
    dns_domains     TEXT,
    ntp_servers     TEXT,
    version         TEXT,
    management_ip   TEXT,
    cluster_health  TEXT    DEFAULT 'unknown',
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_clusters_system ON ontap_clusters(system_id);

CREATE TABLE IF NOT EXISTS ontap_nodes (
    id              INTEGER PRIMARY KEY,
    system_id       INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    cluster_id      INTEGER REFERENCES ontap_clusters(id) ON DELETE CASCADE,
    uuid            TEXT,
    name            TEXT    NOT NULL,
    model           TEXT,
    serial_number   TEXT,
    location        TEXT,
    uptime          INTEGER,
    is_healthy      INTEGER NOT NULL DEFAULT 1,
    nvram_id        TEXT,
    system_machine_type TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_nodes_system  ON ontap_nodes(system_id);
CREATE INDEX IF NOT EXISTS idx_ontap_nodes_cluster ON ontap_nodes(cluster_id);

CREATE TABLE IF NOT EXISTS ontap_aggregates (
    id              INTEGER PRIMARY KEY,
    system_id       INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    node_id         INTEGER REFERENCES ontap_nodes(id) ON DELETE CASCADE,
    uuid            TEXT,
    name            TEXT    NOT NULL,
    state           TEXT    NOT NULL DEFAULT 'online',
    raid_type       TEXT,
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    used_bytes      INTEGER NOT NULL DEFAULT 0,
    available_bytes INTEGER NOT NULL DEFAULT 0,
    disk_count      INTEGER NOT NULL DEFAULT 0,
    is_root         INTEGER NOT NULL DEFAULT 0,
    block_type      TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_aggregates_system ON ontap_aggregates(system_id);
CREATE INDEX IF NOT EXISTS idx_ontap_aggregates_node   ON ontap_aggregates(node_id);

CREATE TABLE IF NOT EXISTS ontap_svms (
    id                INTEGER PRIMARY KEY,
    system_id         INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    uuid              TEXT,
    name              TEXT    NOT NULL,
    state             TEXT    NOT NULL DEFAULT 'running',
    subtype           TEXT    DEFAULT 'default',
    ip_interfaces     TEXT,
    allowed_protocols TEXT,
    language          TEXT    DEFAULT 'c.utf_8',
    comment           TEXT,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_svms_system ON ontap_svms(system_id);

CREATE TABLE IF NOT EXISTS ontap_volumes (
    id                    INTEGER PRIMARY KEY,
    system_id             INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    svm_id                INTEGER REFERENCES ontap_svms(id) ON DELETE CASCADE,
    aggregate_id          INTEGER REFERENCES ontap_aggregates(id) ON DELETE CASCADE,
    uuid                  TEXT,
    name                  TEXT    NOT NULL,
    state                 TEXT    NOT NULL DEFAULT 'online',
    type                  TEXT    DEFAULT 'rw',
    style                 TEXT    DEFAULT 'flexvol',
    size_bytes            INTEGER NOT NULL DEFAULT 0,
    used_bytes            INTEGER NOT NULL DEFAULT 0,
    available_bytes       INTEGER NOT NULL DEFAULT 0,
    snapshot_reserve_pct  REAL    NOT NULL DEFAULT 5.0,
    is_encrypted          INTEGER NOT NULL DEFAULT 0,
    junction_path         TEXT,
    tiering_policy        TEXT,
    created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_volumes_system    ON ontap_volumes(system_id);
CREATE INDEX IF NOT EXISTS idx_ontap_volumes_svm       ON ontap_volumes(svm_id);
CREATE INDEX IF NOT EXISTS idx_ontap_volumes_aggregate ON ontap_volumes(aggregate_id);

CREATE TABLE IF NOT EXISTS ontap_lifs (
    id                 INTEGER PRIMARY KEY,
    system_id          INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    svm_id             INTEGER REFERENCES ontap_svms(id) ON DELETE CASCADE,
    uuid               TEXT,
    name               TEXT    NOT NULL,
    ip_address         TEXT    NOT NULL,
    netmask            TEXT,
    subnet             TEXT,
    home_node          TEXT,
    home_port          TEXT,
    current_node       TEXT,
    current_port       TEXT,
    role               TEXT    DEFAULT 'data',
    operational_status TEXT    NOT NULL DEFAULT 'up',
    failover_policy    TEXT,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_lifs_system ON ontap_lifs(system_id);
CREATE INDEX IF NOT EXISTS idx_ontap_lifs_svm    ON ontap_lifs(svm_id);

CREATE TABLE IF NOT EXISTS ontap_ports (
    id               INTEGER PRIMARY KEY,
    system_id        INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    node_id          INTEGER REFERENCES ontap_nodes(id) ON DELETE CASCADE,
    uuid             TEXT,
    name             TEXT    NOT NULL,
    type             TEXT,
    speed            TEXT,
    mtu              INTEGER DEFAULT 1500,
    state            TEXT    NOT NULL DEFAULT 'up',
    broadcast_domain TEXT,
    ipspace          TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_ports_system ON ontap_ports(system_id);
CREATE INDEX IF NOT EXISTS idx_ontap_ports_node   ON ontap_ports(node_id);

CREATE TABLE IF NOT EXISTS ontap_disks (
    id               INTEGER PRIMARY KEY,
    system_id        INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    node_id          INTEGER REFERENCES ontap_nodes(id) ON DELETE CASCADE,
    uuid             TEXT,
    name             TEXT    NOT NULL,
    type             TEXT,
    model            TEXT,
    serial_number    TEXT,
    firmware_version TEXT,
    state            TEXT    NOT NULL DEFAULT 'present',
    container_type   TEXT,
    usable_size_bytes INTEGER NOT NULL DEFAULT 0,
    aggregate_name   TEXT,
    bay              INTEGER,
    shelf            TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_disks_system ON ontap_disks(system_id);
CREATE INDEX IF NOT EXISTS idx_ontap_disks_node   ON ontap_disks(node_id);

CREATE TABLE IF NOT EXISTS ontap_shelves (
    id               INTEGER PRIMARY KEY,
    system_id        INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    uuid             TEXT,
    name             TEXT,
    model            TEXT,
    serial_number    TEXT,
    state            TEXT    NOT NULL DEFAULT 'ok',
    module_type      TEXT,
    disk_count       INTEGER NOT NULL DEFAULT 0,
    bay_count        INTEGER NOT NULL DEFAULT 0,
    firmware_version TEXT,
    connection_type  TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_shelves_system ON ontap_shelves(system_id);

CREATE TABLE IF NOT EXISTS ontap_luns (
    id            INTEGER PRIMARY KEY,
    system_id     INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    svm_id        INTEGER REFERENCES ontap_svms(id) ON DELETE CASCADE,
    volume_id     INTEGER REFERENCES ontap_volumes(id) ON DELETE CASCADE,
    uuid          TEXT,
    name          TEXT    NOT NULL,
    path          TEXT,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    used_bytes    INTEGER NOT NULL DEFAULT 0,
    os_type       TEXT    DEFAULT 'linux',
    serial_number TEXT,
    state         TEXT    NOT NULL DEFAULT 'online',
    mapped        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_luns_system ON ontap_luns(system_id);
CREATE INDEX IF NOT EXISTS idx_ontap_luns_svm    ON ontap_luns(svm_id);
CREATE INDEX IF NOT EXISTS idx_ontap_luns_volume ON ontap_luns(volume_id);

CREATE TABLE IF NOT EXISTS ontap_exports (
    id           INTEGER PRIMARY KEY,
    system_id    INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    svm_id       INTEGER REFERENCES ontap_svms(id) ON DELETE CASCADE,
    policy_name  TEXT    NOT NULL,
    rule_index   INTEGER NOT NULL DEFAULT 1,
    client_match TEXT    NOT NULL DEFAULT '0.0.0.0/0',
    protocol     TEXT    DEFAULT 'nfs',
    ro_rule      TEXT    DEFAULT 'sys',
    rw_rule      TEXT    DEFAULT 'sys',
    superuser    TEXT    DEFAULT 'none',
    anon_user    TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_exports_system ON ontap_exports(system_id);
CREATE INDEX IF NOT EXISTS idx_ontap_exports_svm    ON ontap_exports(svm_id);

CREATE TABLE IF NOT EXISTS ontap_cifs_shares (
    id                       INTEGER PRIMARY KEY,
    system_id                INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    svm_id                   INTEGER REFERENCES ontap_svms(id) ON DELETE CASCADE,
    name                     TEXT    NOT NULL,
    path                     TEXT    NOT NULL,
    comment                  TEXT,
    acls                     TEXT,
    properties               TEXT,
    continuously_available   INTEGER NOT NULL DEFAULT 0,
    encryption               INTEGER NOT NULL DEFAULT 0,
    created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_cifs_shares_system ON ontap_cifs_shares(system_id);
CREATE INDEX IF NOT EXISTS idx_ontap_cifs_shares_svm    ON ontap_cifs_shares(svm_id);

CREATE TABLE IF NOT EXISTS ontap_snapmirror (
    id                      INTEGER PRIMARY KEY,
    system_id               INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    uuid                    TEXT,
    source_path             TEXT    NOT NULL,
    destination_path        TEXT    NOT NULL,
    policy                  TEXT,
    state                   TEXT    NOT NULL DEFAULT 'snapmirrored',
    relationship_type       TEXT    DEFAULT 'extended_data_protection',
    healthy                 INTEGER NOT NULL DEFAULT 1,
    lag_time                TEXT,
    transfer_bytes          INTEGER DEFAULT 0,
    last_transfer_duration  TEXT,
    last_transfer_end_time  TEXT,
    created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_snapmirror_system ON ontap_snapmirror(system_id);

CREATE TABLE IF NOT EXISTS ontap_snapshots (
    id               INTEGER PRIMARY KEY,
    system_id        INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    volume_id        INTEGER REFERENCES ontap_volumes(id) ON DELETE CASCADE,
    uuid             TEXT,
    name             TEXT    NOT NULL,
    create_time      TEXT,
    size_bytes       INTEGER NOT NULL DEFAULT 0,
    state            TEXT    DEFAULT 'valid',
    snapmirror_label TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_snapshots_system ON ontap_snapshots(system_id);
CREATE INDEX IF NOT EXISTS idx_ontap_snapshots_volume ON ontap_snapshots(volume_id);

CREATE TABLE IF NOT EXISTS ontap_ems_events (
    id           INTEGER PRIMARY KEY,
    system_id    INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    index_num    INTEGER,
    time         TEXT    NOT NULL,
    node         TEXT,
    severity     TEXT    NOT NULL DEFAULT 'informational',
    message_name TEXT,
    message_text TEXT,
    source       TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_ems_system   ON ontap_ems_events(system_id);
CREATE INDEX IF NOT EXISTS idx_ontap_ems_severity ON ontap_ems_events(severity);
CREATE INDEX IF NOT EXISTS idx_ontap_ems_time     ON ontap_ems_events(time);

CREATE TABLE IF NOT EXISTS ontap_licenses (
    id             INTEGER PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    name           TEXT    NOT NULL,
    scope          TEXT    DEFAULT 'cluster',
    state          TEXT    NOT NULL DEFAULT 'active',
    serial_number  TEXT,
    capacity_limit INTEGER,
    capacity_used  INTEGER,
    expiry_date    TEXT,
    compliance     TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_licenses_system ON ontap_licenses(system_id);

CREATE TABLE IF NOT EXISTS ontap_qos_policies (
    id                   INTEGER PRIMARY KEY,
    system_id            INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    uuid                 TEXT,
    name                 TEXT    NOT NULL,
    fixed_policy         INTEGER NOT NULL DEFAULT 1,
    max_throughput_iops  INTEGER,
    max_throughput_mbps  INTEGER,
    min_throughput_iops  INTEGER,
    min_throughput_mbps  INTEGER,
    adaptive             INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_qos_system ON ontap_qos_policies(system_id);

CREATE TABLE IF NOT EXISTS ontap_security (
    id                       INTEGER PRIMARY KEY,
    system_id                INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    cluster_peer_encryption  INTEGER NOT NULL DEFAULT 0,
    fips_enabled             INTEGER NOT NULL DEFAULT 0,
    tls_protocols            TEXT,
    ssh_ciphers              TEXT,
    audit_log_enabled        INTEGER NOT NULL DEFAULT 1,
    login_banner             TEXT,
    multi_admin_verify       INTEGER NOT NULL DEFAULT 0,
    created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_security_system ON ontap_security(system_id);

CREATE TABLE IF NOT EXISTS ontap_software (
    id                  INTEGER PRIMARY KEY,
    system_id           INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    version             TEXT    NOT NULL,
    package_url         TEXT,
    state               TEXT    DEFAULT 'completed',
    elapsed_duration    TEXT,
    estimated_duration  TEXT,
    status_details      TEXT,
    validation_results  TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ontap_software_system ON ontap_software(system_id);

-- ============================================================================
-- STORAGEGRID TABLES (12 tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sg_grids (
    id                 INTEGER PRIMARY KEY,
    system_id          INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    uuid               TEXT,
    name               TEXT    NOT NULL,
    version            TEXT,
    primary_admin_node TEXT,
    ntp_servers        TEXT,
    dns_servers        TEXT,
    topology_json      TEXT,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sg_grids_system ON sg_grids(system_id);

CREATE TABLE IF NOT EXISTS sg_nodes (
    id               INTEGER PRIMARY KEY,
    system_id        INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    grid_id          INTEGER REFERENCES sg_grids(id) ON DELETE CASCADE,
    uuid             TEXT,
    name             TEXT    NOT NULL,
    type             TEXT    NOT NULL CHECK(type IN ('admin','storage','gateway','archive')),
    site             TEXT,
    state            TEXT    NOT NULL DEFAULT 'connected',
    hardware_type    TEXT,
    ip_addresses     TEXT,
    software_version TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sg_nodes_system ON sg_nodes(system_id);
CREATE INDEX IF NOT EXISTS idx_sg_nodes_grid   ON sg_nodes(grid_id);
CREATE INDEX IF NOT EXISTS idx_sg_nodes_type   ON sg_nodes(type);

CREATE TABLE IF NOT EXISTS sg_alerts (
    id           INTEGER PRIMARY KEY,
    system_id    INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    alert_id     TEXT    NOT NULL,
    rule_name    TEXT    NOT NULL,
    severity     TEXT    NOT NULL DEFAULT 'minor' CHECK(severity IN ('minor','major','critical')),
    status       TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','silenced','resolved')),
    triggered_at TEXT    NOT NULL,
    resolved_at  TEXT,
    node_id      TEXT,
    message      TEXT,
    labels_json  TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sg_alerts_system   ON sg_alerts(system_id);
CREATE INDEX IF NOT EXISTS idx_sg_alerts_severity ON sg_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_sg_alerts_status   ON sg_alerts(status);

CREATE TABLE IF NOT EXISTS sg_ilm_policies (
    id          INTEGER PRIMARY KEY,
    system_id   INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    policy_id   TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','proposed','historical')),
    rules_json  TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sg_ilm_system ON sg_ilm_policies(system_id);

CREATE TABLE IF NOT EXISTS sg_storage_pools (
    id             INTEGER PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    pool_id        TEXT    NOT NULL,
    name           TEXT    NOT NULL,
    type           TEXT    DEFAULT 'storage',
    site           TEXT,
    capacity_bytes INTEGER NOT NULL DEFAULT 0,
    used_bytes     INTEGER NOT NULL DEFAULT 0,
    node_count     INTEGER NOT NULL DEFAULT 0,
    grades         TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sg_storage_pools_system ON sg_storage_pools(system_id);

CREATE TABLE IF NOT EXISTS sg_buckets (
    id                 INTEGER PRIMARY KEY,
    system_id          INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    name               TEXT    NOT NULL,
    tenant_id          TEXT,
    tenant_name        TEXT,
    region             TEXT    DEFAULT 'us-east-1',
    object_count       INTEGER NOT NULL DEFAULT 0,
    data_bytes         INTEGER NOT NULL DEFAULT 0,
    versioning         TEXT    DEFAULT 'disabled',
    compliance_enabled INTEGER NOT NULL DEFAULT 0,
    s3_lock_enabled    INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sg_buckets_system ON sg_buckets(system_id);
CREATE INDEX IF NOT EXISTS idx_sg_buckets_tenant ON sg_buckets(tenant_id);

CREATE TABLE IF NOT EXISTS sg_users (
    id          INTEGER PRIMARY KEY,
    system_id   INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    user_id     TEXT    NOT NULL,
    account_id  TEXT,
    full_name   TEXT,
    unique_name TEXT    NOT NULL,
    member_of   TEXT,
    disable     INTEGER NOT NULL DEFAULT 0,
    user_type   TEXT    DEFAULT 'local',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sg_users_system ON sg_users(system_id);

CREATE TABLE IF NOT EXISTS sg_network (
    id             INTEGER PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    node_id        INTEGER REFERENCES sg_nodes(id) ON DELETE CASCADE,
    interface_name TEXT    NOT NULL,
    network_type   TEXT    NOT NULL CHECK(network_type IN ('grid','admin','client')),
    ip_address     TEXT,
    subnet_mask    TEXT,
    gateway        TEXT,
    mtu            INTEGER DEFAULT 1500,
    link_status    TEXT    NOT NULL DEFAULT 'up',
    vlan_id        INTEGER,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sg_network_system ON sg_network(system_id);
CREATE INDEX IF NOT EXISTS idx_sg_network_node   ON sg_network(node_id);

CREATE TABLE IF NOT EXISTS sg_metrics (
    id           INTEGER PRIMARY KEY,
    system_id    INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    node_id      INTEGER REFERENCES sg_nodes(id) ON DELETE CASCADE,
    metric_name  TEXT    NOT NULL,
    metric_value REAL    NOT NULL,
    unit         TEXT,
    timestamp    TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sg_metrics_system    ON sg_metrics(system_id);
CREATE INDEX IF NOT EXISTS idx_sg_metrics_node      ON sg_metrics(node_id);
CREATE INDEX IF NOT EXISTS idx_sg_metrics_timestamp ON sg_metrics(timestamp);

CREATE TABLE IF NOT EXISTS sg_certificates (
    id            INTEGER PRIMARY KEY,
    system_id     INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    cert_id       TEXT,
    purpose       TEXT    NOT NULL DEFAULT 'server',
    subject       TEXT,
    issuer        TEXT,
    not_before    TEXT,
    not_after     TEXT,
    serial_number TEXT,
    fingerprint   TEXT,
    pem_encoded   TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sg_certificates_system ON sg_certificates(system_id);

CREATE TABLE IF NOT EXISTS sg_compliance (
    id                INTEGER PRIMARY KEY,
    system_id         INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    bucket_id         INTEGER REFERENCES sg_buckets(id) ON DELETE CASCADE,
    retention_mode    TEXT    DEFAULT 'none',
    retain_until_date TEXT,
    legal_hold        INTEGER NOT NULL DEFAULT 0,
    auto_delete       INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sg_compliance_system ON sg_compliance(system_id);
CREATE INDEX IF NOT EXISTS idx_sg_compliance_bucket ON sg_compliance(bucket_id);

CREATE TABLE IF NOT EXISTS sg_traffic_classes (
    id            INTEGER PRIMARY KEY,
    system_id     INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    policy_id     TEXT    NOT NULL,
    name          TEXT    NOT NULL,
    description   TEXT,
    matchers_json TEXT,
    limits_json   TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sg_traffic_classes_system ON sg_traffic_classes(system_id);

-- ============================================================================
-- E-SERIES TABLES (13 tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS es_arrays (
    id                   INTEGER PRIMARY KEY,
    system_id            INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    uuid                 TEXT,
    name                 TEXT    NOT NULL,
    chassis_serial       TEXT,
    firmware_version     TEXT,
    model                TEXT,
    status               TEXT    NOT NULL DEFAULT 'optimal',
    controller_count     INTEGER NOT NULL DEFAULT 2,
    drive_count          INTEGER NOT NULL DEFAULT 0,
    total_capacity_bytes INTEGER NOT NULL DEFAULT 0,
    used_capacity_bytes  INTEGER NOT NULL DEFAULT 0,
    needs_attention      INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_arrays_system ON es_arrays(system_id);

CREATE TABLE IF NOT EXISTS es_controllers (
    id               INTEGER PRIMARY KEY,
    system_id        INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    array_id         INTEGER REFERENCES es_arrays(id) ON DELETE CASCADE,
    uuid             TEXT,
    name             TEXT    NOT NULL,
    serial_number    TEXT,
    model            TEXT,
    status           TEXT    NOT NULL DEFAULT 'optimal',
    firmware_version TEXT,
    ip_address       TEXT,
    board_id         TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_controllers_system ON es_controllers(system_id);
CREATE INDEX IF NOT EXISTS idx_es_controllers_array  ON es_controllers(array_id);

CREATE TABLE IF NOT EXISTS es_drives (
    id               INTEGER PRIMARY KEY,
    system_id        INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    array_id         INTEGER REFERENCES es_arrays(id) ON DELETE CASCADE,
    uuid             TEXT,
    status           TEXT    NOT NULL DEFAULT 'optimal',
    media_type       TEXT    NOT NULL DEFAULT 'hdd' CHECK(media_type IN ('hdd','ssd','unknown')),
    capacity_bytes   INTEGER NOT NULL DEFAULT 0,
    firmware_version TEXT,
    serial_number    TEXT,
    slot             INTEGER,
    tray             INTEGER,
    product_id       TEXT,
    drive_type       TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_drives_system ON es_drives(system_id);
CREATE INDEX IF NOT EXISTS idx_es_drives_array  ON es_drives(array_id);

CREATE TABLE IF NOT EXISTS es_pools (
    id                   INTEGER PRIMARY KEY,
    system_id            INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    array_id             INTEGER REFERENCES es_arrays(id) ON DELETE CASCADE,
    uuid                 TEXT,
    name                 TEXT    NOT NULL,
    raid_level           TEXT    DEFAULT 'raidDiskPool',
    status               TEXT    NOT NULL DEFAULT 'optimal',
    total_capacity_bytes INTEGER NOT NULL DEFAULT 0,
    used_capacity_bytes  INTEGER NOT NULL DEFAULT 0,
    drive_count          INTEGER NOT NULL DEFAULT 0,
    security_type        TEXT    DEFAULT 'none',
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_pools_system ON es_pools(system_id);
CREATE INDEX IF NOT EXISTS idx_es_pools_array  ON es_pools(array_id);

CREATE TABLE IF NOT EXISTS es_volumes (
    id                  INTEGER PRIMARY KEY,
    system_id           INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    pool_id             INTEGER REFERENCES es_pools(id) ON DELETE CASCADE,
    uuid                TEXT,
    name                TEXT    NOT NULL,
    status              TEXT    NOT NULL DEFAULT 'optimal',
    capacity_bytes      INTEGER NOT NULL DEFAULT 0,
    segment_size        INTEGER DEFAULT 131072,
    cache_enabled       INTEGER NOT NULL DEFAULT 1,
    read_ahead          INTEGER NOT NULL DEFAULT 1,
    flash_cache_enabled INTEGER NOT NULL DEFAULT 0,
    thin_provisioned    INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_volumes_system ON es_volumes(system_id);
CREATE INDEX IF NOT EXISTS idx_es_volumes_pool   ON es_volumes(pool_id);

CREATE TABLE IF NOT EXISTS es_hosts (
    id          INTEGER PRIMARY KEY,
    system_id   INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    array_id    INTEGER REFERENCES es_arrays(id) ON DELETE CASCADE,
    uuid        TEXT,
    name        TEXT    NOT NULL,
    host_type   TEXT    DEFAULT 'linux',
    ports_json  TEXT,
    cluster_id  TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_hosts_system ON es_hosts(system_id);
CREATE INDEX IF NOT EXISTS idx_es_hosts_array  ON es_hosts(array_id);

CREATE TABLE IF NOT EXISTS es_mappings (
    id          INTEGER PRIMARY KEY,
    system_id   INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    volume_id   INTEGER REFERENCES es_volumes(id) ON DELETE CASCADE,
    host_id     INTEGER REFERENCES es_hosts(id) ON DELETE CASCADE,
    lun_number  INTEGER NOT NULL DEFAULT 0,
    access_mode TEXT    NOT NULL DEFAULT 'readWrite',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_mappings_system ON es_mappings(system_id);
CREATE INDEX IF NOT EXISTS idx_es_mappings_volume ON es_mappings(volume_id);
CREATE INDEX IF NOT EXISTS idx_es_mappings_host   ON es_mappings(host_id);

CREATE TABLE IF NOT EXISTS es_interfaces (
    id              INTEGER PRIMARY KEY,
    system_id       INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    controller_id   INTEGER REFERENCES es_controllers(id) ON DELETE CASCADE,
    uuid            TEXT,
    interface_type  TEXT    NOT NULL DEFAULT 'iscsi',
    channel         INTEGER,
    link_status     TEXT    NOT NULL DEFAULT 'up',
    speed           TEXT,
    ip_address      TEXT,
    iqn             TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_interfaces_system     ON es_interfaces(system_id);
CREATE INDEX IF NOT EXISTS idx_es_interfaces_controller ON es_interfaces(controller_id);

CREATE TABLE IF NOT EXISTS es_snapshots (
    id                       INTEGER PRIMARY KEY,
    system_id                INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    volume_id                INTEGER REFERENCES es_volumes(id) ON DELETE CASCADE,
    uuid                     TEXT,
    name                     TEXT    NOT NULL,
    status                   TEXT    NOT NULL DEFAULT 'optimal',
    pit_timestamp            TEXT,
    repository_capacity_bytes INTEGER NOT NULL DEFAULT 0,
    created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_snapshots_system ON es_snapshots(system_id);
CREATE INDEX IF NOT EXISTS idx_es_snapshots_volume ON es_snapshots(volume_id);

CREATE TABLE IF NOT EXISTS es_mirrors (
    id                  INTEGER PRIMARY KEY,
    system_id           INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    uuid                TEXT,
    primary_volume_id   TEXT,
    secondary_volume_id TEXT,
    state               TEXT    NOT NULL DEFAULT 'optimal',
    sync_mode           TEXT    DEFAULT 'async',
    sync_completion_pct REAL    NOT NULL DEFAULT 100.0,
    role                TEXT    DEFAULT 'primary',
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_mirrors_system ON es_mirrors(system_id);

CREATE TABLE IF NOT EXISTS es_mel_events (
    id                 INTEGER PRIMARY KEY,
    system_id          INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    array_id           INTEGER REFERENCES es_arrays(id) ON DELETE CASCADE,
    sequence_number    INTEGER NOT NULL,
    event_type         TEXT    NOT NULL,
    time_stamp         TEXT    NOT NULL,
    priority           TEXT    NOT NULL DEFAULT 'informational',
    component_type     TEXT,
    component_location TEXT,
    description        TEXT,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_mel_system   ON es_mel_events(system_id);
CREATE INDEX IF NOT EXISTS idx_es_mel_array    ON es_mel_events(array_id);
CREATE INDEX IF NOT EXISTS idx_es_mel_priority ON es_mel_events(priority);

CREATE TABLE IF NOT EXISTS es_performance (
    id               INTEGER PRIMARY KEY,
    system_id        INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    object_type      TEXT    NOT NULL,
    object_id        TEXT    NOT NULL,
    read_iops        REAL    NOT NULL DEFAULT 0,
    write_iops       REAL    NOT NULL DEFAULT 0,
    read_throughput  REAL    NOT NULL DEFAULT 0,
    write_throughput REAL    NOT NULL DEFAULT 0,
    read_latency     REAL    NOT NULL DEFAULT 0,
    write_latency    REAL    NOT NULL DEFAULT 0,
    timestamp        TEXT    NOT NULL,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_performance_system    ON es_performance(system_id);
CREATE INDEX IF NOT EXISTS idx_es_performance_object    ON es_performance(object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_es_performance_timestamp ON es_performance(timestamp);

CREATE TABLE IF NOT EXISTS es_ssd_cache (
    id             INTEGER PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    array_id       INTEGER REFERENCES es_arrays(id) ON DELETE CASCADE,
    uuid           TEXT,
    name           TEXT    NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'optimal',
    capacity_bytes INTEGER NOT NULL DEFAULT 0,
    used_bytes     INTEGER NOT NULL DEFAULT 0,
    hit_pct        REAL    NOT NULL DEFAULT 0.0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_ssd_cache_system ON es_ssd_cache(system_id);
CREATE INDEX IF NOT EXISTS idx_es_ssd_cache_array  ON es_ssd_cache(array_id);

-- ============================================================================
-- METRICS TABLES (4 tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS metrics_raw (
    id            INTEGER PRIMARY KEY,
    system_id     INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    resource_type TEXT    NOT NULL,
    resource_id   TEXT    NOT NULL,
    metric_name   TEXT    NOT NULL,
    metric_value  REAL    NOT NULL,
    unit          TEXT,
    timestamp     TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_metrics_raw_composite ON metrics_raw(system_id, resource_type, resource_id, metric_name, timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_raw_timestamp ON metrics_raw(timestamp);

CREATE TABLE IF NOT EXISTS metrics_hourly (
    id              INTEGER PRIMARY KEY,
    system_id       INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    resource_type   TEXT    NOT NULL,
    resource_id     TEXT    NOT NULL,
    metric_name     TEXT    NOT NULL,
    hour_timestamp  TEXT    NOT NULL,
    min_value       REAL    NOT NULL DEFAULT 0,
    max_value       REAL    NOT NULL DEFAULT 0,
    avg_value       REAL    NOT NULL DEFAULT 0,
    sample_count    INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(system_id, resource_type, resource_id, metric_name, hour_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_metrics_hourly_lookup ON metrics_hourly(system_id, resource_type, resource_id, metric_name);

CREATE TABLE IF NOT EXISTS metrics_daily (
    id             INTEGER PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    resource_type  TEXT    NOT NULL,
    resource_id    TEXT    NOT NULL,
    metric_name    TEXT    NOT NULL,
    day_timestamp  TEXT    NOT NULL,
    min_value      REAL    NOT NULL DEFAULT 0,
    max_value      REAL    NOT NULL DEFAULT 0,
    avg_value      REAL    NOT NULL DEFAULT 0,
    sample_count   INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(system_id, resource_type, resource_id, metric_name, day_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_metrics_daily_lookup ON metrics_daily(system_id, resource_type, resource_id, metric_name);

CREATE TABLE IF NOT EXISTS metrics_weekly (
    id              INTEGER PRIMARY KEY,
    system_id       INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    resource_type   TEXT    NOT NULL,
    resource_id     TEXT    NOT NULL,
    metric_name     TEXT    NOT NULL,
    week_timestamp  TEXT    NOT NULL,
    min_value       REAL    NOT NULL DEFAULT 0,
    max_value       REAL    NOT NULL DEFAULT 0,
    avg_value       REAL    NOT NULL DEFAULT 0,
    sample_count    INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(system_id, resource_type, resource_id, metric_name, week_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_metrics_weekly_lookup ON metrics_weekly(system_id, resource_type, resource_id, metric_name);

-- ============================================================================
-- CAPACITY TABLES (2 tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS capacity_snapshots (
    id                  INTEGER PRIMARY KEY,
    system_id           INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    resource_type       TEXT    NOT NULL,
    resource_id         TEXT    NOT NULL,
    resource_name       TEXT,
    total_bytes         INTEGER NOT NULL DEFAULT 0,
    used_bytes          INTEGER NOT NULL DEFAULT 0,
    available_bytes     INTEGER NOT NULL DEFAULT 0,
    utilization_pct     REAL    NOT NULL DEFAULT 0.0,
    snapshot_timestamp  TEXT    NOT NULL,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_capacity_snap_system    ON capacity_snapshots(system_id);
CREATE INDEX IF NOT EXISTS idx_capacity_snap_resource  ON capacity_snapshots(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_capacity_snap_timestamp ON capacity_snapshots(snapshot_timestamp);

CREATE TABLE IF NOT EXISTS capacity_projections (
    id                       INTEGER PRIMARY KEY,
    system_id                INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    resource_type            TEXT    NOT NULL,
    resource_id              TEXT    NOT NULL,
    resource_name            TEXT,
    current_used_bytes       INTEGER NOT NULL DEFAULT 0,
    growth_rate_bytes_per_day REAL   NOT NULL DEFAULT 0,
    projected_full_date      TEXT,
    confidence_pct           REAL    NOT NULL DEFAULT 0.0,
    analysis_timestamp       TEXT    NOT NULL,
    days_until_full          INTEGER,
    created_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_capacity_proj_system   ON capacity_projections(system_id);
CREATE INDEX IF NOT EXISTS idx_capacity_proj_resource ON capacity_projections(resource_type, resource_id);

-- ============================================================================
-- ANALYSIS TABLES (3 tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS issues (
    id            INTEGER PRIMARY KEY,
    system_id     INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    resource_type TEXT    NOT NULL,
    resource_id   TEXT    NOT NULL,
    severity      TEXT    NOT NULL DEFAULT 'medium' CHECK(severity IN ('critical','high','medium','low','info')),
    category      TEXT    NOT NULL DEFAULT 'general',
    title         TEXT    NOT NULL,
    description   TEXT,
    detected_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    resolved_at   TEXT,
    status        TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','in_progress','resolved','dismissed')),
    rule_id       INTEGER,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_issues_system   ON issues(system_id);
CREATE INDEX IF NOT EXISTS idx_issues_severity ON issues(severity);
CREATE INDEX IF NOT EXISTS idx_issues_status   ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_category ON issues(category);

CREATE TABLE IF NOT EXISTS recommendations (
    id            INTEGER PRIMARY KEY,
    issue_id      INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    priority      INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
    title         TEXT    NOT NULL,
    description   TEXT,
    impact        TEXT,
    effort        TEXT    DEFAULT 'medium' CHECK(effort IN ('low','medium','high')),
    auto_fixable  INTEGER NOT NULL DEFAULT 0,
    fix_command   TEXT,
    status        TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','applied','failed')),
    applied_at    TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recommendations_issue    ON recommendations(issue_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_priority ON recommendations(priority);
CREATE INDEX IF NOT EXISTS idx_recommendations_status   ON recommendations(status);

CREATE TABLE IF NOT EXISTS best_practice_rules (
    id            INTEGER PRIMARY KEY,
    platform      TEXT    NOT NULL CHECK(platform IN ('ontap','storagegrid','eseries','all')),
    category      TEXT    NOT NULL,
    rule_name     TEXT    NOT NULL,
    description   TEXT,
    severity      TEXT    NOT NULL DEFAULT 'medium' CHECK(severity IN ('critical','high','medium','low','info')),
    check_query   TEXT,
    remediation   TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_best_practice_platform ON best_practice_rules(platform);
CREATE INDEX IF NOT EXISTS idx_best_practice_category ON best_practice_rules(category);
CREATE INDEX IF NOT EXISTS idx_best_practice_enabled  ON best_practice_rules(enabled);

-- ============================================================================
-- KNOWLEDGE BASE TABLES (4 tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS kb_software_versions (
    id              INTEGER PRIMARY KEY,
    platform        TEXT    NOT NULL CHECK(platform IN ('ontap','storagegrid','eseries')),
    version         TEXT    NOT NULL,
    release_date    TEXT,
    end_of_support  TEXT,
    known_issues    TEXT,
    download_url    TEXT,
    is_recommended  INTEGER NOT NULL DEFAULT 0,
    release_notes   TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(platform, version)
);

CREATE INDEX IF NOT EXISTS idx_kb_software_platform ON kb_software_versions(platform);

CREATE TABLE IF NOT EXISTS kb_security_advisories (
    id                INTEGER PRIMARY KEY,
    advisory_id       TEXT    NOT NULL UNIQUE,
    title             TEXT    NOT NULL,
    severity          TEXT    NOT NULL DEFAULT 'medium' CHECK(severity IN ('critical','high','medium','low')),
    affected_products TEXT,
    affected_versions TEXT,
    fixed_versions    TEXT,
    cve_ids           TEXT,
    description       TEXT,
    workaround        TEXT,
    published_at      TEXT,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kb_advisory_severity ON kb_security_advisories(severity);

CREATE TABLE IF NOT EXISTS kb_firmware_matrix (
    id                   INTEGER PRIMARY KEY,
    platform             TEXT    NOT NULL CHECK(platform IN ('ontap','storagegrid','eseries')),
    component_type       TEXT    NOT NULL,
    model                TEXT    NOT NULL,
    recommended_version  TEXT,
    minimum_version      TEXT,
    latest_version       TEXT,
    compatibility_notes  TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kb_firmware_platform  ON kb_firmware_matrix(platform);
CREATE INDEX IF NOT EXISTS idx_kb_firmware_component ON kb_firmware_matrix(component_type);

CREATE TABLE IF NOT EXISTS kb_learning_log (
    id               INTEGER PRIMARY KEY,
    system_id        INTEGER REFERENCES systems(id) ON DELETE CASCADE,
    event_type       TEXT    NOT NULL,
    context          TEXT,
    learned_pattern  TEXT    NOT NULL,
    confidence_score REAL    NOT NULL DEFAULT 0.0,
    applied_count    INTEGER NOT NULL DEFAULT 0,
    last_applied_at  TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kb_learning_system ON kb_learning_log(system_id);
CREATE INDEX IF NOT EXISTS idx_kb_learning_type   ON kb_learning_log(event_type);

-- ============================================================================
-- REPORTING TABLES (3 tables)
-- ============================================================================

CREATE TABLE IF NOT EXISTS reports (
    id              INTEGER PRIMARY KEY,
    name            TEXT    NOT NULL,
    type            TEXT    NOT NULL DEFAULT 'health' CHECK(type IN ('health','capacity','performance','security','inventory','custom')),
    parameters_json TEXT,
    generated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    format          TEXT    NOT NULL DEFAULT 'html' CHECK(format IN ('html','pdf','csv','json')),
    file_path       TEXT,
    file_size_bytes INTEGER,
    created_by      TEXT    DEFAULT 'system',
    status          TEXT    NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','generating','completed','failed')),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reports_type      ON reports(type);
CREATE INDEX IF NOT EXISTS idx_reports_generated ON reports(generated_at);

CREATE TABLE IF NOT EXISTS health_scores (
    id                  INTEGER PRIMARY KEY,
    system_id           INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    overall_score       REAL    NOT NULL DEFAULT 0.0 CHECK(overall_score BETWEEN 0 AND 100),
    performance_score   REAL    NOT NULL DEFAULT 0.0 CHECK(performance_score BETWEEN 0 AND 100),
    capacity_score      REAL    NOT NULL DEFAULT 0.0 CHECK(capacity_score BETWEEN 0 AND 100),
    protection_score    REAL    NOT NULL DEFAULT 0.0 CHECK(protection_score BETWEEN 0 AND 100),
    security_score      REAL    NOT NULL DEFAULT 0.0 CHECK(security_score BETWEEN 0 AND 100),
    configuration_score REAL    NOT NULL DEFAULT 0.0 CHECK(configuration_score BETWEEN 0 AND 100),
    details_json        TEXT,
    scored_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_health_scores_system ON health_scores(system_id);
CREATE INDEX IF NOT EXISTS idx_health_scores_scored ON health_scores(scored_at);

CREATE TABLE IF NOT EXISTS reference_data (
    id          INTEGER PRIMARY KEY,
    category    TEXT    NOT NULL,
    key         TEXT    NOT NULL,
    value       TEXT    NOT NULL,
    description TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reference_data_category ON reference_data(category);
CREATE INDEX IF NOT EXISTS idx_reference_data_key      ON reference_data(key);
