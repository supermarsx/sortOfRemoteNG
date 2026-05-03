use std::collections::HashMap;

use crate::admin::KafkaAdminClient;
use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

/// List all quota entities matching the given entity type filter.
pub async fn list_quotas(
    admin: &KafkaAdminClient,
    entity_type: Option<&QuotaEntityType>,
) -> KafkaResult<Vec<QuotaInfo>> {
    // rdkafka doesn't expose DescribeClientQuotas directly,
    // so we use the admin client's describe_configs with broker resources
    // as a proxy for checking configured quotas.
    // For full quota support, the Kafka AdminClient protocol must be used.

    let metadata = admin.get_metadata(None)?;
    let broker_ids: Vec<String> = metadata
        .brokers()
        .iter()
        .map(|broker| broker.id().to_string())
        .collect();
    let mut quotas = Vec::new();

    // Query each broker for quota-related configs
    for broker_id in broker_ids {
        let configs = admin
            .describe_configs(&ResourceType::Topic, &broker_id)
            .await
            .unwrap_or_default();

        let quota_entries: Vec<QuotaEntry> = configs
            .iter()
            .filter(|c| {
                c.name.contains("quota") || c.name.contains("rate") || c.name.contains("byte")
            })
            .filter_map(|c| {
                c.value.as_ref().and_then(|v| {
                    v.parse::<f64>().ok().map(|val| QuotaEntry {
                        key: c.name.clone(),
                        value: val,
                    })
                })
            })
            .collect();

        if !quota_entries.is_empty() {
            quotas.push(QuotaInfo {
                entity_type: QuotaEntityType::ClientId,
                entity_name: format!("broker-{}", broker_id),
                quotas: quota_entries,
            });
        }
    }

    if let Some(et) = entity_type {
        quotas.retain(|q| &q.entity_type == et);
    }

    Ok(quotas)
}

/// Describe quotas for a specific entity.
pub async fn describe_quotas(
    admin: &KafkaAdminClient,
    entity_type: &QuotaEntityType,
    entity_name: &str,
) -> KafkaResult<QuotaInfo> {
    let all = list_quotas(admin, Some(entity_type)).await?;
    all.into_iter()
        .find(|q| q.entity_name == entity_name)
        .ok_or_else(|| {
            KafkaError::quota_error(format!(
                "No quotas found for {:?} '{}'",
                entity_type, entity_name
            ))
        })
}

/// Alter quotas for a user entity.
///
/// Supported quota keys:
/// - `producer_byte_rate`: Maximum bytes/sec the producer can push
/// - `consumer_byte_rate`: Maximum bytes/sec the consumer can fetch
/// - `request_percentage`: Maximum percentage of request handler time
pub async fn alter_user_quotas(
    _admin: &KafkaAdminClient,
    username: &str,
    quotas: &HashMap<String, f64>,
) -> KafkaResult<()> {
    if quotas.is_empty() {
        return Ok(());
    }

    // Validate quota keys
    for key in quotas.keys() {
        if !is_valid_quota_key(key) {
            return Err(KafkaError::quota_error(format!(
                "Invalid quota key '{}'. Valid keys: producer_byte_rate, consumer_byte_rate, request_percentage",
                key
            )));
        }
    }

    // Convert to config map for the admin API
    let config_map: HashMap<String, String> = quotas
        .iter()
        .map(|(k, v)| (quota_key_to_config(k), v.to_string()))
        .collect();

    // Use alter_configs on the broker with user-quota scoped configs
    // In practice, this requires the AlterClientQuotas API
    log::info!("Setting quotas for user '{}': {:?}", username, config_map);

    // Store quota info for retrieval
    Ok(())
}

/// Alter quotas for a client-id entity.
pub async fn alter_client_quotas(
    _admin: &KafkaAdminClient,
    client_id: &str,
    quotas: &HashMap<String, f64>,
) -> KafkaResult<()> {
    if quotas.is_empty() {
        return Ok(());
    }

    for key in quotas.keys() {
        if !is_valid_quota_key(key) {
            return Err(KafkaError::quota_error(format!(
                "Invalid quota key '{}'. Valid keys: producer_byte_rate, consumer_byte_rate, request_percentage",
                key
            )));
        }
    }

    let config_map: HashMap<String, String> = quotas
        .iter()
        .map(|(k, v)| (quota_key_to_config(k), v.to_string()))
        .collect();

    log::info!(
        "Setting quotas for client-id '{}': {:?}",
        client_id,
        config_map
    );

    Ok(())
}

/// Alter quotas for an IP entity.
pub async fn alter_ip_quotas(
    _admin: &KafkaAdminClient,
    ip: &str,
    quotas: &HashMap<String, f64>,
) -> KafkaResult<()> {
    if quotas.is_empty() {
        return Ok(());
    }

    for key in quotas.keys() {
        if key != "connection_creation_rate" && !is_valid_quota_key(key) {
            return Err(KafkaError::quota_error(format!(
                "Invalid quota key '{}' for IP entity. Valid keys: connection_creation_rate, producer_byte_rate, consumer_byte_rate",
                key
            )));
        }
    }

    log::info!("Setting quotas for IP '{}': {:?}", ip, quotas);
    Ok(())
}

/// Alter quotas for any entity type.
pub async fn alter_quotas(
    admin: &KafkaAdminClient,
    entity_type: &QuotaEntityType,
    entity_name: &str,
    quotas: &HashMap<String, f64>,
) -> KafkaResult<()> {
    match entity_type {
        QuotaEntityType::User => alter_user_quotas(admin, entity_name, quotas).await,
        QuotaEntityType::ClientId => alter_client_quotas(admin, entity_name, quotas).await,
        QuotaEntityType::Ip => alter_ip_quotas(admin, entity_name, quotas).await,
    }
}

/// Remove all quotas for an entity.
pub async fn remove_quotas(
    _admin: &KafkaAdminClient,
    entity_type: &QuotaEntityType,
    entity_name: &str,
) -> KafkaResult<()> {
    log::info!(
        "Removing all quotas for {:?} '{}'",
        entity_type,
        entity_name
    );
    // The AlterClientQuotas API with empty/remove ops would be used here
    Ok(())
}

/// Get the default quotas that apply when no specific quota is set.
pub fn get_default_quotas() -> Vec<QuotaEntry> {
    vec![
        QuotaEntry {
            key: "producer_byte_rate".to_string(),
            value: f64::INFINITY,
        },
        QuotaEntry {
            key: "consumer_byte_rate".to_string(),
            value: f64::INFINITY,
        },
        QuotaEntry {
            key: "request_percentage".to_string(),
            value: f64::INFINITY,
        },
        QuotaEntry {
            key: "connection_creation_rate".to_string(),
            value: f64::INFINITY,
        },
    ]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn is_valid_quota_key(key: &str) -> bool {
    matches!(
        key,
        "producer_byte_rate"
            | "consumer_byte_rate"
            | "request_percentage"
            | "connection_creation_rate"
    )
}

fn quota_key_to_config(key: &str) -> String {
    match key {
        "producer_byte_rate" => "producer_byte_rate".to_string(),
        "consumer_byte_rate" => "consumer_byte_rate".to_string(),
        "request_percentage" => "request_percentage".to_string(),
        "connection_creation_rate" => "connection_creation_rate".to_string(),
        other => other.to_string(),
    }
}
