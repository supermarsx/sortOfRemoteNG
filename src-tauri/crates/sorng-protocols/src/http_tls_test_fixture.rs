//! Static, isolated TLS fixture shared by transport and real HTTP command tests.
use base64::Engine;
use std::sync::Arc;
use tokio_rustls::rustls;

// Generated solely for this isolated loopback test; not an application key.
// Self-signed localhost/127.0.0.1, valid 2020-2040. Never installed in an OS store.
pub(super) const TEST_CERT: &str = "MIIC1zCCAb+gAwIBAgIJAJMeGnO55zKiMA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNVBAMTCWxvY2FsaG9zdDAeFw0yMDAxMDEwMDAwMDBaFw00MDAxMDEwMDAwMDBaMBQxEjAQBgNVBAMTCWxvY2FsaG9zdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAN/8KUNa814VvFWvJDf7FTKXJ0Y03y02RGC26nY268Q+S6O7rO3ggpLmnhRRYVqlUjGZA4tD60PVRcxzMjSDikdf0kQ//BwNGYo/MC0M3iRbl6u+WsD7PiAWXvuqXOe/4XgdFJhLIhwqoZ13ZqKwsaGeFxoTPDRxT2tlzPGA3P0khqowfQauHiCnDGQZgrbMwbCjgkPTaS6g6g4GaiBbSzAOrZTZ7ohKXdfpPxpjPMYMMWKn0cNDFZzuDzripbpwgRqkNmQCWgREHxpoH0SycOYMrJ10q1zUR8Ewgwh0j5s3mfQgi0ix/WhzndFAaKnnqDG28XJy4bUhQkc2GxS+CBECAwEAAaMsMCowGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMAwGA1UdEwEB/wQCMAAwDQYJKoZIhvcNAQELBQADggEBAM5zsL1OC93b9Q/vP5kC9/xf9k9Lw4LTAz7VsoMO4TprAP+ZXLNmY1E6/qUb4hvOnu+MfiX2GEUytBglQkKLLStQ6oCRgHcrKHhDKtLiF0xhFPcMW9rgt2rNebF752uqPC9hUwym7xNiUNlzzTCp/vkXv6jgbY2i40oExszA+nj65qIFaYaYuhLI100JWbIJdLkx4soiSL9iZChZKqHLTioyJlwo+ZntpJRH9PNpRbN8n60pIjzI1Pk4hmkn/l7syJkEheMaKYKWtv5eJzTAW3NtQAT/9co1ikWkXM5fOWJ5Lx7Hsp98Z/tSvlr9V8xKa/r+I2DJo9oWOv+5eet96HM=";
const TEST_KEY: &str = "MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDf/ClDWvNeFbxVryQ3+xUylydGNN8tNkRgtup2NuvEPkuju6zt4IKS5p4UUWFapVIxmQOLQ+tD1UXMczI0g4pHX9JEP/wcDRmKPzAtDN4kW5ervlrA+z4gFl77qlznv+F4HRSYSyIcKqGdd2aisLGhnhcaEzw0cU9rZczxgNz9JIaqMH0Grh4gpwxkGYK2zMGwo4JD02kuoOoOBmogW0swDq2U2e6ISl3X6T8aYzzGDDFip9HDQxWc7g864qW6cIEapDZkAloERB8aaB9EsnDmDKyddKtc1EfBMIMIdI+bN5n0IItIsf1oc53RQGip56gxtvFycuG1IUJHNhsUvggRAgMBAAECggEBAL5jnkN1nOZ9fVAsBpJbJ6KQHz8rFAVfWnIHKXcAqhluhmcP0SeGLhdmVjqZDjK50gr8sKmBOwq2z5TA2o0Ovsx6o8WFyeuiKvJ7UZ0Jkg2/mUXQEV52cVFfEq/DGSOY07OArI/jVYQxrJyn8KMbpHHnamWssgE1y7dTmggybCXzfV2xRPUPxos77IJc56pFFIvG2GoHtclZf8XdCgvQBQFf+Wew1yiV3ypYDI5JeNYROBoZSAK0nF59EDS2aRGyVK/smTUybsint5GxqXw8WmXDhdOOvJdco/YQFKc2HaIHWqA0iyF9jHA5xiZ1b9nJdgW09G3+e7XgZSXuqksdA/0CgYEA/4aDH4PiMVe14GlF5ymlzxxsWy6zceVq0zqCaCg42VKL87mg4FjFuo7RvbVEqkh/e80j91U7Z4VdIDtiDvXTPBHVN5HY2YtvpnNDrm2H6TWCRj7jsQlQu8TQkGOP5o4hykc+u79m0xIRZjt/k39QElLN+tfB6Il3OShUetlidGMCgYEA4GanPudPW3ZWGBphvamrEExtgc1kwHiNctNwOqxqJha16VC5L+Q2Q2CDkrMzcurD8QeVBXwfF/imgZJaNpDfP+xOX0IEf8qdAL71qaLrwxz2REZ0tK+cVCb3J2rMXWP9gLVwJQx34AQRjj/7C/UI+ZnV574kJE5+KG7D63Oa2fsCgYEAw3tLatvBOpBoUrMWyD7jW2vaNXOn0jV5oPj89OP4gcGV0bIsMhWXxx4ltSUsz7zA0pxgrIHm/U5YrSTg4qMLo8PcwzNvmxYCJ2u81n9y32WRMV5BYJnIyq1KBXw1hWMs1IvmoUlPR6Bl8TkJY3SddDcm34UaEmS/8dk5r/YITRMCgYB0bI4FEtmXaHQOmVFwp6C7GgwOtlO5kFJC6vRlXKLOFCZZYKpT8KE+n8pjyFm/G5KBcR+d8uHm+/jXbOklOlC5x4552bSf4K1If8rRMlgDqPkUP0G5pQsElhrQ9pYFNiWGK5x9fFSNg07gcM19TKpVZb0XOQ1jUN4feChp9la3FQKBgQCo643MghnvwDMD8u7QTCl3ipkemtphyKuuDfMtPd5AWbJYiWPoZVNqp7ddCCPDn4/Dp0746qgDB0a1Nq1TODKF3vQeXwlCMJ2ZcQfcGnF22AvIhkMSW1Q6jQjrDuGEOj8aPvk79AFd9lir1d0OS3r5X27nZUx3Xm79BOSLfLX+CQ==";

pub(super) fn test_acceptor() -> tokio_rustls::TlsAcceptor {
    test_acceptor_versions(&[&rustls::version::TLS13, &rustls::version::TLS12])
}

pub(super) fn test_acceptor_versions(
    versions: &[&'static rustls::SupportedProtocolVersion],
) -> tokio_rustls::TlsAcceptor {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let cert = rustls::pki_types::CertificateDer::from(
        base64::engine::general_purpose::STANDARD
            .decode(TEST_CERT)
            .unwrap(),
    );
    let key = rustls::pki_types::PrivatePkcs8KeyDer::from(
        base64::engine::general_purpose::STANDARD
            .decode(TEST_KEY)
            .unwrap(),
    );
    let config = rustls::ServerConfig::builder_with_protocol_versions(versions)
        .with_no_client_auth()
        .with_single_cert(vec![cert], key.into())
        .unwrap();
    tokio_rustls::TlsAcceptor::from(Arc::new(config))
}
