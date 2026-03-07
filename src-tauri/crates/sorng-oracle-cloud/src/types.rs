use serde::{Deserialize, Serialize};

// ─── Connection ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciConnectionConfig {
    pub region: String,
    pub tenancy_ocid: String,
    pub user_ocid: String,
    pub fingerprint: String,
    pub private_key: String,
    pub compartment_id: Option<String>,
    pub tls_skip_verify: Option<bool>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciConnectionSummary {
    pub region: String,
    pub tenancy_ocid: String,
    pub user_ocid: String,
    pub compartment_id: Option<String>,
}

// ─── Compute ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciInstance {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub availability_domain: String,
    pub fault_domain: Option<String>,
    pub shape: String,
    pub lifecycle_state: String,
    pub time_created: String,
    pub image_id: Option<String>,
    pub region: String,
    pub metadata: Option<serde_json::Value>,
    pub shape_config: Option<OciShapeConfig>,
    pub source_details: Option<serde_json::Value>,
    pub launch_options: Option<serde_json::Value>,
    pub agent_config: Option<serde_json::Value>,
    pub defined_tags: Option<serde_json::Value>,
    pub freeform_tags: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciShapeConfig {
    pub ocpus: Option<f64>,
    pub memory_in_gbs: Option<f64>,
    pub baseline_ocpu_utilization: Option<String>,
    pub gpu_description: Option<String>,
    pub gpus: Option<u32>,
    pub networking_bandwidth_in_gbps: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciShape {
    pub shape: String,
    pub ocpus: Option<f64>,
    pub memory_in_gbs: Option<f64>,
    pub networking_bandwidth_in_gbps: Option<f64>,
    pub gpu_description: Option<String>,
    pub gpus: Option<u32>,
    pub is_flexible: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciImage {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub operating_system: String,
    pub operating_system_version: String,
    pub lifecycle_state: String,
    pub size_in_mbs: Option<u64>,
    pub time_created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciVnicAttachment {
    pub id: String,
    pub instance_id: String,
    pub vnic_id: String,
    pub subnet_id: String,
    pub lifecycle_state: String,
    pub time_created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciBootVolume {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub availability_domain: String,
    pub size_in_gbs: u64,
    pub lifecycle_state: String,
    pub time_created: String,
    pub image_id: Option<String>,
    pub vpus_per_gb: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchInstanceRequest {
    pub compartment_id: String,
    pub availability_domain: String,
    pub shape: String,
    pub display_name: Option<String>,
    pub image_id: Option<String>,
    pub subnet_id: Option<String>,
    pub shape_config: Option<OciShapeConfig>,
    pub metadata: Option<serde_json::Value>,
    pub ssh_authorized_keys: Option<String>,
}

// ─── Networking ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciVcn {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub cidr_block: String,
    pub cidr_blocks: Option<Vec<String>>,
    pub dns_label: Option<String>,
    pub lifecycle_state: String,
    pub time_created: String,
    pub default_route_table_id: Option<String>,
    pub default_security_list_id: Option<String>,
    pub default_dhcp_options_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciSubnet {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    pub cidr_block: String,
    pub availability_domain: Option<String>,
    pub lifecycle_state: String,
    pub time_created: String,
    pub route_table_id: Option<String>,
    pub security_list_ids: Option<Vec<String>>,
    pub dns_label: Option<String>,
    pub prohibit_public_ip_on_vnic: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciSecurityList {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    pub lifecycle_state: String,
    pub ingress_security_rules: Vec<OciSecurityRule>,
    pub egress_security_rules: Vec<OciSecurityRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciSecurityRule {
    pub protocol: String,
    pub source: Option<String>,
    pub destination: Option<String>,
    pub description: Option<String>,
    pub is_stateless: Option<bool>,
    pub tcp_options: Option<serde_json::Value>,
    pub udp_options: Option<serde_json::Value>,
    pub icmp_options: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciRouteTable {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    pub lifecycle_state: String,
    pub route_rules: Vec<OciRouteRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciRouteRule {
    pub destination: String,
    pub destination_type: String,
    pub network_entity_id: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciInternetGateway {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    pub lifecycle_state: String,
    pub is_enabled: bool,
    pub time_created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciNatGateway {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    pub lifecycle_state: String,
    pub nat_ip: String,
    pub time_created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciLoadBalancer {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub lifecycle_state: String,
    pub shape_name: String,
    pub ip_addresses: Vec<OciIpAddress>,
    pub subnet_ids: Vec<String>,
    pub is_private: Option<bool>,
    pub time_created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciIpAddress {
    pub ip_address: String,
    pub is_public: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciNetworkSecurityGroup {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    pub lifecycle_state: String,
    pub time_created: String,
}

// ─── Storage ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciBlockVolume {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub availability_domain: String,
    pub size_in_gbs: u64,
    pub lifecycle_state: String,
    pub time_created: String,
    pub vpus_per_gb: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciBucket {
    pub name: String,
    pub namespace_name: String,
    pub compartment_id: String,
    pub created_by: String,
    pub time_created: String,
    pub etag: String,
    pub public_access_type: Option<String>,
    pub storage_tier: Option<String>,
    pub object_lifecycle_policy_etag: Option<String>,
    pub freeform_tags: Option<serde_json::Value>,
    pub approximate_count: Option<u64>,
    pub approximate_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciObject {
    pub name: String,
    pub size: Option<u64>,
    pub md5: Option<String>,
    pub time_created: Option<String>,
    pub etag: Option<String>,
    pub storage_tier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciVolumeAttachment {
    pub id: String,
    pub instance_id: String,
    pub volume_id: String,
    pub attachment_type: String,
    pub lifecycle_state: String,
    pub time_created: String,
    pub device: Option<String>,
    pub is_read_only: Option<bool>,
}

// ─── Identity / IAM ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciCompartment {
    pub id: String,
    pub name: String,
    pub description: String,
    pub compartment_id: String,
    pub lifecycle_state: String,
    pub time_created: String,
    pub freeform_tags: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciUser {
    pub id: String,
    pub name: String,
    pub description: String,
    pub compartment_id: String,
    pub lifecycle_state: String,
    pub time_created: String,
    pub email: Option<String>,
    pub is_mfa_activated: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciGroup {
    pub id: String,
    pub name: String,
    pub description: String,
    pub compartment_id: String,
    pub lifecycle_state: String,
    pub time_created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciPolicy {
    pub id: String,
    pub name: String,
    pub description: String,
    pub compartment_id: String,
    pub lifecycle_state: String,
    pub statements: Vec<String>,
    pub time_created: String,
}

// ─── Database ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciDbSystem {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub availability_domain: String,
    pub shape: String,
    pub lifecycle_state: String,
    pub db_version: String,
    pub cpu_core_count: u32,
    pub data_storage_size_in_gbs: Option<u64>,
    pub node_count: Option<u32>,
    pub time_created: String,
    pub subnet_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciAutonomousDb {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub lifecycle_state: String,
    pub db_name: String,
    pub db_version: Option<String>,
    pub cpu_core_count: u32,
    pub data_storage_size_in_tbs: Option<u64>,
    pub is_free_tier: Option<bool>,
    pub time_created: String,
    pub connection_strings: Option<serde_json::Value>,
}

// ─── Containers / OKE ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciContainerInstance {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub availability_domain: String,
    pub lifecycle_state: String,
    pub shape: String,
    pub shape_config: Option<OciShapeConfig>,
    pub container_count: u32,
    pub time_created: String,
    pub vnics: Option<Vec<serde_json::Value>>,
    pub containers: Option<Vec<OciContainer>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciContainer {
    pub container_id: String,
    pub display_name: String,
    pub image_url: String,
    pub lifecycle_state: String,
    pub resource_config: Option<serde_json::Value>,
    pub health_checks: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OkeCluster {
    pub id: String,
    pub name: String,
    pub compartment_id: String,
    pub vcn_id: String,
    pub kubernetes_version: String,
    pub lifecycle_state: String,
    pub endpoint_config: Option<serde_json::Value>,
    pub options: Option<serde_json::Value>,
    pub time_created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OkeNodePool {
    pub id: String,
    pub name: String,
    pub cluster_id: String,
    pub compartment_id: String,
    pub kubernetes_version: String,
    pub node_shape: String,
    pub node_source: Option<serde_json::Value>,
    pub quantity_per_subnet: Option<u32>,
    pub lifecycle_state: String,
    pub time_created: String,
}

// ─── Functions ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciFunction {
    pub id: String,
    pub display_name: String,
    pub application_id: String,
    pub compartment_id: String,
    pub image: String,
    pub memory_in_mbs: u64,
    pub timeout_in_seconds: u32,
    pub lifecycle_state: String,
    pub invoke_endpoint: Option<String>,
    pub time_created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciFunctionApplication {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub lifecycle_state: String,
    pub subnet_ids: Vec<String>,
    pub time_created: String,
}

// ─── Monitoring ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciAlarm {
    pub id: String,
    pub display_name: String,
    pub compartment_id: String,
    pub namespace_name: String,
    pub query: String,
    pub severity: String,
    pub lifecycle_state: String,
    pub is_enabled: bool,
    pub destinations: Vec<String>,
    pub time_created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciMetricData {
    pub namespace_name: String,
    pub name: String,
    pub compartment_id: String,
    pub dimensions: serde_json::Value,
    pub aggregated_datapoints: Vec<OciDatapoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciDatapoint {
    pub timestamp: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciAuditEvent {
    pub event_type: String,
    pub compartment_id: String,
    pub event_time: String,
    pub source: String,
    pub event_name: String,
    pub data: Option<serde_json::Value>,
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OciDashboard {
    pub region: String,
    pub total_instances: u64,
    pub running_instances: u64,
    pub total_vcns: u64,
    pub total_subnets: u64,
    pub total_volumes: u64,
    pub total_buckets: u64,
    pub total_autonomous_dbs: u64,
    pub total_compartments: u64,
    pub recent_audit_events: Vec<OciAuditEvent>,
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_connection_config_roundtrip() {
        let config = OciConnectionConfig {
            region: "us-ashburn-1".into(),
            tenancy_ocid: "ocid1.tenancy.oc1..aaa".into(),
            user_ocid: "ocid1.user.oc1..bbb".into(),
            fingerprint: "aa:bb:cc:dd".into(),
            private_key: "-----BEGIN RSA PRIVATE KEY-----".into(),
            compartment_id: Some("ocid1.compartment.oc1..ccc".into()),
            tls_skip_verify: Some(false),
            timeout_secs: Some(30),
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: OciConnectionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.region, "us-ashburn-1");
        assert_eq!(parsed.tenancy_ocid, config.tenancy_ocid);
        assert_eq!(parsed.timeout_secs, Some(30));
    }

    #[test]
    fn test_connection_summary_roundtrip() {
        let summary = OciConnectionSummary {
            region: "eu-frankfurt-1".into(),
            tenancy_ocid: "ocid1.tenancy.oc1..aaa".into(),
            user_ocid: "ocid1.user.oc1..bbb".into(),
            compartment_id: None,
        };
        let json = serde_json::to_string(&summary).unwrap();
        let parsed: OciConnectionSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.region, "eu-frankfurt-1");
        assert!(parsed.compartment_id.is_none());
    }

    #[test]
    fn test_instance_roundtrip() {
        let instance = OciInstance {
            id: "ocid1.instance.oc1..aaa".into(),
            display_name: "test-vm".into(),
            compartment_id: "ocid1.compartment.oc1..bbb".into(),
            availability_domain: "AD-1".into(),
            fault_domain: Some("FAULT-DOMAIN-1".into()),
            shape: "VM.Standard.E4.Flex".into(),
            lifecycle_state: "RUNNING".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
            image_id: Some("ocid1.image.oc1..ccc".into()),
            region: "us-ashburn-1".into(),
            metadata: None,
            shape_config: Some(OciShapeConfig {
                ocpus: Some(2.0),
                memory_in_gbs: Some(16.0),
                baseline_ocpu_utilization: None,
                gpu_description: None,
                gpus: None,
                networking_bandwidth_in_gbps: Some(2.0),
            }),
            source_details: None,
            launch_options: None,
            agent_config: None,
            defined_tags: None,
            freeform_tags: None,
        };
        let json = serde_json::to_string(&instance).unwrap();
        let parsed: OciInstance = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.display_name, "test-vm");
        assert_eq!(parsed.lifecycle_state, "RUNNING");
        assert_eq!(parsed.shape_config.unwrap().ocpus, Some(2.0));
    }

    #[test]
    fn test_shape_roundtrip() {
        let shape = OciShape {
            shape: "VM.Standard.E4.Flex".into(),
            ocpus: Some(4.0),
            memory_in_gbs: Some(64.0),
            networking_bandwidth_in_gbps: Some(4.0),
            gpu_description: None,
            gpus: None,
            is_flexible: Some(true),
        };
        let json = serde_json::to_string(&shape).unwrap();
        let parsed: OciShape = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.shape, "VM.Standard.E4.Flex");
        assert_eq!(parsed.is_flexible, Some(true));
    }

    #[test]
    fn test_image_roundtrip() {
        let image = OciImage {
            id: "ocid1.image.oc1..aaa".into(),
            display_name: "Oracle-Linux-8.8".into(),
            compartment_id: "comp-1".into(),
            operating_system: "Oracle Linux".into(),
            operating_system_version: "8.8".into(),
            lifecycle_state: "AVAILABLE".into(),
            size_in_mbs: Some(47694),
            time_created: "2025-03-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&image).unwrap();
        let parsed: OciImage = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.operating_system, "Oracle Linux");
        assert_eq!(parsed.size_in_mbs, Some(47694));
    }

    #[test]
    fn test_vcn_roundtrip() {
        let vcn = OciVcn {
            id: "ocid1.vcn.oc1..aaa".into(),
            display_name: "my-vcn".into(),
            compartment_id: "comp-1".into(),
            cidr_block: "10.0.0.0/16".into(),
            cidr_blocks: Some(vec!["10.0.0.0/16".into()]),
            dns_label: Some("myvcn".into()),
            lifecycle_state: "AVAILABLE".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
            default_route_table_id: Some("ocid1.routetable.oc1..aaa".into()),
            default_security_list_id: Some("ocid1.securitylist.oc1..aaa".into()),
            default_dhcp_options_id: None,
        };
        let json = serde_json::to_string(&vcn).unwrap();
        let parsed: OciVcn = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.cidr_block, "10.0.0.0/16");
        assert_eq!(parsed.dns_label, Some("myvcn".into()));
    }

    #[test]
    fn test_subnet_roundtrip() {
        let subnet = OciSubnet {
            id: "ocid1.subnet.oc1..aaa".into(),
            display_name: "public-subnet".into(),
            compartment_id: "comp-1".into(),
            vcn_id: "ocid1.vcn.oc1..aaa".into(),
            cidr_block: "10.0.1.0/24".into(),
            availability_domain: Some("AD-1".into()),
            lifecycle_state: "AVAILABLE".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
            route_table_id: None,
            security_list_ids: Some(vec!["ocid1.securitylist.oc1..aaa".into()]),
            dns_label: Some("pubsub".into()),
            prohibit_public_ip_on_vnic: Some(false),
        };
        let json = serde_json::to_string(&subnet).unwrap();
        let parsed: OciSubnet = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.cidr_block, "10.0.1.0/24");
        assert_eq!(parsed.prohibit_public_ip_on_vnic, Some(false));
    }

    #[test]
    fn test_security_list_roundtrip() {
        let sl = OciSecurityList {
            id: "ocid1.securitylist.oc1..aaa".into(),
            display_name: "default".into(),
            compartment_id: "comp-1".into(),
            vcn_id: "ocid1.vcn.oc1..aaa".into(),
            lifecycle_state: "AVAILABLE".into(),
            ingress_security_rules: vec![OciSecurityRule {
                protocol: "6".into(),
                source: Some("0.0.0.0/0".into()),
                destination: None,
                description: Some("Allow SSH".into()),
                is_stateless: Some(false),
                tcp_options: None,
                udp_options: None,
                icmp_options: None,
            }],
            egress_security_rules: vec![],
        };
        let json = serde_json::to_string(&sl).unwrap();
        let parsed: OciSecurityList = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.ingress_security_rules.len(), 1);
        assert_eq!(parsed.ingress_security_rules[0].protocol, "6");
    }

    #[test]
    fn test_block_volume_roundtrip() {
        let vol = OciBlockVolume {
            id: "ocid1.volume.oc1..aaa".into(),
            display_name: "data-vol".into(),
            compartment_id: "comp-1".into(),
            availability_domain: "AD-1".into(),
            size_in_gbs: 256,
            lifecycle_state: "AVAILABLE".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
            vpus_per_gb: Some(10),
        };
        let json = serde_json::to_string(&vol).unwrap();
        let parsed: OciBlockVolume = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.size_in_gbs, 256);
        assert_eq!(parsed.vpus_per_gb, Some(10));
    }

    #[test]
    fn test_bucket_roundtrip() {
        let bucket = OciBucket {
            name: "my-bucket".into(),
            namespace_name: "myns".into(),
            compartment_id: "comp-1".into(),
            created_by: "ocid1.user.oc1..aaa".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
            etag: "abc123".into(),
            public_access_type: Some("NoPublicAccess".into()),
            storage_tier: Some("Standard".into()),
            object_lifecycle_policy_etag: None,
            freeform_tags: None,
            approximate_count: Some(42),
            approximate_size: Some(1073741824),
        };
        let json = serde_json::to_string(&bucket).unwrap();
        let parsed: OciBucket = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "my-bucket");
        assert_eq!(parsed.approximate_count, Some(42));
    }

    #[test]
    fn test_compartment_roundtrip() {
        let comp = OciCompartment {
            id: "ocid1.compartment.oc1..aaa".into(),
            name: "my-compartment".into(),
            description: "Test compartment".into(),
            compartment_id: "ocid1.tenancy.oc1..aaa".into(),
            lifecycle_state: "ACTIVE".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
            freeform_tags: None,
        };
        let json = serde_json::to_string(&comp).unwrap();
        let parsed: OciCompartment = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "my-compartment");
    }

    #[test]
    fn test_user_roundtrip() {
        let user = OciUser {
            id: "ocid1.user.oc1..aaa".into(),
            name: "admin".into(),
            description: "Admin user".into(),
            compartment_id: "ocid1.tenancy.oc1..aaa".into(),
            lifecycle_state: "ACTIVE".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
            email: Some("admin@example.com".into()),
            is_mfa_activated: Some(true),
        };
        let json = serde_json::to_string(&user).unwrap();
        let parsed: OciUser = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "admin");
        assert_eq!(parsed.is_mfa_activated, Some(true));
    }

    #[test]
    fn test_policy_roundtrip() {
        let policy = OciPolicy {
            id: "ocid1.policy.oc1..aaa".into(),
            name: "admin-policy".into(),
            description: "Admin access".into(),
            compartment_id: "comp-1".into(),
            lifecycle_state: "ACTIVE".into(),
            statements: vec![
                "Allow group Admins to manage all-resources in tenancy".into(),
            ],
            time_created: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&policy).unwrap();
        let parsed: OciPolicy = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.statements.len(), 1);
    }

    #[test]
    fn test_db_system_roundtrip() {
        let db = OciDbSystem {
            id: "ocid1.dbsystem.oc1..aaa".into(),
            display_name: "mydb".into(),
            compartment_id: "comp-1".into(),
            availability_domain: "AD-1".into(),
            shape: "VM.Standard2.1".into(),
            lifecycle_state: "AVAILABLE".into(),
            db_version: "19.0.0.0".into(),
            cpu_core_count: 1,
            data_storage_size_in_gbs: Some(256),
            node_count: Some(1),
            time_created: "2025-01-01T00:00:00Z".into(),
            subnet_id: "ocid1.subnet.oc1..aaa".into(),
        };
        let json = serde_json::to_string(&db).unwrap();
        let parsed: OciDbSystem = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.db_version, "19.0.0.0");
    }

    #[test]
    fn test_autonomous_db_roundtrip() {
        let adb = OciAutonomousDb {
            id: "ocid1.autonomousdatabase.oc1..aaa".into(),
            display_name: "my-adb".into(),
            compartment_id: "comp-1".into(),
            lifecycle_state: "AVAILABLE".into(),
            db_name: "MYDB".into(),
            db_version: Some("19c".into()),
            cpu_core_count: 1,
            data_storage_size_in_tbs: Some(1),
            is_free_tier: Some(true),
            time_created: "2025-01-01T00:00:00Z".into(),
            connection_strings: None,
        };
        let json = serde_json::to_string(&adb).unwrap();
        let parsed: OciAutonomousDb = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.db_name, "MYDB");
        assert_eq!(parsed.is_free_tier, Some(true));
    }

    #[test]
    fn test_container_instance_roundtrip() {
        let ci = OciContainerInstance {
            id: "ocid1.containerinstance.oc1..aaa".into(),
            display_name: "my-ci".into(),
            compartment_id: "comp-1".into(),
            availability_domain: "AD-1".into(),
            lifecycle_state: "ACTIVE".into(),
            shape: "CI.Standard.E4.Flex".into(),
            shape_config: Some(OciShapeConfig {
                ocpus: Some(1.0),
                memory_in_gbs: Some(4.0),
                baseline_ocpu_utilization: None,
                gpu_description: None,
                gpus: None,
                networking_bandwidth_in_gbps: None,
            }),
            container_count: 2,
            time_created: "2025-01-01T00:00:00Z".into(),
            vnics: None,
            containers: Some(vec![OciContainer {
                container_id: "cid-1".into(),
                display_name: "nginx".into(),
                image_url: "docker.io/library/nginx:latest".into(),
                lifecycle_state: "ACTIVE".into(),
                resource_config: None,
                health_checks: None,
            }]),
        };
        let json = serde_json::to_string(&ci).unwrap();
        let parsed: OciContainerInstance = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.container_count, 2);
        assert_eq!(parsed.containers.unwrap().len(), 1);
    }

    #[test]
    fn test_oke_cluster_roundtrip() {
        let cluster = OkeCluster {
            id: "ocid1.cluster.oc1..aaa".into(),
            name: "my-cluster".into(),
            compartment_id: "comp-1".into(),
            vcn_id: "ocid1.vcn.oc1..aaa".into(),
            kubernetes_version: "v1.28.2".into(),
            lifecycle_state: "ACTIVE".into(),
            endpoint_config: None,
            options: None,
            time_created: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&cluster).unwrap();
        let parsed: OkeCluster = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.kubernetes_version, "v1.28.2");
    }

    #[test]
    fn test_function_roundtrip() {
        let func = OciFunction {
            id: "ocid1.fnfunc.oc1..aaa".into(),
            display_name: "hello-fn".into(),
            application_id: "ocid1.fnapp.oc1..aaa".into(),
            compartment_id: "comp-1".into(),
            image: "iad.ocir.io/myns/hello:0.0.1".into(),
            memory_in_mbs: 256,
            timeout_in_seconds: 30,
            lifecycle_state: "ACTIVE".into(),
            invoke_endpoint: Some("https://abc.us-ashburn-1.functions.oci.oraclecloud.com".into()),
            time_created: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&func).unwrap();
        let parsed: OciFunction = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.memory_in_mbs, 256);
        assert!(parsed.invoke_endpoint.is_some());
    }

    #[test]
    fn test_alarm_roundtrip() {
        let alarm = OciAlarm {
            id: "ocid1.alarm.oc1..aaa".into(),
            display_name: "high-cpu".into(),
            compartment_id: "comp-1".into(),
            namespace_name: "oci_computeagent".into(),
            query: "CpuUtilization[1m].mean() > 80".into(),
            severity: "CRITICAL".into(),
            lifecycle_state: "ACTIVE".into(),
            is_enabled: true,
            destinations: vec!["ocid1.onstopic.oc1..aaa".into()],
            time_created: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&alarm).unwrap();
        let parsed: OciAlarm = serde_json::from_str(&json).unwrap();
        assert!(parsed.is_enabled);
        assert_eq!(parsed.severity, "CRITICAL");
    }

    #[test]
    fn test_metric_data_roundtrip() {
        let metric = OciMetricData {
            namespace_name: "oci_computeagent".into(),
            name: "CpuUtilization".into(),
            compartment_id: "comp-1".into(),
            dimensions: serde_json::json!({"resourceId": "ocid1.instance.oc1..aaa"}),
            aggregated_datapoints: vec![
                OciDatapoint {
                    timestamp: "2025-01-01T00:00:00Z".into(),
                    value: 45.2,
                },
                OciDatapoint {
                    timestamp: "2025-01-01T00:01:00Z".into(),
                    value: 52.8,
                },
            ],
        };
        let json = serde_json::to_string(&metric).unwrap();
        let parsed: OciMetricData = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.aggregated_datapoints.len(), 2);
        assert!((parsed.aggregated_datapoints[0].value - 45.2).abs() < f64::EPSILON);
    }

    #[test]
    fn test_audit_event_roundtrip() {
        let event = OciAuditEvent {
            event_type: "com.oraclecloud.computeApi.LaunchInstance.begin".into(),
            compartment_id: "comp-1".into(),
            event_time: "2025-01-01T00:00:00Z".into(),
            source: "compute".into(),
            event_name: "LaunchInstance".into(),
            data: Some(serde_json::json!({"instanceId": "ocid1.instance.oc1..aaa"})),
        };
        let json = serde_json::to_string(&event).unwrap();
        let parsed: OciAuditEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.event_name, "LaunchInstance");
    }

    #[test]
    fn test_dashboard_roundtrip() {
        let dash = OciDashboard {
            region: "us-ashburn-1".into(),
            total_instances: 10,
            running_instances: 7,
            total_vcns: 3,
            total_subnets: 9,
            total_volumes: 15,
            total_buckets: 5,
            total_autonomous_dbs: 2,
            total_compartments: 4,
            recent_audit_events: vec![],
        };
        let json = serde_json::to_string(&dash).unwrap();
        let parsed: OciDashboard = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.total_instances, 10);
        assert_eq!(parsed.running_instances, 7);
        assert!(parsed.recent_audit_events.is_empty());
    }

    #[test]
    fn test_load_balancer_roundtrip() {
        let lb = OciLoadBalancer {
            id: "ocid1.loadbalancer.oc1..aaa".into(),
            display_name: "my-lb".into(),
            compartment_id: "comp-1".into(),
            lifecycle_state: "ACTIVE".into(),
            shape_name: "flexible".into(),
            ip_addresses: vec![OciIpAddress {
                ip_address: "203.0.113.1".into(),
                is_public: Some(true),
            }],
            subnet_ids: vec!["ocid1.subnet.oc1..aaa".into()],
            is_private: Some(false),
            time_created: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&lb).unwrap();
        let parsed: OciLoadBalancer = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.ip_addresses.len(), 1);
        assert_eq!(parsed.ip_addresses[0].is_public, Some(true));
    }

    #[test]
    fn test_volume_attachment_roundtrip() {
        let va = OciVolumeAttachment {
            id: "ocid1.volumeattachment.oc1..aaa".into(),
            instance_id: "ocid1.instance.oc1..aaa".into(),
            volume_id: "ocid1.volume.oc1..aaa".into(),
            attachment_type: "iscsi".into(),
            lifecycle_state: "ATTACHED".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
            device: Some("/dev/oracleoci/oraclevdb".into()),
            is_read_only: Some(false),
        };
        let json = serde_json::to_string(&va).unwrap();
        let parsed: OciVolumeAttachment = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.attachment_type, "iscsi");
    }

    #[test]
    fn test_nsg_roundtrip() {
        let nsg = OciNetworkSecurityGroup {
            id: "ocid1.networksecuritygroup.oc1..aaa".into(),
            display_name: "my-nsg".into(),
            compartment_id: "comp-1".into(),
            vcn_id: "ocid1.vcn.oc1..aaa".into(),
            lifecycle_state: "AVAILABLE".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&nsg).unwrap();
        let parsed: OciNetworkSecurityGroup = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.display_name, "my-nsg");
    }

    #[test]
    fn test_function_application_roundtrip() {
        let app = OciFunctionApplication {
            id: "ocid1.fnapp.oc1..aaa".into(),
            display_name: "my-app".into(),
            compartment_id: "comp-1".into(),
            lifecycle_state: "ACTIVE".into(),
            subnet_ids: vec!["ocid1.subnet.oc1..aaa".into()],
            time_created: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&app).unwrap();
        let parsed: OciFunctionApplication = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.subnet_ids.len(), 1);
    }

    #[test]
    fn test_node_pool_roundtrip() {
        let np = OkeNodePool {
            id: "ocid1.nodepool.oc1..aaa".into(),
            name: "pool-1".into(),
            cluster_id: "ocid1.cluster.oc1..aaa".into(),
            compartment_id: "comp-1".into(),
            kubernetes_version: "v1.28.2".into(),
            node_shape: "VM.Standard.E4.Flex".into(),
            node_source: None,
            quantity_per_subnet: Some(3),
            lifecycle_state: "ACTIVE".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&np).unwrap();
        let parsed: OkeNodePool = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.quantity_per_subnet, Some(3));
    }

    #[test]
    fn test_boot_volume_roundtrip() {
        let bv = OciBootVolume {
            id: "ocid1.bootvolume.oc1..aaa".into(),
            display_name: "boot-vol".into(),
            compartment_id: "comp-1".into(),
            availability_domain: "AD-1".into(),
            size_in_gbs: 50,
            lifecycle_state: "AVAILABLE".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
            image_id: Some("ocid1.image.oc1..aaa".into()),
            vpus_per_gb: Some(10),
        };
        let json = serde_json::to_string(&bv).unwrap();
        let parsed: OciBootVolume = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.size_in_gbs, 50);
    }

    #[test]
    fn test_route_table_roundtrip() {
        let rt = OciRouteTable {
            id: "ocid1.routetable.oc1..aaa".into(),
            display_name: "my-rt".into(),
            compartment_id: "comp-1".into(),
            vcn_id: "ocid1.vcn.oc1..aaa".into(),
            lifecycle_state: "AVAILABLE".into(),
            route_rules: vec![OciRouteRule {
                destination: "0.0.0.0/0".into(),
                destination_type: "CIDR_BLOCK".into(),
                network_entity_id: "ocid1.internetgateway.oc1..aaa".into(),
                description: Some("Default route".into()),
            }],
        };
        let json = serde_json::to_string(&rt).unwrap();
        let parsed: OciRouteTable = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.route_rules.len(), 1);
        assert_eq!(parsed.route_rules[0].destination, "0.0.0.0/0");
    }

    #[test]
    fn test_internet_gateway_roundtrip() {
        let igw = OciInternetGateway {
            id: "ocid1.internetgateway.oc1..aaa".into(),
            display_name: "my-igw".into(),
            compartment_id: "comp-1".into(),
            vcn_id: "ocid1.vcn.oc1..aaa".into(),
            lifecycle_state: "AVAILABLE".into(),
            is_enabled: true,
            time_created: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&igw).unwrap();
        let parsed: OciInternetGateway = serde_json::from_str(&json).unwrap();
        assert!(parsed.is_enabled);
    }

    #[test]
    fn test_nat_gateway_roundtrip() {
        let nat = OciNatGateway {
            id: "ocid1.natgateway.oc1..aaa".into(),
            display_name: "my-nat".into(),
            compartment_id: "comp-1".into(),
            vcn_id: "ocid1.vcn.oc1..aaa".into(),
            lifecycle_state: "AVAILABLE".into(),
            nat_ip: "129.213.10.1".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&nat).unwrap();
        let parsed: OciNatGateway = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.nat_ip, "129.213.10.1");
    }

    #[test]
    fn test_group_roundtrip() {
        let group = OciGroup {
            id: "ocid1.group.oc1..aaa".into(),
            name: "Admins".into(),
            description: "Admin group".into(),
            compartment_id: "ocid1.tenancy.oc1..aaa".into(),
            lifecycle_state: "ACTIVE".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&group).unwrap();
        let parsed: OciGroup = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "Admins");
    }

    #[test]
    fn test_object_roundtrip() {
        let obj = OciObject {
            name: "data/file.csv".into(),
            size: Some(1024),
            md5: Some("abc123".into()),
            time_created: Some("2025-01-01T00:00:00Z".into()),
            etag: Some("etag-1".into()),
            storage_tier: Some("Standard".into()),
        };
        let json = serde_json::to_string(&obj).unwrap();
        let parsed: OciObject = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "data/file.csv");
        assert_eq!(parsed.size, Some(1024));
    }

    #[test]
    fn test_launch_instance_request_roundtrip() {
        let req = LaunchInstanceRequest {
            compartment_id: "comp-1".into(),
            availability_domain: "AD-1".into(),
            shape: "VM.Standard.E4.Flex".into(),
            display_name: Some("new-vm".into()),
            image_id: Some("ocid1.image.oc1..aaa".into()),
            subnet_id: Some("ocid1.subnet.oc1..aaa".into()),
            shape_config: None,
            metadata: None,
            ssh_authorized_keys: Some("ssh-rsa AAAA...".into()),
        };
        let json = serde_json::to_string(&req).unwrap();
        let parsed: LaunchInstanceRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.display_name, Some("new-vm".into()));
    }

    #[test]
    fn test_vnic_attachment_roundtrip() {
        let va = OciVnicAttachment {
            id: "ocid1.vnicattachment.oc1..aaa".into(),
            instance_id: "ocid1.instance.oc1..aaa".into(),
            vnic_id: "ocid1.vnic.oc1..aaa".into(),
            subnet_id: "ocid1.subnet.oc1..aaa".into(),
            lifecycle_state: "ATTACHED".into(),
            time_created: "2025-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&va).unwrap();
        let parsed: OciVnicAttachment = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.lifecycle_state, "ATTACHED");
    }
}
