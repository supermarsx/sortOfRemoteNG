//! Paper document operations — create, update, archive, list, export.

use crate::types::*;

/// Build paper/docs/create request body.
pub fn build_paper_create(
    path: &str,
    import_format: &str,
) -> serde_json::Value {
    serde_json::json!({
        "path": path,
        "import_format": import_format,
    })
}

/// Build paper/docs/update request body (content goes in the upload body).
pub fn build_paper_update(
    path: &str,
    import_format: &str,
    doc_update_policy: &PaperDocUpdatePolicy,
    paper_revision: Option<i64>,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "path": path,
        "import_format": import_format,
        "doc_update_policy": doc_update_policy,
    });
    if let Some(rev) = paper_revision {
        body["paper_revision"] = serde_json::json!(rev);
    }
    body
}

/// Build files/paper/create (Paper-as-files) upload arg header.
pub fn build_paper_file_create(path: &str) -> serde_json::Value {
    serde_json::json!({
        "path": path,
        "import_format": "html",
    })
}

/// Build files/paper/update upload arg header.
pub fn build_paper_file_update(
    path: &str,
    doc_update_policy: &PaperDocUpdatePolicy,
    paper_revision: Option<i64>,
) -> serde_json::Value {
    let mut arg = serde_json::json!({
        "path": path,
        "import_format": "html",
        "doc_update_policy": doc_update_policy,
    });
    if let Some(rev) = paper_revision {
        arg["paper_revision"] = serde_json::json!(rev);
    }
    arg
}

/// Build paper/docs/download arg header for exporting.
pub fn build_paper_export(
    doc_id: &str,
    export_format: &PaperDocExportFormat,
) -> serde_json::Value {
    serde_json::json!({
        "doc_id": doc_id,
        "export_format": export_format,
    })
}

/// Build paper/docs/archive request body.
pub fn build_paper_archive(doc_id: &str) -> serde_json::Value {
    serde_json::json!({ "doc_id": doc_id })
}

/// Build paper/docs/permanently_delete request body.
pub fn build_paper_permanently_delete(doc_id: &str) -> serde_json::Value {
    serde_json::json!({ "doc_id": doc_id })
}

/// Build paper/docs/get_folder_info request body.
pub fn build_paper_get_folder_info(doc_id: &str) -> serde_json::Value {
    serde_json::json!({ "doc_id": doc_id })
}

/// Build paper/docs/list request body.
pub fn build_paper_list(
    filter_by: Option<&str>,
    sort_by: Option<&str>,
    sort_order: Option<&str>,
    limit: Option<u32>,
) -> serde_json::Value {
    let mut body = serde_json::Map::new();
    if let Some(f) = filter_by {
        body.insert("filter_by".into(), serde_json::json!(f));
    }
    if let Some(s) = sort_by {
        body.insert("sort_by".into(), serde_json::json!(s));
    }
    if let Some(o) = sort_order {
        body.insert("sort_order".into(), serde_json::json!(o));
    }
    if let Some(l) = limit {
        body.insert("limit".into(), serde_json::json!(l));
    }
    serde_json::Value::Object(body)
}

/// Build paper/docs/list/continue request body.
pub fn build_paper_list_continue(cursor: &str) -> serde_json::Value {
    serde_json::json!({ "cursor": cursor })
}

/// Build paper/docs/sharing_policy/set request body.
pub fn build_paper_set_sharing_policy(
    doc_id: &str,
    public_sharing_policy: Option<&str>,
    team_sharing_policy: Option<&str>,
) -> serde_json::Value {
    let mut policy = serde_json::Map::new();
    if let Some(p) = public_sharing_policy {
        policy.insert("public_sharing_policy".into(), serde_json::json!(p));
    }
    if let Some(t) = team_sharing_policy {
        policy.insert("team_sharing_policy".into(), serde_json::json!(t));
    }
    serde_json::json!({
        "doc_id": doc_id,
        "sharing_policy": serde_json::Value::Object(policy),
    })
}

/// Build paper/docs/users/add request body.
pub fn build_paper_add_users(
    doc_id: &str,
    members: &[PaperMemberEntry],
    custom_message: Option<&str>,
    quiet: bool,
) -> serde_json::Value {
    let entries: Vec<serde_json::Value> = members
        .iter()
        .map(|m| {
            serde_json::json!({
                "member": {".tag": "email", "email": &m.email},
                "permission_level": {".tag": &m.permission_level},
            })
        })
        .collect();
    let mut body = serde_json::json!({
        "doc_id": doc_id,
        "members": entries,
        "quiet": quiet,
    });
    if let Some(msg) = custom_message {
        body["custom_message"] = serde_json::json!(msg);
    }
    body
}

/// Build paper/docs/users/remove request body.
pub fn build_paper_remove_user(doc_id: &str, email: &str) -> serde_json::Value {
    serde_json::json!({
        "doc_id": doc_id,
        "member": {".tag": "email", "email": email},
    })
}

/// Paper member entry for adding users.
pub struct PaperMemberEntry {
    pub email: String,
    pub permission_level: String, // "edit" or "view_and_comment"
}

impl PaperMemberEntry {
    pub fn editor(email: &str) -> Self {
        Self {
            email: email.to_string(),
            permission_level: "edit".to_string(),
        }
    }
    pub fn viewer(email: &str) -> Self {
        Self {
            email: email.to_string(),
            permission_level: "view_and_comment".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_create_body() {
        let v = build_paper_create("/Documents/Note.paper", "html");
        assert_eq!(v["path"], "/Documents/Note.paper");
        assert_eq!(v["import_format"], "html");
    }

    #[test]
    fn paper_update_body() {
        let v = build_paper_update("/doc.paper", "markdown", &PaperDocUpdatePolicy::Overwrite, Some(42));
        assert_eq!(v["paper_revision"], 42);
    }

    #[test]
    fn paper_update_no_revision() {
        let v = build_paper_update("/doc.paper", "html", &PaperDocUpdatePolicy::Append, None);
        assert!(v.get("paper_revision").is_none());
    }

    #[test]
    fn paper_file_create_body() {
        let v = build_paper_file_create("/new.paper");
        assert_eq!(v["path"], "/new.paper");
    }

    #[test]
    fn paper_file_update_body() {
        let v = build_paper_file_update("/doc.paper", &PaperDocUpdatePolicy::Overwrite, None);
        assert_eq!(v["import_format"], "html");
    }

    #[test]
    fn paper_export_body() {
        let v = build_paper_export("doc_id_123", &PaperDocExportFormat::Markdown);
        assert_eq!(v["doc_id"], "doc_id_123");
    }

    #[test]
    fn paper_archive_body() {
        let v = build_paper_archive("doc_id_123");
        assert_eq!(v["doc_id"], "doc_id_123");
    }

    #[test]
    fn paper_permanently_delete_body() {
        let v = build_paper_permanently_delete("doc_id_123");
        assert_eq!(v["doc_id"], "doc_id_123");
    }

    #[test]
    fn paper_list_body() {
        let v = build_paper_list(Some("docs_created"), Some("modified"), Some("descending"), Some(50));
        assert_eq!(v["filter_by"], "docs_created");
        assert_eq!(v["limit"], 50);
    }

    #[test]
    fn paper_list_continue_body() {
        let v = build_paper_list_continue("cursor_paper_abc");
        assert_eq!(v["cursor"], "cursor_paper_abc");
    }

    #[test]
    fn paper_set_sharing_policy_body() {
        let v = build_paper_set_sharing_policy("doc1", Some("people_with_link_can_edit"), None);
        assert!(v["sharing_policy"]["public_sharing_policy"].as_str().is_some());
    }

    #[test]
    fn paper_add_users_body() {
        let members = vec![
            PaperMemberEntry::editor("alice@example.com"),
            PaperMemberEntry::viewer("bob@example.com"),
        ];
        let v = build_paper_add_users("doc1", &members, Some("Hello!"), false);
        assert_eq!(v["members"].as_array().unwrap().len(), 2);
        assert_eq!(v["custom_message"], "Hello!");
    }

    #[test]
    fn paper_remove_user_body() {
        let v = build_paper_remove_user("doc1", "user@example.com");
        assert_eq!(v["member"]["email"], "user@example.com");
    }

    #[test]
    fn paper_member_entry_editor() {
        let e = PaperMemberEntry::editor("a@b.com");
        assert_eq!(e.permission_level, "edit");
    }

    #[test]
    fn paper_member_entry_viewer() {
        let e = PaperMemberEntry::viewer("a@b.com");
        assert_eq!(e.permission_level, "view_and_comment");
    }
}
