// ──────────────────────────────────────────────────────────────────────────────
// sorng-nextcloud · activity
// ──────────────────────────────────────────────────────────────────────────────
// OCS Activity API:
//  • List activities (all / per-file)
//  • Query with filters (type, since, limit)
//  • Push-based change detection via activity polling
// ──────────────────────────────────────────────────────────────────────────────

use crate::client::NextcloudClient;
use crate::types::*;

const ACTIVITY_API: &str = "ocs/v2.php/apps/activity/api/v2/activity";

// ── Listing ──────────────────────────────────────────────────────────────────

/// Get the activity feed for the current user.
pub async fn list_activities(
    client: &NextcloudClient,
    query: &ActivityQuery,
) -> Result<Vec<ActivityItem>, String> {
    let mut url = format!("{}?format=json", ACTIVITY_API);

    if let Some(ref filter) = query.filter {
        url.push_str(&format!(
            "&type={}",
            url::form_urlencoded::byte_serialize(filter.as_bytes()).collect::<String>()
        ));
    }
    if let Some(since) = query.since {
        url.push_str(&format!("&since={}", since));
    }
    if let Some(limit) = query.limit {
        url.push_str(&format!("&limit={}", limit));
    }
    if let Some(ref ot) = query.object_type {
        url.push_str(&format!(
            "&object_type={}",
            url::form_urlencoded::byte_serialize(ot.as_bytes()).collect::<String>()
        ));
    }
    if let Some(oid) = query.object_id {
        url.push_str(&format!("&object_id={}", oid));
    }
    if let Some(ref sort) = query.sort {
        url.push_str(&format!("&sort={}", sort));
    }

    let resp: OcsResponse<Vec<ActivityItem>> = client.ocs_get(&url).await?;
    Ok(resp.ocs.data)
}

/// Get activities for a specific file (by file id).
pub async fn activities_for_file(
    client: &NextcloudClient,
    file_id: u64,
    limit: Option<u32>,
    since: Option<u64>,
) -> Result<Vec<ActivityItem>, String> {
    let query = ActivityQuery {
        filter: Some("filter".to_string()),
        since,
        limit,
        object_type: Some("files".to_string()),
        object_id: Some(file_id),
        sort: Some("desc".to_string()),
    };
    list_activities(client, &query).await
}

/// Get the most recent activities (convenience).
pub async fn recent_activities(
    client: &NextcloudClient,
    limit: u32,
) -> Result<Vec<ActivityItem>, String> {
    let query = ActivityQuery {
        limit: Some(limit),
        sort: Some("desc".to_string()),
        ..ActivityQuery::default()
    };
    list_activities(client, &query).await
}

// ── Activity Filters ─────────────────────────────────────────────────────────

/// List available activity filter types.
pub async fn list_activity_filters(
    client: &NextcloudClient,
) -> Result<Vec<ActivityFilter>, String> {
    let resp: OcsResponse<Vec<ActivityFilter>> = client
        .ocs_get("ocs/v2.php/apps/activity/api/v2/activity/filters?format=json")
        .await?;
    Ok(resp.ocs.data)
}

/// A filter type available for the activity API.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ActivityFilter {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub priority: Option<u32>,
}

// ── Change detection ─────────────────────────────────────────────────────────

/// Poll for new activities since a given activity id.
/// Useful for implementing change detection / push-like notifications.
pub async fn poll_changes(
    client: &NextcloudClient,
    last_known_id: u64,
    limit: u32,
) -> Result<Vec<ActivityItem>, String> {
    let query = ActivityQuery {
        since: Some(last_known_id),
        limit: Some(limit),
        sort: Some("asc".to_string()),
        ..ActivityQuery::default()
    };
    list_activities(client, &query).await
}

/// Extract file-related changes from an activity list.
pub fn extract_file_changes(activities: &[ActivityItem]) -> Vec<ActivityFileChange> {
    activities
        .iter()
        .filter(|a| a.object_type.as_deref() == Some("files"))
        .map(|a| ActivityFileChange {
            activity_id: a.activity_id,
            file_id: a.object_id.unwrap_or(0),
            file_name: a.object_name.clone().unwrap_or_default(),
            action: classify_activity_action(&a.activity_type),
            user: a.user.clone(),
            timestamp: a.timestamp,
        })
        .collect()
}

/// High-level classification of an activity.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub enum ActivityAction {
    Created,
    Modified,
    Deleted,
    Moved,
    Renamed,
    Shared,
    Unshared,
    Restored,
    Commented,
    Tagged,
    Favorited,
    Other,
}

/// File-level change derived from an activity.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ActivityFileChange {
    pub activity_id: u64,
    pub file_id: u64,
    pub file_name: String,
    pub action: ActivityAction,
    pub user: String,
    pub timestamp: u64,
}

/// Map an activity type string to an `ActivityAction`.
pub fn classify_activity_action(activity_type: &str) -> ActivityAction {
    match activity_type {
        "file_created" | "created_self" | "created_by" | "created_public" => {
            ActivityAction::Created
        }
        "file_changed" | "changed_self" | "changed_by" => ActivityAction::Modified,
        "file_deleted" | "deleted_self" | "deleted_by" => ActivityAction::Deleted,
        "file_moved" | "moved_self" | "moved_by" => ActivityAction::Moved,
        "file_renamed" | "renamed_self" | "renamed_by" => ActivityAction::Renamed,
        "shared_user_self" | "shared_group_self" | "shared_link_self" | "shared_with_by" => {
            ActivityAction::Shared
        }
        "unshared_user_self" | "unshared_group_self" | "unshared_link_self"
        | "unshared_by" => ActivityAction::Unshared,
        "file_restored" | "restored_self" | "restored_by" => ActivityAction::Restored,
        s if s.contains("comment") => ActivityAction::Commented,
        s if s.contains("tag") => ActivityAction::Tagged,
        s if s.contains("favorite") => ActivityAction::Favorited,
        _ => ActivityAction::Other,
    }
}

// ── Activity summary ─────────────────────────────────────────────────────────

/// Summary statistics from a list of activities.
#[derive(Debug, Clone, Default)]
pub struct ActivitySummary {
    pub total: usize,
    pub files_created: usize,
    pub files_modified: usize,
    pub files_deleted: usize,
    pub shares: usize,
    pub comments: usize,
    pub other: usize,
}

/// Compute a summary from activities.
pub fn summarize_activities(activities: &[ActivityItem]) -> ActivitySummary {
    let mut s = ActivitySummary {
        total: activities.len(),
        ..Default::default()
    };

    for a in activities {
        match classify_activity_action(&a.activity_type) {
            ActivityAction::Created => s.files_created += 1,
            ActivityAction::Modified => s.files_modified += 1,
            ActivityAction::Deleted => s.files_deleted += 1,
            ActivityAction::Shared | ActivityAction::Unshared => s.shares += 1,
            ActivityAction::Commented => s.comments += 1,
            _ => s.other += 1,
        }
    }

    s
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_created() {
        assert_eq!(
            classify_activity_action("file_created"),
            ActivityAction::Created
        );
        assert_eq!(
            classify_activity_action("created_self"),
            ActivityAction::Created
        );
    }

    #[test]
    fn classify_modified() {
        assert_eq!(
            classify_activity_action("file_changed"),
            ActivityAction::Modified
        );
    }

    #[test]
    fn classify_deleted() {
        assert_eq!(
            classify_activity_action("file_deleted"),
            ActivityAction::Deleted
        );
    }

    #[test]
    fn classify_shared() {
        assert_eq!(
            classify_activity_action("shared_user_self"),
            ActivityAction::Shared
        );
        assert_eq!(
            classify_activity_action("shared_link_self"),
            ActivityAction::Shared
        );
    }

    #[test]
    fn classify_moved() {
        assert_eq!(
            classify_activity_action("file_moved"),
            ActivityAction::Moved
        );
    }

    #[test]
    fn classify_comment() {
        assert_eq!(
            classify_activity_action("add_comment"),
            ActivityAction::Commented
        );
    }

    #[test]
    fn classify_unknown() {
        assert_eq!(
            classify_activity_action("some_random_thing"),
            ActivityAction::Other
        );
    }

    #[test]
    fn extract_file_changes_filters() {
        let activities = vec![
            ActivityItem {
                activity_id: 1,
                app: "files".into(),
                activity_type: "file_created".into(),
                affecteduser: "alice".into(),
                user: "alice".into(),
                timestamp: 1000,
                subject: "created file.txt".into(),
                subject_rich: None,
                message: None,
                message_rich: None,
                object_type: Some("files".into()),
                object_id: Some(42),
                object_name: Some("file.txt".into()),
                link: None,
                icon: None,
                previews: None,
            },
            ActivityItem {
                activity_id: 2,
                app: "comments".into(),
                activity_type: "add_comment".into(),
                affecteduser: "alice".into(),
                user: "bob".into(),
                timestamp: 2000,
                subject: "comment".into(),
                subject_rich: None,
                message: None,
                message_rich: None,
                object_type: Some("chat".into()),
                object_id: None,
                object_name: None,
                link: None,
                icon: None,
                previews: None,
            },
        ];

        let changes = extract_file_changes(&activities);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].file_id, 42);
        assert_eq!(changes[0].action, ActivityAction::Created);
    }

    #[test]
    fn summarize_activities_counts() {
        let activities = vec![
            ActivityItem {
                activity_id: 1,
                app: "files".into(),
                activity_type: "file_created".into(),
                affecteduser: "a".into(),
                user: "a".into(),
                timestamp: 1,
                subject: "s".into(),
                subject_rich: None,
                message: None,
                message_rich: None,
                object_type: None,
                object_id: None,
                object_name: None,
                link: None,
                icon: None,
                previews: None,
            },
            ActivityItem {
                activity_id: 2,
                app: "files".into(),
                activity_type: "file_changed".into(),
                affecteduser: "a".into(),
                user: "a".into(),
                timestamp: 2,
                subject: "s".into(),
                subject_rich: None,
                message: None,
                message_rich: None,
                object_type: None,
                object_id: None,
                object_name: None,
                link: None,
                icon: None,
                previews: None,
            },
            ActivityItem {
                activity_id: 3,
                app: "files".into(),
                activity_type: "file_deleted".into(),
                affecteduser: "a".into(),
                user: "a".into(),
                timestamp: 3,
                subject: "s".into(),
                subject_rich: None,
                message: None,
                message_rich: None,
                object_type: None,
                object_id: None,
                object_name: None,
                link: None,
                icon: None,
                previews: None,
            },
        ];

        let s = summarize_activities(&activities);
        assert_eq!(s.total, 3);
        assert_eq!(s.files_created, 1);
        assert_eq!(s.files_modified, 1);
        assert_eq!(s.files_deleted, 1);
    }

    #[test]
    fn default_activity_query() {
        let q = ActivityQuery::default();
        assert!(q.filter.is_none());
        assert!(q.since.is_none());
    }
}
