//! AWS RDS (Relational Database Service) client.
//!
//! Mirrors `aws-sdk-rds` types and operations. RDS uses the AWS Query protocol
//! with XML responses (API version 2014-10-31).
//!
//! Reference: <https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/>

use crate::client::{self, AwsClient};
use crate::config::Tag;
use crate::error::{AwsError, AwsResult};
use serde::{Deserialize, Serialize};

const API_VERSION: &str = "2014-10-31";
const SERVICE: &str = "rds";

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DBInstance {
    pub db_instance_identifier: String,
    pub db_instance_class: String,
    pub engine: String,
    pub engine_version: Option<String>,
    pub db_instance_status: String,
    pub master_username: Option<String>,
    pub db_name: Option<String>,
    pub endpoint: Option<Endpoint>,
    pub allocated_storage: u32,
    pub instance_create_time: Option<String>,
    pub preferred_backup_window: Option<String>,
    pub backup_retention_period: u32,
    pub availability_zone: Option<String>,
    pub multi_az: bool,
    pub publicly_accessible: bool,
    pub storage_type: Option<String>,
    pub storage_encrypted: bool,
    pub kms_key_id: Option<String>,
    pub db_cluster_identifier: Option<String>,
    pub db_subnet_group_name: Option<String>,
    pub vpc_security_groups: Vec<VpcSecurityGroupMembership>,
    pub auto_minor_version_upgrade: bool,
    pub iops: Option<u32>,
    pub max_allocated_storage: Option<u32>,
    pub deletion_protection: bool,
    pub tags: Vec<Tag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Endpoint {
    pub address: Option<String>,
    pub port: u16,
    pub hosted_zone_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpcSecurityGroupMembership {
    pub vpc_security_group_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DBCluster {
    pub db_cluster_identifier: String,
    pub db_cluster_arn: Option<String>,
    pub status: String,
    pub engine: String,
    pub engine_version: Option<String>,
    pub endpoint: Option<String>,
    pub reader_endpoint: Option<String>,
    pub port: Option<u16>,
    pub master_username: Option<String>,
    pub database_name: Option<String>,
    pub multi_az: bool,
    pub storage_encrypted: bool,
    pub allocated_storage: Option<u32>,
    pub cluster_create_time: Option<String>,
    pub db_cluster_members: Vec<DBClusterMember>,
    pub availability_zones: Vec<String>,
    pub deletion_protection: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DBClusterMember {
    pub db_instance_identifier: String,
    pub is_cluster_writer: bool,
    pub db_cluster_parameter_group_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DBSnapshot {
    pub db_snapshot_identifier: String,
    pub db_instance_identifier: String,
    pub snapshot_create_time: Option<String>,
    pub engine: String,
    pub allocated_storage: u32,
    pub status: String,
    pub snapshot_type: Option<String>,
    pub availability_zone: Option<String>,
    pub vpc_id: Option<String>,
    pub master_username: Option<String>,
    pub engine_version: Option<String>,
    pub encrypted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DBClusterSnapshot {
    pub db_cluster_snapshot_identifier: String,
    pub db_cluster_identifier: String,
    pub snapshot_create_time: Option<String>,
    pub engine: String,
    pub allocated_storage: u32,
    pub status: String,
    pub snapshot_type: Option<String>,
    pub cluster_create_time: Option<String>,
    pub master_username: Option<String>,
    pub engine_version: Option<String>,
    pub storage_encrypted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DBParameterGroup {
    pub db_parameter_group_name: String,
    pub db_parameter_group_family: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DBSubnetGroup {
    pub db_subnet_group_name: String,
    pub db_subnet_group_description: String,
    pub vpc_id: String,
    pub subnet_group_status: String,
    pub subnets: Vec<Subnet>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subnet {
    pub subnet_identifier: String,
    pub subnet_availability_zone: Option<String>,
    pub subnet_status: String,
}

/// Input for creating a DB instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDBInstanceInput {
    pub db_instance_identifier: String,
    pub db_instance_class: String,
    pub engine: String,
    pub engine_version: Option<String>,
    pub master_username: Option<String>,
    pub master_user_password: Option<String>,
    pub db_name: Option<String>,
    pub allocated_storage: Option<u32>,
    pub availability_zone: Option<String>,
    pub multi_az: Option<bool>,
    pub publicly_accessible: Option<bool>,
    pub storage_type: Option<String>,
    pub storage_encrypted: Option<bool>,
    pub kms_key_id: Option<String>,
    pub backup_retention_period: Option<u32>,
    pub db_subnet_group_name: Option<String>,
    pub vpc_security_group_ids: Vec<String>,
    pub auto_minor_version_upgrade: Option<bool>,
    pub iops: Option<u32>,
    pub deletion_protection: Option<bool>,
    pub tags: Vec<Tag>,
}

/// RDS event notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DBEvent {
    pub source_identifier: String,
    pub source_type: String,
    pub message: String,
    pub date: String,
    pub source_arn: Option<String>,
    pub event_categories: Vec<String>,
}

// ── RDS Client ──────────────────────────────────────────────────────────

pub struct RdsClient {
    client: AwsClient,
}

impl RdsClient {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    // ── DB Instances ────────────────────────────────────────────────

    pub async fn describe_db_instances(&self, db_instance_id: Option<&str>, max_records: Option<u32>, marker: Option<&str>) -> AwsResult<(Vec<DBInstance>, Option<String>)> {
        let mut params = client::build_query_params("DescribeDBInstances", API_VERSION);
        if let Some(id) = db_instance_id {
            params.insert("DBInstanceIdentifier".to_string(), id.to_string());
        }
        if let Some(mr) = max_records {
            params.insert("MaxRecords".to_string(), mr.to_string());
        }
        if let Some(mk) = marker {
            params.insert("Marker".to_string(), mk.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        let instances = self.parse_db_instances(&response.body);
        let next_marker = client::xml_text(&response.body, "Marker");
        Ok((instances, next_marker))
    }

    pub async fn create_db_instance(&self, input: &CreateDBInstanceInput) -> AwsResult<DBInstance> {
        let mut params = client::build_query_params("CreateDBInstance", API_VERSION);
        params.insert("DBInstanceIdentifier".to_string(), input.db_instance_identifier.clone());
        params.insert("DBInstanceClass".to_string(), input.db_instance_class.clone());
        params.insert("Engine".to_string(), input.engine.clone());
        if let Some(ref v) = input.engine_version { params.insert("EngineVersion".to_string(), v.clone()); }
        if let Some(ref u) = input.master_username { params.insert("MasterUsername".to_string(), u.clone()); }
        if let Some(ref p) = input.master_user_password { params.insert("MasterUserPassword".to_string(), p.clone()); }
        if let Some(ref n) = input.db_name { params.insert("DBName".to_string(), n.clone()); }
        if let Some(s) = input.allocated_storage { params.insert("AllocatedStorage".to_string(), s.to_string()); }
        if let Some(ref az) = input.availability_zone { params.insert("AvailabilityZone".to_string(), az.clone()); }
        if let Some(m) = input.multi_az { params.insert("MultiAZ".to_string(), m.to_string()); }
        if let Some(p) = input.publicly_accessible { params.insert("PubliclyAccessible".to_string(), p.to_string()); }
        if let Some(ref st) = input.storage_type { params.insert("StorageType".to_string(), st.clone()); }
        if let Some(e) = input.storage_encrypted { params.insert("StorageEncrypted".to_string(), e.to_string()); }
        if let Some(ref k) = input.kms_key_id { params.insert("KmsKeyId".to_string(), k.clone()); }
        if let Some(b) = input.backup_retention_period { params.insert("BackupRetentionPeriod".to_string(), b.to_string()); }
        if let Some(ref sg) = input.db_subnet_group_name { params.insert("DBSubnetGroupName".to_string(), sg.clone()); }
        for (i, sg_id) in input.vpc_security_group_ids.iter().enumerate() {
            params.insert(format!("VpcSecurityGroupIds.member.{}", i + 1), sg_id.clone());
        }
        if let Some(a) = input.auto_minor_version_upgrade { params.insert("AutoMinorVersionUpgrade".to_string(), a.to_string()); }
        if let Some(iops) = input.iops { params.insert("Iops".to_string(), iops.to_string()); }
        if let Some(d) = input.deletion_protection { params.insert("DeletionProtection".to_string(), d.to_string()); }
        client::add_tags(&mut params, &input.tags, "Tags.Tag");
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_db_instances(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No DBInstance in response", 200))
    }

    pub async fn delete_db_instance(&self, db_instance_id: &str, skip_final_snapshot: bool) -> AwsResult<DBInstance> {
        let mut params = client::build_query_params("DeleteDBInstance", API_VERSION);
        params.insert("DBInstanceIdentifier".to_string(), db_instance_id.to_string());
        params.insert("SkipFinalSnapshot".to_string(), skip_final_snapshot.to_string());
        if !skip_final_snapshot {
            params.insert("FinalDBSnapshotIdentifier".to_string(),
                format!("{}-final-{}", db_instance_id, chrono::Utc::now().format("%Y%m%d%H%M%S")));
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_db_instances(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No DBInstance in response", 200))
    }

    pub async fn start_db_instance(&self, db_instance_id: &str) -> AwsResult<DBInstance> {
        let mut params = client::build_query_params("StartDBInstance", API_VERSION);
        params.insert("DBInstanceIdentifier".to_string(), db_instance_id.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_db_instances(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No DBInstance in response", 200))
    }

    pub async fn stop_db_instance(&self, db_instance_id: &str) -> AwsResult<DBInstance> {
        let mut params = client::build_query_params("StopDBInstance", API_VERSION);
        params.insert("DBInstanceIdentifier".to_string(), db_instance_id.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_db_instances(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No DBInstance in response", 200))
    }

    pub async fn reboot_db_instance(&self, db_instance_id: &str) -> AwsResult<DBInstance> {
        let mut params = client::build_query_params("RebootDBInstance", API_VERSION);
        params.insert("DBInstanceIdentifier".to_string(), db_instance_id.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_db_instances(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No DBInstance in response", 200))
    }

    // ── DB Clusters ─────────────────────────────────────────────────

    pub async fn describe_db_clusters(&self, cluster_id: Option<&str>) -> AwsResult<Vec<DBCluster>> {
        let mut params = client::build_query_params("DescribeDBClusters", API_VERSION);
        if let Some(id) = cluster_id {
            params.insert("DBClusterIdentifier".to_string(), id.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_db_clusters(&response.body))
    }

    pub async fn create_db_cluster(&self, cluster_id: &str, engine: &str, master_username: &str, master_password: &str) -> AwsResult<DBCluster> {
        let mut params = client::build_query_params("CreateDBCluster", API_VERSION);
        params.insert("DBClusterIdentifier".to_string(), cluster_id.to_string());
        params.insert("Engine".to_string(), engine.to_string());
        params.insert("MasterUsername".to_string(), master_username.to_string());
        params.insert("MasterUserPassword".to_string(), master_password.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_db_clusters(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No DBCluster in response", 200))
    }

    pub async fn delete_db_cluster(&self, cluster_id: &str, skip_final_snapshot: bool) -> AwsResult<DBCluster> {
        let mut params = client::build_query_params("DeleteDBCluster", API_VERSION);
        params.insert("DBClusterIdentifier".to_string(), cluster_id.to_string());
        params.insert("SkipFinalSnapshot".to_string(), skip_final_snapshot.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_db_clusters(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No DBCluster in response", 200))
    }

    // ── Snapshots ───────────────────────────────────────────────────

    pub async fn describe_db_snapshots(&self, db_instance_id: Option<&str>, snapshot_id: Option<&str>) -> AwsResult<Vec<DBSnapshot>> {
        let mut params = client::build_query_params("DescribeDBSnapshots", API_VERSION);
        if let Some(id) = db_instance_id {
            params.insert("DBInstanceIdentifier".to_string(), id.to_string());
        }
        if let Some(sid) = snapshot_id {
            params.insert("DBSnapshotIdentifier".to_string(), sid.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_db_snapshots(&response.body))
    }

    pub async fn create_db_snapshot(&self, db_instance_id: &str, snapshot_id: &str) -> AwsResult<DBSnapshot> {
        let mut params = client::build_query_params("CreateDBSnapshot", API_VERSION);
        params.insert("DBInstanceIdentifier".to_string(), db_instance_id.to_string());
        params.insert("DBSnapshotIdentifier".to_string(), snapshot_id.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_db_snapshots(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No DBSnapshot in response", 200))
    }

    pub async fn delete_db_snapshot(&self, snapshot_id: &str) -> AwsResult<DBSnapshot> {
        let mut params = client::build_query_params("DeleteDBSnapshot", API_VERSION);
        params.insert("DBSnapshotIdentifier".to_string(), snapshot_id.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        self.parse_db_snapshots(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No DBSnapshot in response", 200))
    }

    // ── Parameter Groups ────────────────────────────────────────────

    pub async fn describe_db_parameter_groups(&self) -> AwsResult<Vec<DBParameterGroup>> {
        let params = client::build_query_params("DescribeDBParameterGroups", API_VERSION);
        let response = self.client.query_request(SERVICE, &params).await?;
        let blocks = client::xml_blocks(&response.body, "DBParameterGroup");
        Ok(blocks.iter().filter_map(|b| {
            Some(DBParameterGroup {
                db_parameter_group_name: client::xml_text(b, "DBParameterGroupName")?,
                db_parameter_group_family: client::xml_text(b, "DBParameterGroupFamily").unwrap_or_default(),
                description: client::xml_text(b, "Description").unwrap_or_default(),
            })
        }).collect())
    }

    // ── Subnet Groups ───────────────────────────────────────────────

    pub async fn describe_db_subnet_groups(&self) -> AwsResult<Vec<DBSubnetGroup>> {
        let params = client::build_query_params("DescribeDBSubnetGroups", API_VERSION);
        let response = self.client.query_request(SERVICE, &params).await?;
        let blocks = client::xml_blocks(&response.body, "DBSubnetGroup");
        Ok(blocks.iter().filter_map(|b| {
            Some(DBSubnetGroup {
                db_subnet_group_name: client::xml_text(b, "DBSubnetGroupName")?,
                db_subnet_group_description: client::xml_text(b, "DBSubnetGroupDescription").unwrap_or_default(),
                vpc_id: client::xml_text(b, "VpcId").unwrap_or_default(),
                subnet_group_status: client::xml_text(b, "SubnetGroupStatus").unwrap_or_default(),
                subnets: client::xml_blocks(b, "Subnet").iter().filter_map(|s| {
                    Some(Subnet {
                        subnet_identifier: client::xml_text(s, "SubnetIdentifier")?,
                        subnet_availability_zone: client::xml_text(s, "AvailabilityZone"),
                        subnet_status: client::xml_text(s, "SubnetStatus").unwrap_or_default(),
                    })
                }).collect(),
            })
        }).collect())
    }

    // ── Events ──────────────────────────────────────────────────────

    pub async fn describe_events(&self, source_identifier: Option<&str>, source_type: Option<&str>, duration: Option<u32>) -> AwsResult<Vec<DBEvent>> {
        let mut params = client::build_query_params("DescribeEvents", API_VERSION);
        if let Some(si) = source_identifier {
            params.insert("SourceIdentifier".to_string(), si.to_string());
        }
        if let Some(st) = source_type {
            params.insert("SourceType".to_string(), st.to_string());
        }
        if let Some(d) = duration {
            params.insert("Duration".to_string(), d.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        let blocks = client::xml_blocks(&response.body, "Event");
        Ok(blocks.iter().filter_map(|b| {
            Some(DBEvent {
                source_identifier: client::xml_text(b, "SourceIdentifier")?,
                source_type: client::xml_text(b, "SourceType").unwrap_or_default(),
                message: client::xml_text(b, "Message").unwrap_or_default(),
                date: client::xml_text(b, "Date").unwrap_or_default(),
                source_arn: client::xml_text(b, "SourceArn"),
                event_categories: client::xml_text_all(b, "EventCategory"),
            })
        }).collect())
    }

    // ── XML Parsers ─────────────────────────────────────────────────

    fn parse_db_instances(&self, xml: &str) -> Vec<DBInstance> {
        let blocks = client::xml_blocks(xml, "DBInstance");
        blocks.iter().filter_map(|b| {
            let id = client::xml_text(b, "DBInstanceIdentifier")?;
            let endpoint_block = client::xml_block(b, "Endpoint");
            let endpoint = endpoint_block.as_ref().map(|eb| Endpoint {
                address: client::xml_text(eb, "Address"),
                port: client::xml_text(eb, "Port").and_then(|v| v.parse().ok()).unwrap_or(0),
                hosted_zone_id: client::xml_text(eb, "HostedZoneId"),
            });
            Some(DBInstance {
                db_instance_identifier: id,
                db_instance_class: client::xml_text(b, "DBInstanceClass").unwrap_or_default(),
                engine: client::xml_text(b, "Engine").unwrap_or_default(),
                engine_version: client::xml_text(b, "EngineVersion"),
                db_instance_status: client::xml_text(b, "DBInstanceStatus").unwrap_or_default(),
                master_username: client::xml_text(b, "MasterUsername"),
                db_name: client::xml_text(b, "DBName"),
                endpoint,
                allocated_storage: client::xml_text(b, "AllocatedStorage").and_then(|v| v.parse().ok()).unwrap_or(0),
                instance_create_time: client::xml_text(b, "InstanceCreateTime"),
                preferred_backup_window: client::xml_text(b, "PreferredBackupWindow"),
                backup_retention_period: client::xml_text(b, "BackupRetentionPeriod").and_then(|v| v.parse().ok()).unwrap_or(0),
                availability_zone: client::xml_text(b, "AvailabilityZone"),
                multi_az: client::xml_text(b, "MultiAZ").map(|v| v == "true").unwrap_or(false),
                publicly_accessible: client::xml_text(b, "PubliclyAccessible").map(|v| v == "true").unwrap_or(false),
                storage_type: client::xml_text(b, "StorageType"),
                storage_encrypted: client::xml_text(b, "StorageEncrypted").map(|v| v == "true").unwrap_or(false),
                kms_key_id: client::xml_text(b, "KmsKeyId"),
                db_cluster_identifier: client::xml_text(b, "DBClusterIdentifier"),
                db_subnet_group_name: client::xml_text(b, "DBSubnetGroupName"),
                vpc_security_groups: client::xml_blocks(b, "VpcSecurityGroupMembership").iter().filter_map(|sg| {
                    Some(VpcSecurityGroupMembership {
                        vpc_security_group_id: client::xml_text(sg, "VpcSecurityGroupId")?,
                        status: client::xml_text(sg, "Status").unwrap_or_default(),
                    })
                }).collect(),
                auto_minor_version_upgrade: client::xml_text(b, "AutoMinorVersionUpgrade").map(|v| v == "true").unwrap_or(true),
                iops: client::xml_text(b, "Iops").and_then(|v| v.parse().ok()),
                max_allocated_storage: client::xml_text(b, "MaxAllocatedStorage").and_then(|v| v.parse().ok()),
                deletion_protection: client::xml_text(b, "DeletionProtection").map(|v| v == "true").unwrap_or(false),
                tags: vec![],
            })
        }).collect()
    }

    fn parse_db_clusters(&self, xml: &str) -> Vec<DBCluster> {
        let blocks = client::xml_blocks(xml, "DBCluster");
        blocks.iter().filter_map(|b| {
            Some(DBCluster {
                db_cluster_identifier: client::xml_text(b, "DBClusterIdentifier")?,
                db_cluster_arn: client::xml_text(b, "DBClusterArn"),
                status: client::xml_text(b, "Status").unwrap_or_default(),
                engine: client::xml_text(b, "Engine").unwrap_or_default(),
                engine_version: client::xml_text(b, "EngineVersion"),
                endpoint: client::xml_text(b, "Endpoint"),
                reader_endpoint: client::xml_text(b, "ReaderEndpoint"),
                port: client::xml_text(b, "Port").and_then(|v| v.parse().ok()),
                master_username: client::xml_text(b, "MasterUsername"),
                database_name: client::xml_text(b, "DatabaseName"),
                multi_az: client::xml_text(b, "MultiAZ").map(|v| v == "true").unwrap_or(false),
                storage_encrypted: client::xml_text(b, "StorageEncrypted").map(|v| v == "true").unwrap_or(false),
                allocated_storage: client::xml_text(b, "AllocatedStorage").and_then(|v| v.parse().ok()),
                cluster_create_time: client::xml_text(b, "ClusterCreateTime"),
                db_cluster_members: client::xml_blocks(b, "DBClusterMember").iter().filter_map(|m| {
                    Some(DBClusterMember {
                        db_instance_identifier: client::xml_text(m, "DBInstanceIdentifier")?,
                        is_cluster_writer: client::xml_text(m, "IsClusterWriter").map(|v| v == "true").unwrap_or(false),
                        db_cluster_parameter_group_status: client::xml_text(m, "DBClusterParameterGroupStatus"),
                    })
                }).collect(),
                availability_zones: client::xml_text_all(b, "AvailabilityZone"),
                deletion_protection: client::xml_text(b, "DeletionProtection").map(|v| v == "true").unwrap_or(false),
            })
        }).collect()
    }

    fn parse_db_snapshots(&self, xml: &str) -> Vec<DBSnapshot> {
        let blocks = client::xml_blocks(xml, "DBSnapshot");
        blocks.iter().filter_map(|b| {
            Some(DBSnapshot {
                db_snapshot_identifier: client::xml_text(b, "DBSnapshotIdentifier")?,
                db_instance_identifier: client::xml_text(b, "DBInstanceIdentifier").unwrap_or_default(),
                snapshot_create_time: client::xml_text(b, "SnapshotCreateTime"),
                engine: client::xml_text(b, "Engine").unwrap_or_default(),
                allocated_storage: client::xml_text(b, "AllocatedStorage").and_then(|v| v.parse().ok()).unwrap_or(0),
                status: client::xml_text(b, "Status").unwrap_or_default(),
                snapshot_type: client::xml_text(b, "SnapshotType"),
                availability_zone: client::xml_text(b, "AvailabilityZone"),
                vpc_id: client::xml_text(b, "VpcId"),
                master_username: client::xml_text(b, "MasterUsername"),
                engine_version: client::xml_text(b, "EngineVersion"),
                encrypted: client::xml_text(b, "Encrypted").map(|v| v == "true").unwrap_or(false),
            })
        }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_instance_serde() {
        let inst = DBInstance {
            db_instance_identifier: "mydb".to_string(),
            db_instance_class: "db.t3.micro".to_string(),
            engine: "mysql".to_string(),
            engine_version: Some("8.0.33".to_string()),
            db_instance_status: "available".to_string(),
            master_username: Some("admin".to_string()),
            db_name: Some("mydb".to_string()),
            endpoint: Some(Endpoint { address: Some("mydb.abc.us-east-1.rds.amazonaws.com".to_string()), port: 3306, hosted_zone_id: None }),
            allocated_storage: 20,
            instance_create_time: None,
            preferred_backup_window: None,
            backup_retention_period: 7,
            availability_zone: Some("us-east-1a".to_string()),
            multi_az: false,
            publicly_accessible: false,
            storage_type: Some("gp3".to_string()),
            storage_encrypted: true,
            kms_key_id: None,
            db_cluster_identifier: None,
            db_subnet_group_name: Some("default".to_string()),
            vpc_security_groups: vec![VpcSecurityGroupMembership { vpc_security_group_id: "sg-123".to_string(), status: "active".to_string() }],
            auto_minor_version_upgrade: true,
            iops: None,
            max_allocated_storage: Some(100),
            deletion_protection: true,
            tags: vec![],
        };
        let json = serde_json::to_string(&inst).unwrap();
        let back: DBInstance = serde_json::from_str(&json).unwrap();
        assert_eq!(back.engine, "mysql");
        assert_eq!(back.endpoint.unwrap().port, 3306);
    }
}
