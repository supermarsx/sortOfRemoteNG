//! User management — local iDRAC accounts, LDAP, Active Directory.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;

/// iDRAC user and authentication management.
pub struct UserManager<'a> {
    client: &'a IdracClient,
}

impl<'a> UserManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// List iDRAC local user accounts.
    pub async fn list_users(&self) -> IdracResult<Vec<IdracUser>> {
        let rf = self.client.require_redfish()?;

        let col: serde_json::Value = rf
            .get("/redfish/v1/Managers/iDRAC.Embedded.1/Accounts?$expand=*($levels=1)")
            .await?;

        let members = col.get("Members").and_then(|v| v.as_array()).cloned().unwrap_or_default();

        Ok(members
            .iter()
            .map(|u| IdracUser {
                id: u.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                user_name: u.get("UserName").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                role_id: u.get("RoleId").and_then(|v| v.as_str()).map(|s| s.to_string()),
                enabled: u.get("Enabled").and_then(|v| v.as_bool()).unwrap_or(false),
                locked: u.get("Locked").and_then(|v| v.as_bool()).unwrap_or(false),
                description: u.get("Description").and_then(|v| v.as_str()).map(|s| s.to_string()),
                privilege: u.pointer("/Oem/Dell/DellAccount/Privilege").and_then(|v| v.as_u64()).map(|n| n as u32),
                ipmi_lan_privilege: u.pointer("/Oem/Dell/DellAccount/IpmiLanPrivilege").and_then(|v| v.as_str()).map(|s| s.to_string()),
                ipmi_serial_privilege: u.pointer("/Oem/Dell/DellAccount/IpmiSerialPrivilege").and_then(|v| v.as_str()).map(|s| s.to_string()),
                snmp_v3_enabled: u.pointer("/Oem/Dell/DellAccount/SNMPv3Enable").and_then(|v| v.as_bool()),
            })
            .collect())
    }

    /// Create or update a user account.
    pub async fn create_or_update_user(&self, params: IdracUserParams) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let mut body = serde_json::Map::new();
        body.insert("UserName".to_string(), serde_json::json!(params.user_name));

        if let Some(pass) = &params.password {
            body.insert("Password".to_string(), serde_json::json!(pass));
        }
        if let Some(role) = &params.role_id {
            body.insert("RoleId".to_string(), serde_json::json!(role));
        }
        if let Some(enabled) = params.enabled {
            body.insert("Enabled".to_string(), serde_json::json!(enabled));
        }

        let url = format!(
            "/redfish/v1/Managers/iDRAC.Embedded.1/Accounts/{}",
            params.slot_id
        );

        rf.patch_json(&url, &serde_json::Value::Object(body)).await
    }

    /// Delete a user account (clear the slot).
    pub async fn delete_user(&self, slot_id: &str) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        // iDRAC doesn't DELETE accounts — clear by setting empty username
        let body = serde_json::json!({
            "UserName": "",
            "Enabled": false,
        });

        rf.patch_json(
            &format!(
                "/redfish/v1/Managers/iDRAC.Embedded.1/Accounts/{}",
                slot_id
            ),
            &body,
        )
        .await
    }

    /// Unlock a locked user account.
    pub async fn unlock_user(&self, slot_id: &str) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "Locked": false
        });

        rf.patch_json(
            &format!(
                "/redfish/v1/Managers/iDRAC.Embedded.1/Accounts/{}",
                slot_id
            ),
            &body,
        )
        .await
    }

    /// Change a user's password.
    pub async fn change_password(&self, slot_id: &str, new_password: &str) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "Password": new_password
        });

        rf.patch_json(
            &format!(
                "/redfish/v1/Managers/iDRAC.Embedded.1/Accounts/{}",
                slot_id
            ),
            &body,
        )
        .await
    }

    /// Get LDAP configuration.
    pub async fn get_ldap_config(&self) -> IdracResult<LdapConfig> {
        let rf = self.client.require_redfish()?;

        let attrs: serde_json::Value = rf
            .get("/redfish/v1/Managers/iDRAC.Embedded.1/Attributes")
            .await?;

        let get_attr = |key: &str| -> Option<String> {
            attrs.get("Attributes")
                .and_then(|a| a.get(key))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        };

        Ok(LdapConfig {
            enabled: get_attr("LDAP.1#Enable").map(|s| s == "Enabled").unwrap_or(false),
            server: get_attr("LDAP.1#Server"),
            port: get_attr("LDAP.1#Port").and_then(|s| s.parse().ok()),
            base_dn: get_attr("LDAP.1#BaseDN"),
            bind_dn: get_attr("LDAP.1#BindDN"),
            search_filter: get_attr("LDAP.1#SearchFilter"),
            user_attribute: get_attr("LDAP.1#UserAttribute"),
            group_attribute: get_attr("LDAP.1#GroupAttribute"),
            use_ssl: get_attr("LDAP.1#SSLPort").is_some(),
            certificate_validation_enabled: get_attr("LDAP.1#CertValidationEnable").map(|s| s == "Enabled").unwrap_or(false),
        })
    }

    /// Update LDAP configuration.
    pub async fn update_ldap_config(&self, config: &LdapConfig) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let mut attrs = serde_json::Map::new();
        attrs.insert(
            "LDAP.1#Enable".to_string(),
            serde_json::json!(if config.enabled { "Enabled" } else { "Disabled" }),
        );
        if let Some(ref server) = config.server {
            attrs.insert("LDAP.1#Server".to_string(), serde_json::json!(server));
        }
        if let Some(port) = config.port {
            attrs.insert("LDAP.1#Port".to_string(), serde_json::json!(port));
        }
        if let Some(ref base_dn) = config.base_dn {
            attrs.insert("LDAP.1#BaseDN".to_string(), serde_json::json!(base_dn));
        }
        if let Some(ref bind_dn) = config.bind_dn {
            attrs.insert("LDAP.1#BindDN".to_string(), serde_json::json!(bind_dn));
        }

        let body = serde_json::json!({ "Attributes": attrs });
        rf.patch_json("/redfish/v1/Managers/iDRAC.Embedded.1/Attributes", &body).await
    }

    /// Get Active Directory configuration.
    pub async fn get_ad_config(&self) -> IdracResult<ActiveDirectoryConfig> {
        let rf = self.client.require_redfish()?;

        let attrs: serde_json::Value = rf
            .get("/redfish/v1/Managers/iDRAC.Embedded.1/Attributes")
            .await?;

        let get_attr = |key: &str| -> Option<String> {
            attrs.get("Attributes")
                .and_then(|a| a.get(key))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        };

        Ok(ActiveDirectoryConfig {
            enabled: get_attr("ActiveDirectory.1#Enable").map(|s| s == "Enabled").unwrap_or(false),
            domain_name: get_attr("ActiveDirectory.1#DomainName"),
            domain_controller1: get_attr("ActiveDirectory.1#DomainController1"),
            domain_controller2: get_attr("ActiveDirectory.1#DomainController2"),
            domain_controller3: get_attr("ActiveDirectory.1#DomainController3"),
            global_catalog1: get_attr("ActiveDirectory.1#GlobalCatalog1"),
            global_catalog2: get_attr("ActiveDirectory.1#GlobalCatalog2"),
            global_catalog3: get_attr("ActiveDirectory.1#GlobalCatalog3"),
            schema_type: get_attr("ActiveDirectory.1#Schema"),
            certificate_validation_enabled: get_attr("ActiveDirectory.1#CertValidationEnable").map(|s| s == "Enabled").unwrap_or(false),
        })
    }

    /// Update Active Directory configuration.
    pub async fn update_ad_config(&self, config: &ActiveDirectoryConfig) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let mut attrs = serde_json::Map::new();
        attrs.insert(
            "ActiveDirectory.1#Enable".to_string(),
            serde_json::json!(if config.enabled { "Enabled" } else { "Disabled" }),
        );
        if let Some(ref domain) = config.domain_name {
            attrs.insert("ActiveDirectory.1#DomainName".to_string(), serde_json::json!(domain));
        }
        if let Some(ref dc1) = config.domain_controller1 {
            attrs.insert("ActiveDirectory.1#DomainController1".to_string(), serde_json::json!(dc1));
        }
        if let Some(ref dc2) = config.domain_controller2 {
            attrs.insert("ActiveDirectory.1#DomainController2".to_string(), serde_json::json!(dc2));
        }
        if let Some(ref dc3) = config.domain_controller3 {
            attrs.insert("ActiveDirectory.1#DomainController3".to_string(), serde_json::json!(dc3));
        }

        let body = serde_json::json!({ "Attributes": attrs });
        rf.patch_json("/redfish/v1/Managers/iDRAC.Embedded.1/Attributes", &body).await
    }

    /// Test LDAP connection.
    pub async fn test_ldap_connection(&self) -> IdracResult<String> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({});
        let result = rf
            .post_action(
                "/redfish/v1/Dell/Managers/iDRAC.Embedded.1/DellLCService/Actions/DellLCService.TestNetworkShare",
                &body,
            )
            .await?;

        Ok(result.unwrap_or_else(|| "Test initiated".to_string()))
    }
}
