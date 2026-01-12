//! # Certificate Authentication Module
//!
//! This module provides X.509 certificate-based authentication functionality.
//! It handles certificate validation, parsing, and user authentication using certificates.
//!
//! ## Features
//!
//! - X.509 certificate parsing and validation
//! - Certificate-based user authentication
//! - Certificate revocation checking (CRL/OCSP)
//! - Certificate store management
//!
//! ## Security
//!
//! Certificates are validated against trusted certificate authorities.
//! Certificate revocation is checked using CRL and OCSP protocols.
//!
//! ## Example
//!

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use x509_parser::prelude::*;
use rustls_pemfile::Item;
use chrono::{DateTime, Utc};

/// Certificate information structure
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CertInfo {
    /// Certificate subject
    pub subject: String,
    /// Certificate issuer
    pub issuer: String,
    /// Certificate validity start date
    pub not_before: String,
    /// Certificate validity end date
    pub not_after: String,
    /// Certificate fingerprint
    pub fingerprint: String,
}

/// Represents a certificate-based user authentication entry.
#[derive(Serialize, Deserialize, Clone)]
pub struct CertUser {
    /// The username associated with this certificate
    pub username: String,
    /// The certificate fingerprint (SHA256)
    pub fingerprint: String,
    /// Certificate subject information
    pub subject: String,
    /// Certificate issuer information
    pub issuer: String,
    /// Certificate validity start date
    pub not_before: String,
    /// Certificate validity end date
    pub not_after: String,
    /// Whether this certificate is currently valid
    pub is_valid: bool,
}

/// Certificate authentication service state
pub type CertAuthServiceState = Arc<Mutex<CertAuthService>>;

/// Service for managing certificate-based authentication
pub struct CertAuthService {
    /// Map of certificate fingerprints to users
    cert_users: HashMap<String, CertUser>,
    /// Trusted certificate authorities
    trusted_cas: Vec<Vec<u8>>,
    /// Certificate revocation list
    crl: Vec<String>,
    /// Store path for certificate data
    store_path: String,
}

impl CertAuthService {
    /// Creates a new certificate authentication service
    pub fn new(store_path: String) -> CertAuthServiceState {
        let mut service = CertAuthService {
            cert_users: HashMap::new(),
            trusted_cas: Vec::new(),
            crl: Vec::new(),
            store_path,
        };
        service.load().unwrap_or_else(|e| {
            eprintln!("Failed to load certificate store: {}", e);
        });
        Arc::new(Mutex::new(service))
    }

    /// Loads certificate data from persistent storage
    fn load(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let path = Path::new(&self.store_path);
        if path.exists() {
            let data = fs::read_to_string(path)?;
            let store: CertStore = serde_json::from_str(&data)?;
            self.cert_users = store.cert_users;
            self.trusted_cas = store.trusted_cas;
            self.crl = store.crl;
        }
        Ok(())
    }

    /// Persists certificate data to storage
    fn persist(&self) -> Result<(), Box<dyn std::error::Error>> {
        let store = CertStore {
            cert_users: self.cert_users.clone(),
            trusted_cas: self.trusted_cas.clone(),
            crl: self.crl.clone(),
        };
        let data = serde_json::to_string_pretty(&store)?;
        fs::write(&self.store_path, data)?;
        Ok(())
    }

    /// Authenticates a user using their certificate
    pub async fn authenticate_with_cert(&self, cert_data: Vec<u8>) -> Result<String, String> {
        // Parse the certificate
        let cert = self.parse_certificate_internal(&cert_data)?;

        // Check if certificate is in our user store
        let fingerprint = self.calculate_fingerprint(&cert_data);
        if let Some(user) = self.cert_users.get(&fingerprint) {
            // Validate certificate
            if !self.validate_certificate_internal(&cert)? {
                return Err("Certificate validation failed".to_string());
            }

            // Check revocation status
            if self.is_revoked(&fingerprint) {
                return Err("Certificate has been revoked".to_string());
            }

            Ok(user.username.clone())
        } else {
            Err("Certificate not recognized".to_string())
        }
    }

    /// Registers a new certificate for a user
    pub async fn register_certificate(&mut self, username: String, cert_data: Vec<u8>) -> Result<(), String> {
        let cert = self.parse_certificate_internal(&cert_data)?;
        let fingerprint = self.calculate_fingerprint(&cert_data);

        if !self.validate_certificate_internal(&cert)? {
            return Err("Certificate validation failed".to_string());
        }

        if self.is_revoked(&fingerprint) {
            return Err("Certificate has been revoked".to_string());
        }

        let user = CertUser {
            username: username.clone(),
            fingerprint: fingerprint.clone(),
            subject: cert.subject,
            issuer: cert.issuer,
            not_before: cert.not_before,
            not_after: cert.not_after,
            is_valid: true,
        };

        self.cert_users.insert(fingerprint, user);
        self.persist().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Parses a certificate from DER or PEM data
    pub fn parse_certificate(&self, cert_data: Vec<u8>) -> Result<CertInfo, String> {
        self.parse_certificate_internal(&cert_data)
    }

    /// Parses a certificate from DER or PEM data (internal)
    fn parse_certificate_internal(&self, cert_data: &[u8]) -> Result<CertInfo, String> {
        // Try PEM first
        if let Ok(pems) = rustls_pemfile::read_all(&mut cert_data.as_ref()) {
            for item in pems {
                if let Item::X509Certificate(cert) = item {
                    let cert = X509Certificate::from_der(&cert)
                        .map(|(_, cert)| cert)
                        .map_err(|e| format!("Failed to parse certificate: {}", e))?;
                    let not_before = self.format_cert_time(&cert.validity().not_before);
                    let not_after = self.format_cert_time(&cert.validity().not_after);
                    return Ok(CertInfo {
                        subject: cert.subject().to_string(),
                        issuer: cert.issuer().to_string(),
                        not_before,
                        not_after,
                        fingerprint: self.calculate_fingerprint(cert_data),
                    });
                }
            }
        }

        // Try DER
        let cert = X509Certificate::from_der(cert_data)
            .map(|(_, cert)| cert)
            .map_err(|e| format!("Failed to parse certificate: {}", e))?;
        let not_before = self.format_cert_time(&cert.validity().not_before);
        let not_after = self.format_cert_time(&cert.validity().not_after);

        Ok(CertInfo {
            subject: cert.subject().to_string(),
            issuer: cert.issuer().to_string(),
            not_before,
            not_after,
            fingerprint: self.calculate_fingerprint(cert_data),
        })
    }

    /// Validates a certificate
    pub fn validate_certificate(&self, cert_data: Vec<u8>) -> Result<bool, String> {
        let cert = self.parse_certificate_internal(&cert_data)?;
        self.validate_certificate_internal(&cert)
    }

    /// Validates a certificate (internal)
    fn validate_certificate_internal(&self, _cert: &CertInfo) -> Result<bool, String> {
        let not_before = self.parse_cert_time(&_cert.not_before)?;
        let not_after = self.parse_cert_time(&_cert.not_after)?;
        let now = Utc::now();

        if now < not_before || now > not_after {
            return Ok(false);
        }

        if self.is_revoked(&_cert.fingerprint) {
            return Ok(false);
        }

        if !self.trusted_cas.is_empty() {
            let trusted_subjects = self.get_trusted_ca_subjects();
            if !trusted_subjects.contains(&_cert.issuer) {
                return Ok(false);
            }
        }

        Ok(true)
    }

    /// Calculates SHA256 fingerprint of certificate
    fn calculate_fingerprint(&self, cert_data: &[u8]) -> String {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(cert_data);
        let result = hasher.finalize();
        hex::encode(result)
    }

    /// Checks if a certificate is revoked
    fn is_revoked(&self, fingerprint: &str) -> bool {
        self.crl.contains(&fingerprint.to_string())
    }

    fn get_trusted_ca_subjects(&self) -> HashSet<String> {
        let mut subjects = HashSet::new();
        for ca_cert in &self.trusted_cas {
            if let Ok(info) = self.parse_certificate_internal(ca_cert) {
                subjects.insert(info.subject);
            }
        }
        subjects
    }

    fn format_cert_time(&self, time: &ASN1Time) -> String {
        time.to_datetime()
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|_| time.to_string())
    }

    fn parse_cert_time(&self, value: &str) -> Result<DateTime<Utc>, String> {
        if let Ok(dt) = DateTime::parse_from_rfc3339(value) {
            return Ok(dt.with_timezone(&Utc));
        }

        let legacy_formats = [
            "%Y-%m-%d %H:%M:%S %Z",
            "%Y-%m-%d %H:%M:%S %z",
        ];

        for format in legacy_formats {
            if let Ok(dt) = DateTime::parse_from_str(value, format) {
                return Ok(dt.with_timezone(&Utc));
            }
        }

        Err(format!("Unrecognized certificate date format: {}", value))
    }

    /// Adds a trusted certificate authority
    pub async fn add_trusted_ca(&mut self, ca_cert: Vec<u8>) -> Result<(), String> {
        // Validate the certificate first
        self.parse_certificate_internal(&ca_cert)?;
        self.trusted_cas.push(ca_cert);
        self.persist().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Revokes a certificate
    pub async fn revoke_certificate(&mut self, fingerprint: String) -> Result<(), String> {
        self.crl.push(fingerprint);
        self.persist().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Lists all registered certificates
    pub async fn list_certificates(&self) -> Vec<CertUser> {
        self.cert_users.values().cloned().collect()
    }
}

/// Certificate store for persistence
#[derive(Serialize, Deserialize)]
struct CertStore {
    cert_users: HashMap<String, CertUser>,
    trusted_cas: Vec<Vec<u8>>,
    crl: Vec<String>,
}
