//! # NetBird Setup Key Management
//!
//! Helpers for setup key lifecycle — creation, validation, expiry tracking,
//! rotation strategy, and bulk operations.

use crate::types::*;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

/// Check whether a setup key is expired.
pub fn is_expired(key: &SetupKey) -> bool {
    key.expires < Utc::now()
}

/// Check whether a setup key has reached its usage limit.
pub fn is_overused(key: &SetupKey) -> bool {
    key.usage_limit > 0 && key.used_times >= key.usage_limit
}

/// Compute the effective state of a setup key.
pub fn compute_state(key: &SetupKey) -> SetupKeyState {
    if key.revoked {
        SetupKeyState::Revoked
    } else if is_expired(key) {
        SetupKeyState::Expired
    } else if is_overused(key) {
        SetupKeyState::Overused
    } else {
        SetupKeyState::Valid
    }
}

/// Identify setup keys that expire within the given duration.
pub fn expiring_soon<'a>(keys: &[&'a SetupKey], within: Duration) -> Vec<&'a SetupKey> {
    let deadline = Utc::now() + within;
    keys.iter()
        .filter(|k| k.valid && !k.revoked && k.expires < deadline)
        .copied()
        .collect()
}

/// Summary of setup key inventory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupKeySummary {
    pub total: u32,
    pub valid: u32,
    pub expired: u32,
    pub revoked: u32,
    pub overused: u32,
    pub reusable: u32,
    pub one_off: u32,
    pub ephemeral: u32,
    pub expiring_within_24h: u32,
}

pub fn summarize_keys(keys: &[&SetupKey]) -> SetupKeySummary {
    let day = Duration::hours(24);
    SetupKeySummary {
        total: keys.len() as u32,
        valid: keys.iter().filter(|k| compute_state(k) == SetupKeyState::Valid).count() as u32,
        expired: keys.iter().filter(|k| compute_state(k) == SetupKeyState::Expired).count() as u32,
        revoked: keys.iter().filter(|k| compute_state(k) == SetupKeyState::Revoked).count() as u32,
        overused: keys.iter().filter(|k| compute_state(k) == SetupKeyState::Overused).count() as u32,
        reusable: keys.iter().filter(|k| k.key_type == SetupKeyType::Reusable).count() as u32,
        one_off: keys.iter().filter(|k| k.key_type == SetupKeyType::OneOff).count() as u32,
        ephemeral: keys.iter().filter(|k| k.ephemeral).count() as u32,
        expiring_within_24h: expiring_soon(keys, day).len() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn make_key(id: &str, valid: bool, revoked: bool, hours_until_expiry: i64) -> SetupKey {
        SetupKey {
            id: id.into(),
            key: format!("key-{}", id),
            name: id.into(),
            key_type: SetupKeyType::Reusable,
            expires: Utc::now() + Duration::hours(hours_until_expiry),
            revoked,
            used_times: 0,
            last_used: None,
            auto_groups: vec![],
            usage_limit: 0,
            valid,
            state: SetupKeyState::Valid,
            ephemeral: false,
        }
    }

    #[test]
    fn test_compute_state_valid() {
        let k = make_key("1", true, false, 48);
        assert_eq!(compute_state(&k), SetupKeyState::Valid);
    }

    #[test]
    fn test_compute_state_revoked() {
        let k = make_key("1", false, true, 48);
        assert_eq!(compute_state(&k), SetupKeyState::Revoked);
    }

    #[test]
    fn test_compute_state_expired() {
        let k = make_key("1", true, false, -1);
        assert_eq!(compute_state(&k), SetupKeyState::Expired);
    }

    #[test]
    fn test_expiring_soon() {
        let k1 = make_key("1", true, false, 12); // expires in 12h
        let k2 = make_key("2", true, false, 48); // expires in 48h
        let soon = expiring_soon(&[&k1, &k2], Duration::hours(24));
        assert_eq!(soon.len(), 1);
        assert_eq!(soon[0].id, "1");
    }
}
