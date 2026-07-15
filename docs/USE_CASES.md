# 🎯 AIQwhisper — Use Cases

> Real-world scenarios and workflows for AIQwhisper in production environments.

---

## Table of Contents

1. [MSP Fleet Management](#1-msp-fleet-management)
2. [Air-Gapped Datacenter](#2-air-gapped-datacenter)
3. [Capacity Planning](#3-capacity-planning)
4. [Compliance & Auditing](#4-compliance--auditing)
5. [Incident Investigation](#5-incident-investigation)
6. [Upgrade Planning](#6-upgrade-planning)
7. [Executive Reporting](#7-executive-reporting)
8. [Custom Integration](#8-custom-integration)
9. [Multi-Platform Monitoring](#9-multi-platform-monitoring)
10. [Predictive Maintenance](#10-predictive-maintenance)

---

## 1. MSP Fleet Management

### Scenario

A Managed Service Provider (MSP) manages storage infrastructure for 25 customers across 55+ NetApp systems. The portfolio includes a mix of ONTAP clusters (35), E-Series arrays (15), and StorageGRID grids (5). Each customer has unique SLA requirements, and the MSP's operations team of 4 engineers needs a unified view of fleet health to prioritize their daily work.

Currently, the team manually logs into individual system management consoles — System Manager for ONTAP, SANtricity for E-Series, and Grid Manager for StorageGRID. There is no single pane of glass for the mixed-platform environment, and generating monthly customer reports requires hours of manual data aggregation from multiple sources.

The MSP deploys a single AIQwhisper instance on an internal management server. All 55 systems are registered via the API, with each system tagged by customer name. The operations team uses the dashboard for daily triage and generates automated reports for monthly customer deliverables.

### Challenge

- No unified monitoring tool exists that covers ONTAP, StorageGRID, and E-Series simultaneously
- AIQUM doesn't support E-Series and has limited StorageGRID integration
- Manual reporting takes 8+ hours per month across all customers
- Critical issues on less-visited systems go unnoticed for days

### Solution with AIQwhisper

AIQwhisper serves as the unified monitoring layer across all three platforms, providing a single health score per system, automated issue detection with 60+ rules, and one-click report generation.

### Workflow Steps

1. **Register all customer systems** via the API with descriptive naming (`customer-system-type`)
2. **Configure collection intervals** — 15-minute inventory, 5-minute performance for Tier 1 customers
3. **Monitor the dashboard daily** — sort by health score to see the most critical systems first
4. **Investigate issues** flagged by the rules engine — each issue includes remediation steps
5. **Generate monthly customer reports** — health summary, firmware currency, capacity projections
6. **Track firmware currency** — identify systems running EOL software before customer SLA reviews

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `POST /api/systems` | Register each customer's systems |
| `GET /api/dashboard/summary` | Daily fleet health overview |
| `GET /api/issues?severity=critical` | Priority triage of critical issues |
| `POST /api/reports/generate` | Monthly customer report generation |
| `GET /api/learning/catalog` | Firmware currency checks |
| `GET /api/capacity/projections` | Proactive capacity alerts |

### Sample API Call

```bash
# Generate a health summary report for Customer A's systems
curl -X POST http://localhost:3080/api/reports/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "health-summary",
    "system_ids": [1, 2, 3, 4],
    "from": "2026-06-01T00:00:00Z",
    "to": "2026-06-30T23:59:59Z"
  }'
```

### Deliverables

- **Daily**: Fleet health dashboard with prioritized issue list
- **Monthly**: Per-customer health scorecard, firmware currency report, and capacity projection summary
- **Quarterly**: Executive risk assessment across the entire customer portfolio

### Key Benefits

- ✅ Single pane of glass for all 3 NetApp platforms — no other tool provides this
- ✅ Automated report generation saves 8+ hours per month
- ✅ Health scoring enables objective SLA tracking
- ✅ Proactive issue detection reduces customer-facing incidents
- ✅ Lightweight deployment — runs on the existing management server

---

## 2. Air-Gapped Datacenter

### Scenario

A government defense agency operates a classified datacenter running 12 ONTAP clusters and 4 E-Series arrays. The environment is completely air-gapped — no internet connectivity is permitted. All management tools must function entirely offline, and no data can leave the network boundary.

Traditional monitoring tools like NetApp Active IQ Cloud require internet connectivity for telemetry analysis, and AIQUM's auto-support features assume cloud access for full functionality. The storage team needs a monitoring solution that works entirely within the isolated network.

AIQwhisper's zero-dependency architecture is ideal for this environment. With `AUTO_LEARN_ENABLED=false`, it operates fully offline while still providing comprehensive monitoring, health scoring, and best-practice analysis.

### Challenge

- Strict air-gap policy: zero outbound internet connections allowed
- Cloud-dependent monitoring tools (Active IQ Cloud) are completely unusable
- AIQUM works but is heavyweight and its auto-support/cloud features are non-functional
- Manual monitoring of 16 systems is time-consuming and error-prone

### Solution with AIQwhisper

AIQwhisper runs entirely on-premises with no cloud dependencies. The auto-learning engine is disabled, and EOL/version data is manually imported from a connected system on a periodic basis via a secure data transfer mechanism (e.g., data diode, approved media).

### Workflow Steps

1. **Install AIQwhisper** on an approved management server within the classified network
2. **Configure for air-gapped operation**:
   ```ini
   AUTO_LEARN_ENABLED=false
   BIND_ADDRESS=10.100.0.50
   REJECT_UNAUTHORIZED=false
   ```
3. **Register all 16 systems** using the API or web UI
4. **Manually import the EOL catalog** from a connected reference system (periodic update via approved media)
5. **Run daily health checks** using the dashboard
6. **Generate security posture reports** for compliance reviews

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `POST /api/systems` | Register isolated systems |
| `GET /api/dashboard/summary` | Daily health overview |
| `GET /api/issues` | Best-practice analysis results |
| `GET /api/recommendations` | Security and configuration recommendations |
| `POST /api/learning/update` | Manual catalog import |
| `POST /api/reports/generate` | Compliance and security reports |

### Sample API Call

```bash
# Import EOL catalog data (transferred from connected system)
curl -X POST http://localhost:3080/api/learning/update \
  -H 'Content-Type: application/json' \
  -d @/secure-import/eol-catalog-20260701.json

# Generate a security posture report
curl -X POST http://localhost:3080/api/reports/generate \
  -H 'Content-Type: application/json' \
  -d '{"type": "security-posture"}'
```

### Deliverables

- **Daily**: Automated health checks without internet connectivity
- **Weekly**: Issue and recommendation review reports
- **Monthly**: Security posture and compliance reports for accreditation reviews
- **Periodic**: Manually updated EOL catalog for software currency analysis

### Key Benefits

- ✅ 100% air-gapped operation — no internet connectivity required
- ✅ No cloud telemetry or data exfiltration risk
- ✅ Manual EOL catalog updates via secure transfer maintain software currency awareness
- ✅ Minimal footprint — approved on resource-constrained management networks
- ✅ Full audit trail of all collected data stored locally

---

## 3. Capacity Planning

### Scenario

An enterprise storage team manages 20 ONTAP clusters with over 800 volumes supporting production databases, file shares, and virtualization workloads. The team performs quarterly capacity reviews to plan storage purchases and prevent outages from full aggregates. Historically, capacity planning was done using spreadsheets populated with manual exports from System Manager.

The CFO has demanded more accurate procurement forecasting — last year, an emergency purchase was needed because growth projections from simple linear estimates were unreliable. The team needs statistical confidence scoring to distinguish between predictable steady-state growth and erratic consumption patterns.

AIQwhisper's built-in linear regression with R² confidence scoring provides exactly this capability — identifying which projections are reliable (high R²) and which should be treated with caution (low R²).

### Challenge

- Manual spreadsheet-based capacity planning is error-prone and time-consuming
- Simple "days-to-full" calculations don't account for growth patterns
- No confidence scoring — impossible to distinguish reliable vs. unreliable projections
- Emergency purchases indicate current forecasting is inadequate

### Solution with AIQwhisper

AIQwhisper collects capacity data every 15 minutes and stores up to 6 months of historical trends. The capacity projection engine runs linear regression on this data, producing days-to-full estimates at 85%, 90%, 95%, and 100% thresholds, along with R² confidence scores. Resources with R² > 0.8 have highly predictable growth patterns; those below 0.5 have erratic consumption and require manual investigation.

### Workflow Steps

1. **Ensure 30+ days of historical capacity data** — AIQwhisper needs a baseline for accurate projections
2. **Pull capacity projections** for all aggregates and volumes
3. **Sort by days-to-full** to identify the most urgent capacity constraints
4. **Filter by R² score** to separate reliable projections from unreliable ones
5. **Investigate low-R² resources** — often caused by irregular data loads, test environments, or cleanup operations
6. **Generate a capacity planning report** for the procurement team
7. **Present right-sizing recommendations** — over-provisioned resources can offset new purchases

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/capacity/projections` | Days-to-full projections with R² scores |
| `GET /api/capacity/trends` | Historical capacity trend data |
| `GET /api/inventory/aggregates` | Current aggregate sizes and utilization |
| `GET /api/inventory/volumes` | Volume-level capacity data |
| `POST /api/reports/generate` | Capacity planning report |

### Sample API Call

```bash
# Get projections sorted by nearest to full, filtered to 90% threshold
curl "http://localhost:3080/api/capacity/projections?threshold=90&sort_by=days_to_full&sort_order=asc&limit=20"
```

**Sample Response:**

```json
{
  "success": true,
  "data": [
    {
      "system_name": "prod-ontap-01",
      "resource_name": "aggr1_data",
      "utilization_pct": 91.0,
      "growth_rate_gb_per_month": 72.0,
      "projections": {
        "days_to_95_pct": 42,
        "days_to_100_pct": 89
      },
      "regression": {
        "r_squared": 0.94,
        "confidence": "high"
      }
    }
  ]
}
```

### Deliverables

- **Quarterly**: Capacity planning report with projections, confidence scores, and procurement recommendations
- **Monthly**: Automated alerting on resources approaching capacity thresholds
- **Ad-hoc**: Right-sizing analysis identifying over-provisioned resources

### Key Benefits

- ✅ R² confidence scoring separates reliable projections from guesswork
- ✅ 6-month trend data provides accurate growth rate calculations
- ✅ Automated report generation replaces 2+ days of manual spreadsheet work
- ✅ Right-sizing analysis can offset or defer procurement spending
- ✅ Multiple threshold projections (85/90/95/100%) support tiered response planning

---

## 4. Compliance & Auditing

### Scenario

A financial services company must comply with PCI-DSS, SOX, and internal security policies. The internal audit team conducts semi-annual reviews of all IT infrastructure, including the 10 ONTAP clusters and 3 StorageGRID grids that store customer financial data. The audit requires evidence of software currency (no EOL software), security configuration compliance (encryption, FIPS, authentication), and data protection coverage (snapshots, replication).

Previously, the storage team spent 2 weeks preparing audit evidence — manually collecting screenshots, CLI outputs, and configuration exports from every system. The evidence package was assembled in a shared folder with hundreds of files that auditors struggled to navigate.

### Challenge

- Semi-annual audits require 2 weeks of manual evidence preparation
- Evidence is scattered across screenshots, CLI outputs, and spreadsheets
- No automated way to verify security configurations across all systems
- Software currency checks require manual comparison with NetApp EOL announcements

### Solution with AIQwhisper

AIQwhisper's built-in rules engine covers security, software currency, and data protection best practices. The auto-learning engine automatically maintains an up-to-date EOL catalog, so software currency checks are always current. Reports can be generated on demand with a single API call, providing structured, machine-readable audit evidence.

### Workflow Steps

1. **Ensure the auto-learning catalog is current** — verify the latest EOL data is loaded
2. **Run a fresh collection** on all systems before the audit
3. **Generate a security posture report** — covers encryption, authentication, FIPS, and network security settings
4. **Generate a firmware currency report** — identifies systems running EOL or near-EOL software
5. **Generate an issue summary** — shows all open compliance-related findings
6. **Pull SnapMirror and snapshot inventory** — evidence of data protection coverage
7. **Package all reports** and provide to the audit team

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `POST /api/reports/generate` (type: `security-posture`) | Security configuration audit |
| `POST /api/reports/generate` (type: `firmware-currency`) | Software version analysis |
| `GET /api/issues?category=security` | Open security issues |
| `GET /api/recommendations?category=security` | Security best-practice recommendations |
| `GET /api/inventory/snapmirror` | Data replication coverage |
| `GET /api/learning/catalog?type=eol` | EOL status verification |

### Sample API Call

```bash
# Generate security posture report for all systems
curl -X POST http://localhost:3080/api/reports/generate \
  -H 'Content-Type: application/json' \
  -d '{"type": "security-posture"}'

# Check for systems running EOL software
curl "http://localhost:3080/api/learning/catalog?product=ontap&type=eol" | \
  jq '.data[] | select(.status == "end-of-life")'
```

### Deliverables

- **Semi-annual**: Complete audit evidence package with structured reports
- **On-demand**: Security posture snapshot for ad-hoc compliance reviews
- **Continuous**: Automated detection of compliance drift (new security issues, EOL transitions)

### Key Benefits

- ✅ Audit preparation reduced from 2 weeks to 2 hours
- ✅ Structured, consistent report format across all systems
- ✅ Automated EOL tracking eliminates manual comparison with NetApp announcements
- ✅ 60+ best-practice rules cover security, protection, and configuration compliance
- ✅ Historical evidence — AIQwhisper stores 6 months of data for trend analysis

---

## 5. Incident Investigation

### Scenario

At 3:47 AM, the on-call engineer receives alerts about slow database queries from the application monitoring system. The Oracle DBA team reports that I/O latency on their primary database volume has spiked from a typical 1.2ms to over 15ms. The volume is hosted on an ONTAP cluster, and the DBA team suspects a storage infrastructure issue.

The on-call engineer needs to quickly determine whether the root cause is storage-related, correlate the performance degradation with other events, and identify whether other workloads were affected. Without AIQwhisper, this investigation would require logging into System Manager, navigating to the performance counters, and manually exporting data to correlate events — a process that takes 30+ minutes and provides limited historical context.

### Challenge

- Real-time troubleshooting under pressure — SLA clock is ticking
- Need to correlate volume latency with system-wide events (aggregate, disk, node-level)
- Historical context is critical — was this a gradual degradation or sudden spike?
- Need to determine blast radius — were other volumes/applications affected?

### Solution with AIQwhisper

AIQwhisper's 6-month performance history with 5-minute granularity provides immediate forensic data. The API enables rapid multi-level investigation — system, aggregate, volume, and disk performance data can be queried in parallel. The event log provides a correlated timeline of what happened on the storage system.

### Workflow Steps

1. **Check the volume's performance history** — identify when latency started increasing
2. **Correlate with aggregate performance** — determine if the aggregate hosting the volume is impacted
3. **Check disk-level metrics** — look for failing or slow disks
4. **Review the event log** — look for related events around the incident time
5. **Check other volumes on the same aggregate** — determine blast radius
6. **Check node CPU and WAFL metrics** — look for system-level bottlenecks
7. **Document the timeline** and root cause for the post-incident review

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/performance/:id/volume?resource_id=<vol>` | Volume latency and IOPS timeline |
| `GET /api/performance/:id/aggregate` | Aggregate I/O performance |
| `GET /api/performance/:id/disk` | Disk-level busy and latency |
| `GET /api/performance/:id/processor` | Node CPU utilization |
| `GET /api/performance/:id/wafl` | WAFL layer statistics |
| `GET /api/events?system_id=1&from=...&to=...` | Correlated event timeline |

### Sample API Call

```bash
# Get volume latency data around the incident time
curl "http://localhost:3080/api/performance/1/volume?resource_id=vol_prod_db01&from=2026-07-15T02:00:00Z&to=2026-07-15T06:00:00Z&interval=raw"

# Check disk performance for the same period
curl "http://localhost:3080/api/performance/1/disk?from=2026-07-15T02:00:00Z&to=2026-07-15T06:00:00Z&interval=raw"

# Review events around the incident
curl "http://localhost:3080/api/events?system_id=1&from=2026-07-15T03:00:00Z&to=2026-07-15T05:00:00Z"
```

### Deliverables

- **Immediate**: Root cause identification and blast radius assessment
- **Post-incident**: Documented timeline with performance data for the incident review
- **Follow-up**: Recommendations to prevent recurrence

### Key Benefits

- ✅ 6-month performance history at 5-minute granularity — no data gaps
- ✅ Multi-level correlation (volume → aggregate → disk → system) via API
- ✅ Event log provides correlated timeline of storage system events
- ✅ API-first design enables rapid scripted investigations
- ✅ Historical context distinguishes gradual degradation from sudden spikes

---

## 6. Upgrade Planning

### Scenario

A large enterprise is planning ONTAP upgrades across 20 clusters over the next 12 months. The clusters run a mix of ONTAP versions (9.10.1 through 9.14.1), and some are approaching end-of-life dates. The upgrade planning team needs to prioritize which clusters to upgrade first, identify version compatibility paths, and ensure hardware model compatibility with target software versions.

The team has been tracking versions in a spreadsheet, but it's always outdated because checking each cluster's version requires logging into System Manager individually. When NetApp announces new EOL dates, someone has to manually update the spreadsheet — this has led to missed deadlines in the past.

### Challenge

- Manual version tracking across 20 clusters is perpetually out of date
- EOL announcements are missed, leading to compliance gaps
- Upgrade prioritization is subjective without a clear risk framework
- Hardware compatibility with target ONTAP versions needs verification

### Solution with AIQwhisper

AIQwhisper's auto-learning engine automatically pulls EOL data from the endoflife.date API. Combined with real-time inventory collection, it always has an accurate view of which versions are running on which clusters and how close they are to EOL. The firmware currency report highlights upgrade priorities.

### Workflow Steps

1. **Review the learning catalog** — check for the latest EOL data
2. **Generate a firmware currency report** — see all systems with version status
3. **Identify systems running EOL software** — these are the highest priority
4. **Identify systems approaching EOL** — plan upgrades before the deadline
5. **Cross-reference hardware models** — verify compatibility with target versions
6. **Build an upgrade schedule** prioritized by risk (EOL → near-EOL → current)
7. **Generate baseline performance data** before upgrades for comparison

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/learning/catalog?type=eol` | EOL dates for all ONTAP versions |
| `POST /api/reports/generate` (type: `firmware-currency`) | Comprehensive version analysis |
| `GET /api/systems` | Current versions and models across the fleet |
| `GET /api/inventory/clusters` | Detailed cluster configuration |
| `GET /api/inventory/nodes` | Node hardware models and firmware |
| `GET /api/performance/:id/system` | Pre-upgrade baseline performance |

### Sample API Call

```bash
# Get firmware currency report
curl -X POST http://localhost:3080/api/reports/generate \
  -H 'Content-Type: application/json' \
  -d '{"type": "firmware-currency"}'

# List all systems with their versions
curl "http://localhost:3080/api/systems?type=ontap&sort_by=version&sort_order=asc" | \
  jq '.data[] | {name, version, model, health_score}'
```

### Deliverables

- **Immediate**: Prioritized upgrade list based on EOL proximity and risk
- **Planning**: Upgrade schedule with version compatibility paths
- **Post-upgrade**: Performance comparison reports (before vs. after)

### Key Benefits

- ✅ Automatic EOL tracking — no more missed NetApp announcements
- ✅ Instant fleet-wide version inventory — always current
- ✅ Risk-based upgrade prioritization — EOL systems flagged automatically
- ✅ Pre/post-upgrade performance comparison with historical data
- ✅ Hardware model inventory for compatibility verification

---

## 7. Executive Reporting

### Scenario

The VP of Infrastructure needs a quarterly board presentation on the health and risk posture of the company's storage infrastructure. The audience is non-technical — they want to see a simple health score, key risks, capacity runway, and whether the team is on top of issues. The presentation needs to convey confidence that the storage infrastructure is well-managed and that procurement decisions are data-driven.

The storage team has historically assembled these presentations manually, spending days pulling data from multiple tools and creating custom charts in PowerPoint. The VP has requested that the data be consistent, objective, and generated from a single source of truth.

### Challenge

- Non-technical audience requires simplified, visual metrics
- Manual report creation takes 2+ days per quarter
- Data comes from multiple disconnected tools — inconsistency risk
- VP wants objective health scoring, not subjective assessments

### Solution with AIQwhisper

AIQwhisper's executive overview report provides exactly what's needed: a composite health score, capacity summary with growth projections, risk assessment, and performance highlights — all from a single API call. The health score is objective and algorithmic, computed from weighted factors including issues, capacity, software currency, data protection, performance, and security.

### Workflow Steps

1. **Generate the executive overview report** covering the quarter
2. **Extract the key metrics**: overall health score, capacity utilization, top risks
3. **Pull health score trends** — show improvement or degradation over time
4. **Include capacity projections** — demonstrate proactive planning
5. **Highlight resolved issues** — demonstrate operational effectiveness
6. **Present risk heat map** — visual representation of system-level risk

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `POST /api/reports/generate` (type: `executive-overview`) | Quarterly executive summary |
| `POST /api/reports/generate` (type: `risk-heatmap`) | Visual risk assessment |
| `GET /api/dashboard/summary` | Current fleet status |
| `GET /api/capacity/projections` | Capacity runway summary |
| `GET /api/issues?status=resolved&from=...` | Issues resolved during the quarter |

### Sample API Call

```bash
# Generate executive overview for Q2 2026
curl -X POST http://localhost:3080/api/reports/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "executive-overview",
    "from": "2026-04-01T00:00:00Z",
    "to": "2026-06-30T23:59:59Z"
  }'
```

### Deliverables

- **Quarterly**: Executive overview report with health scores, capacity projections, and risk assessments
- **Board-ready**: Structured data suitable for direct inclusion in executive presentations
- **Trend data**: Quarter-over-quarter health score improvements

### Key Benefits

- ✅ One-click report generation replaces 2 days of manual work
- ✅ Objective health scoring — algorithmic, not subjective
- ✅ Board-appropriate metrics — simplified for non-technical audiences
- ✅ Historical trends demonstrate operational improvement
- ✅ Capacity projections support data-driven procurement decisions

---

## 8. Custom Integration

### Scenario

A DevOps team wants to integrate storage monitoring data into their existing observability stack. They use Grafana for dashboards, ServiceNow for ITSM, and PagerDuty for alerting. Rather than adding another standalone monitoring console, they want AIQwhisper to serve as the data source for storage metrics, with alerts flowing through their existing incident management workflow.

The team builds a custom integration layer that polls AIQwhisper's REST API at regular intervals, pushes metrics into their time-series database (Prometheus/InfluxDB), creates ServiceNow tickets for critical issues, and triggers PagerDuty alerts for health score drops.

### Challenge

- Multiple observability tools already in use — adding another console creates tool fatigue
- Storage metrics need to flow into the existing Grafana dashboards
- Critical issues should create ServiceNow tickets automatically
- Alert fatigue — only high-severity events should trigger PagerDuty

### Solution with AIQwhisper

AIQwhisper's full REST API is designed for exactly this integration pattern. Every piece of data — health scores, performance metrics, capacity projections, issues — is available via well-documented JSON endpoints. The consistent response format and pagination support make building integrations straightforward.

### Workflow Steps

1. **Design the integration architecture** — determine data flow and update frequency
2. **Build a Grafana data source** — poll AIQwhisper's performance and capacity endpoints
3. **Create a ServiceNow integration script** — monitor `/api/issues` for new critical issues
4. **Configure PagerDuty triggers** — alert on health score drops below threshold
5. **Set up a scheduled poller** (cron) to pull data every 5 minutes
6. **Test the integration** end-to-end with simulated events

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/dashboard/summary` | High-level metrics for Grafana overview panel |
| `GET /api/performance/:id/:type` | Detailed performance data for Grafana time-series |
| `GET /api/capacity/trends` | Capacity trend data for Grafana |
| `GET /api/issues?severity=critical&status=open` | New critical issues for ServiceNow tickets |
| `GET /api/systems` | Health scores for PagerDuty threshold alerts |
| `GET /health` | Monitoring AIQwhisper itself |

### Sample Integration Script

```bash
#!/bin/bash
# Poll AIQwhisper for critical issues and create ServiceNow tickets

AIQWHISPER_URL="http://localhost:3080"
SNOW_URL="https://instance.service-now.com/api/now/table/incident"
SNOW_AUTH="user:password"

# Get new critical issues
ISSUES=$(curl -s "$AIQWHISPER_URL/api/issues?severity=critical&status=open")
COUNT=$(echo "$ISSUES" | jq '.meta.total')

if [ "$COUNT" -gt 0 ]; then
  echo "$ISSUES" | jq -c '.data[]' | while read -r ISSUE; do
    TITLE=$(echo "$ISSUE" | jq -r '.title')
    SYSTEM=$(echo "$ISSUE" | jq -r '.system_name')
    
    # Create ServiceNow incident
    curl -s -X POST "$SNOW_URL" \
      -u "$SNOW_AUTH" \
      -H 'Content-Type: application/json' \
      -d "{
        \"short_description\": \"[Storage] $SYSTEM: $TITLE\",
        \"description\": $(echo "$ISSUE" | jq '.description'),
        \"urgency\": \"1\",
        \"category\": \"Storage\"
      }"
  done
fi
```

### Deliverables

- **Grafana dashboards**: Real-time storage performance and capacity metrics alongside compute/network data
- **ServiceNow tickets**: Automatically created for critical storage issues
- **PagerDuty alerts**: Triggered on health score drops or critical events
- **Unified observability**: Storage data integrated into the existing tool ecosystem

### Key Benefits

- ✅ Full REST API — every data point is accessible programmatically
- ✅ Consistent JSON response format simplifies integration development
- ✅ Pagination support handles large datasets efficiently
- ✅ No vendor lock-in — integrate with any tool that accepts JSON data
- ✅ CORS enabled — build web-based integrations from any origin

---

## 9. Multi-Platform Monitoring

### Scenario

A media and entertainment company uses all three NetApp platforms in their content production pipeline. ONTAP clusters provide high-performance NAS for video editing (NFS/SMB), StorageGRID serves as the object storage tier for long-term content archiving (S3), and E-Series arrays provide low-latency block storage for rendering farms (iSCSI/FC). The three platforms interact — content flows from ONTAP to StorageGRID for archival, and rendering jobs pull source material from ONTAP while writing to E-Series.

With three different management consoles and no cross-platform visibility, the team struggles to understand end-to-end content pipeline health. A capacity issue on StorageGRID can delay archival workflows, which in turn causes capacity pressure on ONTAP as content piles up.

### Challenge

- Three separate management consoles with no unified view
- Cross-platform dependencies mean issues on one platform affect others
- Capacity planning must consider the entire content pipeline, not individual platforms
- Different teams manage different platforms — communication gaps exist

### Solution with AIQwhisper

AIQwhisper is the only tool that provides native monitoring for all three NetApp platforms from a single instance. The unified dashboard, issue detection, and reporting span all platforms, enabling cross-platform correlation and holistic capacity planning.

### Workflow Steps

1. **Register all systems** — 5 ONTAP clusters, 2 StorageGRID grids, 3 E-Series arrays
2. **Monitor the unified dashboard** — health scores and capacity across all platforms
3. **Set up cross-platform capacity monitoring** — track ONTAP and StorageGRID capacity together
4. **Investigate cross-platform issues** — correlate ONTAP volume growth with StorageGRID archival rates
5. **Generate unified reports** covering all three platforms in a single document

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/dashboard/summary` | Unified cross-platform overview |
| `GET /api/systems?type=ontap` | ONTAP-specific health data |
| `GET /api/systems?type=storagegrid` | StorageGRID health data |
| `GET /api/systems?type=eseries` | E-Series health data |
| `GET /api/capacity/projections` | Cross-platform capacity projections |
| `GET /api/issues` | Issues across all platforms |
| `GET /api/inventory/s3-buckets` | StorageGRID archival bucket status |
| `GET /api/performance/:id/s3` | S3 ingest/retrieve performance |

### Sample API Call

```bash
# Get a unified view of all systems
curl "http://localhost:3080/api/dashboard/summary"

# Compare capacity across platforms
curl "http://localhost:3080/api/capacity/projections?sort_by=days_to_full&sort_order=asc"
```

### Deliverables

- **Real-time**: Unified dashboard covering ONTAP, StorageGRID, and E-Series
- **Cross-platform**: Correlated capacity and performance analysis across the content pipeline
- **Unified reporting**: Single report covering all 10 systems across 3 platforms

### Key Benefits

- ✅ Only monitoring tool with native support for ONTAP + StorageGRID + E-Series
- ✅ Unified health scoring enables cross-platform risk comparison
- ✅ Single API for querying data across all three platforms
- ✅ Eliminates context-switching between three separate management consoles
- ✅ Cross-platform capacity planning for end-to-end pipeline visibility

---

## 10. Predictive Maintenance

### Scenario

A healthcare organization runs 8 E-Series arrays supporting their medical imaging (PACS) system. These arrays are mission-critical — any unplanned downtime can delay patient diagnosis and treatment. The arrays contain hundreds of SSDs, and the storage team wants to proactively identify drives approaching end-of-life before they fail, replace controllers showing degradation trends, and predict capacity exhaustion before it impacts clinical workflows.

The team has experienced two unplanned outages in the past year due to simultaneous drive failures that exceeded the RAID protection level. Post-mortems revealed that the drives had been showing declining wear-life percentages for months, but nobody was tracking this metric across all arrays.

### Challenge

- Unplanned drive failures causing outages in a healthcare-critical environment
- No proactive tracking of SSD wear-life across hundreds of drives
- Controller health degradation trends not monitored
- Capacity exhaustion for PACS data can halt clinical imaging workflows

### Solution with AIQwhisper

AIQwhisper collects E-Series drive inventory including wear-life percentage, temperature, and error counts. The performance monitoring tracks controller-level metrics over time. Combined with capacity projections, the storage team gets a complete predictive maintenance picture — drives nearing end of wear life, controllers showing performance degradation, and capacity trends approaching thresholds.

### Workflow Steps

1. **Register all 8 E-Series arrays** in AIQwhisper
2. **Monitor drive wear-life inventory** — identify SSDs below 10% remaining life
3. **Track drive temperature trends** — elevated temperatures indicate potential problems
4. **Monitor controller performance** — watch for increasing latency or error rates
5. **Set up capacity projections** — predict when PACS storage needs expansion
6. **Generate monthly maintenance planning reports** for the clinical engineering team
7. **Proactively order replacement drives** based on wear-life trends

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/inventory/drives?system_id=...` | Drive wear-life, temperature, status |
| `GET /api/performance/:id/drive` | Drive I/O statistics and trends |
| `GET /api/performance/:id/controller` | Controller-level health metrics |
| `GET /api/capacity/projections?system_id=...` | PACS storage capacity runway |
| `GET /api/issues?system_id=...&category=availability` | Hardware issue alerts |
| `POST /api/reports/generate` (type: `health-summary`) | Monthly maintenance report |

### Sample API Call

```bash
# Find drives with less than 10% wear life remaining
curl "http://localhost:3080/api/inventory/drives?system_id=11" | \
  jq '.data[] | select(.wear_life_pct < 10) | {tray, slot, serial_number, wear_life_pct, model}'

# Check controller performance trends over the past month
curl "http://localhost:3080/api/performance/11/controller?from=2026-06-15T00:00:00Z&interval=daily"

# Get capacity projections for PACS storage pools
curl "http://localhost:3080/api/capacity/projections?system_id=11&resource_type=pool"
```

**Sample Drive Query Response:**

```json
[
  {
    "tray": 0,
    "slot": 14,
    "serial_number": "S4GANX0N789012",
    "wear_life_pct": 3,
    "model": "PX04SVB384"
  },
  {
    "tray": 1,
    "slot": 7,
    "serial_number": "S4GANX0N789456",
    "wear_life_pct": 8,
    "model": "PX04SVB384"
  }
]
```

### Deliverables

- **Monthly**: Drive wear-life report with replacement recommendations
- **Continuous**: Automated alerting on drives approaching end of wear life
- **Quarterly**: Capacity projection report for PACS storage planning
- **Proactive**: Controller health trend analysis identifying degradation patterns

### Key Benefits

- ✅ Proactive drive replacement prevents unplanned outages
- ✅ SSD wear-life tracking across hundreds of drives in a single view
- ✅ Controller performance trending identifies degradation before failure
- ✅ Capacity projections prevent clinical workflow disruptions
- ✅ Historical data provides evidence for maintenance planning and budgeting

---

## Next Steps

- **[Installation Guide](INSTALLATION.md)** — Get AIQwhisper running in your environment
- **[API Reference](API_REFERENCE.md)** — Complete endpoint documentation
- **[Comparison](COMPARISON.md)** — AIQwhisper vs AIQUM feature comparison

---

<p align="center">
  <sub>AIQwhisper v2.0.0 — Use Cases</sub>
</p>
