//! Azure App Service – Web apps, function apps, deployment slots.

use log::debug;
use serde_json::json;

use crate::client::AzureClient;
use crate::types::{AzureResult, DeploymentSlot, WebApp};

// ─── Web Apps ───────────────────────────────────────────────────────

pub async fn list_web_apps(client: &AzureClient) -> AzureResult<Vec<WebApp>> {
    let api = &client.config().api_version_web;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.Web/sites?api-version={}",
        api
    ))?;
    debug!("list_web_apps → {}", url);
    client.get_all_pages(&url).await
}

pub async fn list_web_apps_in_rg(
    client: &AzureClient,
    rg: &str,
) -> AzureResult<Vec<WebApp>> {
    let api = &client.config().api_version_web;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Web/sites?api-version={}",
        api
    ))?;
    debug!("list_web_apps_in_rg({}) → {}", rg, url);
    client.get_all_pages(&url).await
}

pub async fn get_web_app(
    client: &AzureClient,
    rg: &str,
    name: &str,
) -> AzureResult<WebApp> {
    let api = &client.config().api_version_web;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Web/sites/{}?api-version={}",
        name, api
    ))?;
    debug!("get_web_app({}/{}) → {}", rg, name, url);
    client.get_json(&url).await
}

pub async fn start_web_app(
    client: &AzureClient,
    rg: &str,
    name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_web;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Web/sites/{}/start?api-version={}",
        name, api
    ))?;
    debug!("start_web_app({}/{}) → {}", rg, name, url);
    client.post_action(&url, &json!({})).await
}

pub async fn stop_web_app(
    client: &AzureClient,
    rg: &str,
    name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_web;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Web/sites/{}/stop?api-version={}",
        name, api
    ))?;
    debug!("stop_web_app({}/{}) → {}", rg, name, url);
    client.post_action(&url, &json!({})).await
}

pub async fn restart_web_app(
    client: &AzureClient,
    rg: &str,
    name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_web;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Web/sites/{}/restart?api-version={}",
        name, api
    ))?;
    debug!("restart_web_app({}/{}) → {}", rg, name, url);
    client.post_action(&url, &json!({})).await
}

pub async fn delete_web_app(
    client: &AzureClient,
    rg: &str,
    name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_web;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Web/sites/{}?api-version={}",
        name, api
    ))?;
    debug!("delete_web_app({}/{}) → {}", rg, name, url);
    client.delete(&url).await
}

// ─── Deployment Slots ───────────────────────────────────────────────

pub async fn list_slots(
    client: &AzureClient,
    rg: &str,
    app_name: &str,
) -> AzureResult<Vec<DeploymentSlot>> {
    let api = &client.config().api_version_web;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Web/sites/{}/slots?api-version={}",
        app_name, api
    ))?;
    debug!("list_slots({}/{}) → {}", rg, app_name, url);
    client.get_all_pages(&url).await
}

pub async fn get_slot(
    client: &AzureClient,
    rg: &str,
    app_name: &str,
    slot_name: &str,
) -> AzureResult<DeploymentSlot> {
    let api = &client.config().api_version_web;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Web/sites/{}/slots/{}?api-version={}",
        app_name, slot_name, api
    ))?;
    debug!("get_slot({}/{}/{}) → {}", rg, app_name, slot_name, url);
    client.get_json(&url).await
}

pub async fn swap_slot(
    client: &AzureClient,
    rg: &str,
    app_name: &str,
    target_slot: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_web;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Web/sites/{}/slotsswap?api-version={}",
        app_name, api
    ))?;
    let body = json!({
        "targetSlot": target_slot,
        "preserveVnet": true
    });
    debug!("swap_slot({}/{} → {}) → {}", rg, app_name, target_slot, url);
    client.post_action(&url, &body).await
}

pub async fn start_slot(
    client: &AzureClient,
    rg: &str,
    app_name: &str,
    slot_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_web;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Web/sites/{}/slots/{}/start?api-version={}",
        app_name, slot_name, api
    ))?;
    debug!("start_slot({}/{}/{}) → {}", rg, app_name, slot_name, url);
    client.post_action(&url, &json!({})).await
}

pub async fn stop_slot(
    client: &AzureClient,
    rg: &str,
    app_name: &str,
    slot_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_web;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Web/sites/{}/slots/{}/stop?api-version={}",
        app_name, slot_name, api
    ))?;
    debug!("stop_slot({}/{}/{}) → {}", rg, app_name, slot_name, url);
    client.post_action(&url, &json!({})).await
}

pub async fn restart_slot(
    client: &AzureClient,
    rg: &str,
    app_name: &str,
    slot_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_web;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Web/sites/{}/slots/{}/restart?api-version={}",
        app_name, slot_name, api
    ))?;
    debug!("restart_slot({}/{}/{}) → {}", rg, app_name, slot_name, url);
    client.post_action(&url, &json!({})).await
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AzureCredentials;

    #[test]
    fn web_app_url_pattern() {
        let mut c = AzureClient::new();
        c.set_credentials(AzureCredentials { subscription_id: "s1".into(), ..Default::default() });
        let url = c.resource_group_url("rg1", "/providers/Microsoft.Web/sites?api-version=2023-12-01").unwrap();
        assert!(url.contains("/sites?"));
    }

    #[test]
    fn web_app_deserialize() {
        let json = r#"{"id":"x","name":"app1","location":"eastus","kind":"app","properties":{"state":"Running","defaultHostName":"app1.azurewebsites.net","httpsOnly":true}}"#;
        let w: WebApp = serde_json::from_str(json).unwrap();
        assert_eq!(w.name, "app1");
        assert_eq!(w.kind, Some("app".into()));
        let p = w.properties.unwrap();
        assert_eq!(p.state, Some("Running".into()));
        assert_eq!(p.default_host_name, Some("app1.azurewebsites.net".into()));
    }

    #[test]
    fn deployment_slot_deserialize() {
        let json = r#"{"id":"x","name":"app1/staging","location":"eastus","kind":"app","properties":{"state":"Running","defaultHostName":"app1-staging.azurewebsites.net"}}"#;
        let s: DeploymentSlot = serde_json::from_str(json).unwrap();
        assert_eq!(s.name, "app1/staging");
    }

    #[test]
    fn swap_slot_body() {
        let body = serde_json::json!({
            "targetSlot": "production",
            "preserveVnet": true
        });
        assert_eq!(body["targetSlot"], "production");
    }
}
