use crate::admin::KafkaAdminClient;
use crate::error::KafkaResult;
use crate::types::*;

/// Create ACL entries on the cluster.
///
/// Note: rdkafka 0.36 does not expose ACL admin APIs.  The KafkaAdminClient
/// stub logs a warning and returns Ok(()) until a future rdkafka release adds
/// support.
pub async fn create_acls(admin: &KafkaAdminClient, entries: &[AclEntry]) -> KafkaResult<()> {
    if entries.is_empty() {
        return Ok(());
    }
    admin.create_acls(entries).await
}

/// Delete ACL entries matching the given filter.
///
/// Returns the list of deleted ACL entries.
pub async fn delete_acls(
    admin: &KafkaAdminClient,
    filters: &[AclFilter],
) -> KafkaResult<Vec<AclEntry>> {
    if filters.is_empty() {
        return Ok(Vec::new());
    }
    let mut deleted = Vec::new();
    for filter in filters {
        // Capture existing entries before deletion so we can report what was removed.
        let existing = admin.describe_acls(filter).await.unwrap_or_default();
        admin.delete_acls(filter).await?;
        deleted.extend(existing);
    }
    Ok(deleted)
}

/// List all ACL entries matching the given filter.
pub async fn list_acls(admin: &KafkaAdminClient, filter: &AclFilter) -> KafkaResult<Vec<AclEntry>> {
    admin.describe_acls(filter).await
}

/// Describe ACLs for a specific resource.
pub async fn describe_acls(
    admin: &KafkaAdminClient,
    resource_type: &ResourceType,
    resource_name: &str,
) -> KafkaResult<Vec<AclEntry>> {
    let filter = AclFilter {
        resource_type: Some(resource_type.clone()),
        resource_name: Some(resource_name.to_string()),
        ..AclFilter::default()
    };
    list_acls(admin, &filter).await
}

/// List ACLs for a specific principal.
pub async fn list_acls_for_principal(
    admin: &KafkaAdminClient,
    principal: &str,
) -> KafkaResult<Vec<AclEntry>> {
    let filter = AclFilter {
        principal: Some(principal.to_string()),
        ..AclFilter::default()
    };
    list_acls(admin, &filter).await
}

/// Create a read/write ACL for a topic.
pub async fn grant_topic_access(
    admin: &KafkaAdminClient,
    topic: &str,
    principal: &str,
    host: &str,
    operations: &[AclOperation],
) -> KafkaResult<()> {
    let entries: Vec<AclEntry> = operations
        .iter()
        .map(|op| AclEntry {
            resource_type: ResourceType::Topic,
            resource_name: topic.to_string(),
            pattern_type: PatternType::Literal,
            principal: principal.to_string(),
            host: host.to_string(),
            operation: op.clone(),
            permission_type: AclPermissionType::Allow,
        })
        .collect();

    create_acls(admin, &entries).await
}

/// Create ACLs for a consumer group.
pub async fn grant_group_access(
    admin: &KafkaAdminClient,
    group_id: &str,
    principal: &str,
    host: &str,
    operations: &[AclOperation],
) -> KafkaResult<()> {
    let entries: Vec<AclEntry> = operations
        .iter()
        .map(|op| AclEntry {
            resource_type: ResourceType::Group,
            resource_name: group_id.to_string(),
            pattern_type: PatternType::Literal,
            principal: principal.to_string(),
            host: host.to_string(),
            operation: op.clone(),
            permission_type: AclPermissionType::Allow,
        })
        .collect();

    create_acls(admin, &entries).await
}

/// Revoke all ACLs for a principal on a specific topic.
pub async fn revoke_topic_access(
    admin: &KafkaAdminClient,
    topic: &str,
    principal: &str,
) -> KafkaResult<Vec<AclEntry>> {
    let filter = AclFilter {
        resource_type: Some(ResourceType::Topic),
        resource_name: Some(topic.to_string()),
        principal: Some(principal.to_string()),
        ..AclFilter::default()
    };
    delete_acls(admin, &[filter]).await
}

/// Create a deny ACL for a resource.
pub async fn deny_access(
    admin: &KafkaAdminClient,
    resource_type: ResourceType,
    resource_name: &str,
    principal: &str,
    host: &str,
    operation: AclOperation,
) -> KafkaResult<()> {
    let entry = AclEntry {
        resource_type,
        resource_name: resource_name.to_string(),
        pattern_type: PatternType::Literal,
        principal: principal.to_string(),
        host: host.to_string(),
        operation,
        permission_type: AclPermissionType::Deny,
    };
    create_acls(admin, &[entry]).await
}
