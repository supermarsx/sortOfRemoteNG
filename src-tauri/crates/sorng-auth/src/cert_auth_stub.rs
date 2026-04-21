use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

pub type CertAuthServiceState = Arc<Mutex<CertAuthService>>;

const DISABLED_MESSAGE: &str =
    "Certificate authentication is disabled. Rebuild with the `cert-auth` feature enabled.";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CertInfo {
    pub subject: String,
    pub issuer: String,
    pub not_before: String,
    pub not_after: String,
    pub fingerprint: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CertUser {
    pub username: String,
    pub fingerprint: String,
    pub subject: String,
    pub issuer: String,
    pub not_before: String,
    pub not_after: String,
    pub is_valid: bool,
}

pub struct CertAuthService;

impl CertAuthService {
    pub fn new(_store_path: String) -> CertAuthServiceState {
        Arc::new(Mutex::new(Self))
    }

    pub async fn authenticate_with_cert(&self, _cert_data: Vec<u8>) -> Result<String, String> {
        Err(DISABLED_MESSAGE.to_string())
    }

    pub async fn register_certificate(
        &mut self,
        _username: String,
        _cert_data: Vec<u8>,
    ) -> Result<(), String> {
        Err(DISABLED_MESSAGE.to_string())
    }

    pub fn parse_certificate(&self, _cert_data: Vec<u8>) -> Result<CertInfo, String> {
        Err(DISABLED_MESSAGE.to_string())
    }

    pub fn validate_certificate(&self, _cert_data: Vec<u8>) -> Result<bool, String> {
        Err(DISABLED_MESSAGE.to_string())
    }

    pub async fn add_trusted_ca(&mut self, _ca_cert: Vec<u8>) -> Result<(), String> {
        Err(DISABLED_MESSAGE.to_string())
    }

    pub async fn revoke_certificate(&mut self, _fingerprint: String) -> Result<(), String> {
        Err(DISABLED_MESSAGE.to_string())
    }

    pub async fn list_certificates(&self) -> Vec<CertUser> {
        Vec::new()
    }
}

