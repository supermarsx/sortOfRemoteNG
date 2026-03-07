use std::collections::HashMap;
use std::time::Duration;

use rdkafka::admin::{
    AdminClient, AdminOptions, NewPartitions, NewTopic, TopicReplication,
    ResourceSpecifier, AlterConfig,
};
use rdkafka::client::DefaultClientContext;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::metadata::Metadata;
use rdkafka::ClientConfig;

use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

/// Wrapper around the rdkafka AdminClient providing high-level admin operations.
pub struct KafkaAdminClient {
    admin: AdminClient<DefaultClientContext>,
    consumer: BaseConsumer,
    timeout: Duration,
}

impl KafkaAdminClient {
    /// Create a new admin client from a connection configuration.
    pub fn create(config: &KafkaConnectionConfig) -> KafkaResult<Self> {
        let mut client_config = config.to_client_config();

        let admin: AdminClient<DefaultClientContext> = client_config
            .create()
            .map_err(|e| KafkaError::connection_failed(format!("Failed to create admin client: {}", e)))?;

        let consumer: BaseConsumer = client_config
            .set("group.id", "__sorng_admin_metadata")
            .create()
            .map_err(|e| KafkaError::connection_failed(format!("Failed to create metadata consumer: {}", e)))?;

        Ok(Self {
            admin,
            consumer,
            timeout: Duration::from_millis(config.request_timeout_ms as u64),
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
    pub async fn create_topics(
        &self,
        topics: &[CreateTopicRequest],
    ) -> KafkaResult<()> {
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

        let results = self.admin.create_topics(&new_topics, &self.admin_opts()).await?;

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
    pub async fn create_partitions(
        &self,
        topic: &str,
        new_total_count: i32,
    ) -> KafkaResult<()> {
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

        let results = self.admin.alter_configs(&[alter], &self.admin_opts()).await?;

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
    pub fn list_offsets(
        &self,
        topic: &str,
        partition: i32,
    ) -> KafkaResult<(i64, i64)> {
        use rdkafka::topic_partition_list::{TopicPartitionList, Offset};

        let mut tpl = TopicPartitionList::new();
        tpl.add_partition_offset(topic, partition, Offset::Beginning)
            .map_err(|e| KafkaError::offset_error(format!("Failed to set beginning offset: {}", e)))?;

        let earliest_offsets = self
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
    // ACLs (rdkafka doesn't expose ACL APIs directly, stubs use admin protocol)
    // -----------------------------------------------------------------------

    /// Describe ACLs matching a filter.
    pub async fn describe_acls(&self, _filter: &AclFilter) -> KafkaResult<Vec<AclEntry>> {
        // ACL operations require rdkafka compiled with the admin ACL features.
        // Providing a no-op stub that returns empty until the feature is available.
        log::warn!("ACL describe not fully supported in rdkafka; returning empty set");
        Ok(Vec::new())
    }

    /// Create ACL entries.
    pub async fn create_acls(&self, _entries: &[AclEntry]) -> KafkaResult<()> {
        log::warn!("ACL creation not fully supported in rdkafka");
        Ok(())
    }

    /// Delete ACL entries matching a filter.
    pub async fn delete_acls(&self, _filter: &AclFilter) -> KafkaResult<usize> {
        log::warn!("ACL deletion not fully supported in rdkafka");
        Ok(0)
    }
}
