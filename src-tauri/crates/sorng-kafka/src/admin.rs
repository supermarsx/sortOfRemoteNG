use std::collections::HashMap;
use std::time::Duration;

use rdkafka::admin::{
    AdminClient, AdminOptions, AlterConfig, NewPartitions, NewTopic, ResourceSpecifier,
    TopicReplication,
};
use rdkafka::client::DefaultClientContext;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::metadata::Metadata;
use tokio::process::Command;

use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

/// Connection parameters needed for CLI-based operations (e.g. ACLs).
#[derive(Debug, Clone)]
struct CliConfig {
    bootstrap_servers: String,
    security_protocol: SecurityProtocol,
    sasl_mechanism: Option<SaslMechanism>,
    sasl_username: Option<String>,
    sasl_password: Option<String>,
    ssl_ca_location: Option<String>,
    ssl_cert_location: Option<String>,
    ssl_key_password: Option<String>,
}

impl CliConfig {
    fn from_connection(config: &KafkaConnectionConfig) -> Self {
        Self {
            bootstrap_servers: config.bootstrap_servers.clone(),
            security_protocol: config.security_protocol.clone(),
            sasl_mechanism: config.sasl_mechanism.clone(),
            sasl_username: config.sasl_username.clone(),
            sasl_password: config.sasl_password.clone(),
            ssl_ca_location: config.ssl_ca_location.clone(),
            ssl_cert_location: config.ssl_cert_location.clone(),
            ssl_key_password: config.ssl_key_password.clone(),
        }
    }

    /// Write a temporary command-config properties file for kafka-acls.
    /// Returns the file path. Caller is responsible for cleanup.
    fn write_command_config(&self) -> Result<std::path::PathBuf, KafkaError> {
        let mut props = String::new();
        props.push_str(&format!(
            "security.protocol={}\n",
            self.security_protocol.as_kafka_str()
        ));
        if let Some(ref mech) = self.sasl_mechanism {
            props.push_str(&format!("sasl.mechanism={}\n", mech.as_kafka_str()));
        }
        if let Some(ref user) = self.sasl_username {
            props.push_str(&format!("sasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required username=\"{}\" password=\"{}\";\n", user, self.sasl_password.as_deref().unwrap_or("")));
        }
        if let Some(ref ca) = self.ssl_ca_location {
            props.push_str(&format!("ssl.truststore.location={}\n", ca));
        }
        if let Some(ref cert) = self.ssl_cert_location {
            props.push_str(&format!("ssl.keystore.location={}\n", cert));
        }
        if let Some(ref key_pw) = self.ssl_key_password {
            props.push_str(&format!("ssl.keystore.password={}\n", key_pw));
        }
        let dir = std::env::temp_dir();
        let path = dir.join(format!("sorng-kafka-cli-{}.properties", std::process::id()));
        std::fs::write(&path, &props)
            .map_err(|e| KafkaError::admin_error(format!("Failed to write CLI config: {}", e)))?;
        Ok(path)
    }

    /// Build base arguments for kafka-acls CLI.
    fn base_args(&self) -> Vec<String> {
        vec![
            "--bootstrap-server".to_string(),
            self.bootstrap_servers.clone(),
        ]
    }

    /// Returns true if security config requires a --command-config file.
    fn needs_command_config(&self) -> bool {
        self.security_protocol != SecurityProtocol::Plaintext || self.sasl_mechanism.is_some()
    }
}

/// Wrapper around the rdkafka AdminClient providing high-level admin operations.
pub struct KafkaAdminClient {
    admin: AdminClient<DefaultClientContext>,
    consumer: BaseConsumer,
    timeout: Duration,
    cli_config: CliConfig,
}

impl KafkaAdminClient {
    /// Create a new admin client from a connection configuration.
    pub fn create(config: &KafkaConnectionConfig) -> KafkaResult<Self> {
        let mut client_config = config.to_client_config();

        let admin: AdminClient<DefaultClientContext> = client_config.create().map_err(|e| {
            KafkaError::connection_failed(format!("Failed to create admin client: {}", e))
        })?;

        let consumer: BaseConsumer = client_config
            .set("group.id", "__sorng_admin_metadata")
            .create()
            .map_err(|e| {
                KafkaError::connection_failed(format!("Failed to create metadata consumer: {}", e))
            })?;

        Ok(Self {
            admin,
            consumer,
            timeout: Duration::from_millis(config.request_timeout_ms as u64),
            cli_config: CliConfig::from_connection(config),
        })
    }

    /// Get the underlying admin client reference.
    pub fn inner(&self) -> &AdminClient<DefaultClientContext> {
        &self.admin
    }

    fn admin_opts(&self) -> AdminOptions {
        AdminOptions::new().operation_timeout(Some(self.timeout))
    }

    // -----------------------------------------------------------------------
    // Topic administration
    // -----------------------------------------------------------------------

    /// Create one or more topics.
    pub async fn create_topics(&self, topics: &[CreateTopicRequest]) -> KafkaResult<()> {
        let new_topics: Vec<NewTopic<'_>> = topics
            .iter()
            .map(|t| {
                let mut nt = NewTopic::new(
                    &t.name,
                    t.partitions,
                    TopicReplication::Fixed(t.replication_factor),
                );
                for (k, v) in &t.configs {
                    nt = nt.set(k.as_str(), v.as_str());
                }
                nt
            })
            .collect();

        let results = self
            .admin
            .create_topics(&new_topics, &self.admin_opts())
            .await?;

        for result in results {
            if let Err((topic, code)) = result {
                return Err(KafkaError::admin_error(format!(
                    "Failed to create topic '{}': {:?}",
                    topic, code
                )));
            }
        }

        Ok(())
    }

    /// Delete one or more topics by name.
    pub async fn delete_topics(&self, names: &[&str]) -> KafkaResult<()> {
        let results = self.admin.delete_topics(names, &self.admin_opts()).await?;
        for result in results {
            if let Err((topic, code)) = result {
                return Err(KafkaError::admin_error(format!(
                    "Failed to delete topic '{}': {:?}",
                    topic, code
                )));
            }
        }
        Ok(())
    }

    /// Increase the partition count of a topic.
    pub async fn create_partitions(&self, topic: &str, new_total_count: i32) -> KafkaResult<()> {
        let new_parts = NewPartitions::new(topic, new_total_count as usize);
        let results = self
            .admin
            .create_partitions(&[new_parts], &self.admin_opts())
            .await?;

        for result in results {
            if let Err((t, code)) = result {
                return Err(KafkaError::partition_error(format!(
                    "Failed to add partitions for '{}': {:?}",
                    t, code
                )));
            }
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------

    /// Describe configuration for a resource (topic or broker).
    pub async fn describe_configs(
        &self,
        resource_type: &ResourceType,
        resource_name: &str,
    ) -> KafkaResult<Vec<TopicConfig>> {
        let specifier = match resource_type {
            ResourceType::Topic => ResourceSpecifier::Topic(resource_name),
            ResourceType::Group => ResourceSpecifier::Group(resource_name),
            _ => ResourceSpecifier::Topic(resource_name),
        };

        let results = self
            .admin
            .describe_configs(&[specifier], &self.admin_opts())
            .await?;

        let mut configs = Vec::new();
        for result in results {
            match result {
                Ok(config_resource) => {
                    for entry in config_resource.entries {
                        let value_str = entry.value.as_ref().map(|v| v.to_string());
                        configs.push(TopicConfig {
                            name: entry.name.to_string(),
                            value: value_str.clone(),
                            source: ConfigSource::DefaultConfig,
                            is_default: value_str.is_none(),
                            is_sensitive: false,
                            is_read_only: false,
                            synonyms: Vec::new(),
                        });
                    }
                }
                Err(code) => {
                    return Err(KafkaError::admin_error(format!(
                        "Failed to describe config for '{}': {:?}",
                        resource_name, code
                    )));
                }
            }
        }

        Ok(configs)
    }

    /// Alter configuration for a resource.
    pub async fn alter_configs(
        &self,
        resource_type: &ResourceType,
        resource_name: &str,
        configs: &HashMap<String, String>,
    ) -> KafkaResult<()> {
        let specifier = match resource_type {
            ResourceType::Topic => ResourceSpecifier::Topic(resource_name),
            _ => ResourceSpecifier::Topic(resource_name),
        };

        let mut alter = AlterConfig::new(specifier);
        for (k, v) in configs {
            alter = alter.set(k, v);
        }

        let results = self
            .admin
            .alter_configs(&[alter], &self.admin_opts())
            .await?;

        for result in results {
            if let Err((_, code)) = result {
                return Err(KafkaError::admin_error(format!(
                    "Failed to alter config for '{}': {:?}",
                    resource_name, code
                )));
            }
        }
        Ok(())
    }

    /// Incrementally alter a single config entry.
    pub async fn incremental_alter_configs(
        &self,
        resource_type: &ResourceType,
        resource_name: &str,
        ops: &HashMap<String, String>,
    ) -> KafkaResult<()> {
        // rdkafka doesn't expose IncrementalAlterConfigs directly in all versions;
        // fall back to full alter_configs with the supplied ops merged.
        self.alter_configs(resource_type, resource_name, ops).await
    }

    // -----------------------------------------------------------------------
    // Metadata
    // -----------------------------------------------------------------------

    /// Fetch full cluster metadata, optionally filtered to a single topic.
    pub fn get_metadata(&self, topic: Option<&str>) -> KafkaResult<Metadata> {
        self.consumer
            .fetch_metadata(topic, self.timeout)
            .map_err(|e| KafkaError::admin_error(format!("Failed to fetch metadata: {}", e)))
    }

    /// Describe the cluster: broker list, cluster ID, controller.
    pub fn describe_cluster(&self) -> KafkaResult<(Vec<BrokerInfo>, Option<String>, Option<i32>)> {
        let metadata = self.get_metadata(None)?;
        let mut brokers = Vec::new();
        let controller_id = None; // metadata doesn't expose controller directly

        for broker in metadata.brokers() {
            brokers.push(BrokerInfo {
                id: broker.id(),
                host: broker.host().to_string(),
                port: broker.port() as u16,
                rack: None,
                is_controller: false,
                version: None,
                endpoints: vec![BrokerEndpoint {
                    security_protocol: "PLAINTEXT".to_string(),
                    host: broker.host().to_string(),
                    port: broker.port() as u16,
                    listener_name: None,
                }],
                log_dirs: Vec::new(),
            });
        }

        let cluster_id = Some(metadata.orig_broker_id().to_string());
        Ok((brokers, cluster_id, controller_id))
    }

    // -----------------------------------------------------------------------
    // Offsets
    // -----------------------------------------------------------------------

    /// List offsets for a topic+partition (earliest and latest).
    pub fn list_offsets(&self, topic: &str, partition: i32) -> KafkaResult<(i64, i64)> {
        use rdkafka::topic_partition_list::{Offset, TopicPartitionList};

        let mut tpl = TopicPartitionList::new();
        tpl.add_partition_offset(topic, partition, Offset::Beginning)
            .map_err(|e| {
                KafkaError::offset_error(format!("Failed to set beginning offset: {}", e))
            })?;

        let _earliest_offsets = self
            .consumer
            .committed_offsets(tpl, self.timeout)
            .map_err(|e| KafkaError::offset_error(format!("Failed to query offsets: {}", e)))?;

        let (lo, hi) = self
            .consumer
            .fetch_watermarks(topic, partition, self.timeout)
            .map_err(|e| KafkaError::offset_error(format!("Failed to fetch watermarks: {}", e)))?;

        Ok((lo, hi))
    }

    /// Delete records (equivalent to setting low watermark) up to a given offset.
    pub async fn delete_records(
        &self,
        _topic: &str,
        _partition: i32,
        _before_offset: i64,
    ) -> KafkaResult<()> {
        // rdkafka does not expose DeleteRecords directly; this would require
        // raw protocol support. We document this as unsupported and return an error.
        Err(KafkaError::admin_error(
            "delete_records is not supported by rdkafka; use kafka-admin CLI or JMX",
        ))
    }

    /// Describe log directories for the specified broker IDs.
    pub fn describe_log_dirs(&self, _broker_ids: &[i32]) -> KafkaResult<Vec<LogDirInfo>> {
        // Log dir inspection requires JMX or the DescribeLogDirs API.
        // We return an empty result since rdkafka doesn't expose this.
        log::warn!("describe_log_dirs is not directly supported by rdkafka");
        Ok(Vec::new())
    }

    // -----------------------------------------------------------------------
    // ACLs — executed via the kafka-acls CLI since rdkafka does not expose
    // the ACL admin API.  The CLI binary must be on $PATH.
    // -----------------------------------------------------------------------

    /// Locate the kafka-acls binary (tries common names).
    fn find_kafka_acls_bin() -> KafkaResult<String> {
        for name in &["kafka-acls", "kafka-acls.sh"] {
            let probe = std::process::Command::new(name)
                .arg("--help")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
            if probe.is_ok() {
                return Ok(name.to_string());
            }
        }
        Err(KafkaError::acl_error(
            "kafka-acls CLI not found on PATH. Install Apache Kafka CLI tools to manage ACLs.",
        ))
    }

    /// Run the kafka-acls CLI with the given arguments and return stdout.
    async fn run_kafka_acls(&self, extra_args: &[&str]) -> KafkaResult<String> {
        let bin = Self::find_kafka_acls_bin()?;
        let mut args = self.cli_config.base_args();

        let config_file = if self.cli_config.needs_command_config() {
            let path = self.cli_config.write_command_config()?;
            args.push("--command-config".to_string());
            args.push(path.display().to_string());
            Some(path)
        } else {
            None
        };

        for a in extra_args {
            args.push(a.to_string());
        }

        log::info!("Running: {} {}", bin, args.join(" "));

        let output =
            Command::new(&bin).args(&args).output().await.map_err(|e| {
                KafkaError::acl_error(format!("Failed to execute kafka-acls: {}", e))
            })?;

        // Cleanup temp config
        if let Some(path) = config_file {
            let _ = std::fs::remove_file(path);
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(KafkaError::acl_error(format!(
                "kafka-acls exited with {}: {}",
                output.status, stderr
            )));
        }

        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    /// Describe ACLs matching a filter via `kafka-acls --list`.
    pub async fn describe_acls(&self, filter: &AclFilter) -> KafkaResult<Vec<AclEntry>> {
        let mut args = vec!["--list"];
        let rt_str;
        let rn_owned;
        if let Some(ref rt) = filter.resource_type {
            rt_str = resource_type_to_cli_flag(rt);
            args.push(&rt_str);
            if let Some(ref name) = filter.resource_name {
                rn_owned = name.clone();
                args.push(&rn_owned);
            }
        }
        let principal_flag;
        if let Some(ref p) = filter.principal {
            principal_flag = format!("--principal={}", p);
            args.push(&principal_flag);
        }

        let stdout = self.run_kafka_acls(&args).await?;
        Ok(parse_kafka_acls_list(&stdout))
    }

    /// Create ACL entries via `kafka-acls --add`.
    pub async fn create_acls(&self, entries: &[AclEntry]) -> KafkaResult<()> {
        for entry in entries {
            let mut args = vec!["--add".to_string()];
            args.push(acl_entry_resource_flag(entry));
            args.push(acl_entry_resource_name_flag(entry));
            let principal_flag = if entry.permission_type == AclPermissionType::Allow {
                format!("--allow-principal={}", entry.principal)
            } else {
                format!("--deny-principal={}", entry.principal)
            };
            args.push(principal_flag);
            args.push(format!("--allow-host={}", entry.host));
            args.push(format!("--operation={}", acl_op_to_str(&entry.operation)));
            if entry.pattern_type == PatternType::Prefixed {
                args.push("--resource-pattern-type=prefixed".to_string());
            }
            let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            self.run_kafka_acls(&arg_refs).await?;
        }
        Ok(())
    }

    /// Delete ACL entries matching a filter via `kafka-acls --remove --force`.
    /// Returns the number of ACLs described before deletion.
    pub async fn delete_acls(&self, filter: &AclFilter) -> KafkaResult<usize> {
        // First describe to know how many will be deleted
        let existing = self.describe_acls(filter).await?;
        let count = existing.len();
        if count == 0 {
            return Ok(0);
        }

        let mut args = vec!["--remove", "--force"];
        let rt_str;
        let rn_owned;
        if let Some(ref rt) = filter.resource_type {
            rt_str = resource_type_to_cli_flag(rt);
            args.push(&rt_str);
            if let Some(ref name) = filter.resource_name {
                rn_owned = name.clone();
                args.push(&rn_owned);
            }
        }
        let principal_flag;
        if let Some(ref p) = filter.principal {
            principal_flag = format!("--principal={}", p);
            args.push(&principal_flag);
        }

        self.run_kafka_acls(&args).await?;
        Ok(count)
    }
}

// ── kafka-acls CLI output parsing ────────────────────────────────────────

/// Map a `ResourceType` to the kafka-acls CLI flag.
fn resource_type_to_cli_flag(rt: &ResourceType) -> String {
    match rt {
        ResourceType::Topic => "--topic".to_string(),
        ResourceType::Group => "--group".to_string(),
        ResourceType::Cluster => "--cluster".to_string(),
        ResourceType::TransactionalId => "--transactional-id".to_string(),
        ResourceType::DelegationToken => "--delegation-token".to_string(),
        ResourceType::Any => String::new(),
    }
}

fn acl_entry_resource_flag(entry: &AclEntry) -> String {
    match entry.resource_type {
        ResourceType::Topic => format!("--topic={}", entry.resource_name),
        ResourceType::Group => format!("--group={}", entry.resource_name),
        ResourceType::Cluster => "--cluster".to_string(),
        ResourceType::TransactionalId => {
            format!("--transactional-id={}", entry.resource_name)
        }
        ResourceType::DelegationToken => {
            format!("--delegation-token={}", entry.resource_name)
        }
        ResourceType::Any => String::new(),
    }
}

fn acl_entry_resource_name_flag(_entry: &AclEntry) -> String {
    // Resource name is included in the resource flag above, so this is empty.
    String::new()
}

fn acl_op_to_str(op: &AclOperation) -> &'static str {
    match op {
        AclOperation::All => "All",
        AclOperation::Read => "Read",
        AclOperation::Write => "Write",
        AclOperation::Create => "Create",
        AclOperation::Delete => "Delete",
        AclOperation::Alter => "Alter",
        AclOperation::Describe => "Describe",
        AclOperation::ClusterAction => "ClusterAction",
        AclOperation::DescribeConfigs => "DescribeConfigs",
        AclOperation::AlterConfigs => "AlterConfigs",
        AclOperation::IdempotentWrite => "IdempotentWrite",
        AclOperation::CreateTokens => "CreateTokens",
        AclOperation::DescribeTokens => "DescribeTokens",
        AclOperation::Any => "Any",
    }
}

fn str_to_acl_op(s: &str) -> AclOperation {
    match s {
        "All" => AclOperation::All,
        "Read" => AclOperation::Read,
        "Write" => AclOperation::Write,
        "Create" => AclOperation::Create,
        "Delete" => AclOperation::Delete,
        "Alter" => AclOperation::Alter,
        "Describe" => AclOperation::Describe,
        "ClusterAction" => AclOperation::ClusterAction,
        "DescribeConfigs" => AclOperation::DescribeConfigs,
        "AlterConfigs" => AclOperation::AlterConfigs,
        "IdempotentWrite" => AclOperation::IdempotentWrite,
        "CreateTokens" => AclOperation::CreateTokens,
        "DescribeTokens" => AclOperation::DescribeTokens,
        _ => AclOperation::Any,
    }
}

fn str_to_resource_type(s: &str) -> ResourceType {
    match s {
        "TOPIC" => ResourceType::Topic,
        "GROUP" => ResourceType::Group,
        "CLUSTER" => ResourceType::Cluster,
        "TRANSACTIONAL_ID" => ResourceType::TransactionalId,
        "DELEGATION_TOKEN" => ResourceType::DelegationToken,
        _ => ResourceType::Any,
    }
}

fn str_to_pattern_type(s: &str) -> PatternType {
    match s {
        "LITERAL" => PatternType::Literal,
        "PREFIXED" => PatternType::Prefixed,
        "MATCH" => PatternType::Match,
        _ => PatternType::Any,
    }
}

fn str_to_permission_type(s: &str) -> AclPermissionType {
    match s {
        "ALLOW" => AclPermissionType::Allow,
        "DENY" => AclPermissionType::Deny,
        _ => AclPermissionType::Any,
    }
}

/// Parse the output of `kafka-acls --list`.
///
/// Expected format:
/// ```text
/// Current ACLs for resource `ResourcePattern(resourceType=TOPIC, name=my-topic, patternType=LITERAL)`:
/// \t(principal=User:alice, host=*, operation=READ, permissionType=ALLOW)
/// ```
fn parse_kafka_acls_list(output: &str) -> Vec<AclEntry> {
    let mut entries = Vec::new();
    let mut cur_resource_type = ResourceType::Any;
    let mut cur_resource_name = String::new();
    let mut cur_pattern_type = PatternType::Literal;

    for line in output.lines() {
        let trimmed = line.trim();

        // Resource header line
        if trimmed.starts_with("Current ACLs for resource") {
            if let Some(start) = trimmed.find("resourceType=") {
                let after = &trimmed[start + 13..];
                if let Some(end) = after.find(',') {
                    cur_resource_type = str_to_resource_type(&after[..end]);
                }
            }
            if let Some(start) = trimmed.find("name=") {
                let after = &trimmed[start + 5..];
                if let Some(end) = after.find(',') {
                    cur_resource_name = after[..end].to_string();
                }
            }
            if let Some(start) = trimmed.find("patternType=") {
                let after = &trimmed[start + 12..];
                let end = after.find(')').unwrap_or(after.len());
                cur_pattern_type = str_to_pattern_type(&after[..end]);
            }
            continue;
        }

        // ACL entry line: (principal=User:X, host=Y, operation=Z, permissionType=W)
        if trimmed.starts_with("(principal=") {
            let inner = trimmed.trim_start_matches('(').trim_end_matches(')');
            let mut principal = String::new();
            let mut host = String::new();
            let mut operation = AclOperation::Any;
            let mut permission = AclPermissionType::Any;

            for part in inner.split(", ") {
                if let Some((key, val)) = part.split_once('=') {
                    match key.trim() {
                        "principal" => principal = val.to_string(),
                        "host" => host = val.to_string(),
                        "operation" => operation = str_to_acl_op(val),
                        "permissionType" => permission = str_to_permission_type(val),
                        _ => {}
                    }
                }
            }

            entries.push(AclEntry {
                resource_type: cur_resource_type.clone(),
                resource_name: cur_resource_name.clone(),
                pattern_type: cur_pattern_type.clone(),
                principal,
                host,
                operation,
                permission_type: permission,
            });
        }
    }

    entries
}
