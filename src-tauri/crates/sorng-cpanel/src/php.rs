// ── cPanel PHP & software management ─────────────────────────────────────────

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

pub struct PhpManager;

impl PhpManager {
    /// List available PHP versions (WHM php_get_installed_versions).
    pub async fn list_php_versions(client: &CpanelClient) -> CpanelResult<Vec<PhpVersion>> {
        let raw: serde_json::Value = client
            .whm_api_raw("php_get_installed_versions", &[])
            .await?;
        let data = raw
            .get("data")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Get the PHP version for a domain.
    pub async fn get_domain_php_version(client: &CpanelClient, user: &str, domain: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "LangPHP", "php_get_domain_handler", &[("domain", domain)])
            .await?;
        let data = extract_data(&raw)?;
        Ok(data
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("default")
            .to_string())
    }

    /// Set the PHP version for a domain.
    pub async fn set_domain_php_version(client: &CpanelClient, user: &str, domain: &str, version: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "LangPHP",
                "php_set_domain_handler",
                &[("domain", domain), ("version", version)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("PHP version set to {version} for {domain}"))
    }

    /// Get PHP configuration directives for a user.
    pub async fn get_php_config(client: &CpanelClient, user: &str, version: &str) -> CpanelResult<PhpConfig> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "LangPHP",
                "php_ini_get_user_content",
                &[("version", version)],
            )
            .await?;
        let data = extract_data(&raw)?;
        let directives: Vec<PhpDirective> =
            serde_json::from_value(data.get("directives").cloned().unwrap_or_default())
                .unwrap_or_default();
        Ok(PhpConfig {
            version: version.to_string(),
            directives,
        })
    }

    /// Set PHP directives (php.ini values).
    pub async fn set_php_directive(
        client: &CpanelClient,
        user: &str,
        version: &str,
        key: &str,
        value: &str,
    ) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "LangPHP",
                "php_ini_set_user_content",
                &[("version", version), ("directive-key", key), ("directive-value", value)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("PHP directive {key} = {value} set"))
    }

    /// List installed PHP extensions.
    pub async fn list_extensions(client: &CpanelClient, user: &str, version: &str) -> CpanelResult<Vec<PhpExtension>> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "LangPHP",
                "php_get_installed_extensions",
                &[("version", version)],
            )
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    // ── Perl modules ─────────────────────────────────────────────────

    /// List installed Perl modules.
    pub async fn list_perl_modules(client: &CpanelClient, user: &str) -> CpanelResult<Vec<PerlModule>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "LangPerl", "list_modules", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    // ── Node.js / Python / Ruby apps ─────────────────────────────────

    /// List Node.js applications.
    pub async fn list_nodejs_apps(client: &CpanelClient, user: &str) -> CpanelResult<serde_json::Value> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "PassengerApps", "list_applications", &[("type", "nodejs")])
            .await?;
        extract_data(&raw)
    }

    /// List Python applications.
    pub async fn list_python_apps(client: &CpanelClient, user: &str) -> CpanelResult<serde_json::Value> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "PassengerApps", "list_applications", &[("type", "python")])
            .await?;
        extract_data(&raw)
    }

    /// List installed software (Softaculous / Installatron).
    pub async fn list_installed_software(client: &CpanelClient, user: &str) -> CpanelResult<Vec<InstalledSoftware>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Integration", "fetch_url", &[("url", "/frontend/jupiter/softaculous/index.live.php?act=installations")])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    // ── WHM-level PHP/EasyApache management  ─────────────────────────

    /// Get EasyApache profile (WHM).
    pub async fn get_easyapache_profile(client: &CpanelClient) -> CpanelResult<serde_json::Value> {
        client.whm_api_raw("get_easyapache_profile", &[]).await
    }

    /// Get system PHP handler info (WHM).
    pub async fn get_php_handler_info(client: &CpanelClient) -> CpanelResult<serde_json::Value> {
        client.whm_api_raw("php_get_handlers", &[]).await
    }

    /// Get system default PHP version (WHM).
    pub async fn get_default_php_version(client: &CpanelClient) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_api_raw("php_get_system_default_version", &[])
            .await?;
        Ok(raw
            .get("data")
            .and_then(|d| d.get("version"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string())
    }
}

fn extract_data(raw: &serde_json::Value) -> CpanelResult<serde_json::Value> {
    check_uapi(raw)?;
    Ok(raw
        .get("result")
        .and_then(|r| r.get("data"))
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![])))
}

fn check_uapi(raw: &serde_json::Value) -> CpanelResult<()> {
    let status = raw
        .get("result")
        .and_then(|r| r.get("status"))
        .and_then(|s| s.as_u64())
        .unwrap_or(1);
    if status == 0 {
        let errors = raw
            .get("result")
            .and_then(|r| r.get("errors"))
            .and_then(|e| e.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join("; "))
            .unwrap_or_else(|| "UAPI call failed".into());
        return Err(CpanelError::api(errors));
    }
    Ok(())
}
