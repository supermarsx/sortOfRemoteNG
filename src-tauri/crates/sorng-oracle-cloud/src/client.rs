use crate::error::{OciError, OciErrorKind, OciResult};
use crate::types::OciConnectionConfig;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, DATE};
use serde::de::DeserializeOwned;

/// OCI API client that handles authentication and HTTP communication.
pub struct OciClient {
    pub config: OciConnectionConfig,
    http: reqwest::Client,
}

impl OciClient {
    /// Create a new OCI client from a connection configuration.
    pub fn new(config: OciConnectionConfig) -> OciResult<Self> {
        let mut builder = reqwest::Client::builder();

        if let Some(timeout) = config.timeout_secs {
            builder = builder.timeout(std::time::Duration::from_secs(timeout));
        }

        // Route TLS certificate decisions through the backend Trust Center with
        // TOFU as the default (replacing the old blind
        // `danger_accept_invalid_certs(true)`). The legacy skip flag maps to an
        // explicit, revocable `AlwaysTrust` override; otherwise the store's
        // effective/global policy (default TOFU) governs.
        //
        // The t3 audit noted oracle-cloud "may skip via skip_ca_check ||
        // skip_cn_check"; the actual config carries a single `tls_skip_verify`
        // boolean, so that is the legacy opt-out we honour here.
        //
        // The store is the active user database's trust file
        // (`databases/<id>.trust.json`), resolved through the process-global
        // trust runtime; with no database open the handshake fails closed.
        let skip = config.tls_skip_verify == Some(true);
        let ctx = sorng_tls_trust::TofuTlsContext::shared(
            Self::canonical_host(&config.region),
            443,
            sorng_tls_trust::skip_flag_to_override(skip),
        );
        let http = sorng_tls_trust::build_tofu_client(builder, ctx)
            .map_err(|e| OciError::connection(format!("Failed to create HTTP client: {e}")))?;

        Ok(Self { config, http })
    }

    /// Canonical host used to key the Trust Center record. OCI dials
    /// `{service}.{region}.oraclecloud.com`; the region-anchored host gives one
    /// stable `tls:host:443` identity per OCI region targeted by the connection.
    fn canonical_host(region: &str) -> String {
        format!("{region}.oraclecloud.com")
    }

    /// Build the full URL for an OCI service endpoint.
    pub fn url(&self, service: &str, path: &str) -> String {
        format!(
            "https://{service}.{region}.oraclecloud.com{path}",
            service = service,
            region = self.config.region,
            path = path,
        )
    }

    /// Apply OCI request signing headers to a request builder.
    fn apply_auth(&self, headers: &mut HeaderMap) {
        let now = chrono::Utc::now()
            .format("%a, %d %b %Y %H:%M:%S GMT")
            .to_string();
        headers.insert(
            DATE,
            HeaderValue::from_str(&now).unwrap_or_else(|_| HeaderValue::from_static("")),
        );

        // OCI uses HTTP Signature-based auth. Build the key ID and a
        // placeholder signature so the request structure is correct.
        let key_id = format!(
            "{tenancy}/{user}/{fingerprint}",
            tenancy = self.config.tenancy_ocid,
            user = self.config.user_ocid,
            fingerprint = self.config.fingerprint,
        );
        let auth_value = format!(
            "Signature version=\"1\",keyId=\"{key_id}\",algorithm=\"rsa-sha256\",headers=\"date (request-target) host\",signature=\"PLACEHOLDER\"",
        );
        if let Ok(val) = HeaderValue::from_str(&auth_value) {
            headers.insert(AUTHORIZATION, val);
        }
    }

    /// Deserialize a successful response or map the HTTP error.
    async fn handle_response<T: DeserializeOwned>(&self, resp: reqwest::Response) -> OciResult<T> {
        let status = resp.status();
        if status.is_success() {
            resp.json::<T>().await.map_err(OciError::from)
        } else {
            let code = status.as_u16();
            let body = resp.text().await.unwrap_or_default();
            Err(match code {
                401 => OciError::new(OciErrorKind::AuthenticationFailed, body),
                403 => OciError::new(OciErrorKind::PermissionDenied, body),
                404 => OciError::resource_not_found(body),
                409 => OciError::new(OciErrorKind::ConflictError, body),
                429 => OciError::new(OciErrorKind::RateLimited, body),
                _ => OciError::http(format!("HTTP {code}: {body}")),
            })
        }
    }

    /// Perform an authenticated GET request.
    pub async fn get<T: DeserializeOwned>(&self, service: &str, path: &str) -> OciResult<T> {
        let url = self.url(service, path);
        let mut headers = HeaderMap::new();
        self.apply_auth(&mut headers);
        let resp = self.http.get(&url).headers(headers).send().await?;
        self.handle_response(resp).await
    }

    /// Perform an authenticated POST request with a JSON body.
    pub async fn post<T: DeserializeOwned>(
        &self,
        service: &str,
        path: &str,
        body: &impl serde::Serialize,
    ) -> OciResult<T> {
        let url = self.url(service, path);
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        self.apply_auth(&mut headers);
        let resp = self
            .http
            .post(&url)
            .headers(headers)
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    /// Perform an authenticated PUT request with a JSON body.
    pub async fn put<T: DeserializeOwned>(
        &self,
        service: &str,
        path: &str,
        body: &impl serde::Serialize,
    ) -> OciResult<T> {
        let url = self.url(service, path);
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        self.apply_auth(&mut headers);
        let resp = self
            .http
            .put(&url)
            .headers(headers)
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    /// Perform an authenticated DELETE request.
    pub async fn delete(&self, service: &str, path: &str) -> OciResult<()> {
        let url = self.url(service, path);
        let mut headers = HeaderMap::new();
        self.apply_auth(&mut headers);
        let resp = self.http.delete(&url).headers(headers).send().await?;
        let status = resp.status();
        if status.is_success() || status.as_u16() == 204 {
            Ok(())
        } else {
            let code = status.as_u16();
            let body = resp.text().await.unwrap_or_default();
            Err(match code {
                401 => OciError::new(OciErrorKind::AuthenticationFailed, body),
                403 => OciError::new(OciErrorKind::PermissionDenied, body),
                404 => OciError::resource_not_found(body),
                409 => OciError::new(OciErrorKind::ConflictError, body),
                429 => OciError::new(OciErrorKind::RateLimited, body),
                _ => OciError::http(format!("HTTP {code}: {body}")),
            })
        }
    }

    /// Ping the OCI identity service to verify connectivity.
    pub async fn ping(&self) -> OciResult<()> {
        let url = self.url("identity", "/20160918/tenancies/self");
        let mut headers = HeaderMap::new();
        self.apply_auth(&mut headers);
        let resp = self.http.get(&url).headers(headers).send().await?;
        if resp.status().is_success() || resp.status().as_u16() == 401 {
            // 401 means we reached OCI but auth may be wrong — still "connected"
            Ok(())
        } else {
            Err(OciError::connection(format!(
                "Ping failed with status {}",
                resp.status()
            )))
        }
    }

    /// Get the compartment ID, falling back to the tenancy OCID.
    pub fn compartment_id(&self) -> &str {
        self.config
            .compartment_id
            .as_deref()
            .unwrap_or(&self.config.tenancy_ocid)
    }
}

#[cfg(test)]
mod trust_runtime_tests {
    use super::*;
    use sorng_storage::trust_store::test_support::{
        install_active_runtime_for_tests, install_runtime_for_tests,
    };
    use sorng_storage::trust_store::{CertIdentity, Identity};
    use sorng_tls_trust::TofuTlsContext;

    fn tls_identity(fingerprint: &str) -> Identity {
        Identity::Tls(Box::new(CertIdentity {
            fingerprint: fingerprint.to_string(),
            subject: Some("CN=oraclecloud.com".into()),
            issuer: Some("CN=oraclecloud.com".into()),
            first_seen: "2026-01-01T00:00:00Z".into(),
            last_seen: "2026-01-01T00:00:00Z".into(),
            valid_from: None,
            valid_to: None,
            pem: None,
            serial: None,
            signature_algorithm: None,
            san: None,
            chain_fingerprints: Vec::new(),
            subject_cn: None,
            subject_org: None,
            subject_ou: None,
            subject_country: None,
            subject_state: None,
            subject_locality: None,
            subject_email: None,
            issuer_cn: None,
            issuer_org: None,
            issuer_country: None,
            key_algorithm: None,
            key_size: None,
            version: None,
            chain: None,
        }))
    }

    /// The context the client builds pins into the *active database's* trust
    /// file, keyed by the region-anchored canonical host.
    #[test]
    fn pins_into_the_active_database_trust_file() {
        let dir = tempfile::tempdir().unwrap();
        let databases = dir.path().join("databases");
        let _guard = install_active_runtime_for_tests(databases.clone(), "oci-db");

        let host = OciClient::canonical_host("eu-frankfurt-1");
        assert_eq!(host, "eu-frankfurt-1.oraclecloud.com");
        let ctx = TofuTlsContext::shared(host.clone(), 443, None);

        ctx.store
            .trust(
                format!("{host}:443"),
                "tls".into(),
                tls_identity("cc33"),
                false,
            )
            .expect("pin into the active database");

        assert!(
            databases.join("oci-db.trust.json").exists(),
            "the pin must land in databases/<id>.trust.json"
        );
    }

    #[test]
    fn fails_closed_without_an_active_database() {
        let dir = tempfile::tempdir().unwrap();
        let _guard = install_runtime_for_tests(dir.path().join("databases"), None);

        let ctx = TofuTlsContext::shared("eu-frankfurt-1.oraclecloud.com", 443, None);
        assert!(ctx
            .store
            .verify(
                "eu-frankfurt-1.oraclecloud.com:443",
                "tls",
                tls_identity("cc33")
            )
            .is_err());
    }
}
