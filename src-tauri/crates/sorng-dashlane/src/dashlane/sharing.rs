use crate::dashlane::types::{
    DashlaneError, SharingGroup, SharingMember, SharingPermission, SharingStatus,
    DashlaneCredential,
};

/// Check if a credential is in any sharing group.
pub fn is_shared(credential: &DashlaneCredential, groups: &[SharingGroup]) -> bool {
    groups.iter().any(|g| g.item_ids.contains(&credential.id))
}

/// Get sharing groups that contain a specific credential.
pub fn get_sharing_groups_for_item(
    item_id: &str,
    groups: &[SharingGroup],
) -> Vec<SharingGroup> {
    groups
        .iter()
        .filter(|g| g.item_ids.contains(&item_id.to_string()))
        .cloned()
        .collect()
}

/// Get all shared credentials.
pub fn get_shared_credentials(
    credentials: &[DashlaneCredential],
    groups: &[SharingGroup],
) -> Vec<DashlaneCredential> {
    let shared_ids: std::collections::HashSet<&str> = groups
        .iter()
        .flat_map(|g| g.item_ids.iter().map(|s| s.as_str()))
        .collect();

    credentials
        .iter()
        .filter(|c| shared_ids.contains(c.id.as_str()))
        .cloned()
        .collect()
}

/// Get personal (non-shared) credentials.
pub fn get_personal_credentials(
    credentials: &[DashlaneCredential],
    groups: &[SharingGroup],
) -> Vec<DashlaneCredential> {
    let shared_ids: std::collections::HashSet<&str> = groups
        .iter()
        .flat_map(|g| g.item_ids.iter().map(|s| s.as_str()))
        .collect();

    credentials
        .iter()
        .filter(|c| !shared_ids.contains(c.id.as_str()))
        .cloned()
        .collect()
}

/// Find a member in a sharing group.
pub fn find_member<'a>(group: &'a SharingGroup, user_id: &str) -> Option<&'a SharingMember> {
    group.members.iter().find(|m| m.user_id == user_id)
}

/// Check if a user can manage a sharing group.
pub fn can_manage_group(group: &SharingGroup, user_id: &str) -> bool {
    group
        .members
        .iter()
        .any(|m| m.user_id == user_id && m.permission == SharingPermission::Admin)
}

/// Get active members only.
pub fn get_active_members(group: &SharingGroup) -> Vec<&SharingMember> {
    group
        .members
        .iter()
        .filter(|m| m.status == SharingStatus::Accepted)
        .collect()
}

/// Get pending members.
pub fn get_pending_members(group: &SharingGroup) -> Vec<&SharingMember> {
    group
        .members
        .iter()
        .filter(|m| m.status == SharingStatus::Pending)
        .collect()
}

/// Create a new sharing group.
pub fn create_sharing_group(
    name: String,
    owner_id: String,
    owner_name: String,
) -> SharingGroup {
    SharingGroup {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        members: vec![SharingMember {
            user_id: owner_id,
            name: owner_name,
            permission: SharingPermission::Admin,
            status: SharingStatus::Accepted,
        }],
        item_ids: Vec::new(),
        created_at: Some(chrono::Utc::now().to_rfc3339()),
    }
}

/// Add items to a sharing group.
pub fn add_items_to_group(group: &mut SharingGroup, item_ids: Vec<String>) {
    for id in item_ids {
        if !group.item_ids.contains(&id) {
            group.item_ids.push(id);
        }
    }
}

/// Remove items from a sharing group.
pub fn remove_items_from_group(group: &mut SharingGroup, item_ids: &[String]) {
    group.item_ids.retain(|id| !item_ids.contains(id));
}
