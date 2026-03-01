//! Account and user info operations.

/// Build get_current_account request (no arguments needed).
pub fn build_get_current_account() -> serde_json::Value {
    serde_json::json!(null)
}

/// Build get_account request body (for another user's basic account info).
pub fn build_get_account(account_id: &str) -> serde_json::Value {
    serde_json::json!({ "account_id": account_id })
}

/// Build get_account_batch request body.
pub fn build_get_account_batch(account_ids: &[&str]) -> serde_json::Value {
    serde_json::json!({ "account_ids": account_ids })
}

/// Build get_space_usage request (no arguments needed).
pub fn build_get_space_usage() -> serde_json::Value {
    serde_json::json!(null)
}

/// Build set_profile_photo request body (base64 image).
pub fn build_set_profile_photo(photo_base64: &str) -> serde_json::Value {
    serde_json::json!({
        "photo": {
            ".tag": "base64_data",
            "base64_data": photo_base64,
        }
    })
}

/// Format space usage for display.
pub fn format_space_usage(used: u64, allocated: u64) -> String {
    let used_gb = used as f64 / 1_073_741_824.0;
    let alloc_gb = allocated as f64 / 1_073_741_824.0;
    let pct = if allocated > 0 {
        (used as f64 / allocated as f64) * 100.0
    } else {
        0.0
    };
    format!("{used_gb:.2} GB / {alloc_gb:.2} GB ({pct:.1}%)")
}

/// Check if space usage exceeds a percentage threshold.
pub fn is_space_critical(used: u64, allocated: u64, threshold_pct: f64) -> bool {
    if allocated == 0 {
        return false;
    }
    let pct = (used as f64 / allocated as f64) * 100.0;
    pct >= threshold_pct
}

/// Build features/get_values request body.
pub fn build_get_features(features: &[&str]) -> serde_json::Value {
    let tags: Vec<serde_json::Value> = features
        .iter()
        .map(|f| serde_json::json!({".tag": *f}))
        .collect();
    serde_json::json!({ "features": tags })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_current_account_body() {
        let v = build_get_current_account();
        assert!(v.is_null());
    }

    #[test]
    fn get_account_body() {
        let v = build_get_account("dbid:AAH_user123");
        assert_eq!(v["account_id"], "dbid:AAH_user123");
    }

    #[test]
    fn get_account_batch_body() {
        let v = build_get_account_batch(&["dbid:A", "dbid:B"]);
        assert_eq!(v["account_ids"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn get_space_usage_body() {
        let v = build_get_space_usage();
        assert!(v.is_null());
    }

    #[test]
    fn set_profile_photo_body() {
        let v = build_set_profile_photo("base64data==");
        assert_eq!(v["photo"][".tag"], "base64_data");
    }

    #[test]
    fn format_space_usage_display() {
        // 5 GB used of 10 GB
        let s = format_space_usage(5_368_709_120, 10_737_418_240);
        assert!(s.contains("5.00 GB"));
        assert!(s.contains("10.00 GB"));
        assert!(s.contains("50.0%"));
    }

    #[test]
    fn format_space_usage_zero() {
        let s = format_space_usage(0, 0);
        assert!(s.contains("0.0%"));
    }

    #[test]
    fn is_space_critical_below() {
        assert!(!is_space_critical(1_000_000, 10_000_000, 90.0));
    }

    #[test]
    fn is_space_critical_above() {
        assert!(is_space_critical(9_500_000, 10_000_000, 90.0));
    }

    #[test]
    fn is_space_critical_zero_allocated() {
        assert!(!is_space_critical(100, 0, 50.0));
    }

    #[test]
    fn get_features_body() {
        let v = build_get_features(&["paper_as_files", "file_locking"]);
        assert_eq!(v["features"].as_array().unwrap().len(), 2);
    }
}
