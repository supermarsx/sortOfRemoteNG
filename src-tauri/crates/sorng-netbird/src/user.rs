//! # NetBird User Management
//!
//! User lifecycle helpers — role management, service-user creation,
//! user blocking, and auto-group assignment.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Request to create a service user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateServiceUserRequest {
    pub name: String,
    pub role: UserRole,
    pub auto_groups: Vec<String>,
    pub is_service_user: bool,
}

/// Request to update an existing user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserRequest {
    pub role: Option<UserRole>,
    pub auto_groups: Option<Vec<String>>,
    pub is_blocked: Option<bool>,
}

/// Summary of account users.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSummary {
    pub total: u32,
    pub owners: u32,
    pub admins: u32,
    pub regular: u32,
    pub service_users: u32,
    pub blocked: u32,
}

pub fn summarize_users(users: &[&NetBirdUser]) -> UserSummary {
    UserSummary {
        total: users.len() as u32,
        owners: users.iter().filter(|u| u.role == UserRole::Owner).count() as u32,
        admins: users.iter().filter(|u| u.role == UserRole::Admin).count() as u32,
        regular: users.iter().filter(|u| u.role == UserRole::User).count() as u32,
        service_users: users.iter().filter(|u| u.is_service_user).count() as u32,
        blocked: users.iter().filter(|u| u.is_blocked).count() as u32,
    }
}

/// Filter for active (non-blocked, non-service) human users.
pub fn active_human_users<'a>(users: &[&'a NetBirdUser]) -> Vec<&'a NetBirdUser> {
    users
        .iter()
        .filter(|u| !u.is_blocked && !u.is_service_user)
        .copied()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_user(id: &str, role: UserRole, service: bool, blocked: bool) -> NetBirdUser {
        NetBirdUser {
            id: id.into(),
            email: Some(format!("{}@example.com", id)),
            name: id.into(),
            role,
            auto_groups: vec![],
            is_current: false,
            is_service_user: service,
            is_blocked: blocked,
            last_login: None,
            issued: None,
            permissions: UserPermissions { dashboard_view: None },
        }
    }

    #[test]
    fn test_summarize_users() {
        let users = vec![
            make_user("a", UserRole::Owner, false, false),
            make_user("b", UserRole::Admin, false, false),
            make_user("c", UserRole::User, false, true),
            make_user("d", UserRole::User, true, false),
        ];
        let refs: Vec<&NetBirdUser> = users.iter().collect();
        let summary = summarize_users(&refs);
        assert_eq!(summary.total, 4);
        assert_eq!(summary.owners, 1);
        assert_eq!(summary.admins, 1);
        assert_eq!(summary.blocked, 1);
        assert_eq!(summary.service_users, 1);
    }

    #[test]
    fn test_active_human_users() {
        let users = vec![
            make_user("a", UserRole::User, false, false),
            make_user("b", UserRole::User, true, false),
            make_user("c", UserRole::User, false, true),
        ];
        let refs: Vec<&NetBirdUser> = users.iter().collect();
        let active = active_human_users(&refs);
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, "a");
    }
}
