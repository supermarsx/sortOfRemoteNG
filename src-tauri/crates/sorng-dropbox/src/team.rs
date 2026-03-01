//! Team administration operations (Business / Enterprise accounts).

/// Build team/get_info request (no args).
pub fn build_get_team_info() -> serde_json::Value {
    serde_json::json!(null)
}

/// Build team/members/list_v2 request body.
pub fn build_members_list(limit: Option<u32>, include_removed: bool) -> serde_json::Value {
    let mut body = serde_json::json!({
        "include_removed": include_removed,
    });
    if let Some(l) = limit {
        body["limit"] = serde_json::json!(l);
    }
    body
}

/// Build team/members/list/continue_v2 request body.
pub fn build_members_list_continue(cursor: &str) -> serde_json::Value {
    serde_json::json!({ "cursor": cursor })
}

/// Build team/members/get_info_v2 request body.
pub fn build_members_get_info(members: &[&str]) -> serde_json::Value {
    let selectors: Vec<serde_json::Value> = members
        .iter()
        .map(|m| {
            if m.contains('@') {
                serde_json::json!({".tag": "email", "email": *m})
            } else {
                serde_json::json!({".tag": "team_member_id", "team_member_id": *m})
            }
        })
        .collect();
    serde_json::json!({ "members": selectors })
}

/// Build team/members/add_v2 request body.
pub fn build_members_add(
    new_members: &[NewTeamMember],
    force_async: bool,
) -> serde_json::Value {
    let entries: Vec<serde_json::Value> = new_members
        .iter()
        .map(|nm| {
            let mut entry = serde_json::json!({
                "member_email": nm.email,
                "member_given_name": nm.given_name,
                "member_surname": nm.surname,
                "send_welcome_email": nm.send_welcome_email,
            });
            if let Some(ref role) = nm.role {
                entry["role"] = serde_json::json!({".tag": role});
            }
            if let Some(ref eid) = nm.member_external_id {
                entry["member_external_id"] = serde_json::json!(eid);
            }
            entry
        })
        .collect();
    serde_json::json!({
        "new_members": entries,
        "force_async": force_async,
    })
}

/// Build team/members/remove request body.
pub fn build_members_remove(
    team_member_id: &str,
    wipe_data: bool,
    transfer_dest_id: Option<&str>,
    transfer_admin_id: Option<&str>,
    keep_account: bool,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "user": {".tag": "team_member_id", "team_member_id": team_member_id},
        "wipe_data": wipe_data,
        "keep_account": keep_account,
    });
    if let Some(dest) = transfer_dest_id {
        body["transfer_dest_id"] = serde_json::json!({".tag": "team_member_id", "team_member_id": dest});
    }
    if let Some(admin) = transfer_admin_id {
        body["transfer_admin_id"] = serde_json::json!({".tag": "team_member_id", "team_member_id": admin});
    }
    body
}

/// Build team/members/suspend request body.
pub fn build_members_suspend(team_member_id: &str, wipe_data: bool) -> serde_json::Value {
    serde_json::json!({
        "user": {".tag": "team_member_id", "team_member_id": team_member_id},
        "wipe_data": wipe_data,
    })
}

/// Build team/members/unsuspend request body.
pub fn build_members_unsuspend(team_member_id: &str) -> serde_json::Value {
    serde_json::json!({
        "user": {".tag": "team_member_id", "team_member_id": team_member_id},
    })
}

/// Build team/members/set_admin_permissions_v2 request body.
pub fn build_set_admin_permissions(
    team_member_id: &str,
    new_role: &str,
) -> serde_json::Value {
    serde_json::json!({
        "user": {".tag": "team_member_id", "team_member_id": team_member_id},
        "new_role": new_role,
    })
}

/// Build team/namespaces/list request body.
pub fn build_namespaces_list(limit: Option<u32>) -> serde_json::Value {
    let mut body = serde_json::Map::new();
    if let Some(l) = limit {
        body.insert("limit".into(), serde_json::json!(l));
    }
    serde_json::Value::Object(body)
}

/// Build team/namespaces/list/continue request body.
pub fn build_namespaces_list_continue(cursor: &str) -> serde_json::Value {
    serde_json::json!({ "cursor": cursor })
}

/// Build team/devices/list_member_devices request body.
pub fn build_list_member_devices(
    team_member_id: &str,
    include_web_sessions: bool,
    include_desktop_clients: bool,
    include_mobile_clients: bool,
) -> serde_json::Value {
    serde_json::json!({
        "team_member_id": team_member_id,
        "include_web_sessions": include_web_sessions,
        "include_desktop_clients": include_desktop_clients,
        "include_mobile_clients": include_mobile_clients,
    })
}

/// Builder type for adding team members.
pub struct NewTeamMember {
    pub email: String,
    pub given_name: String,
    pub surname: String,
    pub send_welcome_email: bool,
    pub role: Option<String>,
    pub member_external_id: Option<String>,
}

impl NewTeamMember {
    pub fn new(email: &str, given_name: &str, surname: &str) -> Self {
        Self {
            email: email.to_string(),
            given_name: given_name.to_string(),
            surname: surname.to_string(),
            send_welcome_email: true,
            role: None,
            member_external_id: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_team_info_body() {
        let v = build_get_team_info();
        assert!(v.is_null());
    }

    #[test]
    fn members_list_body() {
        let v = build_members_list(Some(100), false);
        assert_eq!(v["limit"], 100);
        assert!(!v["include_removed"].as_bool().unwrap());
    }

    #[test]
    fn members_list_continue_body() {
        let v = build_members_list_continue("cursor_xyz");
        assert_eq!(v["cursor"], "cursor_xyz");
    }

    #[test]
    fn members_get_info_email() {
        let v = build_members_get_info(&["user@example.com"]);
        assert_eq!(v["members"][0][".tag"], "email");
    }

    #[test]
    fn members_get_info_id() {
        let v = build_members_get_info(&["dbmid:member123"]);
        assert_eq!(v["members"][0][".tag"], "team_member_id");
    }

    #[test]
    fn members_add_body() {
        let members = vec![NewTeamMember::new("a@b.com", "Alice", "Smith")];
        let v = build_members_add(&members, false);
        assert_eq!(v["new_members"].as_array().unwrap().len(), 1);
        assert_eq!(v["new_members"][0]["member_email"], "a@b.com");
    }

    #[test]
    fn members_remove_body() {
        let v = build_members_remove("tm123", true, None, None, false);
        assert_eq!(v["user"]["team_member_id"], "tm123");
        assert!(v["wipe_data"].as_bool().unwrap());
    }

    #[test]
    fn members_remove_with_transfer() {
        let v = build_members_remove("tm123", false, Some("tm_dest"), Some("tm_admin"), true);
        assert!(v.get("transfer_dest_id").is_some());
        assert!(v.get("transfer_admin_id").is_some());
    }

    #[test]
    fn members_suspend_body() {
        let v = build_members_suspend("tm123", true);
        assert_eq!(v["user"]["team_member_id"], "tm123");
    }

    #[test]
    fn members_unsuspend_body() {
        let v = build_members_unsuspend("tm123");
        assert_eq!(v["user"]["team_member_id"], "tm123");
    }

    #[test]
    fn set_admin_permissions_body() {
        let v = build_set_admin_permissions("tm123", "team_admin");
        assert_eq!(v["new_role"], "team_admin");
    }

    #[test]
    fn namespaces_list_body() {
        let v = build_namespaces_list(Some(50));
        assert_eq!(v["limit"], 50);
    }

    #[test]
    fn namespaces_list_continue_body() {
        let v = build_namespaces_list_continue("ns_cursor");
        assert_eq!(v["cursor"], "ns_cursor");
    }

    #[test]
    fn list_member_devices_body() {
        let v = build_list_member_devices("tm123", true, true, false);
        assert!(v["include_web_sessions"].as_bool().unwrap());
        assert!(!v["include_mobile_clients"].as_bool().unwrap());
    }

    #[test]
    fn new_team_member_defaults() {
        let m = NewTeamMember::new("x@y.com", "X", "Y");
        assert!(m.send_welcome_email);
        assert!(m.role.is_none());
        assert!(m.member_external_id.is_none());
    }
}
