// ── sorng-warpgate/src/credentials.rs ───────────────────────────────────────
//! Warpgate per-user credential management (password, public key, SSO, OTP, certificate).

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct CredentialManager;

impl CredentialManager {
    // ── Password credentials ─────────────────────────────────────────

    /// GET /users/:user_id/credentials/passwords
    pub async fn list_passwords(client: &WarpgateClient, user_id: &str) -> WarpgateResult<Vec<PasswordCredential>> {
        let resp = client.get(&format!("/users/{}/credentials/passwords", user_id)).await?;
        let creds: Vec<PasswordCredential> = serde_json::from_value(resp)?;
        Ok(creds)
    }

    /// POST /users/:user_id/credentials/passwords
    pub async fn create_password(client: &WarpgateClient, user_id: &str, req: &NewPasswordCredential) -> WarpgateResult<PasswordCredential> {
        let body = serde_json::to_value(req)?;
        let resp = client.post(&format!("/users/{}/credentials/passwords", user_id), &body).await?;
        let cred: PasswordCredential = serde_json::from_value(resp)?;
        Ok(cred)
    }

    /// DELETE /users/:user_id/credentials/passwords/:id
    pub async fn delete_password(client: &WarpgateClient, user_id: &str, cred_id: &str) -> WarpgateResult<()> {
        client.delete(&format!("/users/{}/credentials/passwords/{}", user_id, cred_id)).await?;
        Ok(())
    }

    // ── Public key credentials ───────────────────────────────────────

    /// GET /users/:user_id/credentials/public-keys
    pub async fn list_public_keys(client: &WarpgateClient, user_id: &str) -> WarpgateResult<Vec<PublicKeyCredential>> {
        let resp = client.get(&format!("/users/{}/credentials/public-keys", user_id)).await?;
        let creds: Vec<PublicKeyCredential> = serde_json::from_value(resp)?;
        Ok(creds)
    }

    /// POST /users/:user_id/credentials/public-keys
    pub async fn create_public_key(client: &WarpgateClient, user_id: &str, req: &NewPublicKeyCredential) -> WarpgateResult<PublicKeyCredential> {
        let body = serde_json::to_value(req)?;
        let resp = client.post(&format!("/users/{}/credentials/public-keys", user_id), &body).await?;
        let cred: PublicKeyCredential = serde_json::from_value(resp)?;
        Ok(cred)
    }

    /// PUT /users/:user_id/credentials/public-keys/:id
    pub async fn update_public_key(client: &WarpgateClient, user_id: &str, cred_id: &str, req: &NewPublicKeyCredential) -> WarpgateResult<PublicKeyCredential> {
        let body = serde_json::to_value(req)?;
        let resp = client.put(&format!("/users/{}/credentials/public-keys/{}", user_id, cred_id), &body).await?;
        let cred: PublicKeyCredential = serde_json::from_value(resp)?;
        Ok(cred)
    }

    /// DELETE /users/:user_id/credentials/public-keys/:id
    pub async fn delete_public_key(client: &WarpgateClient, user_id: &str, cred_id: &str) -> WarpgateResult<()> {
        client.delete(&format!("/users/{}/credentials/public-keys/{}", user_id, cred_id)).await?;
        Ok(())
    }

    // ── SSO credentials ──────────────────────────────────────────────

    /// GET /users/:user_id/credentials/sso
    pub async fn list_sso(client: &WarpgateClient, user_id: &str) -> WarpgateResult<Vec<SsoCredential>> {
        let resp = client.get(&format!("/users/{}/credentials/sso", user_id)).await?;
        let creds: Vec<SsoCredential> = serde_json::from_value(resp)?;
        Ok(creds)
    }

    /// POST /users/:user_id/credentials/sso
    pub async fn create_sso(client: &WarpgateClient, user_id: &str, req: &NewSsoCredential) -> WarpgateResult<SsoCredential> {
        let body = serde_json::to_value(req)?;
        let resp = client.post(&format!("/users/{}/credentials/sso", user_id), &body).await?;
        let cred: SsoCredential = serde_json::from_value(resp)?;
        Ok(cred)
    }

    /// PUT /users/:user_id/credentials/sso/:id
    pub async fn update_sso(client: &WarpgateClient, user_id: &str, cred_id: &str, req: &NewSsoCredential) -> WarpgateResult<SsoCredential> {
        let body = serde_json::to_value(req)?;
        let resp = client.put(&format!("/users/{}/credentials/sso/{}", user_id, cred_id), &body).await?;
        let cred: SsoCredential = serde_json::from_value(resp)?;
        Ok(cred)
    }

    /// DELETE /users/:user_id/credentials/sso/:id
    pub async fn delete_sso(client: &WarpgateClient, user_id: &str, cred_id: &str) -> WarpgateResult<()> {
        client.delete(&format!("/users/{}/credentials/sso/{}", user_id, cred_id)).await?;
        Ok(())
    }

    // ── OTP credentials ──────────────────────────────────────────────

    /// GET /users/:user_id/credentials/otp
    pub async fn list_otp(client: &WarpgateClient, user_id: &str) -> WarpgateResult<Vec<OtpCredential>> {
        let resp = client.get(&format!("/users/{}/credentials/otp", user_id)).await?;
        let creds: Vec<OtpCredential> = serde_json::from_value(resp)?;
        Ok(creds)
    }

    /// POST /users/:user_id/credentials/otp
    pub async fn create_otp(client: &WarpgateClient, user_id: &str, req: &NewOtpCredential) -> WarpgateResult<OtpCredential> {
        let body = serde_json::to_value(req)?;
        let resp = client.post(&format!("/users/{}/credentials/otp", user_id), &body).await?;
        let cred: OtpCredential = serde_json::from_value(resp)?;
        Ok(cred)
    }

    /// DELETE /users/:user_id/credentials/otp/:id
    pub async fn delete_otp(client: &WarpgateClient, user_id: &str, cred_id: &str) -> WarpgateResult<()> {
        client.delete(&format!("/users/{}/credentials/otp/{}", user_id, cred_id)).await?;
        Ok(())
    }

    // ── Certificate credentials ──────────────────────────────────────

    /// GET /users/:user_id/credentials/certificates
    pub async fn list_certificates(client: &WarpgateClient, user_id: &str) -> WarpgateResult<Vec<CertificateCredential>> {
        let resp = client.get(&format!("/users/{}/credentials/certificates", user_id)).await?;
        let creds: Vec<CertificateCredential> = serde_json::from_value(resp)?;
        Ok(creds)
    }

    /// POST /users/:user_id/credentials/certificates
    pub async fn issue_certificate(client: &WarpgateClient, user_id: &str, req: &IssueCertificateRequest) -> WarpgateResult<IssuedCertificate> {
        let body = serde_json::to_value(req)?;
        let resp = client.post(&format!("/users/{}/credentials/certificates", user_id), &body).await?;
        let issued: IssuedCertificate = serde_json::from_value(resp)?;
        Ok(issued)
    }

    /// PATCH /users/:user_id/credentials/certificates/:id
    pub async fn update_certificate(client: &WarpgateClient, user_id: &str, cred_id: &str, req: &UpdateCertificateLabel) -> WarpgateResult<CertificateCredential> {
        let body = serde_json::to_value(req)?;
        let resp = client.patch(&format!("/users/{}/credentials/certificates/{}", user_id, cred_id), &body).await?;
        let cred: CertificateCredential = serde_json::from_value(resp)?;
        Ok(cred)
    }

    /// DELETE /users/:user_id/credentials/certificates/:id  (revoke)
    pub async fn revoke_certificate(client: &WarpgateClient, user_id: &str, cred_id: &str) -> WarpgateResult<()> {
        client.delete(&format!("/users/{}/credentials/certificates/{}", user_id, cred_id)).await?;
        Ok(())
    }
}
