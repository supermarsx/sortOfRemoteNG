// ── sorng-hashicorp-vault/src/pki.rs ─────────────────────────────────────────
//! PKI secrets engine operations.

use crate::client::VaultClient;
use crate::error::VaultResult;
use crate::types::*;
use serde_json::Value;

pub struct PkiManager;

impl PkiManager {
    pub async fn read_ca_cert(client: &VaultClient, mount: &str) -> VaultResult<VaultCaInfo> {
        client.pki_read_ca_cert(mount).await
    }

    pub async fn list_certs(client: &VaultClient, mount: &str) -> VaultResult<Vec<String>> {
        client.pki_list_certs(mount).await
    }

    pub async fn read_cert(
        client: &VaultClient,
        mount: &str,
        serial: &str,
    ) -> VaultResult<VaultCertificate> {
        client.pki_read_cert(mount, serial).await
    }

    pub async fn issue_cert(
        client: &VaultClient,
        mount: &str,
        role: &str,
        params: &VaultPkiIssueCert,
    ) -> VaultResult<VaultCertificate> {
        client.pki_issue_cert(mount, role, params).await
    }

    pub async fn sign_cert(
        client: &VaultClient,
        mount: &str,
        role: &str,
        csr: &str,
    ) -> VaultResult<VaultCertificate> {
        client.pki_sign_cert(mount, role, csr).await
    }

    pub async fn revoke_cert(
        client: &VaultClient,
        mount: &str,
        serial: &str,
    ) -> VaultResult<Value> {
        client.pki_revoke_cert(mount, serial).await
    }

    pub async fn tidy(client: &VaultClient, mount: &str) -> VaultResult<Value> {
        client.pki_tidy(mount).await
    }

    pub async fn list_roles(client: &VaultClient, mount: &str) -> VaultResult<Vec<String>> {
        client.pki_list_roles(mount).await
    }

    pub async fn read_role(
        client: &VaultClient,
        mount: &str,
        name: &str,
    ) -> VaultResult<VaultPkiRole> {
        client.pki_read_role(mount, name).await
    }

    pub async fn create_role(
        client: &VaultClient,
        mount: &str,
        name: &str,
        config: &Value,
    ) -> VaultResult<Value> {
        client.pki_create_role(mount, name, config).await
    }

    pub async fn delete_role(client: &VaultClient, mount: &str, name: &str) -> VaultResult<()> {
        client.pki_delete_role(mount, name).await
    }

    pub async fn generate_root(
        client: &VaultClient,
        mount: &str,
        params: &Value,
    ) -> VaultResult<VaultCertificate> {
        client.pki_generate_root(mount, params).await
    }

    pub async fn set_urls(client: &VaultClient, mount: &str, urls: &Value) -> VaultResult<Value> {
        client.pki_set_urls(mount, urls).await
    }
}
