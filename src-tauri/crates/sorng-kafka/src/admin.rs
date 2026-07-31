use std::collections::HashMap;
use std::fmt::Write as FmtWrite;
use std::fs::OpenOptions;
use std::io::{self, Seek, SeekFrom, Write as IoWrite};
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use rdkafka::admin::{
    AdminClient, AdminOptions, AlterConfig, NewPartitions, NewTopic, ResourceSpecifier,
    TopicReplication,
};
use rdkafka::client::DefaultClientContext;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::metadata::Metadata;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

const SECRET_TEMP_CREATE_ATTEMPTS: usize = 16;
const CLI_OUTPUT_LIMIT: usize = 1024 * 1024;
const CLI_MIN_TIMEOUT: Duration = Duration::from_secs(5);
const CLI_MAX_TIMEOUT: Duration = Duration::from_secs(60);
const KAFKA_ACLS_CANDIDATES: &[&str] = &["kafka-acls", "kafka-acls.sh"];

struct SecretTempFile {
    path: PathBuf,
    secret_len: u64,
}

impl SecretTempFile {
    fn create(prefix: &str, suffix: &str, contents: &[u8]) -> io::Result<Self> {
        for _ in 0..SECRET_TEMP_CREATE_ATTEMPTS {
            let path =
                std::env::temp_dir().join(secret_temp_filename(prefix, suffix, Uuid::new_v4()));
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }

            let mut file = match options.open(&path) {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            };
            let guard = Self {
                path,
                secret_len: contents.len() as u64,
            };
            let write_result = file.write_all(contents).and_then(|_| file.sync_all());
            drop(file);
            if let Err(error) = write_result {
                drop(guard);
                return Err(error);
            }
            return Ok(guard);
        }

        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not allocate a private temporary file",
        ))
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for SecretTempFile {
    fn drop(&mut self) {
        if let Ok(mut file) = OpenOptions::new().write(true).open(&self.path) {
            let mut zeros = [0_u8; 4096];
            let _ = file.seek(SeekFrom::Start(0));
            let mut remaining = self.secret_len;
            while remaining > 0 {
                let count = remaining.min(zeros.len() as u64) as usize;
                if file.write_all(&zeros[..count]).is_err() {
                    break;
                }
                remaining -= count as u64;
            }
            let _ = file.flush();
            let _ = file.set_len(0);
            zeros.zeroize();
        }
        let _ = std::fs::remove_file(&self.path);
    }
}

fn secret_temp_filename(prefix: &str, suffix: &str, id: Uuid) -> String {
    format!("{prefix}{id}{suffix}")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CliProcessError {
    NotFound,
    StartFailed,
    WaitFailed,
    TimedOut,
    OutputTooLarge,
    ReadFailed,
}

struct CliProcessOutput {
    status: ExitStatus,
    stdout: Zeroizing<Vec<u8>>,
    #[allow(dead_code)]
    stderr: Zeroizing<Vec<u8>>,
}

fn bounded_cli_timeout(configured: Duration) -> Duration {
    configured.clamp(CLI_MIN_TIMEOUT, CLI_MAX_TIMEOUT)
}

fn append_bounded(output: &mut Vec<u8>, chunk: &[u8], limit: usize) -> Result<(), ()> {
    if chunk.len() > limit.saturating_sub(output.len()) {
        return Err(());
    }
    output.extend_from_slice(chunk);
    Ok(())
}

async fn read_bounded<R>(mut reader: R, limit: usize) -> Result<Zeroizing<Vec<u8>>, CliProcessError>
where
    R: AsyncRead + Unpin,
{
    let mut output = Zeroizing::new(Vec::with_capacity(limit.min(8192)));
    let mut buffer = [0_u8; 8192];
    loop {
        let count = match reader.read(&mut buffer).await {
            Ok(count) => count,
            Err(_) => {
                buffer.zeroize();
                return Err(CliProcessError::ReadFailed);
            }
        };
        if count == 0 {
            break;
        }
        if append_bounded(&mut output, &buffer[..count], limit).is_err() {
            buffer.zeroize();
            return Err(CliProcessError::OutputTooLarge);
        }
    }
    buffer.zeroize();
    Ok(output)
}

async fn run_bounded_command(
    program: &str,
    args: &[String],
    timeout: Duration,
) -> Result<CliProcessOutput, CliProcessError> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            CliProcessError::NotFound
        } else {
            CliProcessError::StartFailed
        }
    })?;
    let stdout = child
        .stdout
        .take()
        .expect("stdout is piped for Kafka CLI commands");
    let stderr = child
        .stderr
        .take()
        .expect("stderr is piped for Kafka CLI commands");
    let stdout_task = tokio::spawn(read_bounded(stdout, CLI_OUTPUT_LIMIT));
    let stderr_task = tokio::spawn(read_bounded(stderr, CLI_OUTPUT_LIMIT));

    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(_)) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            let _ = tokio::join!(stdout_task, stderr_task);
            return Err(CliProcessError::WaitFailed);
        }
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            let _ = tokio::join!(stdout_task, stderr_task);
            return Err(CliProcessError::TimedOut);
        }
    };
    let (stdout, stderr) = tokio::join!(stdout_task, stderr_task);
    let stdout = stdout.map_err(|_| CliProcessError::ReadFailed)??;
    let stderr = stderr.map_err(|_| CliProcessError::ReadFailed)??;

    Ok(CliProcessOutput {
        status,
        stdout,
        stderr,
    })
}

fn escape_jaas_value(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\r' => escaped.push_str("\\r"),
            '\n' => escaped.push_str("\\n"),
            character => escaped.push(character),
        }
    }
    escaped
}

fn escape_property_value(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '\r' => escaped.push_str("\\r"),
            '\n' => escaped.push_str("\\n"),
            character => escaped.push(character),
        }
    }
    escaped
}

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

    /// Write a private, automatically cleaned command-config file for kafka-acls.
    fn write_command_config(&self) -> Result<SecretTempFile, KafkaError> {
        let mut props = Zeroizing::new(String::new());
        let _ = writeln!(
            props,
            "security.protocol={}",
            self.security_protocol.as_kafka_str()
        );
        if let Some(ref mech) = self.sasl_mechanism {
            let _ = writeln!(props, "sasl.mechanism={}", mech.as_kafka_str());
        }
        if let Some(ref user) = self.sasl_username {
            let user = escape_jaas_value(user);
            let password = Zeroizing::new(escape_jaas_value(
                self.sasl_password.as_deref().unwrap_or(""),
            ));
            let _ = writeln!(
                props,
                "sasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required username=\"{user}\" password=\"{}\";",
                password.as_str()
            );
        }
        if let Some(ref ca) = self.ssl_ca_location {
            let ca = escape_property_value(ca);
            let _ = writeln!(props, "ssl.truststore.location={ca}");
        }
        if let Some(ref cert) = self.ssl_cert_location {
            let cert = escape_property_value(cert);
            let _ = writeln!(props, "ssl.keystore.location={cert}");
        }
        if let Some(ref key_pw) = self.ssl_key_password {
            let key_password = Zeroizing::new(escape_property_value(key_pw));
            let _ = writeln!(props, "ssl.keystore.password={}", key_password.as_str());
        }
        SecretTempFile::create("sorng-kafka-cli-", ".properties", props.as_bytes())
            .map_err(|_| KafkaError::acl_error("Failed to prepare Kafka CLI credentials"))
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

    /// Run the kafka-acls CLI with the given arguments and return stdout.
    async fn run_kafka_acls(&self, extra_args: &[&str]) -> KafkaResult<String> {
        let mut args = self.cli_config.base_args();

        let config_file = if self.cli_config.needs_command_config() {
            let file = self.cli_config.write_command_config()?;
            args.push("--command-config".to_string());
            args.push(file.path().to_string_lossy().into_owned());
            Some(file)
        } else {
            None
        };

        for a in extra_args {
            args.push(a.to_string());
        }

        log::info!("Running Kafka ACL command");
        let timeout = bounded_cli_timeout(self.timeout);
        let mut output = None;
        for candidate in KAFKA_ACLS_CANDIDATES {
            match run_bounded_command(candidate, &args, timeout).await {
                Ok(result) => {
                    output = Some(result);
                    break;
                }
                Err(CliProcessError::NotFound) => continue,
                Err(CliProcessError::TimedOut) => {
                    return Err(KafkaError::acl_error("kafka-acls command timed out"));
                }
                Err(CliProcessError::OutputTooLarge) => {
                    return Err(KafkaError::acl_error(
                        "kafka-acls output exceeded the safety limit",
                    ));
                }
                Err(_) => {
                    return Err(KafkaError::acl_error("kafka-acls command failed"));
                }
            }
        }
        let output = output.ok_or_else(|| {
            KafkaError::acl_error(
                "kafka-acls CLI not found on PATH. Install Apache Kafka CLI tools to manage ACLs.",
            )
        })?;
        drop(config_file);

        if !output.status.success() {
            return Err(KafkaError::acl_error("kafka-acls command failed"));
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

#[cfg(test)]
mod safety_helper_tests {
    use super::*;

    #[test]
    fn escaping_prevents_properties_and_jaas_line_injection() {
        assert_eq!(escape_property_value("a\\b\r\nc"), "a\\\\b\\r\\nc");
        assert_eq!(escape_jaas_value("a\"\\b\r\nc"), "a\\\"\\\\b\\r\\nc");
    }

    #[test]
    fn bounded_append_rejects_a_chunk_without_partially_copying_it() {
        let mut output = b"1234".to_vec();
        assert!(append_bounded(&mut output, b"56", 5).is_err());
        assert_eq!(output, b"1234");
    }

    #[test]
    fn cli_timeout_is_clamped_to_safe_bounds() {
        assert_eq!(bounded_cli_timeout(Duration::ZERO), CLI_MIN_TIMEOUT);
        assert_eq!(
            bounded_cli_timeout(Duration::from_secs(30)),
            Duration::from_secs(30)
        );
        assert_eq!(
            bounded_cli_timeout(Duration::from_secs(600)),
            CLI_MAX_TIMEOUT
        );
    }

    #[test]
    fn filename_uses_the_full_collision_resistant_identifier() {
        let id = Uuid::from_u128(0x12345678_1234_5678_9abc_def012345678);
        assert_eq!(
            secret_temp_filename("kafka-", ".properties", id),
            "kafka-12345678-1234-5678-9abc-def012345678.properties"
        );
    }
}
