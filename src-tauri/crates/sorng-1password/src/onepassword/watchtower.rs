use super::api_client::OnePasswordApiClient;
use super::types::*;

/// Watchtower / breach monitoring analysis for 1Password items.
///
/// Watchtower is a 1Password feature that monitors passwords for known
/// data breaches, weak passwords, reused passwords, unsecured websites,
/// and two-factor authentication availability.
///
/// This module provides client-side analysis of items since the Connect
/// API doesn't expose Watchtower endpoints directly — analysis is done
/// by fetching items and inspecting their fields/metadata.
pub struct OnePasswordWatchtower;

impl OnePasswordWatchtower {
    /// Analyze all items across all vaults for security issues.
    pub async fn analyze_all(
        client: &OnePasswordApiClient,
    ) -> Result<WatchtowerSummary, OnePasswordError> {
        let vaults = client.list_vaults(None).await?;
        let mut all_items = Vec::new();

        for vault in &vaults {
            let items = client.list_items(&vault.id, None).await?;
            for item in items {
                if let Ok(full) = client.get_item(&vault.id, item.id.as_deref().unwrap_or("")).await
                {
                    all_items.push((vault.id.clone(), full));
                }
            }
        }

        Self::analyze_items(&all_items)
    }

    /// Analyze items in a specific vault.
    pub async fn analyze_vault(
        client: &OnePasswordApiClient,
        vault_id: &str,
    ) -> Result<WatchtowerSummary, OnePasswordError> {
        let items = client.list_items(vault_id, None).await?;
        let mut full_items = Vec::new();

        for item in items {
            if let Ok(full) = client
                .get_item(vault_id, item.id.as_deref().unwrap_or(""))
                .await
            {
                full_items.push((vault_id.to_string(), full));
            }
        }

        Self::analyze_items(&full_items)
    }

    /// Perform the security analysis on a set of items.
    fn analyze_items(
        items: &[(String, FullItem)],
    ) -> Result<WatchtowerSummary, OnePasswordError> {
        let mut alerts = Vec::new();
        let mut weak_passwords = 0u64;
        let mut reused_passwords = 0u64;
        let mut unsecured_sites = 0u64;
        let mut two_factor_available = 0u64;
        let mut inactive_two_factor = 0u64;

        let mut seen_passwords: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();

        for (vault_id, item) in items {
            let item_id = item.id.clone().unwrap_or_default();
            let title = item.title.clone().unwrap_or_default();
            let fields = item.fields.as_ref().cloned().unwrap_or_default();
            let now = chrono::Utc::now().to_rfc3339();

            // Check password strength
            if let Some(pwd_field) = fields
                .iter()
                .find(|f| f.purpose == Some(FieldPurpose::PASSWORD))
            {
                if let Some(value) = &pwd_field.value {
                    let strength = super::password_gen::OnePasswordPasswordGen::rate_strength(value);
                    if strength == "Very Weak" || strength == "Weak" {
                        weak_passwords += 1;
                        alerts.push(WatchtowerAlert {
                            item_id: item_id.clone(),
                            vault_id: vault_id.clone(),
                            title: title.clone(),
                            alert_type: WatchtowerAlertType::WeakPassword,
                            severity: WatchtowerSeverity::High,
                            description: format!(
                                "Password strength rated as '{}' — consider using a stronger password",
                                strength
                            ),
                            detected_at: now.clone(),
                        });
                    }

                    // Track for reuse detection
                    seen_passwords
                        .entry(value.clone())
                        .or_default()
                        .push(item_id.clone());
                }
            }

            // Check for unsecured URLs (HTTP instead of HTTPS)
            if let Some(urls) = &item.urls {
                for url in urls {
                    if url.href.starts_with("http://") {
                        unsecured_sites += 1;
                        alerts.push(WatchtowerAlert {
                            item_id: item_id.clone(),
                            vault_id: vault_id.clone(),
                            title: title.clone(),
                            alert_type: WatchtowerAlertType::UnsecuredWebsite,
                            severity: WatchtowerSeverity::Medium,
                            description: format!(
                                "URL '{}' uses HTTP instead of HTTPS",
                                url.href
                            ),
                            detected_at: now.clone(),
                        });
                        break; // One alert per item
                    }
                }
            }

            // Check for TOTP field availability (2FA detection)
            let has_totp = fields.iter().any(|f| f.field_type == FieldType::TOTP);
            if item.category == ItemCategory::LOGIN {
                if !has_totp {
                    // Login item without TOTP — 2FA might be available
                    two_factor_available += 1;
                }
            }
            if has_totp && fields.iter().any(|f| f.field_type == FieldType::TOTP && f.value.is_none()) {
                inactive_two_factor += 1;
                alerts.push(WatchtowerAlert {
                    item_id: item_id.clone(),
                    vault_id: vault_id.clone(),
                    title: title.clone(),
                    alert_type: WatchtowerAlertType::InactiveTwoFactor,
                    severity: WatchtowerSeverity::Medium,
                    description: "TOTP field exists but has no value configured".to_string(),
                    detected_at: now.clone(),
                });
            }
        }

        // Detect reused passwords
        for (_, item_ids) in &seen_passwords {
            if item_ids.len() > 1 {
                reused_passwords += item_ids.len() as u64;
                for id in item_ids {
                    alerts.push(WatchtowerAlert {
                        item_id: id.clone(),
                        vault_id: String::new(),
                        title: String::new(),
                        alert_type: WatchtowerAlertType::ReusedPassword,
                        severity: WatchtowerSeverity::High,
                        description: format!(
                            "Password is shared with {} other item(s)",
                            item_ids.len() - 1
                        ),
                        detected_at: chrono::Utc::now().to_rfc3339(),
                    });
                }
            }
        }

        Ok(WatchtowerSummary {
            total_items: items.len() as u64,
            weak_passwords,
            reused_passwords,
            compromised_passwords: 0, // Would require HIBP integration
            vulnerable_sites: 0,
            unsecured_sites,
            two_factor_available,
            inactive_two_factor,
            alerts,
        })
    }
}
