//! Azure Key Vault – Management-plane (vaults) + data-plane (secrets, keys, certs).

use log::debug;
use serde_json::json;

use crate::client::AzureClient;
use crate::types::{
    AzureResult, CertificateItem, KeyItem, KeyVault, SecretBundle, SecretItem,
};

// ─── Vaults (management plane) ──────────────────────────────────────

pub async fn list_vaults(client: &AzureClient) -> AzureResult<Vec<KeyVault>> {
    let api = &client.config().api_version_keyvault_mgmt;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.KeyVault/vaults?api-version={}",
        api
    ))?;
    debug!("list_vaults → {}", url);
    client.get_all_pages(&url).await
}

pub async fn list_vaults_in_rg(
    client: &AzureClient,
    rg: &str,
) -> AzureResult<Vec<KeyVault>> {
    let api = &client.config().api_version_keyvault_mgmt;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.KeyVault/vaults?api-version={}",
        api
    ))?;
    debug!("list_vaults_in_rg({}) → {}", rg, url);
    client.get_all_pages(&url).await
}

pub async fn get_vault(
    client: &AzureClient,
    rg: &str,
    vault_name: &str,
) -> AzureResult<KeyVault> {
    let api = &client.config().api_version_keyvault_mgmt;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.KeyVault/vaults/{}?api-version={}",
        vault_name, api
    ))?;
    debug!("get_vault({}/{}) → {}", rg, vault_name, url);
    client.get_json(&url).await
}

pub async fn delete_vault(
    client: &AzureClient,
    rg: &str,
    vault_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_keyvault_mgmt;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.KeyVault/vaults/{}?api-version={}",
        vault_name, api
    ))?;
    debug!("delete_vault({}/{}) → {}", rg, vault_name, url);
    client.delete(&url).await
}

// ─── Secrets (data plane) ───────────────────────────────────────────
// Data-plane calls go to https://{vault-name}.vault.azure.net/…

fn vault_data_url(vault_name: &str, path: &str, api_version: &str) -> String {
    format!(
        "https://{}.vault.azure.net/{}?api-version={}",
        vault_name,
        path.trim_start_matches('/'),
        api_version
    )
}

pub async fn list_secrets(
    client: &AzureClient,
    vault_name: &str,
) -> AzureResult<Vec<SecretItem>> {
    let api = &client.config().api_version_keyvault_data;
    let url = vault_data_url(vault_name, "/secrets", api);
    debug!("list_secrets({}) → {}", vault_name, url);
    client.get_all_pages(&url).await
}

pub async fn get_secret(
    client: &AzureClient,
    vault_name: &str,
    secret_name: &str,
) -> AzureResult<SecretBundle> {
    let api = &client.config().api_version_keyvault_data;
    let url = vault_data_url(vault_name, &format!("/secrets/{}", secret_name), api);
    debug!("get_secret({}/{}) → {}", vault_name, secret_name, url);
    client.get_json(&url).await
}

pub async fn get_secret_version(
    client: &AzureClient,
    vault_name: &str,
    secret_name: &str,
    version: &str,
) -> AzureResult<SecretBundle> {
    let api = &client.config().api_version_keyvault_data;
    let url = vault_data_url(
        vault_name,
        &format!("/secrets/{}/{}", secret_name, version),
        api,
    );
    debug!("get_secret_version({}/{}/{}) → {}", vault_name, secret_name, version, url);
    client.get_json(&url).await
}

pub async fn set_secret(
    client: &AzureClient,
    vault_name: &str,
    secret_name: &str,
    value: &str,
    content_type: Option<&str>,
) -> AzureResult<SecretBundle> {
    let api = &client.config().api_version_keyvault_data;
    let url = vault_data_url(vault_name, &format!("/secrets/{}", secret_name), api);
    let mut body = json!({ "value": value });
    if let Some(ct) = content_type {
        body["contentType"] = json!(ct);
    }
    debug!("set_secret({}/{}) → {}", vault_name, secret_name, url);
    client.put_json(&url, &body).await
}

pub async fn delete_secret(
    client: &AzureClient,
    vault_name: &str,
    secret_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_keyvault_data;
    let url = vault_data_url(vault_name, &format!("/secrets/{}", secret_name), api);
    debug!("delete_secret({}/{}) → {}", vault_name, secret_name, url);
    client.delete(&url).await
}

pub async fn list_secret_versions(
    client: &AzureClient,
    vault_name: &str,
    secret_name: &str,
) -> AzureResult<Vec<SecretItem>> {
    let api = &client.config().api_version_keyvault_data;
    let url = vault_data_url(
        vault_name,
        &format!("/secrets/{}/versions", secret_name),
        api,
    );
    debug!("list_secret_versions({}/{}) → {}", vault_name, secret_name, url);
    client.get_all_pages(&url).await
}

// ─── Keys (data plane) ─────────────────────────────────────────────

pub async fn list_keys(
    client: &AzureClient,
    vault_name: &str,
) -> AzureResult<Vec<KeyItem>> {
    let api = &client.config().api_version_keyvault_data;
    let url = vault_data_url(vault_name, "/keys", api);
    debug!("list_keys({}) → {}", vault_name, url);
    client.get_all_pages(&url).await
}

// ─── Certificates (data plane) ──────────────────────────────────────

pub async fn list_certificates(
    client: &AzureClient,
    vault_name: &str,
) -> AzureResult<Vec<CertificateItem>> {
    let api = &client.config().api_version_keyvault_data;
    let url = vault_data_url(vault_name, "/certificates", api);
    debug!("list_certificates({}) → {}", vault_name, url);
    client.get_all_pages(&url).await
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_data_url_construction() {
        let url = vault_data_url("myvault", "/secrets", "7.4");
        assert_eq!(url, "https://myvault.vault.azure.net/secrets?api-version=7.4");
    }

    #[test]
    fn vault_data_url_secret_version() {
        let url = vault_data_url("myvault", "/secrets/mykey/abc123", "7.4");
        assert!(url.contains("secrets/mykey/abc123"));
    }

    #[test]
    fn key_vault_deserialize() {
        let json = r#"{"id":"x","name":"kv1","location":"eastus","properties":{"vaultUri":"https://kv1.vault.azure.net/","tenantId":"t1","sku":{"name":"standard","family":"A"},"enableSoftDelete":true}}"#;
        let kv: KeyVault = serde_json::from_str(json).unwrap();
        assert_eq!(kv.name, "kv1");
        let p = kv.properties.unwrap();
        assert_eq!(p.vault_uri, Some("https://kv1.vault.azure.net/".into()));
    }

    #[test]
    fn secret_item_deserialize() {
        let json = r#"{"id":"https://kv1.vault.azure.net/secrets/s1","attributes":{"enabled":true,"created":1700000000,"updated":1700100000}}"#;
        let s: SecretItem = serde_json::from_str(json).unwrap();
        assert_eq!(s.id, "https://kv1.vault.azure.net/secrets/s1");
        assert!(s.attributes.unwrap().enabled.unwrap());
    }

    #[test]
    fn secret_bundle_deserialize() {
        let json = r#"{"id":"https://kv1.vault.azure.net/secrets/s1/ver1","value":"supersecret","contentType":"text/plain","attributes":{"enabled":true}}"#;
        let b: SecretBundle = serde_json::from_str(json).unwrap();
        assert_eq!(b.value, "supersecret");
        assert_eq!(b.content_type, Some("text/plain".into()));
    }

    #[test]
    fn key_item_deserialize() {
        let json = r#"{"kid":"https://kv1.vault.azure.net/keys/k1","attributes":{"enabled":true}}"#;
        let k: KeyItem = serde_json::from_str(json).unwrap();
        assert_eq!(k.kid, "https://kv1.vault.azure.net/keys/k1");
    }

    #[test]
    fn cert_item_deserialize() {
        let json = r#"{"id":"https://kv1.vault.azure.net/certificates/c1","attributes":{"enabled":true}}"#;
        let c: CertificateItem = serde_json::from_str(json).unwrap();
        assert_eq!(c.id, "https://kv1.vault.azure.net/certificates/c1");
    }
}
