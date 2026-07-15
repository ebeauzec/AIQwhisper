# AIQwhisper ITIL Process Alignment Guide

> **Version:** 2.0  
> **Last Updated:** 2026-07-15  
> **Authors:** AIQwhisper Engineering Team  
> **Status:** Production  

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [ITIL Process Mapping](#itil-process-mapping)
3. [Severity to ITIL Priority Mapping](#severity-to-itil-priority-mapping)
4. [Stakeholder Matrix (RACI)](#stakeholder-matrix-raci)
5. [Change Management Integration](#change-management-integration)
6. [Escalation Matrix](#escalation-matrix)
7. [Runbook Templates](#runbook-templates)
8. [Appendix](#appendix)

---

## Executive Summary

AIQwhisper provides automated health analysis for NetApp storage infrastructure (ONTAP, StorageGRID, E-Series). This document defines how AIQwhisper integrates with ITIL v4 service management processes, enabling organizations to leverage automated detection and analysis within their existing ITSM workflows.

AIQwhisper maps directly to six core ITIL practices:
- **Incident Management** — Automated detection and classification of storage issues
- **Problem Management** — Trend analysis and root cause identification
- **Change Management** — Risk-assessed firmware and configuration recommendations
- **Service Level Management** — Health scoring and SLA compliance tracking
- **Capacity Management** — Predictive analytics and runway projections
- **Configuration Management** — Infrastructure inventory as CMDB data source

---

## ITIL Process Mapping

### 1. Incident Management

AIQwhisper serves as a **proactive incident detection engine**, identifying issues before they impact services or immediately upon occurrence.

| AIQwhisper Function | ITIL Incident Process Stage | Description |
|---|---|---|
| Rule-based health checks | **Detection & Logging** | Automated scans detect anomalies and log them as potential incidents |
| Severity classification | **Classification & Prioritization** | Each rule maps to ITIL priority (P1–P4) with pre-defined impact/urgency |
| Remediation guidance | **Investigation & Diagnosis** | Detailed remediation steps accelerate root cause identification |
| Support case flags | **Escalation** | Rules indicate when NetApp Support engagement is required |
| Health score tracking | **Resolution & Recovery** | Post-remediation health score improvement confirms resolution |

**Integration Points:**
- AIQwhisper findings can auto-create ITSM tickets (ServiceNow, Jira Service Management, BMC Remedy)
- Each finding includes ITIL priority, stakeholder list, and remediation runbook
- Critical findings (P1) trigger immediate notification workflows

**Incident Lifecycle with AIQwhisper:**
```
AutoSupport/API Data → AIQwhisper Analysis → Finding Generated → 
  → ITSM Ticket Created → Triage (auto-classified) → 
  → Remediation (guided) → Verification → Closure
```

### 2. Problem Management

AIQwhisper supports problem management through **trend analysis and pattern detection**.

| AIQwhisper Function | ITIL Problem Process Stage | Description |
|---|---|---|
| Historical trend analysis | **Problem Detection** | Identifies recurring incidents across systems |
| Cross-system correlation | **Root Cause Analysis** | Correlates issues across ONTAP/StorageGRID/E-Series |
| Health score trending | **Known Error Database** | Persistent low scores identify known problems |
| Capacity projections | **Proactive Problem Management** | Predicts future issues before they become incidents |

**Key Problem Management Workflows:**
1. **Recurring Incident Pattern**: When the same rule triggers repeatedly on a system, AIQwhisper flags it as a potential problem requiring root cause analysis
2. **Cross-Platform Correlation**: Issues appearing across multiple storage platforms may indicate shared infrastructure problems (network, power, cooling)
3. **Capacity Trending**: Consistent capacity growth patterns trigger proactive problem tickets before thresholds are breached

### 3. Change Management

AIQwhisper integrates with change management by **assessing risk and providing structured change recommendations**.

| Change Type | AIQwhisper Role | Risk Assessment |
|---|---|---|
| Firmware updates | Detects outdated versions, provides update procedures | High — requires maintenance window and rollback plan |
| Configuration changes | Identifies misconfigurations with remediation steps | Low to Medium — depends on scope |
| Capacity expansion | Projects needs and recommends expansion timing | Medium — requires planning and procurement |
| Security updates | Detects certificate expiry, policy gaps | Medium to High — impacts access |

**Change Advisory Board (CAB) Integration:**
- AIQwhisper provides risk scores for each recommended change
- Findings include maintenance window requirements
- Rollback procedures are included in remediation steps
- Change history can be tracked through health score improvements

### 4. Service Level Management

AIQwhisper supports SLM through **health scoring and performance monitoring**.

| SLM Function | AIQwhisper Capability |
|---|---|
| Service availability tracking | Node/controller uptime monitoring, HA status checks |
| Performance SLA compliance | Latency monitoring against thresholds (S3 >500ms, volume >20ms) |
| Capacity SLA compliance | Utilization tracking with predictive runway |
| Reporting | Automated health reports with trend analysis |

**Health Score as SLA Metric:**
- **95–100**: Excellent — All SLAs met, optimal configuration
- **80–94**: Good — Minor issues, SLAs at risk for specific metrics
- **60–79**: Fair — Multiple issues, SLA breaches likely without action
- **Below 60**: Poor — Active SLA breaches, immediate action required

### 5. Capacity Management

AIQwhisper provides **data-driven capacity management** across all storage platforms.

| Capacity Function | AIQwhisper Capability | Output |
|---|---|---|
| Current utilization | Real-time capacity monitoring | Utilization percentages, available space |
| Growth trending | Historical analysis of consumption patterns | Daily/weekly/monthly growth rates |
| Runway projection | Predictive analytics based on trends | Days/weeks until capacity thresholds |
| Right-sizing | Workload analysis and recommendations | Optimization suggestions |
| Planning | Budget and procurement recommendations | Capacity purchase timeline |

### 6. Availability Management

AIQwhisper monitors **infrastructure availability** through comprehensive health checks.

| Availability Check | Platforms | Impact |
|---|---|---|
| HA pair status | ONTAP | Controller redundancy |
| Node/controller health | All | System availability |
| Component redundancy | E-Series | PSU, fan, battery status |
| Replication health | All | DR readiness |
| Network connectivity | ONTAP, StorageGRID | Data access availability |

### 7. Configuration Management (CMDB)

AIQwhisper serves as an **authoritative data source for storage CMDB records**.

| CMDB Data Category | Data Collected | Update Frequency |
|---|---|---|
| Hardware inventory | Controllers, shelves, drives, network ports | Per analysis run |
| Software inventory | OS versions, firmware versions, feature licenses | Per analysis run |
| Configuration items | Volumes, aggregates, pools, LIFs, buckets | Per analysis run |
| Relationships | Controller-to-shelf, volume-to-aggregate, node-to-cluster | Per analysis run |
| Capacity metrics | Used/available/total for all storage objects | Per analysis run |

---

## Severity to ITIL Priority Mapping

### Priority Classification Matrix

| AIQwhisper Severity | ITIL Priority | ITIL Classification | Response Target | Resolution Target | Example Scenarios |
|---|---|---|---|---|---|
| **Critical** | **P1 — Major Incident** | Major Incident | < 15 minutes | < 4 hours | Controller offline, drive failure, node offline, certificate expired, pool >95% full |
| **Warning** | **P2 — High** | Standard Incident | < 1 hour | < 8 hours | Node degraded, predictive drive failure, capacity >85%, replication lag |
| **Warning** (lower) | **P3 — Medium** | Standard Incident | < 4 hours | < 24 hours | Config suboptimal, queue depth high, hot spare insufficient |
| **Info** | **P4 — Low** | Service Request | < 8 hours | < 5 business days | Firmware not current, SSO not configured, SNMP not enabled |

### Urgency and Impact Matrix

|  | **High Impact** | **Medium Impact** | **Low Impact** |
|---|---|---|---|
| **High Urgency** | P1 | P2 | P3 |
| **Medium Urgency** | P2 | P3 | P3 |
| **Low Urgency** | P3 | P3 | P4 |

**Impact Definitions:**
- **High**: Multiple users/services affected, data at risk, complete service outage
- **Medium**: Single service degraded, performance impact, redundancy lost
- **Low**: No immediate user impact, best practice deviation, future risk

**Urgency Definitions:**
- **High**: Immediate action required, active data loss risk, SLA breach in progress
- **Medium**: Action required within business hours, degraded but functional
- **Low**: Can be scheduled, no active impact, improvement opportunity

---

## Stakeholder Matrix (RACI)

### RACI Legend
- **R** — Responsible (does the work)
- **A** — Accountable (owns the outcome)
- **C** — Consulted (provides input)
- **I** — Informed (kept updated)

### RACI Chart

| Activity | Storage Admin | Infra Manager | Network Team | Security Team | Change Board (CAB) | NetApp Support | Management |
|---|---|---|---|---|---|---|---|
| **Issue Detection** | R | I | I | I | — | — | — |
| **Triage & Classification** | R | A | C | C | — | C | I |
| **Incident Remediation** | R | A | C | — | — | C | I |
| **Firmware Update Planning** | R | A | C | C | A | C | I |
| **Firmware Update Execution** | R | A | — | — | I | C | — |
| **Capacity Planning** | R | A | — | — | — | C | I |
| **Capacity Expansion** | R | A | C | — | A | C | A |
| **Security Response** | R | A | C | A | C | C | I |
| **Performance Tuning** | R | A | C | — | — | C | — |
| **DR/Replication Management** | R | A | C | — | C | C | I |
| **Certificate Management** | R | A | — | A | C | — | — |
| **Compliance Audit** | C | A | — | R | — | — | I |
| **Health Reporting** | R | A | — | I | — | — | A |
| **Change Review** | C | A | C | C | R | C | I |
| **Escalation to NetApp** | R | A | — | — | — | R | I |
| **Post-Incident Review** | R | A | C | C | I | C | I |

### Stakeholder Definitions

| Stakeholder | Role in AIQwhisper Context |
|---|---|
| **Storage Admin** | Primary operator; executes remediation, monitors health, performs firmware updates |
| **Infra Manager** | Accountable for storage infrastructure; approves changes, reviews reports |
| **Network Team** | Consulted for network-related issues (LIF, replication, connectivity) |
| **Security Team** | Accountable for security findings (certificates, authentication, audit logs) |
| **Change Board (CAB)** | Approves high-risk changes (firmware, major reconfigurations) |
| **NetApp Support** | Consulted for complex issues; Responsible when hardware replacement needed |
| **Management** | Informed of significant incidents; Accountable for budget (capacity expansion) |

---

## Change Management Integration

### Change Risk Classification

AIQwhisper classifies every recommended change with a risk level that maps to the appropriate change management process:

#### Low Risk Changes — Standard Change (Pre-Approved)

| Criteria | Details |
|---|---|
| **Rule Severity** | Info |
| **Approval Required** | None (pre-approved in change calendar) |
| **Maintenance Window** | Not required |
| **Rollback Plan** | Simple revert |
| **Examples** | Enable SNMP monitoring, configure alert notifications, enable audit logging, assign hot spares |

**Process:**
1. Storage Admin reviews AIQwhisper finding
2. Implements change following remediation steps
3. Verifies resolution via follow-up health check
4. Documents change in ITSM system

#### Medium Risk Changes — Normal Change (Change Manager Approval)

| Criteria | Details |
|---|---|
| **Rule Severity** | Warning |
| **Approval Required** | Change Manager |
| **Maintenance Window** | Recommended |
| **Rollback Plan** | Required — documented before execution |
| **Examples** | Certificate rotation, configuration optimization, capacity expansion, BMC firmware update |

**Process:**
1. Storage Admin creates RFC (Request for Change) with AIQwhisper finding details
2. Change Manager reviews risk assessment and remediation plan
3. Maintenance window scheduled if required
4. Implementation with monitoring
5. Post-implementation verification
6. Change record closure

#### High Risk Changes — Emergency or CAB-Approved Change

| Criteria | Details |
|---|---|
| **Rule Severity** | Critical, or any firmware/major change |
| **Approval Required** | CAB (Change Advisory Board) or Emergency Change Manager |
| **Maintenance Window** | Required |
| **Rollback Plan** | Mandatory — tested before execution |
| **Communication Plan** | Required — all stakeholders notified |
| **Examples** | ONTAP/SANtricity/StorageGRID OS upgrade, controller replacement, major configuration changes, EOL migration |

**Process:**
1. Storage Admin creates detailed RFC with:
   - AIQwhisper finding and risk assessment
   - Detailed implementation plan with timeline
   - Tested rollback procedure
   - Impact analysis
   - Communication plan
2. RFC submitted to CAB for review
3. CAB approval obtained (or Emergency Change Manager for P1 incidents)
4. Maintenance window communicated to all stakeholders
5. Pre-change backup/snapshot taken
6. Implementation with real-time monitoring
7. Post-implementation verification (AIQwhisper re-scan)
8. Post-Implementation Review (PIR) within 5 business days

### Change Record Template

```
== Change Request ==
Source:           AIQwhisper Finding [finding-id]
Rule:             [rule-id] - [rule-name]
Platform:         [ONTAP|StorageGRID|E-Series]
System:           [system-name]
Risk Level:       [Low|Medium|High]
ITIL Priority:    [P1|P2|P3|P4]

== Change Details ==
Description:      [From rule description]
Justification:    [From rule impact]
Implementation:   [From remediation_steps]
Maintenance Window: [Required/Not Required]
Estimated Duration: [X hours]

== Risk Assessment ==
Change Risk:      [From change_risk]
Impact if Failed: [Description]
Rollback Plan:    [Detailed steps]
Test Plan:        [Verification steps]

== Approvals ==
Change Manager:   [Name] — [Date]
CAB (if required): [Date] — [Outcome]

== Post-Implementation ==
Health Score Before: [Score]
Health Score After:  [Score]
Finding Resolved:    [Yes/No]
PIR Date:            [Date]
```

---

## Escalation Matrix

### Internal Escalation

| Level | Trigger | Escalation To | Response Time | Actions |
|---|---|---|---|---|
| **L1** | P3/P4 finding detected | Storage Admin | 4 hours | Triage, assess, begin remediation |
| **L2** | P2 finding, or P3/P4 not resolved in 24h | Infra Manager | 1 hour | Review, assign resources, coordinate teams |
| **L3** | P1 finding, or P2 not resolved in 8h | Infra Manager + Management | 15 minutes | War room, all hands, NetApp Support engaged |
| **L4** | Multiple P1s, or site-level outage | VP/Director of IT | Immediate | Executive communication, business continuity activation |

### NetApp Support Escalation

#### When to Open a NetApp Support Case

| Scenario | NetApp Severity | Required Information |
|---|---|---|
| **Controller offline/failed** | Severity 1 | Serial number, error codes, AutoSupport data |
| **Multiple drive failures** (same pool/drawer) | Severity 1 | Array serial, drive locations, MEL events |
| **Data loss or corruption suspected** | Severity 1 | Array serial, affected volumes, error messages |
| **Node offline (won't recover)** | Severity 1 | Node serial, grid topology, error logs |
| **Firmware update failure** | Severity 2 | Array/node serial, firmware versions, error output |
| **Performance degradation (unexplained)** | Severity 2 | Performance data, AutoSupport, recent changes |
| **Reconstruction/repair stalled** | Severity 2 | Array serial, event logs, progress status |
| **Capacity emergency** | Severity 2 | Utilization data, growth rate, current capacity |
| **Certificate/auth issues** | Severity 3 | Error messages, certificate details |
| **Upgrade planning assistance** | Severity 3 | Current versions, target versions, environment details |
| **Configuration best practice review** | Severity 4 | Current configuration, environment details |

#### NetApp Support Severity Levels and SLA

| NetApp Severity | Definition | Target Response Time | Target Update Frequency |
|---|---|---|---|
| **Severity 1** | Production system down or at imminent risk of going down | 1 hour (24/7) | Every 2 hours |
| **Severity 2** | Production system severely degraded | 4 business hours | Daily |
| **Severity 3** | Production system moderately impacted | 8 business hours | Weekly |
| **Severity 4** | Request for information or minor issue | Next business day | As needed |

**Escalation within NetApp Support:**
1. If no response within target time → Request escalation via support portal
2. If resolution not progressing → Request Escalation Manager assignment
3. For Severity 1 beyond 8 hours → Contact NetApp Account Team for executive escalation

---

## Runbook Templates

### Runbook 1: Critical Hardware Failure Response

```
== RUNBOOK: Critical Hardware Failure Response ==
Trigger Rules:  es-avail-001, es-avail-003, es-avail-005, es-avail-006, es-avail-007
ITIL Priority:  P1
Target Time:    4 hours to resolution

== STEP 1: Initial Assessment (0-15 minutes) ==
[ ] Identify affected system and component from AIQwhisper finding
[ ] Verify alert via SANtricity System Manager or ONTAP System Manager
[ ] Assess impact: What volumes/LUNs/shares are affected?
[ ] Check for redundancy: Is the system still serving I/O?
[ ] Notify Infra Manager

== STEP 2: Incident Logging (15-30 minutes) ==
[ ] Create P1 incident ticket in ITSM
[ ] Populate with AIQwhisper finding details
[ ] Add affected services and business impact
[ ] Send stakeholder notification

== STEP 3: Immediate Mitigation (30-60 minutes) ==
[ ] If controller failure: Verify partner controller has taken over
[ ] If drive failure: Verify reconstruction started on hot spare
[ ] If PSU/fan failure: Verify redundant component operational
[ ] Monitor component temperatures and status
[ ] Redirect workloads if necessary

== STEP 4: NetApp Support Engagement (within 1 hour) ==
[ ] Open Severity 1 case at support.netapp.com
[ ] Provide: Serial number, component ID, error codes, AutoSupport reference
[ ] Request hardware dispatch if replacement needed
[ ] Document case number in incident ticket

== STEP 5: Resolution & Recovery ==
[ ] Replace failed component (when dispatched)
[ ] Verify system returns to optimal state
[ ] Monitor for 24 hours post-replacement
[ ] Run AIQwhisper re-analysis to confirm resolution

== STEP 6: Closure ==
[ ] Update incident ticket with resolution details
[ ] Verify health score improvement
[ ] Schedule Post-Incident Review
[ ] Update CMDB if hardware changed
```

### Runbook 2: Firmware Update Process

```
== RUNBOOK: Firmware Update Process ==
Trigger Rules:  es-fw-001 through es-fw-006, sg-fw-001 through sg-fw-004, ontap-fw-*
ITIL Priority:  P3/P4 (planned), P2 (security patch)
Change Risk:    High

== PRE-CHANGE PHASE ==

Step 1: Planning (1-2 weeks before)
[ ] Review AIQwhisper finding for affected systems
[ ] Download firmware from mysupport.netapp.com
[ ] Verify firmware compatibility matrix
[ ] Review release notes for known issues
[ ] Identify rollback procedure
[ ] Create RFC with full implementation plan
[ ] Submit RFC to CAB for approval

Step 2: Pre-Change Verification (1 day before)
[ ] Run AIQwhisper full analysis — document baseline health score
[ ] Verify all systems healthy (no degraded components)
[ ] Confirm backup/snapshot of management databases
[ ] Verify maintenance window communicated
[ ] Confirm rollback firmware available
[ ] Test management connectivity to all target systems

== CHANGE PHASE ==

Step 3: Execution (during maintenance window)
[ ] Send "change started" notification
[ ] For E-Series SANtricity OS:
    - SANtricity System Manager > Upgrade Center
    - OR CLI: SMcli -n <array> -c 'download storageArray firmware file="filename"'
    - Monitor rolling controller upgrade (one at a time)
[ ] For E-Series Drive Firmware:
    - CLI: SMcli -n <array> -c 'download drive firmware file="filename"'
    - Non-disruptive with DDP; schedule window for RAID groups
[ ] For StorageGRID:
    - Grid Manager > MAINTENANCE > Software update
    - Follow upgrade prerequisites checklist
    - Upgrade proceeds node-by-node
[ ] For ONTAP:
    - System Manager > Cluster > Overview > Update
    - OR CLI: cluster image update
    - Automated rolling update (ANDU)
[ ] Monitor progress continuously
[ ] Verify each node/controller returns to service

Step 4: Post-Change Verification (immediately after)
[ ] Verify all systems operational
[ ] Check firmware versions match target
[ ] Run AIQwhisper re-analysis
[ ] Compare health score to baseline
[ ] Verify no new alerts generated
[ ] Send "change completed" notification

== POST-CHANGE PHASE ==

Step 5: Monitoring (24-72 hours)
[ ] Monitor system performance for anomalies
[ ] Check for any new alerts or errors
[ ] Verify workload performance unchanged

Step 6: Closure
[ ] Update change record with results
[ ] Close AIQwhisper finding if resolved
[ ] Update CMDB with new firmware versions
[ ] Schedule PIR if any issues occurred
```

### Runbook 3: Capacity Threshold Response

```
== RUNBOOK: Capacity Threshold Response ==
Trigger Rules:  es-cap-001/002, sg-cap-001/002, ontap-cap-*
ITIL Priority:  P3 (warning) / P1 (critical)

== FOR WARNING THRESHOLD (>85%) ==

Step 1: Assessment
[ ] Review AIQwhisper capacity finding
[ ] Identify affected system, pool/aggregate, current utilization
[ ] Check growth trend from historical data
[ ] Calculate runway (days until critical threshold)

Step 2: Short-Term Actions
[ ] Identify and remove orphaned/unused volumes or objects
[ ] Review and optimize snapshot policies
[ ] Enable storage efficiency (dedup, compression) if not already
[ ] Check for and clean up stale data

Step 3: Medium-Term Planning
[ ] Create capacity expansion plan with timeline
[ ] Obtain budget approval for additional storage
[ ] Order hardware if needed (typical lead time: 2-4 weeks)
[ ] Create change request for capacity expansion

== FOR CRITICAL THRESHOLD (>95%) ==

Step 1: Immediate Actions (within 1 hour)
[ ] Create P1 incident ticket
[ ] Identify largest consumers of space
[ ] Delete any clearly unnecessary data (with approval)
[ ] Suspend non-critical data ingestion if possible

Step 2: Emergency Expansion
[ ] If spare drives available: Add to pool/aggregate immediately
[ ] If no spare drives: Contact NetApp for emergency hardware
[ ] Open support case for capacity guidance
[ ] Communicate to stakeholders: projected time to full

Step 3: Post-Crisis
[ ] Implement capacity monitoring improvements
[ ] Establish earlier warning thresholds
[ ] Review and update capacity planning processes
[ ] Schedule Post-Incident Review
```

### Runbook 4: Security Finding Response

```
== RUNBOOK: Security Finding Response ==
Trigger Rules:  es-sec-*, sg-sec-*, ontap-sec-*
ITIL Priority:  Varies (P1 for expired certs, P3-P4 for config gaps)

== FOR CERTIFICATE EXPIRY ==

Step 1: Assessment
[ ] Identify certificate type and affected services
[ ] Check expiry date and remaining time
[ ] Determine if CA-signed or self-signed
[ ] Identify all systems using this certificate

Step 2: Certificate Renewal
[ ] For CA-signed certificates:
    - Generate CSR from storage system
    - Submit CSR to internal CA
    - Obtain renewed certificate
    - Install certificate and verify chain
[ ] For self-signed certificates:
    - Regenerate certificate with appropriate validity period
    - Update all trusting systems
[ ] Schedule maintenance window for certificate rotation
[ ] Test client connectivity after rotation

== FOR AUTHENTICATION/AUTHORIZATION ==

Step 1: Gap Assessment
[ ] Review AIQwhisper security findings
[ ] Compare against security baseline/policy
[ ] Prioritize findings by risk

Step 2: Remediation
[ ] Configure LDAP/AD integration per security policy
[ ] Enable SSO where supported and required
[ ] Rotate local admin passwords
[ ] Enable and configure audit logging
[ ] Forward audit logs to SIEM

Step 3: Verification
[ ] Run AIQwhisper re-analysis
[ ] Perform access testing
[ ] Document security posture improvement
[ ] Report to Security Team
```

### Runbook 5: Node/Controller Failover Response

```
== RUNBOOK: Node/Controller Failover Response ==
Trigger Rules:  ontap-avail-*, es-avail-001, es-avail-002, sg-avail-001
ITIL Priority:  P1
Target Time:    1 hour to stabilize, 4 hours to resolve

== STEP 1: Confirm Failover Status ==
[ ] ONTAP: System Manager > HA Status; CLI: storage failover show
[ ] E-Series: SANtricity System Manager > Hardware > Controllers
[ ] StorageGRID: Grid Manager > NODES
[ ] Identify: Is the partner/surviving controller handling I/O?
[ ] Verify: Are all volumes/LUNs accessible?

== STEP 2: Impact Assessment ==
[ ] Check application connectivity
[ ] Verify multipath is functioning (host side)
[ ] Monitor performance on surviving controller (watch for overload)
[ ] Document affected services

== STEP 3: Root Cause Investigation ==
[ ] Check system event logs and coredumps
[ ] Review environmental conditions (temperature, power)
[ ] Check for recent changes that may have caused the failure
[ ] Collect AutoSupport/support bundle

== STEP 4: Recovery ==
[ ] If software issue: Attempt node/controller boot
[ ] If hardware issue: Open NetApp Support Severity 1 case
[ ] For ONTAP: storage failover giveback (when safe)
[ ] For E-Series: Controller replacement via NetApp field service
[ ] Monitor recovery process

== STEP 5: Post-Recovery ==
[ ] Verify all volumes redistributed correctly
[ ] Run AIQwhisper re-analysis
[ ] Monitor for 24 hours
[ ] Schedule Post-Incident Review
[ ] Update CMDB and documentation
```

---

## Appendix

### A. Glossary of Terms

| Term | Definition |
|---|---|
| **AIQwhisper** | Automated Infrastructure Quality analysis tool for NetApp storage |
| **AutoSupport** | NetApp telemetry data collection and reporting system |
| **CAB** | Change Advisory Board — reviews and approves high-risk changes |
| **CMDB** | Configuration Management Database — central repository of IT assets |
| **DDP** | Dynamic Disk Pools — E-Series distributed data protection scheme |
| **HA** | High Availability — redundant controller configuration |
| **ILM** | Information Lifecycle Management — StorageGRID data placement policy |
| **ITSM** | IT Service Management — framework for managing IT services |
| **MEL** | Major Event Log — E-Series hardware event logging |
| **PIR** | Post-Implementation Review — post-change assessment |
| **RACI** | Responsible, Accountable, Consulted, Informed — stakeholder matrix |
| **RFC** | Request for Change — formal change proposal |
| **SLA** | Service Level Agreement — agreed service performance targets |

### B. Related Documents

| Document | Location | Purpose |
|---|---|---|
| ONTAP Rules | `src/analysis/rules/ontap-rules.json` | ONTAP best-practice analysis rules |
| StorageGRID Rules | `src/analysis/rules/storagegrid-rules.json` | StorageGRID best-practice analysis rules |
| E-Series Rules | `src/analysis/rules/eseries-rules.json` | E-Series best-practice analysis rules |
| Architecture Guide | `docs/ARCHITECTURE.md` | System architecture documentation |
| API Documentation | `docs/API.md` | REST API reference |
| Deployment Guide | `docs/DEPLOYMENT.md` | Installation and deployment procedures |

### C. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 2.0 | 2026-07-15 | AIQwhisper Team | Complete rewrite with expanded ITIL v4 alignment, runbook templates, and stakeholder matrix |
| 1.0 | 2026-06-01 | AIQwhisper Team | Initial ITIL alignment document |

---

*This document is maintained by the AIQwhisper engineering team. For questions or suggestions, contact the team via the project repository.*
