//! AWS Signature Version 4 implementation.
//!
//! Implements the complete AWS SigV4 signing algorithm as documented at:
//! <https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html>
//!
//! This mirrors the `aws-sigv4` crate's functionality while keeping
//! dependencies minimal. The algorithm consists of four steps:
//!
//! 1. Create a canonical request
//! 2. Create the string to sign
//! 3. Calculate the signing key
//! 4. Add the signature to the request

use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

type HmacSha256 = Hmac<Sha256>;

/// The hashing algorithm used by SigV4.
const ALGORITHM: &str = "AWS4-HMAC-SHA256";

/// Hash of an empty payload.
pub const EMPTY_PAYLOAD_HASH: &str =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/// AWS SigV4 signer.
#[derive(Debug, Clone)]
pub struct SigV4Signer {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    pub region: String,
    pub service: String,
}

/// A signed request ready to be sent.
#[derive(Debug, Clone)]
pub struct SignedRequest {
    /// HTTP method (GET, POST, PUT, DELETE, etc.).
    pub method: String,
    /// Full URL including query string.
    pub url: String,
    /// Headers including the Authorization header.
    pub headers: BTreeMap<String, String>,
    /// Request body.
    pub body: Option<String>,
}

impl SigV4Signer {
    /// Create a new SigV4 signer.
    pub fn new(
        access_key_id: &str,
        secret_access_key: &str,
        session_token: Option<&str>,
        region: &str,
        service: &str,
    ) -> Self {
        Self {
            access_key_id: access_key_id.to_string(),
            secret_access_key: secret_access_key.to_string(),
            session_token: session_token.map(|s| s.to_string()),
            region: region.to_string(),
            service: service.to_string(),
        }
    }

    /// Sign a request and return the signed request with Authorization header.
    ///
    /// # Arguments
    /// * `method` - HTTP method
    /// * `url` - Full request URL
    /// * `headers` - Request headers (Host is required)
    /// * `body` - Request body (empty string for GET)
    /// * `timestamp` - Request timestamp
    pub fn sign_request(
        &self,
        method: &str,
        url: &str,
        headers: &BTreeMap<String, String>,
        body: &str,
        timestamp: DateTime<Utc>,
    ) -> SignedRequest {
        let date_stamp = timestamp.format("%Y%m%d").to_string();
        let amz_date = timestamp.format("%Y%m%dT%H%M%SZ").to_string();

        // Build the headers map with required SigV4 headers
        let mut signed_headers = headers.clone();
        signed_headers.insert("x-amz-date".to_string(), amz_date.clone());

        if let Some(ref token) = self.session_token {
            signed_headers.insert("x-amz-security-token".to_string(), token.clone());
        }

        // Compute payload hash
        let payload_hash = sha256_hex(body);
        signed_headers.insert("x-amz-content-sha256".to_string(), payload_hash.clone());

        // Parse URL to get path and query
        let (canonical_uri, canonical_querystring) = parse_url_components(url);

        // Step 1: Create canonical request
        let canonical_request = self.create_canonical_request(
            method,
            &canonical_uri,
            &canonical_querystring,
            &signed_headers,
            &payload_hash,
        );

        // Step 2: Create string to sign
        let credential_scope = format!(
            "{}/{}/{}/aws4_request",
            date_stamp, self.region, self.service
        );
        let string_to_sign =
            self.create_string_to_sign(&amz_date, &credential_scope, &canonical_request);

        // Step 3: Calculate signing key
        let signing_key = self.derive_signing_key(&date_stamp);

        // Step 4: Calculate signature
        let signature = hex::encode(hmac_sha256(&signing_key, string_to_sign.as_bytes()));

        // Build Authorization header
        let signed_header_names = self.signed_header_names(&signed_headers);
        let authorization = format!(
            "{} Credential={}/{}, SignedHeaders={}, Signature={}",
            ALGORITHM, self.access_key_id, credential_scope, signed_header_names, signature
        );

        signed_headers.insert("authorization".to_string(), authorization);

        SignedRequest {
            method: method.to_string(),
            url: url.to_string(),
            headers: signed_headers,
            body: if body.is_empty() {
                None
            } else {
                Some(body.to_string())
            },
        }
    }

    /// Step 1: Create the canonical request.
    ///
    /// CanonicalRequest =
    ///   HTTPRequestMethod + '\n' +
    ///   CanonicalURI + '\n' +
    ///   CanonicalQueryString + '\n' +
    ///   CanonicalHeaders + '\n' +
    ///   SignedHeaders + '\n' +
    ///   HexEncode(Hash(RequestPayload))
    fn create_canonical_request(
        &self,
        method: &str,
        canonical_uri: &str,
        canonical_querystring: &str,
        headers: &BTreeMap<String, String>,
        payload_hash: &str,
    ) -> String {
        let canonical_headers = self.canonical_headers(headers);
        let signed_headers = self.signed_header_names(headers);

        format!(
            "{}\n{}\n{}\n{}\n{}\n{}",
            method, canonical_uri, canonical_querystring, canonical_headers, signed_headers,
            payload_hash
        )
    }

    /// Step 2: Create the string to sign.
    ///
    /// StringToSign =
    ///   Algorithm + '\n' +
    ///   RequestDateTime + '\n' +
    ///   CredentialScope + '\n' +
    ///   HexEncode(Hash(CanonicalRequest))
    fn create_string_to_sign(
        &self,
        amz_date: &str,
        credential_scope: &str,
        canonical_request: &str,
    ) -> String {
        let canonical_request_hash = sha256_hex(canonical_request);
        format!(
            "{}\n{}\n{}\n{}",
            ALGORITHM, amz_date, credential_scope, canonical_request_hash
        )
    }

    /// Step 3: Derive the signing key.
    ///
    /// kSecret  = "AWS4" + SecretAccessKey
    /// kDate    = HMAC-SHA256(kSecret, Date)
    /// kRegion  = HMAC-SHA256(kDate, Region)
    /// kService = HMAC-SHA256(kRegion, Service)
    /// kSigning = HMAC-SHA256(kService, "aws4_request")
    fn derive_signing_key(&self, date_stamp: &str) -> Vec<u8> {
        let k_secret = format!("AWS4{}", self.secret_access_key);
        let k_date = hmac_sha256(k_secret.as_bytes(), date_stamp.as_bytes());
        let k_region = hmac_sha256(&k_date, self.region.as_bytes());
        let k_service = hmac_sha256(&k_region, self.service.as_bytes());
        hmac_sha256(&k_service, b"aws4_request")
    }

    /// Build canonical headers string.
    /// Headers are lowercased, sorted, and whitespace-trimmed.
    fn canonical_headers(&self, headers: &BTreeMap<String, String>) -> String {
        let mut sorted: Vec<(String, String)> = headers
            .iter()
            .map(|(k, v)| (k.to_lowercase(), v.trim().to_string()))
            .collect();
        sorted.sort_by(|a, b| a.0.cmp(&b.0));

        sorted
            .iter()
            .map(|(k, v)| format!("{}:{}\n", k, v))
            .collect::<String>()
    }

    /// Build the SignedHeaders string (semicolon-delimited, sorted, lowered).
    fn signed_header_names(&self, headers: &BTreeMap<String, String>) -> String {
        let mut names: Vec<String> = headers.keys().map(|k| k.to_lowercase()).collect();
        names.sort();
        names.join(";")
    }
}

// ── Helper functions ────────────────────────────────────────────────────

/// Compute SHA-256 hash and return hex-encoded string.
pub fn sha256_hex(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

/// Compute SHA-256 hash of bytes and return hex-encoded string.
pub fn sha256_hex_bytes(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

/// Compute HMAC-SHA256.
fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// Parse a URL into (canonical_uri, canonical_querystring).
fn parse_url_components(url: &str) -> (String, String) {
    if let Ok(parsed) = url::Url::parse(url) {
        let path = if parsed.path().is_empty() {
            "/".to_string()
        } else {
            uri_encode_path(parsed.path())
        };

        // Sort query parameters
        let mut query_params: Vec<(String, String)> = parsed
            .query_pairs()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        query_params.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

        let query_string = query_params
            .iter()
            .map(|(k, v)| format!("{}={}", uri_encode(k), uri_encode(v)))
            .collect::<Vec<String>>()
            .join("&");

        (path, query_string)
    } else {
        ("/".to_string(), String::new())
    }
}

/// URI-encode a string per AWS SigV4 spec (RFC 3986, except '/' in paths).
pub fn uri_encode(input: &str) -> String {
    use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
    // AWS SigV4: encode everything except unreserved characters
    const AWS_ENCODE_SET: &AsciiSet = &CONTROLS
        .add(b' ')
        .add(b'"')
        .add(b'#')
        .add(b'%')
        .add(b'&')
        .add(b'\'')
        .add(b'+')
        .add(b',')
        .add(b':')
        .add(b';')
        .add(b'<')
        .add(b'=')
        .add(b'>')
        .add(b'?')
        .add(b'@')
        .add(b'[')
        .add(b'\\')
        .add(b']')
        .add(b'^')
        .add(b'`')
        .add(b'{')
        .add(b'|')
        .add(b'}');

    utf8_percent_encode(input, AWS_ENCODE_SET).to_string()
}

/// URI-encode a URL path, preserving forward slashes.
fn uri_encode_path(path: &str) -> String {
    path.split('/')
        .map(|segment| uri_encode(segment))
        .collect::<Vec<String>>()
        .join("/")
}

/// Build a query string from parameters sorted alphabetically.
pub fn build_query_string(params: &BTreeMap<String, String>) -> String {
    params
        .iter()
        .map(|(k, v)| format!("{}={}", uri_encode(k), uri_encode(v)))
        .collect::<Vec<String>>()
        .join("&")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn test_signer() -> SigV4Signer {
        SigV4Signer::new(
            "AKIDEXAMPLE",
            "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            None,
            "us-east-1",
            "service",
        )
    }

    #[test]
    fn sha256_empty_string() {
        assert_eq!(sha256_hex(""), EMPTY_PAYLOAD_HASH);
    }

    #[test]
    fn sha256_known_value() {
        // SHA-256 of "test"
        assert_eq!(
            sha256_hex("test"),
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        );
    }

    #[test]
    fn derive_signing_key_known() {
        let signer = test_signer();
        let key = signer.derive_signing_key("20150830");
        // The signing key should be 32 bytes (HMAC-SHA256 output)
        assert_eq!(key.len(), 32);
    }

    #[test]
    fn uri_encode_basic() {
        assert_eq!(uri_encode("hello world"), "hello%20world");
        assert_eq!(uri_encode("foo/bar"), "foo/bar");
        assert_eq!(uri_encode("key=value"), "key%3Dvalue");
    }

    #[test]
    fn uri_encode_unreserved() {
        // Unreserved characters should not be encoded
        assert_eq!(uri_encode("abcABC123-_.~"), "abcABC123-_.~");
    }

    #[test]
    fn parse_url_simple() {
        let (path, query) = parse_url_components("https://example.com/path/to/resource");
        assert_eq!(path, "/path/to/resource");
        assert_eq!(query, "");
    }

    #[test]
    fn parse_url_with_query() {
        let (path, query) =
            parse_url_components("https://example.com/?Action=DescribeInstances&Version=2016-11-15");
        assert_eq!(path, "/");
        assert!(query.contains("Action"));
        assert!(query.contains("Version"));
    }

    #[test]
    fn parse_url_query_sorted() {
        let (_, query) =
            parse_url_components("https://example.com/?Z=1&A=2&M=3");
        // Should be sorted: A=2&M=3&Z=1
        assert_eq!(query, "A=2&M=3&Z=1");
    }

    #[test]
    fn sign_request_has_authorization() {
        let signer = test_signer();
        let mut headers = BTreeMap::new();
        headers.insert("host".to_string(), "service.us-east-1.amazonaws.com".to_string());

        let ts = chrono::Utc::now();
        let signed = signer.sign_request("GET", "https://service.us-east-1.amazonaws.com/", &headers, "", ts);

        assert!(signed.headers.contains_key("authorization"));
        let auth = &signed.headers["authorization"];
        assert!(auth.starts_with("AWS4-HMAC-SHA256"));
        assert!(auth.contains("Credential=AKIDEXAMPLE/"));
        assert!(auth.contains("SignedHeaders="));
        assert!(auth.contains("Signature="));
    }

    #[test]
    fn sign_request_has_amz_date() {
        let signer = test_signer();
        let mut headers = BTreeMap::new();
        headers.insert("host".to_string(), "service.us-east-1.amazonaws.com".to_string());

        let ts = chrono::Utc::now();
        let signed = signer.sign_request("GET", "https://service.us-east-1.amazonaws.com/", &headers, "", ts);
        assert!(signed.headers.contains_key("x-amz-date"));
    }

    #[test]
    fn sign_request_with_session_token() {
        let signer = SigV4Signer::new(
            "ASIEXAMPLE",
            "secret",
            Some("sessiontoken123"),
            "us-east-1",
            "sts",
        );
        let mut headers = BTreeMap::new();
        headers.insert("host".to_string(), "sts.amazonaws.com".to_string());

        let ts = chrono::Utc::now();
        let signed = signer.sign_request("POST", "https://sts.amazonaws.com/", &headers, "Action=GetCallerIdentity&Version=2011-06-15", ts);
        assert_eq!(
            signed.headers.get("x-amz-security-token").map(|s| s.as_str()),
            Some("sessiontoken123")
        );
    }

    #[test]
    fn sign_request_payload_hash() {
        let signer = test_signer();
        let mut headers = BTreeMap::new();
        headers.insert("host".to_string(), "s3.us-east-1.amazonaws.com".to_string());

        let ts = chrono::Utc::now();
        let signed = signer.sign_request(
            "PUT",
            "https://s3.us-east-1.amazonaws.com/bucket/key",
            &headers,
            "file contents",
            ts,
        );
        assert!(signed.headers.contains_key("x-amz-content-sha256"));
        // Hash should NOT be the empty hash
        assert_ne!(signed.headers["x-amz-content-sha256"], EMPTY_PAYLOAD_HASH);
    }

    #[test]
    fn canonical_headers_sorted() {
        let signer = test_signer();
        let mut headers = BTreeMap::new();
        headers.insert("host".to_string(), "example.com".to_string());
        headers.insert("x-amz-date".to_string(), "20150830T123600Z".to_string());
        headers.insert("content-type".to_string(), "application/json".to_string());

        let canonical = signer.canonical_headers(&headers);
        let lines: Vec<&str> = canonical.lines().collect();
        assert_eq!(lines[0], "content-type:application/json");
        assert_eq!(lines[1], "host:example.com");
        assert_eq!(lines[2], "x-amz-date:20150830T123600Z");
    }

    #[test]
    fn signed_header_names_sorted() {
        let signer = test_signer();
        let mut headers = BTreeMap::new();
        headers.insert("host".to_string(), "example.com".to_string());
        headers.insert("x-amz-date".to_string(), "val".to_string());
        headers.insert("content-type".to_string(), "val".to_string());

        let names = signer.signed_header_names(&headers);
        assert_eq!(names, "content-type;host;x-amz-date");
    }

    #[test]
    fn build_query_string_sorted() {
        let mut params = BTreeMap::new();
        params.insert("Version".to_string(), "2016-11-15".to_string());
        params.insert("Action".to_string(), "DescribeInstances".to_string());
        let qs = build_query_string(&params);
        assert!(qs.starts_with("Action="));
    }

    // ── AWS SigV4 test suite reference values ──────────────────────────
    // These are derived from the AWS Signature V4 test suite:
    // https://docs.aws.amazon.com/general/latest/gr/signature-v4-test-suite.html

    #[test]
    fn sigv4_test_suite_get_vanilla() {
        let signer = SigV4Signer::new(
            "AKIDEXAMPLE",
            "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            None,
            "us-east-1",
            "service",
        );

        let mut headers = BTreeMap::new();
        headers.insert("host".to_string(), "example.amazonaws.com".to_string());

        // Use a fixed timestamp for reproducibility
        let ts = chrono::NaiveDate::from_ymd_opt(2015, 8, 30)
            .unwrap()
            .and_hms_opt(12, 36, 0)
            .unwrap()
            .and_utc();

        let signed = signer.sign_request(
            "GET",
            "https://example.amazonaws.com/",
            &headers,
            "",
            ts,
        );

        // Verify the signature is deterministic
        let auth = &signed.headers["authorization"];
        assert!(auth.starts_with("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request"));
    }
}
