//! Amazon EC2 (Elastic Compute Cloud) service client.
//!
//! Mirrors `aws-sdk-ec2` types and operations. EC2 uses the AWS Query protocol
//! with XML responses (API version 2016-11-15).
//!
//! Reference: <https://docs.aws.amazon.com/AWSEC2/latest/APIReference/>

use crate::client::{self, AwsClient};
use crate::config::Filter;
use crate::error::{AwsError, AwsResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const API_VERSION: &str = "2016-11-15";
const SERVICE: &str = "ec2";

// ── Types ───────────────────────────────────────────────────────────────

/// EC2 instance as returned by DescribeInstances.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instance {
    pub instance_id: String,
    pub image_id: String,
    pub instance_type: String,
    pub state: InstanceState,
    pub public_ip_address: Option<String>,
    pub private_ip_address: Option<String>,
    pub public_dns_name: Option<String>,
    pub private_dns_name: Option<String>,
    pub launch_time: String,
    pub availability_zone: String,
    pub subnet_id: Option<String>,
    pub vpc_id: Option<String>,
    pub key_name: Option<String>,
    pub security_groups: Vec<GroupIdentifier>,
    pub tags: HashMap<String, String>,
    pub architecture: Option<String>,
    pub root_device_type: Option<String>,
    pub root_device_name: Option<String>,
    pub platform: Option<String>,
    pub iam_instance_profile: Option<IamInstanceProfile>,
    pub ebs_optimized: bool,
    pub hypervisor: Option<String>,
    pub monitoring_state: Option<String>,
    pub placement: Option<Placement>,
    pub block_device_mappings: Vec<InstanceBlockDeviceMapping>,
    pub network_interfaces: Vec<InstanceNetworkInterface>,
}

/// Instance state (name + code) as returned by the EC2 API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceState {
    /// State code: 0=pending, 16=running, 32=shutting-down, 48=terminated, 64=stopping, 80=stopped
    pub code: u16,
    /// State name: pending, running, shutting-down, terminated, stopping, stopped
    pub name: String,
}

impl InstanceState {
    pub fn running() -> Self {
        Self { code: 16, name: "running".to_string() }
    }
    pub fn stopped() -> Self {
        Self { code: 80, name: "stopped".to_string() }
    }
    pub fn pending() -> Self {
        Self { code: 0, name: "pending".to_string() }
    }
    pub fn terminated() -> Self {
        Self { code: 48, name: "terminated".to_string() }
    }
}

/// Security group identifier.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupIdentifier {
    pub group_id: String,
    pub group_name: String,
}

/// IAM instance profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IamInstanceProfile {
    pub arn: String,
    pub id: String,
}

/// Instance placement.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Placement {
    pub availability_zone: String,
    pub tenancy: Option<String>,
    pub group_name: Option<String>,
    pub host_id: Option<String>,
}

/// Block device mapping on an instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceBlockDeviceMapping {
    pub device_name: String,
    pub ebs: Option<EbsInstanceBlockDevice>,
}

/// EBS volume attached to an instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EbsInstanceBlockDevice {
    pub volume_id: String,
    pub status: String,
    pub attach_time: String,
    pub delete_on_termination: bool,
}

/// Network interface on an instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceNetworkInterface {
    pub network_interface_id: String,
    pub subnet_id: Option<String>,
    pub vpc_id: Option<String>,
    pub private_ip_address: Option<String>,
    pub public_ip: Option<String>,
    pub mac_address: Option<String>,
    pub status: String,
}

/// EC2 Security Group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityGroup {
    pub group_id: String,
    pub group_name: String,
    pub description: String,
    pub vpc_id: Option<String>,
    pub ip_permissions: Vec<IpPermission>,
    pub ip_permissions_egress: Vec<IpPermission>,
    pub tags: HashMap<String, String>,
}

/// IP permission (firewall rule).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpPermission {
    pub ip_protocol: String,
    pub from_port: Option<i32>,
    pub to_port: Option<i32>,
    pub ip_ranges: Vec<IpRange>,
    pub ipv6_ranges: Vec<Ipv6Range>,
    pub prefix_list_ids: Vec<PrefixListId>,
    pub user_id_group_pairs: Vec<UserIdGroupPair>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpRange {
    pub cidr_ip: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ipv6Range {
    pub cidr_ipv6: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrefixListId {
    pub prefix_list_id: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserIdGroupPair {
    pub group_id: String,
    pub group_name: Option<String>,
    pub user_id: Option<String>,
    pub description: Option<String>,
}

/// EC2 Key Pair info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyPairInfo {
    pub key_pair_id: String,
    pub key_name: String,
    pub key_fingerprint: String,
    pub key_type: Option<String>,
    pub create_time: Option<String>,
    pub tags: HashMap<String, String>,
}

/// VPC (Virtual Private Cloud).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vpc {
    pub vpc_id: String,
    pub cidr_block: String,
    pub state: String,
    pub is_default: bool,
    pub dhcp_options_id: Option<String>,
    pub instance_tenancy: Option<String>,
    pub tags: HashMap<String, String>,
}

/// Subnet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subnet {
    pub subnet_id: String,
    pub vpc_id: String,
    pub cidr_block: String,
    pub availability_zone: String,
    pub available_ip_address_count: u32,
    pub default_for_az: bool,
    pub map_public_ip_on_launch: bool,
    pub state: String,
    pub tags: HashMap<String, String>,
}

/// Elastic IP Address.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Address {
    pub allocation_id: String,
    pub public_ip: String,
    pub association_id: Option<String>,
    pub instance_id: Option<String>,
    pub network_interface_id: Option<String>,
    pub private_ip_address: Option<String>,
    pub domain: String,
    pub tags: HashMap<String, String>,
}

/// EBS Volume.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Volume {
    pub volume_id: String,
    pub size: u32,
    pub volume_type: String,
    pub state: String,
    pub availability_zone: String,
    pub encrypted: bool,
    pub iops: Option<u32>,
    pub throughput: Option<u32>,
    pub kms_key_id: Option<String>,
    pub snapshot_id: Option<String>,
    pub create_time: String,
    pub attachments: Vec<VolumeAttachment>,
    pub tags: HashMap<String, String>,
}

/// Volume attachment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeAttachment {
    pub volume_id: String,
    pub instance_id: String,
    pub device: String,
    pub state: String,
    pub attach_time: String,
    pub delete_on_termination: bool,
}

/// EBS Snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub snapshot_id: String,
    pub volume_id: String,
    pub state: String,
    pub volume_size: u32,
    pub start_time: String,
    pub description: Option<String>,
    pub encrypted: bool,
    pub owner_id: String,
    pub progress: String,
    pub tags: HashMap<String, String>,
}

/// AMI (Amazon Machine Image).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Image {
    pub image_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub state: String,
    pub image_type: String,
    pub architecture: String,
    pub platform: Option<String>,
    pub root_device_type: String,
    pub root_device_name: Option<String>,
    pub owner_id: String,
    pub creation_date: Option<String>,
    pub public: bool,
    pub tags: HashMap<String, String>,
}

/// EC2 reservation (groups instances).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reservation {
    pub reservation_id: String,
    pub owner_id: String,
    pub instances: Vec<Instance>,
    pub groups: Vec<GroupIdentifier>,
}

/// Input for RunInstances.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunInstancesInput {
    pub image_id: String,
    pub instance_type: String,
    pub min_count: u32,
    pub max_count: u32,
    pub key_name: Option<String>,
    pub security_group_ids: Vec<String>,
    pub subnet_id: Option<String>,
    pub user_data: Option<String>,
    pub iam_instance_profile: Option<String>,
    pub tags: HashMap<String, String>,
    pub ebs_optimized: Option<bool>,
    pub monitoring_enabled: Option<bool>,
    pub disable_api_termination: Option<bool>,
    pub block_device_mappings: Vec<BlockDeviceMapping>,
}

/// Block device mapping for launching instances.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockDeviceMapping {
    pub device_name: String,
    pub ebs: Option<EbsBlockDevice>,
    pub virtual_name: Option<String>,
    pub no_device: Option<String>,
}

/// EBS block device configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EbsBlockDevice {
    pub volume_size: Option<u32>,
    pub volume_type: Option<String>,
    pub iops: Option<u32>,
    pub throughput: Option<u32>,
    pub delete_on_termination: Option<bool>,
    pub encrypted: Option<bool>,
    pub snapshot_id: Option<String>,
    pub kms_key_id: Option<String>,
}

/// Input for CreateSecurityGroup.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSecurityGroupInput {
    pub group_name: String,
    pub description: String,
    pub vpc_id: Option<String>,
    pub tags: HashMap<String, String>,
}

/// Input for AuthorizeSecurityGroupIngress/Egress.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorizeSecurityGroupInput {
    pub group_id: String,
    pub ip_permissions: Vec<IpPermission>,
}

/// Instance state change result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceStateChange {
    pub instance_id: String,
    pub previous_state: InstanceState,
    pub current_state: InstanceState,
}

// ── EC2 Client ──────────────────────────────────────────────────────────

/// EC2 service client.
pub struct Ec2Client {
    client: AwsClient,
}

impl Ec2Client {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    /// DescribeInstances - list EC2 instances with optional filters.
    pub async fn describe_instances(
        &self,
        instance_ids: &[String],
        filters: &[Filter],
        next_token: Option<&str>,
        max_results: Option<u32>,
    ) -> AwsResult<(Vec<Reservation>, Option<String>)> {
        let mut params = client::build_query_params("DescribeInstances", API_VERSION);

        for (i, id) in instance_ids.iter().enumerate() {
            params.insert(format!("InstanceId.{}", i + 1), id.clone());
        }
        client::add_filters(&mut params, filters);

        if let Some(token) = next_token {
            params.insert("NextToken".to_string(), token.to_string());
        }
        if let Some(max) = max_results {
            params.insert("MaxResults".to_string(), max.to_string());
        }

        let response = self.client.query_request(SERVICE, &params).await?;
        let reservations = self.parse_describe_instances_response(&response.body);
        let token = client::xml_text(&response.body, "nextToken");
        Ok((reservations, token))
    }

    /// RunInstances - launch new EC2 instances.
    pub async fn run_instances(&self, input: &RunInstancesInput) -> AwsResult<Reservation> {
        let mut params = client::build_query_params("RunInstances", API_VERSION);
        params.insert("ImageId".to_string(), input.image_id.clone());
        params.insert("InstanceType".to_string(), input.instance_type.clone());
        params.insert("MinCount".to_string(), input.min_count.to_string());
        params.insert("MaxCount".to_string(), input.max_count.to_string());

        if let Some(ref key) = input.key_name {
            params.insert("KeyName".to_string(), key.clone());
        }
        for (i, sg) in input.security_group_ids.iter().enumerate() {
            params.insert(format!("SecurityGroupId.{}", i + 1), sg.clone());
        }
        if let Some(ref subnet) = input.subnet_id {
            params.insert("SubnetId".to_string(), subnet.clone());
        }
        if let Some(ref user_data) = input.user_data {
            params.insert("UserData".to_string(), base64::Engine::encode(&base64::engine::general_purpose::STANDARD, user_data));
        }
        if let Some(ref profile) = input.iam_instance_profile {
            params.insert("IamInstanceProfile.Arn".to_string(), profile.clone());
        }
        if let Some(ebs_opt) = input.ebs_optimized {
            params.insert("EbsOptimized".to_string(), ebs_opt.to_string());
        }
        if let Some(monitoring) = input.monitoring_enabled {
            params.insert("Monitoring.Enabled".to_string(), monitoring.to_string());
        }

        // Tags
        let tags: Vec<crate::config::Tag> = input
            .tags
            .iter()
            .map(|(k, v)| crate::config::Tag::new(k, v))
            .collect();
        if !tags.is_empty() {
            params.insert("TagSpecification.1.ResourceType".to_string(), "instance".to_string());
            for (i, tag) in tags.iter().enumerate() {
                params.insert(
                    format!("TagSpecification.1.Tag.{}.Key", i + 1),
                    tag.key.clone(),
                );
                params.insert(
                    format!("TagSpecification.1.Tag.{}.Value", i + 1),
                    tag.value.clone(),
                );
            }
        }

        // Block device mappings
        for (i, bdm) in input.block_device_mappings.iter().enumerate() {
            let prefix = format!("BlockDeviceMapping.{}", i + 1);
            params.insert(format!("{}.DeviceName", prefix), bdm.device_name.clone());
            if let Some(ref ebs) = bdm.ebs {
                if let Some(size) = ebs.volume_size {
                    params.insert(format!("{}.Ebs.VolumeSize", prefix), size.to_string());
                }
                if let Some(ref vtype) = ebs.volume_type {
                    params.insert(format!("{}.Ebs.VolumeType", prefix), vtype.clone());
                }
                if let Some(del) = ebs.delete_on_termination {
                    params.insert(format!("{}.Ebs.DeleteOnTermination", prefix), del.to_string());
                }
                if let Some(enc) = ebs.encrypted {
                    params.insert(format!("{}.Ebs.Encrypted", prefix), enc.to_string());
                }
            }
        }

        let response = self.client.query_request(SERVICE, &params).await?;
        let reservations = self.parse_describe_instances_response(&response.body);
        reservations
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No reservation in RunInstances response", 200))
    }

    /// StartInstances
    pub async fn start_instances(&self, instance_ids: &[String]) -> AwsResult<Vec<InstanceStateChange>> {
        let mut params = client::build_query_params("StartInstances", API_VERSION);
        for (i, id) in instance_ids.iter().enumerate() {
            params.insert(format!("InstanceId.{}", i + 1), id.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_instance_state_changes(&response.body))
    }

    /// StopInstances
    pub async fn stop_instances(&self, instance_ids: &[String], force: bool) -> AwsResult<Vec<InstanceStateChange>> {
        let mut params = client::build_query_params("StopInstances", API_VERSION);
        for (i, id) in instance_ids.iter().enumerate() {
            params.insert(format!("InstanceId.{}", i + 1), id.clone());
        }
        if force {
            params.insert("Force".to_string(), "true".to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_instance_state_changes(&response.body))
    }

    /// RebootInstances
    pub async fn reboot_instances(&self, instance_ids: &[String]) -> AwsResult<()> {
        let mut params = client::build_query_params("RebootInstances", API_VERSION);
        for (i, id) in instance_ids.iter().enumerate() {
            params.insert(format!("InstanceId.{}", i + 1), id.clone());
        }
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    /// TerminateInstances
    pub async fn terminate_instances(&self, instance_ids: &[String]) -> AwsResult<Vec<InstanceStateChange>> {
        let mut params = client::build_query_params("TerminateInstances", API_VERSION);
        for (i, id) in instance_ids.iter().enumerate() {
            params.insert(format!("InstanceId.{}", i + 1), id.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_instance_state_changes(&response.body))
    }

    /// DescribeSecurityGroups.
    pub async fn describe_security_groups(
        &self,
        group_ids: &[String],
        filters: &[Filter],
    ) -> AwsResult<Vec<SecurityGroup>> {
        let mut params = client::build_query_params("DescribeSecurityGroups", API_VERSION);
        for (i, id) in group_ids.iter().enumerate() {
            params.insert(format!("GroupId.{}", i + 1), id.clone());
        }
        client::add_filters(&mut params, filters);
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_security_groups(&response.body))
    }

    /// CreateSecurityGroup.
    pub async fn create_security_group(&self, input: &CreateSecurityGroupInput) -> AwsResult<String> {
        let mut params = client::build_query_params("CreateSecurityGroup", API_VERSION);
        params.insert("GroupName".to_string(), input.group_name.clone());
        params.insert("GroupDescription".to_string(), input.description.clone());
        if let Some(ref vpc) = input.vpc_id {
            params.insert("VpcId".to_string(), vpc.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        client::xml_text(&response.body, "groupId")
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No groupId in response", 200))
    }

    /// DeleteSecurityGroup.
    pub async fn delete_security_group(&self, group_id: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DeleteSecurityGroup", API_VERSION);
        params.insert("GroupId".to_string(), group_id.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    /// AuthorizeSecurityGroupIngress.
    pub async fn authorize_security_group_ingress(&self, input: &AuthorizeSecurityGroupInput) -> AwsResult<()> {
        let mut params = client::build_query_params("AuthorizeSecurityGroupIngress", API_VERSION);
        params.insert("GroupId".to_string(), input.group_id.clone());
        self.add_ip_permissions_params(&mut params, &input.ip_permissions);
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    /// AuthorizeSecurityGroupEgress.
    pub async fn authorize_security_group_egress(&self, input: &AuthorizeSecurityGroupInput) -> AwsResult<()> {
        let mut params = client::build_query_params("AuthorizeSecurityGroupEgress", API_VERSION);
        params.insert("GroupId".to_string(), input.group_id.clone());
        self.add_ip_permissions_params(&mut params, &input.ip_permissions);
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    /// DescribeKeyPairs.
    pub async fn describe_key_pairs(&self, key_names: &[String]) -> AwsResult<Vec<KeyPairInfo>> {
        let mut params = client::build_query_params("DescribeKeyPairs", API_VERSION);
        for (i, name) in key_names.iter().enumerate() {
            params.insert(format!("KeyName.{}", i + 1), name.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_key_pairs(&response.body))
    }

    /// CreateKeyPair.
    pub async fn create_key_pair(&self, key_name: &str, key_type: Option<&str>) -> AwsResult<(KeyPairInfo, String)> {
        let mut params = client::build_query_params("CreateKeyPair", API_VERSION);
        params.insert("KeyName".to_string(), key_name.to_string());
        if let Some(kt) = key_type {
            params.insert("KeyType".to_string(), kt.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        let key_material = client::xml_text(&response.body, "keyMaterial")
            .unwrap_or_default();
        let info = KeyPairInfo {
            key_pair_id: client::xml_text(&response.body, "keyPairId").unwrap_or_default(),
            key_name: client::xml_text(&response.body, "keyName").unwrap_or_else(|| key_name.to_string()),
            key_fingerprint: client::xml_text(&response.body, "keyFingerprint").unwrap_or_default(),
            key_type: key_type.map(|s| s.to_string()),
            create_time: None,
            tags: HashMap::new(),
        };
        Ok((info, key_material))
    }

    /// DeleteKeyPair.
    pub async fn delete_key_pair(&self, key_name: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DeleteKeyPair", API_VERSION);
        params.insert("KeyName".to_string(), key_name.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    /// DescribeVpcs.
    pub async fn describe_vpcs(&self, vpc_ids: &[String], filters: &[Filter]) -> AwsResult<Vec<Vpc>> {
        let mut params = client::build_query_params("DescribeVpcs", API_VERSION);
        for (i, id) in vpc_ids.iter().enumerate() {
            params.insert(format!("VpcId.{}", i + 1), id.clone());
        }
        client::add_filters(&mut params, filters);
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_vpcs(&response.body))
    }

    /// DescribeSubnets.
    pub async fn describe_subnets(&self, subnet_ids: &[String], filters: &[Filter]) -> AwsResult<Vec<Subnet>> {
        let mut params = client::build_query_params("DescribeSubnets", API_VERSION);
        for (i, id) in subnet_ids.iter().enumerate() {
            params.insert(format!("SubnetId.{}", i + 1), id.clone());
        }
        client::add_filters(&mut params, filters);
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_subnets(&response.body))
    }

    /// DescribeAddresses (Elastic IPs).
    pub async fn describe_addresses(&self, allocation_ids: &[String]) -> AwsResult<Vec<Address>> {
        let mut params = client::build_query_params("DescribeAddresses", API_VERSION);
        for (i, id) in allocation_ids.iter().enumerate() {
            params.insert(format!("AllocationId.{}", i + 1), id.clone());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_addresses(&response.body))
    }

    /// AllocateAddress.
    pub async fn allocate_address(&self, domain: &str) -> AwsResult<Address> {
        let mut params = client::build_query_params("AllocateAddress", API_VERSION);
        params.insert("Domain".to_string(), domain.to_string());
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(Address {
            allocation_id: client::xml_text(&response.body, "allocationId").unwrap_or_default(),
            public_ip: client::xml_text(&response.body, "publicIp").unwrap_or_default(),
            association_id: None,
            instance_id: None,
            network_interface_id: None,
            private_ip_address: None,
            domain: domain.to_string(),
            tags: HashMap::new(),
        })
    }

    /// ReleaseAddress.
    pub async fn release_address(&self, allocation_id: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("ReleaseAddress", API_VERSION);
        params.insert("AllocationId".to_string(), allocation_id.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    /// DescribeVolumes.
    pub async fn describe_volumes(&self, volume_ids: &[String], filters: &[Filter]) -> AwsResult<Vec<Volume>> {
        let mut params = client::build_query_params("DescribeVolumes", API_VERSION);
        for (i, id) in volume_ids.iter().enumerate() {
            params.insert(format!("VolumeId.{}", i + 1), id.clone());
        }
        client::add_filters(&mut params, filters);
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_volumes(&response.body))
    }

    /// CreateVolume.
    pub async fn create_volume(
        &self,
        availability_zone: &str,
        size: u32,
        volume_type: &str,
        encrypted: bool,
        iops: Option<u32>,
    ) -> AwsResult<Volume> {
        let mut params = client::build_query_params("CreateVolume", API_VERSION);
        params.insert("AvailabilityZone".to_string(), availability_zone.to_string());
        params.insert("Size".to_string(), size.to_string());
        params.insert("VolumeType".to_string(), volume_type.to_string());
        params.insert("Encrypted".to_string(), encrypted.to_string());
        if let Some(i) = iops {
            params.insert("Iops".to_string(), i.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(Volume {
            volume_id: client::xml_text(&response.body, "volumeId").unwrap_or_default(),
            size,
            volume_type: volume_type.to_string(),
            state: "creating".to_string(),
            availability_zone: availability_zone.to_string(),
            encrypted,
            iops,
            throughput: None,
            kms_key_id: None,
            snapshot_id: None,
            create_time: chrono::Utc::now().to_rfc3339(),
            attachments: vec![],
            tags: HashMap::new(),
        })
    }

    /// DeleteVolume.
    pub async fn delete_volume(&self, volume_id: &str) -> AwsResult<()> {
        let mut params = client::build_query_params("DeleteVolume", API_VERSION);
        params.insert("VolumeId".to_string(), volume_id.to_string());
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    /// DescribeSnapshots.
    pub async fn describe_snapshots(&self, snapshot_ids: &[String], filters: &[Filter]) -> AwsResult<Vec<Snapshot>> {
        let mut params = client::build_query_params("DescribeSnapshots", API_VERSION);
        for (i, id) in snapshot_ids.iter().enumerate() {
            params.insert(format!("SnapshotId.{}", i + 1), id.clone());
        }
        client::add_filters(&mut params, filters);
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_snapshots(&response.body))
    }

    /// CreateSnapshot.
    pub async fn create_snapshot(&self, volume_id: &str, description: Option<&str>) -> AwsResult<Snapshot> {
        let mut params = client::build_query_params("CreateSnapshot", API_VERSION);
        params.insert("VolumeId".to_string(), volume_id.to_string());
        if let Some(desc) = description {
            params.insert("Description".to_string(), desc.to_string());
        }
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(Snapshot {
            snapshot_id: client::xml_text(&response.body, "snapshotId").unwrap_or_default(),
            volume_id: volume_id.to_string(),
            state: "pending".to_string(),
            volume_size: client::xml_text(&response.body, "volumeSize")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            start_time: chrono::Utc::now().to_rfc3339(),
            description: description.map(|s| s.to_string()),
            encrypted: false,
            owner_id: String::new(),
            progress: "0%".to_string(),
            tags: HashMap::new(),
        })
    }

    /// DescribeImages (AMIs).
    pub async fn describe_images(&self, image_ids: &[String], filters: &[Filter], owners: &[String]) -> AwsResult<Vec<Image>> {
        let mut params = client::build_query_params("DescribeImages", API_VERSION);
        for (i, id) in image_ids.iter().enumerate() {
            params.insert(format!("ImageId.{}", i + 1), id.clone());
        }
        for (i, owner) in owners.iter().enumerate() {
            params.insert(format!("Owner.{}", i + 1), owner.clone());
        }
        client::add_filters(&mut params, filters);
        let response = self.client.query_request(SERVICE, &params).await?;
        Ok(self.parse_images(&response.body))
    }

    /// CreateTags - tag any EC2 resource.
    pub async fn create_tags(&self, resource_ids: &[String], tags: &[crate::config::Tag]) -> AwsResult<()> {
        let mut params = client::build_query_params("CreateTags", API_VERSION);
        for (i, id) in resource_ids.iter().enumerate() {
            params.insert(format!("ResourceId.{}", i + 1), id.clone());
        }
        client::add_tags(&mut params, tags, "Tag");
        self.client.query_request(SERVICE, &params).await?;
        Ok(())
    }

    /// DescribeRegions.
    pub async fn describe_regions(&self) -> AwsResult<Vec<(String, String)>> {
        let params = client::build_query_params("DescribeRegions", API_VERSION);
        let response = self.client.query_request(SERVICE, &params).await?;
        let regions = client::xml_blocks(&response.body, "item");
        let mut result = Vec::new();
        for block in &regions {
            if let (Some(name), Some(endpoint)) = (
                client::xml_text(block, "regionName"),
                client::xml_text(block, "regionEndpoint"),
            ) {
                result.push((name, endpoint));
            }
        }
        Ok(result)
    }

    /// DescribeAvailabilityZones.
    pub async fn describe_availability_zones(&self) -> AwsResult<Vec<(String, String, String)>> {
        let params = client::build_query_params("DescribeAvailabilityZones", API_VERSION);
        let response = self.client.query_request(SERVICE, &params).await?;
        let zones = client::xml_blocks(&response.body, "item");
        let mut result = Vec::new();
        for block in &zones {
            if let (Some(name), Some(state), Some(region)) = (
                client::xml_text(block, "zoneName"),
                client::xml_text(block, "zoneState"),
                client::xml_text(block, "regionName"),
            ) {
                result.push((name, state, region));
            }
        }
        Ok(result)
    }

    // ── XML Parsers ─────────────────────────────────────────────────────

    fn parse_describe_instances_response(&self, xml: &str) -> Vec<Reservation> {
        let reservation_blocks = client::xml_blocks(xml, "item");
        let mut reservations = Vec::new();

        // The actual structure is reservationSet > item > instancesSet > item
        // Since our XML parser is simple, we do best-effort parsing
        for block in &reservation_blocks {
            if let Some(res_id) = client::xml_text(block, "reservationId") {
                let owner_id = client::xml_text(block, "ownerId").unwrap_or_default();
                let instance_blocks = client::xml_blocks(block, "item");
                let mut instances = Vec::new();

                for inst_block in &instance_blocks {
                    if let Some(instance_id) = client::xml_text(inst_block, "instanceId") {
                        instances.push(self.parse_instance(inst_block, &instance_id));
                    }
                }

                if !instances.is_empty() {
                    reservations.push(Reservation {
                        reservation_id: res_id,
                        owner_id,
                        instances,
                        groups: vec![],
                    });
                }
            }
        }

        reservations
    }

    fn parse_instance(&self, xml: &str, instance_id: &str) -> Instance {
        let tags = self.parse_tags(xml);
        Instance {
            instance_id: instance_id.to_string(),
            image_id: client::xml_text(xml, "imageId").unwrap_or_default(),
            instance_type: client::xml_text(xml, "instanceType").unwrap_or_default(),
            state: InstanceState {
                code: client::xml_text(xml, "code")
                    .and_then(|c| c.parse().ok())
                    .unwrap_or(0),
                name: client::xml_text(xml, "name").unwrap_or_else(|| "unknown".to_string()),
            },
            public_ip_address: client::xml_text(xml, "ipAddress"),
            private_ip_address: client::xml_text(xml, "privateIpAddress"),
            public_dns_name: client::xml_text(xml, "dnsName"),
            private_dns_name: client::xml_text(xml, "privateDnsName"),
            launch_time: client::xml_text(xml, "launchTime").unwrap_or_default(),
            availability_zone: client::xml_text(xml, "availabilityZone").unwrap_or_default(),
            subnet_id: client::xml_text(xml, "subnetId"),
            vpc_id: client::xml_text(xml, "vpcId"),
            key_name: client::xml_text(xml, "keyName"),
            security_groups: vec![],
            tags,
            architecture: client::xml_text(xml, "architecture"),
            root_device_type: client::xml_text(xml, "rootDeviceType"),
            root_device_name: client::xml_text(xml, "rootDeviceName"),
            platform: client::xml_text(xml, "platform"),
            iam_instance_profile: None,
            ebs_optimized: client::xml_text(xml, "ebsOptimized")
                .map(|v| v == "true")
                .unwrap_or(false),
            hypervisor: client::xml_text(xml, "hypervisor"),
            monitoring_state: client::xml_text(xml, "state"),
            placement: Some(Placement {
                availability_zone: client::xml_text(xml, "availabilityZone").unwrap_or_default(),
                tenancy: client::xml_text(xml, "tenancy"),
                group_name: None,
                host_id: None,
            }),
            block_device_mappings: vec![],
            network_interfaces: vec![],
        }
    }

    fn parse_tags(&self, xml: &str) -> HashMap<String, String> {
        let mut tags = HashMap::new();
        let tag_blocks = client::xml_blocks(xml, "item");
        for block in &tag_blocks {
            if let (Some(key), Some(value)) = (client::xml_text(block, "key"), client::xml_text(block, "value")) {
                tags.insert(key, value);
            }
        }
        tags
    }

    fn parse_instance_state_changes(&self, xml: &str) -> Vec<InstanceStateChange> {
        let changes = client::xml_blocks(xml, "item");
        changes
            .iter()
            .filter_map(|block| {
                let instance_id = client::xml_text(block, "instanceId")?;
                Some(InstanceStateChange {
                    instance_id,
                    previous_state: InstanceState {
                        code: client::xml_text(block, "code")
                            .and_then(|c| c.parse().ok())
                            .unwrap_or(0),
                        name: client::xml_text(block, "name").unwrap_or_default(),
                    },
                    current_state: InstanceState {
                        code: 0,
                        name: "pending".to_string(),
                    },
                })
            })
            .collect()
    }

    fn parse_security_groups(&self, xml: &str) -> Vec<SecurityGroup> {
        let sg_blocks = client::xml_blocks(xml, "item");
        sg_blocks
            .iter()
            .filter_map(|block| {
                let group_id = client::xml_text(block, "groupId")?;
                Some(SecurityGroup {
                    group_id,
                    group_name: client::xml_text(block, "groupName").unwrap_or_default(),
                    description: client::xml_text(block, "groupDescription").unwrap_or_default(),
                    vpc_id: client::xml_text(block, "vpcId"),
                    ip_permissions: vec![],
                    ip_permissions_egress: vec![],
                    tags: self.parse_tags(block),
                })
            })
            .collect()
    }

    fn parse_key_pairs(&self, xml: &str) -> Vec<KeyPairInfo> {
        let kp_blocks = client::xml_blocks(xml, "item");
        kp_blocks
            .iter()
            .filter_map(|block| {
                let key_name = client::xml_text(block, "keyName")?;
                Some(KeyPairInfo {
                    key_pair_id: client::xml_text(block, "keyPairId").unwrap_or_default(),
                    key_name,
                    key_fingerprint: client::xml_text(block, "keyFingerprint").unwrap_or_default(),
                    key_type: client::xml_text(block, "keyType"),
                    create_time: client::xml_text(block, "createTime"),
                    tags: self.parse_tags(block),
                })
            })
            .collect()
    }

    fn parse_vpcs(&self, xml: &str) -> Vec<Vpc> {
        let vpc_blocks = client::xml_blocks(xml, "item");
        vpc_blocks
            .iter()
            .filter_map(|block| {
                let vpc_id = client::xml_text(block, "vpcId")?;
                Some(Vpc {
                    vpc_id,
                    cidr_block: client::xml_text(block, "cidrBlock").unwrap_or_default(),
                    state: client::xml_text(block, "state").unwrap_or_default(),
                    is_default: client::xml_text(block, "isDefault")
                        .map(|v| v == "true")
                        .unwrap_or(false),
                    dhcp_options_id: client::xml_text(block, "dhcpOptionsId"),
                    instance_tenancy: client::xml_text(block, "instanceTenancy"),
                    tags: self.parse_tags(block),
                })
            })
            .collect()
    }

    fn parse_subnets(&self, xml: &str) -> Vec<Subnet> {
        let blocks = client::xml_blocks(xml, "item");
        blocks
            .iter()
            .filter_map(|block| {
                let subnet_id = client::xml_text(block, "subnetId")?;
                Some(Subnet {
                    subnet_id,
                    vpc_id: client::xml_text(block, "vpcId").unwrap_or_default(),
                    cidr_block: client::xml_text(block, "cidrBlock").unwrap_or_default(),
                    availability_zone: client::xml_text(block, "availabilityZone").unwrap_or_default(),
                    available_ip_address_count: client::xml_text(block, "availableIpAddressCount")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0),
                    default_for_az: client::xml_text(block, "defaultForAz")
                        .map(|v| v == "true")
                        .unwrap_or(false),
                    map_public_ip_on_launch: client::xml_text(block, "mapPublicIpOnLaunch")
                        .map(|v| v == "true")
                        .unwrap_or(false),
                    state: client::xml_text(block, "state").unwrap_or_default(),
                    tags: self.parse_tags(block),
                })
            })
            .collect()
    }

    fn parse_addresses(&self, xml: &str) -> Vec<Address> {
        let blocks = client::xml_blocks(xml, "item");
        blocks
            .iter()
            .filter_map(|block| {
                let alloc_id = client::xml_text(block, "allocationId")?;
                Some(Address {
                    allocation_id: alloc_id,
                    public_ip: client::xml_text(block, "publicIp").unwrap_or_default(),
                    association_id: client::xml_text(block, "associationId"),
                    instance_id: client::xml_text(block, "instanceId"),
                    network_interface_id: client::xml_text(block, "networkInterfaceId"),
                    private_ip_address: client::xml_text(block, "privateIpAddress"),
                    domain: client::xml_text(block, "domain").unwrap_or_else(|| "vpc".to_string()),
                    tags: self.parse_tags(block),
                })
            })
            .collect()
    }

    fn parse_volumes(&self, xml: &str) -> Vec<Volume> {
        let blocks = client::xml_blocks(xml, "item");
        blocks
            .iter()
            .filter_map(|block| {
                let vol_id = client::xml_text(block, "volumeId")?;
                Some(Volume {
                    volume_id: vol_id,
                    size: client::xml_text(block, "size")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0),
                    volume_type: client::xml_text(block, "volumeType").unwrap_or_default(),
                    state: client::xml_text(block, "status").unwrap_or_default(),
                    availability_zone: client::xml_text(block, "availabilityZone").unwrap_or_default(),
                    encrypted: client::xml_text(block, "encrypted")
                        .map(|v| v == "true")
                        .unwrap_or(false),
                    iops: client::xml_text(block, "iops").and_then(|v| v.parse().ok()),
                    throughput: client::xml_text(block, "throughput").and_then(|v| v.parse().ok()),
                    kms_key_id: client::xml_text(block, "kmsKeyId"),
                    snapshot_id: client::xml_text(block, "snapshotId"),
                    create_time: client::xml_text(block, "createTime").unwrap_or_default(),
                    attachments: vec![],
                    tags: self.parse_tags(block),
                })
            })
            .collect()
    }

    fn parse_snapshots(&self, xml: &str) -> Vec<Snapshot> {
        let blocks = client::xml_blocks(xml, "item");
        blocks
            .iter()
            .filter_map(|block| {
                let snap_id = client::xml_text(block, "snapshotId")?;
                Some(Snapshot {
                    snapshot_id: snap_id,
                    volume_id: client::xml_text(block, "volumeId").unwrap_or_default(),
                    state: client::xml_text(block, "status").unwrap_or_default(),
                    volume_size: client::xml_text(block, "volumeSize")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0),
                    start_time: client::xml_text(block, "startTime").unwrap_or_default(),
                    description: client::xml_text(block, "description"),
                    encrypted: client::xml_text(block, "encrypted")
                        .map(|v| v == "true")
                        .unwrap_or(false),
                    owner_id: client::xml_text(block, "ownerId").unwrap_or_default(),
                    progress: client::xml_text(block, "progress").unwrap_or_default(),
                    tags: self.parse_tags(block),
                })
            })
            .collect()
    }

    fn parse_images(&self, xml: &str) -> Vec<Image> {
        let blocks = client::xml_blocks(xml, "item");
        blocks
            .iter()
            .filter_map(|block| {
                let image_id = client::xml_text(block, "imageId")?;
                Some(Image {
                    image_id,
                    name: client::xml_text(block, "name"),
                    description: client::xml_text(block, "description"),
                    state: client::xml_text(block, "imageState").unwrap_or_default(),
                    image_type: client::xml_text(block, "imageType").unwrap_or_default(),
                    architecture: client::xml_text(block, "architecture").unwrap_or_default(),
                    platform: client::xml_text(block, "platform"),
                    root_device_type: client::xml_text(block, "rootDeviceType").unwrap_or_default(),
                    root_device_name: client::xml_text(block, "rootDeviceName"),
                    owner_id: client::xml_text(block, "imageOwnerId").unwrap_or_default(),
                    creation_date: client::xml_text(block, "creationDate"),
                    public: client::xml_text(block, "isPublic")
                        .map(|v| v == "true")
                        .unwrap_or(false),
                    tags: self.parse_tags(block),
                })
            })
            .collect()
    }

    fn add_ip_permissions_params(&self, params: &mut std::collections::BTreeMap<String, String>, perms: &[IpPermission]) {
        for (i, perm) in perms.iter().enumerate() {
            let prefix = format!("IpPermissions.{}", i + 1);
            params.insert(format!("{}.IpProtocol", prefix), perm.ip_protocol.clone());
            if let Some(from) = perm.from_port {
                params.insert(format!("{}.FromPort", prefix), from.to_string());
            }
            if let Some(to) = perm.to_port {
                params.insert(format!("{}.ToPort", prefix), to.to_string());
            }
            for (j, range) in perm.ip_ranges.iter().enumerate() {
                params.insert(
                    format!("{}.IpRanges.{}.CidrIp", prefix, j + 1),
                    range.cidr_ip.clone(),
                );
                if let Some(ref desc) = range.description {
                    params.insert(
                        format!("{}.IpRanges.{}.Description", prefix, j + 1),
                        desc.clone(),
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_state_running() {
        let state = InstanceState::running();
        assert_eq!(state.code, 16);
        assert_eq!(state.name, "running");
    }

    #[test]
    fn instance_serde() {
        let instance = Instance {
            instance_id: "i-1234567890abcdef0".to_string(),
            image_id: "ami-12345678".to_string(),
            instance_type: "t3.micro".to_string(),
            state: InstanceState::running(),
            public_ip_address: Some("54.123.45.67".to_string()),
            private_ip_address: Some("10.0.1.100".to_string()),
            public_dns_name: None,
            private_dns_name: None,
            launch_time: "2024-01-01T00:00:00Z".to_string(),
            availability_zone: "us-east-1a".to_string(),
            subnet_id: Some("subnet-12345".to_string()),
            vpc_id: Some("vpc-12345".to_string()),
            key_name: Some("my-key".to_string()),
            security_groups: vec![GroupIdentifier {
                group_id: "sg-12345".to_string(),
                group_name: "default".to_string(),
            }],
            tags: HashMap::from([("Name".to_string(), "web-server".to_string())]),
            architecture: Some("x86_64".to_string()),
            root_device_type: Some("ebs".to_string()),
            root_device_name: Some("/dev/xvda".to_string()),
            platform: None,
            iam_instance_profile: None,
            ebs_optimized: false,
            hypervisor: Some("xen".to_string()),
            monitoring_state: None,
            placement: None,
            block_device_mappings: vec![],
            network_interfaces: vec![],
        };
        let json = serde_json::to_string(&instance).unwrap();
        let back: Instance = serde_json::from_str(&json).unwrap();
        assert_eq!(back.instance_id, "i-1234567890abcdef0");
        assert_eq!(back.state.name, "running");
        assert_eq!(back.tags["Name"], "web-server");
    }

    #[test]
    fn security_group_serde() {
        let sg = SecurityGroup {
            group_id: "sg-12345".to_string(),
            group_name: "web-sg".to_string(),
            description: "Web security group".to_string(),
            vpc_id: Some("vpc-12345".to_string()),
            ip_permissions: vec![IpPermission {
                ip_protocol: "tcp".to_string(),
                from_port: Some(80),
                to_port: Some(80),
                ip_ranges: vec![IpRange {
                    cidr_ip: "0.0.0.0/0".to_string(),
                    description: Some("HTTP".to_string()),
                }],
                ipv6_ranges: vec![],
                prefix_list_ids: vec![],
                user_id_group_pairs: vec![],
            }],
            ip_permissions_egress: vec![],
            tags: HashMap::new(),
        };
        let json = serde_json::to_string(&sg).unwrap();
        let back: SecurityGroup = serde_json::from_str(&json).unwrap();
        assert_eq!(back.group_id, "sg-12345");
        assert_eq!(back.ip_permissions[0].from_port, Some(80));
    }

    #[test]
    fn vpc_serde() {
        let vpc = Vpc {
            vpc_id: "vpc-12345".to_string(),
            cidr_block: "10.0.0.0/16".to_string(),
            state: "available".to_string(),
            is_default: false,
            dhcp_options_id: None,
            instance_tenancy: Some("default".to_string()),
            tags: HashMap::new(),
        };
        let json = serde_json::to_string(&vpc).unwrap();
        let back: Vpc = serde_json::from_str(&json).unwrap();
        assert_eq!(back.vpc_id, "vpc-12345");
        assert_eq!(back.cidr_block, "10.0.0.0/16");
    }

    #[test]
    fn volume_serde() {
        let vol = Volume {
            volume_id: "vol-12345".to_string(),
            size: 100,
            volume_type: "gp3".to_string(),
            state: "available".to_string(),
            availability_zone: "us-east-1a".to_string(),
            encrypted: true,
            iops: Some(3000),
            throughput: Some(125),
            kms_key_id: None,
            snapshot_id: None,
            create_time: "2024-01-01T00:00:00Z".to_string(),
            attachments: vec![],
            tags: HashMap::new(),
        };
        let json = serde_json::to_string(&vol).unwrap();
        let back: Volume = serde_json::from_str(&json).unwrap();
        assert_eq!(back.volume_id, "vol-12345");
        assert_eq!(back.iops, Some(3000));
    }

    #[test]
    fn run_instances_input_serde() {
        let input = RunInstancesInput {
            image_id: "ami-12345".to_string(),
            instance_type: "t3.micro".to_string(),
            min_count: 1,
            max_count: 1,
            key_name: Some("my-key".to_string()),
            security_group_ids: vec!["sg-12345".to_string()],
            subnet_id: Some("subnet-12345".to_string()),
            user_data: None,
            iam_instance_profile: None,
            tags: HashMap::from([("Name".to_string(), "test".to_string())]),
            ebs_optimized: Some(true),
            monitoring_enabled: None,
            disable_api_termination: None,
            block_device_mappings: vec![],
        };
        let json = serde_json::to_string(&input).unwrap();
        let back: RunInstancesInput = serde_json::from_str(&json).unwrap();
        assert_eq!(back.image_id, "ami-12345");
    }
}
