'use strict';

const { Router } = require('express');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');

const router = Router();

function nowUtc() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function hoursAgo(h) {
  return new Date(Date.now() - h * 3600000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function daysAgo(d) {
  return new Date(Date.now() - d * 86400000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

router.post('/seed', (req, res, next) => {
  try {
    const db = getDb();
    const now = nowUtc();
    const existing = db.prepare("SELECT id FROM systems WHERE name LIKE 'DEMO-%' LIMIT 1").get();
    if (existing) {
      return res.status(409).json({ error: 'Demo data already exists. Clear it first.' });
    }

    db.transaction(() => {
      const TB = 1099511627776;
      const GB = 1073741824;

      // SYSTEMS
      const s1 = db.prepare(`INSERT INTO systems (type,name,hostname,port,status,version,last_polled,created_at,updated_at) VALUES ('ontap','DEMO-ONTAP-Prod','ontap-prod.demo.local',443,'online','9.14.1',@now,@now,@now)`).run({now});
      const s2 = db.prepare(`INSERT INTO systems (type,name,hostname,port,status,version,last_polled,created_at,updated_at) VALUES ('ontap','DEMO-ONTAP-DR','ontap-dr.demo.local',443,'online','9.13.1P6',@now,@now,@now)`).run({now});
      const s3 = db.prepare(`INSERT INTO systems (type,name,hostname,port,status,version,last_polled,created_at,updated_at) VALUES ('storagegrid','DEMO-SG-Archive','sg-admin.demo.local',8443,'online','11.8.0',@now,@now,@now)`).run({now});
      const s4 = db.prepare(`INSERT INTO systems (type,name,hostname,port,status,version,last_polled,created_at,updated_at) VALUES ('eseries','DEMO-ESeries-SAN','eseries-san.demo.local',8443,'degraded','11.80.1',@now,@now,@now)`).run({now});

      const sys1=Number(s1.lastInsertRowid), sys2=Number(s2.lastInsertRowid), sys3=Number(s3.lastInsertRowid), sys4=Number(s4.lastInsertRowid);

      // ONTAP CLUSTERS
      const c1 = db.prepare(`INSERT INTO ontap_clusters (system_id,uuid,name,serial_number,version,management_ip,cluster_health,created_at,updated_at) VALUES (@sid,'a1b2c3d4-e5f6-7890-abcd-ef1234567890','ontap-prod-01','1-80-000123','9.14.1','10.0.1.10','ok',@now,@now)`).run({sid:sys1,now});
      const c2 = db.prepare(`INSERT INTO ontap_clusters (system_id,uuid,name,serial_number,version,management_ip,cluster_health,created_at,updated_at) VALUES (@sid,'b2c3d4e5-f6a7-8901-bcde-f12345678901','ontap-dr-01','1-80-000456','9.13.1P6','10.0.2.10','ok',@now,@now)`).run({sid:sys2,now});
      const cls1=Number(c1.lastInsertRowid), cls2=Number(c2.lastInsertRowid);

      // ONTAP NODES
      db.prepare(`INSERT INTO ontap_nodes (system_id,cluster_id,uuid,name,model,serial_number,uptime,is_healthy,created_at,updated_at) VALUES (@sid,@cid,'node-uuid-0001','ontap-prod-01-01','AFF-A400','SN-PROD-001',8640000,1,@now,@now)`).run({sid:sys1,cid:cls1,now});
      db.prepare(`INSERT INTO ontap_nodes (system_id,cluster_id,uuid,name,model,serial_number,uptime,is_healthy,created_at,updated_at) VALUES (@sid,@cid,'node-uuid-0002','ontap-prod-01-02','AFF-A400','SN-PROD-002',8640000,1,@now,@now)`).run({sid:sys1,cid:cls1,now});
      db.prepare(`INSERT INTO ontap_nodes (system_id,cluster_id,uuid,name,model,serial_number,uptime,is_healthy,created_at,updated_at) VALUES (@sid,@cid,'node-uuid-0003','ontap-dr-01-01','FAS8200','SN-DR-001',7200000,1,@now,@now)`).run({sid:sys2,cid:cls2,now});
      db.prepare(`INSERT INTO ontap_nodes (system_id,cluster_id,uuid,name,model,serial_number,uptime,is_healthy,created_at,updated_at) VALUES (@sid,@cid,'node-uuid-0004','ontap-dr-01-02','FAS8200','SN-DR-002',7200000,1,@now,@now)`).run({sid:sys2,cid:cls2,now});

      // AGGREGATES
      db.prepare(`INSERT INTO ontap_aggregates (system_id,name,state,raid_type,size_bytes,used_bytes,available_bytes,disk_count,is_root,created_at,updated_at) VALUES (@sid,'aggr1_prod_ssd','online','raid_dp',@t,@u,@a,24,0,@now,@now)`).run({sid:sys1,t:50*TB,u:37*TB,a:13*TB,now});
      db.prepare(`INSERT INTO ontap_aggregates (system_id,name,state,raid_type,size_bytes,used_bytes,available_bytes,disk_count,is_root,created_at,updated_at) VALUES (@sid,'aggr2_prod_ssd','online','raid_dp',@t,@u,@a,24,0,@now,@now)`).run({sid:sys1,t:50*TB,u:42*TB,a:8*TB,now});
      db.prepare(`INSERT INTO ontap_aggregates (system_id,name,state,raid_type,size_bytes,used_bytes,available_bytes,disk_count,is_root,created_at,updated_at) VALUES (@sid,'aggr1_dr_sas','online','raid_dp',@t,@u,@a,36,0,@now,@now)`).run({sid:sys2,t:80*TB,u:28*TB,a:52*TB,now});

      // SVMS
      db.prepare(`INSERT INTO ontap_svms (system_id,uuid,name,state,subtype,created_at,updated_at) VALUES (@sid,'svm-uuid-0001','svm_prod_nas','running','default',@now,@now)`).run({sid:sys1,now});
      db.prepare(`INSERT INTO ontap_svms (system_id,uuid,name,state,subtype,created_at,updated_at) VALUES (@sid,'svm-uuid-0002','svm_prod_san','running','default',@now,@now)`).run({sid:sys1,now});
      db.prepare(`INSERT INTO ontap_svms (system_id,uuid,name,state,subtype,created_at,updated_at) VALUES (@sid,'svm-uuid-0003','svm_dr','running','dp_destination',@now,@now)`).run({sid:sys2,now});

      // VOLUMES
      const vols = [
        {sid:sys1,name:'vol_finance_data',svm:'svm_prod_nas',state:'online',type:'rw',t:10*TB,u:7.8*TB},
        {sid:sys1,name:'vol_engineering',svm:'svm_prod_nas',state:'online',type:'rw',t:20*TB,u:16.5*TB},
        {sid:sys1,name:'vol_media_archive',svm:'svm_prod_nas',state:'online',type:'rw',t:15*TB,u:14.2*TB},
        {sid:sys1,name:'vol_oracle_data',svm:'svm_prod_san',state:'online',type:'rw',t:5*TB,u:3.1*TB},
        {sid:sys1,name:'vol_oracle_logs',svm:'svm_prod_san',state:'online',type:'rw',t:2*TB,u:0.8*TB},
        {sid:sys1,name:'vol_sql_data',svm:'svm_prod_san',state:'online',type:'rw',t:8*TB,u:5.6*TB},
        {sid:sys1,name:'vol_vmware_ds1',svm:'svm_prod_san',state:'online',type:'rw',t:12*TB,u:9.8*TB},
        {sid:sys2,name:'vol_finance_data_dp',svm:'svm_dr',state:'online',type:'dp',t:10*TB,u:7.8*TB},
        {sid:sys2,name:'vol_engineering_dp',svm:'svm_dr',state:'online',type:'dp',t:20*TB,u:16.5*TB},
        {sid:sys2,name:'vol_backup_weekly',svm:'svm_dr',state:'online',type:'rw',t:30*TB,u:18*TB},
      ];
      for(const v of vols) db.prepare(`INSERT INTO ontap_volumes (system_id,name,state,type,size_bytes,used_bytes,available_bytes,created_at,updated_at) VALUES (@sid,@name,@state,@type,@t,@u,@a,@now,@now)`).run({sid:v.sid,name:v.name,state:v.state,type:v.type,t:Math.round(v.t),u:Math.round(v.u),a:Math.round(v.t-v.u),now});

      // DISKS
      for(let i=1;i<=24;i++) db.prepare(`INSERT INTO ontap_disks (system_id,name,type,state,usable_size_bytes,created_at,updated_at) VALUES (@sid,@n,'SSD',@st,@c,@now,@now)`).run({sid:sys1,n:`1.0.${i}`,st:i===17?'broken':'present',c:3840*GB,now});
      for(let i=1;i<=36;i++) db.prepare(`INSERT INTO ontap_disks (system_id,name,type,state,usable_size_bytes,created_at,updated_at) VALUES (@sid,@n,'SAS','present',@c,@now,@now)`).run({sid:sys2,n:`1.0.${i}`,c:4000*GB,now});

      // LUNS
      db.prepare(`INSERT INTO ontap_luns (system_id,name,serial_number,os_type,size_bytes,state,created_at,updated_at) VALUES (@sid,'/vol/vol_oracle_data/lun_oracle','LUN-ORA-001','linux',@s,'online',@now,@now)`).run({sid:sys1,s:3*TB,now});
      db.prepare(`INSERT INTO ontap_luns (system_id,name,serial_number,os_type,size_bytes,state,created_at,updated_at) VALUES (@sid,'/vol/vol_sql_data/lun_sql','LUN-SQL-001','windows_2008',@s,'online',@now,@now)`).run({sid:sys1,s:5*TB,now});
      db.prepare(`INSERT INTO ontap_luns (system_id,name,serial_number,os_type,size_bytes,state,created_at,updated_at) VALUES (@sid,'/vol/vol_vmware_ds1/lun_vmware','LUN-VMW-001','vmware',@s,'online',@now,@now)`).run({sid:sys1,s:10*TB,now});

      // STORAGEGRID
      db.prepare(`INSERT INTO sg_grids (system_id,name,version,created_at,updated_at) VALUES (@sid,'sg-archive-grid','11.8.0',@now,@now)`).run({sid:sys3,now});
      for(const n of ['sg-admin-01','sg-gw-01','sg-gw-02','sg-store-01','sg-store-02','sg-store-03']){const tp=n.includes('admin')?'admin':n.includes('gw')?'gateway':'storage';db.prepare(`INSERT INTO sg_nodes (system_id,name,type,state,site,created_at,updated_at) VALUES (@sid,@name,@type,'connected','Site-A',@now,@now)`).run({sid:sys3,name:n,type:tp,now});}
      for(const b of [{name:'finance-archive',region:'us-east-1',obj:12450000,bytes:85*TB},{name:'media-assets',region:'us-east-1',obj:2340000,bytes:120*TB},{name:'compliance-vault',region:'eu-west-1',obj:890000,bytes:42*TB},{name:'backup-offsite',region:'us-east-1',obj:5670000,bytes:200*TB}])
        db.prepare(`INSERT INTO sg_buckets (system_id,name,region,object_count,data_bytes,created_at,updated_at) VALUES (@sid,@name,@region,@obj,@bytes,@now,@now)`).run({sid:sys3,name:b.name,region:b.region,obj:b.obj,bytes:Math.round(b.bytes),now});

      // E-SERIES
      db.prepare(`INSERT INTO es_arrays (system_id,name,status,firmware_version,drive_count,created_at,updated_at) VALUES (@sid,'eseries-san-01','needsAttention','11.80.1',48,@now,@now)`).run({sid:sys4,now});
      for(let i=1;i<=48;i++) db.prepare(`INSERT INTO es_drives (system_id,status,media_type,capacity_bytes,created_at,updated_at) VALUES (@sid,@st,'ssd',@c,@now,@now)`).run({sid:sys4,st:i===33?'failed':'optimal',c:1920*GB,now});

      // ISSUES
      const issues = [
        {sid:sys1,rt:'aggregate',ri:'aggr2_prod_ssd',sev:'critical',cat:'capacity',title:'Aggregate utilization exceeds 84%',desc:'aggr2_prod_ssd is at 84% utilization. Immediate capacity expansion recommended.'},
        {sid:sys1,rt:'volume',ri:'vol_media_archive',sev:'critical',cat:'capacity',title:'Volume near capacity: 94.7% used',desc:'vol_media_archive has only 800 GB free. Capacity exhausted in ~12 days.'},
        {sid:sys1,rt:'disk',ri:'1.0.17',sev:'high',cat:'hardware',title:'Failed disk detected',desc:'Disk 1.0.17 marked as broken. RAID reconstruction active. Replace within 48h.'},
        {sid:sys1,rt:'volume',ri:'vol_engineering',sev:'medium',cat:'capacity',title:'Volume utilization above 80%',desc:'vol_engineering at 82.5%. Plan expansion within 30 days.'},
        {sid:sys1,rt:'volume',ri:'vol_vmware_ds1',sev:'medium',cat:'capacity',title:'VMware datastore approaching threshold',desc:'vol_vmware_ds1 at 81.7%. VMware alarms trigger at 85%.'},
        {sid:sys2,rt:'cluster',ri:'ontap-dr-01',sev:'medium',cat:'software',title:'ONTAP version below recommended',desc:'Running 9.13.1P6, recommended 9.14.1+.'},
        {sid:sys1,rt:'snapmirror',ri:'svm_prod_nas:vol_finance_data',sev:'high',cat:'protection',title:'SnapMirror lag exceeds 4 hours',desc:'Replication lagging 6 hours. RPO target is 1 hour.'},
        {sid:sys4,rt:'drive',ri:'Drive 33',sev:'critical',cat:'hardware',title:'E-Series drive failure',desc:'Drive 33 failed. Reconstruction in progress, performance degraded.'},
        {sid:sys4,rt:'array',ri:'eseries-san-01',sev:'medium',cat:'software',title:'SANtricity OS update available',desc:'Firmware 11.80.2 available with critical fixes. Current: 11.80.1.'},
        {sid:sys3,rt:'bucket',ri:'backup-offsite',sev:'info',cat:'capacity',title:'Object count growing rapidly',desc:'Adding ~50K objects/day. Projected 10M in 90 days.'},
        {sid:sys1,rt:'node',ri:'ontap-prod-01-01',sev:'info',cat:'configuration',title:'NTP skew detected',desc:'Clock drift of 1.2s detected. Consider forcing NTP sync.'},
        {sid:sys3,rt:'certificate',ri:'sg-admin-01',sev:'medium',cat:'security',title:'TLS certificate expires in 30 days',desc:'Admin node TLS cert expiring soon. Renew to avoid disruption.'},
      ];
      for(const iss of issues) db.prepare(`INSERT INTO issues (system_id,resource_type,resource_id,severity,category,title,description,detected_at,status,created_at,updated_at) VALUES (@sid,@rt,@ri,@sev,@cat,@title,@desc,@det,'open',@now,@now)`).run({sid:iss.sid,rt:iss.rt,ri:iss.ri,sev:iss.sev,cat:iss.cat,title:iss.title,desc:iss.desc,det:hoursAgo(Math.floor(Math.random()*72)),now});

      // HEALTH SCORES
      db.prepare(`INSERT INTO health_scores (system_id,overall_score,performance_score,capacity_score,protection_score,security_score,configuration_score,scored_at,created_at) VALUES (@sid,72,88,55,60,85,78,@now,@now)`).run({sid:sys1,now});
      db.prepare(`INSERT INTO health_scores (system_id,overall_score,performance_score,capacity_score,protection_score,security_score,configuration_score,scored_at,created_at) VALUES (@sid,85,82,90,80,70,88,@now,@now)`).run({sid:sys2,now});
      db.prepare(`INSERT INTO health_scores (system_id,overall_score,performance_score,capacity_score,protection_score,security_score,configuration_score,scored_at,created_at) VALUES (@sid,91,95,75,92,90,94,@now,@now)`).run({sid:sys3,now});
      db.prepare(`INSERT INTO health_scores (system_id,overall_score,performance_score,capacity_score,protection_score,security_score,configuration_score,scored_at,created_at) VALUES (@sid,58,65,72,40,60,55,@now,@now)`).run({sid:sys4,now});

      // CAPACITY PROJECTIONS
      for(const p of [
        {sid:sys1,rt:'volume',ri:'vol_media_archive',rn:'vol_media_archive',cur:Math.round(14.2*TB),growth:70*GB,days:12,conf:92},
        {sid:sys1,rt:'aggregate',ri:'aggr2_prod_ssd',rn:'aggr2_prod_ssd',cur:42*TB,growth:50*GB,days:164,conf:87},
        {sid:sys1,rt:'volume',ri:'vol_engineering',rn:'vol_engineering',cur:Math.round(16.5*TB),growth:30*GB,days:122,conf:78},
        {sid:sys1,rt:'volume',ri:'vol_vmware_ds1',rn:'vol_vmware_ds1',cur:Math.round(9.8*TB),growth:25*GB,days:92,conf:81},
        {sid:sys3,rt:'bucket',ri:'backup-offsite',rn:'backup-offsite',cur:200*TB,growth:80*GB,days:3750,conf:65},
        {sid:sys3,rt:'bucket',ri:'media-assets',rn:'media-assets',cur:120*TB,growth:40*GB,days:2000,conf:72},
        {sid:sys4,rt:'array',ri:'eseries-san-01',rn:'eseries-san-01',cur:54*TB,growth:10*GB,days:3600,conf:60},
      ]) {
        const fd=new Date(Date.now()+p.days*86400000).toISOString().split('T')[0];
        db.prepare(`INSERT INTO capacity_projections (system_id,resource_type,resource_id,resource_name,current_used_bytes,growth_rate_bytes_per_day,projected_full_date,confidence_pct,analysis_timestamp,days_until_full,created_at) VALUES (@sid,@rt,@ri,@rn,@cur,@growth,@fd,@conf,@now,@days,@now)`).run({sid:p.sid,rt:p.rt,ri:p.ri,rn:p.rn,cur:p.cur,growth:p.growth,fd,conf:p.conf,days:p.days,now});
      }

      // CAPACITY SNAPSHOTS (30 days of trend data for all systems)
      const snapInsert = db.prepare(`INSERT INTO capacity_snapshots (system_id,resource_type,resource_id,resource_name,total_bytes,used_bytes,available_bytes,utilization_pct,snapshot_timestamp,created_at) VALUES (@sid,@rt,@ri,@rn,@t,@u,@a,@p,@ts,@now)`);
      for(let d=30;d>=0;d--){const ts=daysAgo(d);
        // ONTAP Prod aggregates
        snapInsert.run({sid:sys1,rt:'aggregate',ri:'aggr1_prod_ssd',rn:'aggr1_prod_ssd',t:50*TB,u:Math.round((35+d*0.07)*TB),a:Math.round((15-d*0.07)*TB),p:70+d*0.14,ts,now});
        snapInsert.run({sid:sys1,rt:'aggregate',ri:'aggr2_prod_ssd',rn:'aggr2_prod_ssd',t:50*TB,u:Math.round((42+d*0.05)*TB),a:Math.round((8-d*0.05)*TB),p:84+d*0.1,ts,now});
        // ONTAP DR aggregates
        snapInsert.run({sid:sys2,rt:'aggregate',ri:'aggr1_dr_sas',rn:'aggr1_dr_sas',t:80*TB,u:Math.round((52+d*0.04)*TB),a:Math.round((28-d*0.04)*TB),p:65+d*0.05,ts,now});
        // StorageGRID
        snapInsert.run({sid:sys3,rt:'bucket',ri:'backup-offsite',rn:'backup-offsite',t:500*TB,u:Math.round((200+d*1.5)*TB),a:Math.round((300-d*1.5)*TB),p:40+d*0.3,ts,now});
        snapInsert.run({sid:sys3,rt:'bucket',ri:'media-assets',rn:'media-assets',t:200*TB,u:Math.round((120+d*0.8)*TB),a:Math.round((80-d*0.8)*TB),p:60+d*0.4,ts,now});
        // E-Series
        snapInsert.run({sid:sys4,rt:'array',ri:'eseries-san-01',rn:'eseries-san-01',t:90*TB,u:Math.round((54+d*0.1)*TB),a:Math.round((36-d*0.1)*TB),p:60+d*0.11,ts,now});
      }

      // RAW METRICS (24h of perf data for all systems)
      const metricInsert = db.prepare(`INSERT INTO metrics_raw (system_id,resource_type,resource_id,metric_name,metric_value,unit,timestamp,created_at) VALUES (@sid,@rt,@ri,@mn,@mv,@unit,@ts,@now)`);
      for(let h=24;h>=0;h--){const ts=hoursAgo(h);
        // ONTAP Prod — per-volume metrics
        for(const vol of ['vol_finance_data','vol_engineering','vol_media_archive','vol_oracle_data','vol_sql_data','vol_vmware_ds1']){
          metricInsert.run({sid:sys1,rt:'volume',ri:vol,mn:'read_iops',mv:1200+Math.floor(Math.random()*3000),unit:'ops/s',ts,now});
          metricInsert.run({sid:sys1,rt:'volume',ri:vol,mn:'write_iops',mv:800+Math.floor(Math.random()*2000),unit:'ops/s',ts,now});
          metricInsert.run({sid:sys1,rt:'volume',ri:vol,mn:'read_latency',mv:parseFloat((0.3+Math.random()*1.2).toFixed(2)),unit:'ms',ts,now});
          metricInsert.run({sid:sys1,rt:'volume',ri:vol,mn:'write_latency',mv:parseFloat((0.5+Math.random()*2.0).toFixed(2)),unit:'ms',ts,now});
          metricInsert.run({sid:sys1,rt:'volume',ri:vol,mn:'read_throughput',mv:Math.floor(50e6+Math.random()*200e6),unit:'B/s',ts,now});
          metricInsert.run({sid:sys1,rt:'volume',ri:vol,mn:'write_throughput',mv:Math.floor(30e6+Math.random()*150e6),unit:'B/s',ts,now});
        }
        // ONTAP Prod — per-node metrics
        for(const nd of ['ontap-prod-01-01','ontap-prod-01-02']){
          metricInsert.run({sid:sys1,rt:'node',ri:nd,mn:'read_iops',mv:8000+Math.floor(Math.random()*12000),unit:'ops/s',ts,now});
          metricInsert.run({sid:sys1,rt:'node',ri:nd,mn:'write_iops',mv:5000+Math.floor(Math.random()*8000),unit:'ops/s',ts,now});
          metricInsert.run({sid:sys1,rt:'node',ri:nd,mn:'read_latency',mv:parseFloat((0.4+Math.random()*0.8).toFixed(2)),unit:'ms',ts,now});
          metricInsert.run({sid:sys1,rt:'node',ri:nd,mn:'write_latency',mv:parseFloat((0.6+Math.random()*1.5).toFixed(2)),unit:'ms',ts,now});
        }
        // ONTAP DR — per-volume metrics
        for(const vol of ['vol_finance_data_dp','vol_engineering_dp','vol_backup_weekly']){
          metricInsert.run({sid:sys2,rt:'volume',ri:vol,mn:'read_iops',mv:200+Math.floor(Math.random()*800),unit:'ops/s',ts,now});
          metricInsert.run({sid:sys2,rt:'volume',ri:vol,mn:'write_iops',mv:100+Math.floor(Math.random()*500),unit:'ops/s',ts,now});
          metricInsert.run({sid:sys2,rt:'volume',ri:vol,mn:'read_latency',mv:parseFloat((0.5+Math.random()*1.0).toFixed(2)),unit:'ms',ts,now});
          metricInsert.run({sid:sys2,rt:'volume',ri:vol,mn:'write_latency',mv:parseFloat((0.8+Math.random()*2.0).toFixed(2)),unit:'ms',ts,now});
          metricInsert.run({sid:sys2,rt:'volume',ri:vol,mn:'read_throughput',mv:Math.floor(10e6+Math.random()*80e6),unit:'B/s',ts,now});
          metricInsert.run({sid:sys2,rt:'volume',ri:vol,mn:'write_throughput',mv:Math.floor(5e6+Math.random()*50e6),unit:'B/s',ts,now});
        }
        // StorageGRID — per-bucket metrics
        for(const bkt of ['finance-archive','media-assets','compliance-vault','backup-offsite']){
          metricInsert.run({sid:sys3,rt:'bucket',ri:bkt,mn:'read_iops',mv:50+Math.floor(Math.random()*300),unit:'ops/s',ts,now});
          metricInsert.run({sid:sys3,rt:'bucket',ri:bkt,mn:'write_iops',mv:20+Math.floor(Math.random()*150),unit:'ops/s',ts,now});
          metricInsert.run({sid:sys3,rt:'bucket',ri:bkt,mn:'read_throughput',mv:Math.floor(5e6+Math.random()*50e6),unit:'B/s',ts,now});
          metricInsert.run({sid:sys3,rt:'bucket',ri:bkt,mn:'write_throughput',mv:Math.floor(2e6+Math.random()*30e6),unit:'B/s',ts,now});
        }
        // E-Series — array-level metrics
        metricInsert.run({sid:sys4,rt:'array',ri:'eseries-san-01',mn:'read_iops',mv:3000+Math.floor(Math.random()*5000),unit:'ops/s',ts,now});
        metricInsert.run({sid:sys4,rt:'array',ri:'eseries-san-01',mn:'write_iops',mv:2000+Math.floor(Math.random()*4000),unit:'ops/s',ts,now});
        metricInsert.run({sid:sys4,rt:'array',ri:'eseries-san-01',mn:'read_latency',mv:parseFloat((0.5+Math.random()*3.0).toFixed(2)),unit:'ms',ts,now});
        metricInsert.run({sid:sys4,rt:'array',ri:'eseries-san-01',mn:'write_latency',mv:parseFloat((0.8+Math.random()*4.0).toFixed(2)),unit:'ms',ts,now});
        metricInsert.run({sid:sys4,rt:'array',ri:'eseries-san-01',mn:'read_throughput',mv:Math.floor(100e6+Math.random()*300e6),unit:'B/s',ts,now});
        metricInsert.run({sid:sys4,rt:'array',ri:'eseries-san-01',mn:'write_throughput',mv:Math.floor(80e6+Math.random()*200e6),unit:'B/s',ts,now});
      }

      // EMS EVENTS
      const events=[{sid:sys1,sev:'error',name:'raid.disk.broken',msg:'Disk 1.0.17: broken disk detected'},{sid:sys1,sev:'warning',name:'wafl.vol.autoSize.done',msg:'vol_engineering: autosize triggered'},{sid:sys1,sev:'info',name:'snapmirror.check',msg:'SnapMirror check completed'},{sid:sys1,sev:'warning',name:'scsiblade.lunThresholdReached',msg:'LUN approaching space threshold'},{sid:sys2,sev:'info',name:'cf.fsm.takeoverImpossible',msg:'Partner firmware mismatch'},{sid:sys1,sev:'error',name:'callhome.battery.low',msg:'NVRAM battery voltage low on node ontap-prod-01-02'}];
      for(let i=0;i<events.length;i++){const e=events[i];db.prepare(`INSERT INTO ontap_ems_events (system_id,message_name,severity,message_text,source,time,created_at) VALUES (@sid,@name,@sev,@msg,'EMS',@ts,@now)`).run({sid:e.sid,name:e.name,sev:e.sev,msg:e.msg,ts:hoursAgo(i*3+1),now});}

      logger.info('[demo] Demo data seeded: 4 systems, 12 issues, metrics, events');
    })();

    res.status(201).json({data:{message:'Demo data seeded successfully.',systems:4,issues:12}});
  } catch(err){next(err);}
});

router.post('/clear', (req, res, next) => {
  try {
    const db = getDb();
    const demoSystems = db.prepare("SELECT id FROM systems WHERE name LIKE 'DEMO-%'").all();
    if(demoSystems.length===0) return res.json({data:{message:'No demo data found.'}});

    db.transaction(() => {
      const ids = demoSystems.map(s=>s.id);
      const ph = ids.map(()=>'?').join(',');
      for(const t of ['metrics_raw','metrics_hourly','metrics_daily','metrics_weekly','capacity_snapshots','capacity_projections','health_scores','issues','ontap_clusters','ontap_nodes','ontap_aggregates','ontap_svms','ontap_volumes','ontap_disks','ontap_luns','ontap_lifs','ontap_ports','ontap_shelves','ontap_exports','ontap_cifs_shares','ontap_snapmirror','ontap_snapshots','ontap_ems_events','ontap_licenses','ontap_qos_policies','ontap_security','ontap_software','sg_grids','sg_nodes','sg_alerts','sg_buckets','sg_users','sg_network','sg_metrics','sg_certificates','sg_compliance','sg_traffic_classes','sg_ilm_policies','sg_storage_pools','es_arrays','es_controllers','es_drives','es_pools','es_volumes','es_hosts','es_mappings','es_interfaces','es_snapshots','es_mirrors','es_mel_events','es_performance','es_ssd_cache','collection_runs']){
        try{db.prepare(`DELETE FROM ${t} WHERE system_id IN (${ph})`).run(...ids);}catch(_){}
      }
      db.prepare(`DELETE FROM systems WHERE id IN (${ph})`).run(...ids);
      logger.info(`[demo] Demo data cleared: ${ids.length} systems removed`);
    })();

    res.json({data:{message:'Demo data cleared.',systemsRemoved:demoSystems.length}});
  } catch(err){next(err);}
});

module.exports = router;
