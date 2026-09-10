//! Anonymous, manual public manifest reads. Never clones, executes, or imports.
use reqwest::{header, Client, Url};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    net::{IpAddr, SocketAddr},
    sync::OnceLock,
    time::Duration,
};
use tokio::sync::Semaphore;

pub const MAX_CATALOG_BYTES: usize = 2 * 1024 * 1024;
const DEADLINE: Duration = Duration::from_secs(15);
static READERS: OnceLock<Semaphore> = OnceLock::new();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogResponse {
    pub url: String,
    pub body: String,
    pub sha256: String,
    pub fetched_at: String,
}

fn catalog_url(value: &str) -> Result<Url, String> {
    let invalid = || {
        "Choose a public HTTPS raw manifest URL without credentials, query, fragment, or custom port.".to_string()
    };
    if value.len() > 4096 || value.chars().any(char::is_control) {
        return Err(invalid());
    }
    let url = Url::parse(value).map_err(|_| invalid())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.port_or_known_default() != Some(443)
        || url.domain().is_none()
    {
        return Err(invalid());
    }
    Ok(url)
}

fn public_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 192 && b == 0 && c <= 2)
                || (a == 192 && b == 88 && c == 99)
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            // Only native global-unicast space; no local/mapped/translation,
            // transition networks, documentation, multicast or reserved space.
            let words = ip.segments();
            (words[0] & 0xe000) == 0x2000
                && !(words[0] == 0x2001 && (words[1] < 0x0200 || words[1] == 0x0db8))
                && words[0] != 0x2002
                && !(words[0] == 0x3fff && words[1] < 0x1000)
        }
    }
}

fn validate_addresses(addresses: &[SocketAddr]) -> Result<(), String> {
    if addresses.is_empty()
        || addresses.len() > 32
        || addresses
            .iter()
            .any(|address| !public_address(address.ip()))
    {
        return Err("The catalog host must resolve only to public Internet addresses.".into());
    }
    Ok(())
}

/// No user-supplied headers, credentials, proxies, TLS options or redirect policy.
pub async fn fetch_catalog(value: &str) -> Result<CatalogResponse, String> {
    let _permit = READERS
        .get_or_init(|| Semaphore::new(2))
        .try_acquire()
        .map_err(|_| "Two catalog reads are already running. Try again shortly.".to_string())?;
    let url = catalog_url(value)?;
    tokio::time::timeout(DEADLINE, async {
        let host = url.host_str().ok_or("The catalog URL has no host.")?;
        let addresses: Vec<_> = tokio::net::lookup_host((host, 443))
            .await
            .map_err(|_| "The catalog hostname could not be resolved.")?
            .collect();
        validate_addresses(&addresses)?;
        fetch_pinned(url, &addresses).await
    })
    .await
    .map_err(|_| "The catalog read timed out. No library was changed.".to_string())?
}

// Private transport seam: production always validates URLs and all DNS answers
// above, then pins exactly those answers so a later DNS lookup cannot rebind.
async fn fetch_pinned(url: Url, addresses: &[SocketAddr]) -> Result<CatalogResponse, String> {
    let host = url.host_str().ok_or("The catalog URL has no host.")?;
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .connect_timeout(Duration::from_secs(5))
        .timeout(DEADLINE)
        .resolve_to_addrs(host, addresses)
        .build()
        .map_err(|_| "The secure catalog client could not be initialized.")?;
    let mut response = client
        .get(url.clone())
        .header(header::ACCEPT, "application/json, text/plain;q=0.9")
        .header(header::ACCEPT_ENCODING, "identity")
        .header(header::USER_AGENT, "sortOfRemoteNG-script-catalog/1")
        .send()
        .await
        .map_err(|_| {
            "The catalog request failed. Check the public URL and its valid HTTPS certificate."
        })?;
    if !response.status().is_success() {
        return Err(if response.status().is_redirection() {
            "Catalog redirects are not followed. Enter the final public raw manifest URL.".into()
        } else {
            format!(
                "The catalog server returned HTTP {}. No library was changed.",
                response.status().as_u16()
            )
        });
    }
    if response
        .headers()
        .get_all(header::CONTENT_ENCODING)
        .iter()
        .any(|value| {
            value
                .to_str()
                .map_or(true, |text| !text.eq_ignore_ascii_case("identity"))
        })
    {
        return Err("The catalog server ignored the uncompressed-response requirement.".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CATALOG_BYTES as u64)
    {
        return Err("Catalog manifests are limited to 2 MiB.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The catalog response could not be read.")?
    {
        if chunk.len() > MAX_CATALOG_BYTES.saturating_sub(bytes.len()) {
            return Err("Catalog manifests are limited to 2 MiB.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(bytes).map_err(|_| "The catalog must be UTF-8 JSON.")?;
    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|_| "The catalog must be valid JSON.")?;
    if !parsed.is_object() {
        return Err("The catalog must be a JSON manifest object.".into());
    }
    let sha256 = format!("{:x}", Sha256::digest(body.as_bytes()));
    Ok(CatalogResponse {
        url: url.to_string(),
        body,
        sha256,
        fetched_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn rejects_credentials_non_https_ports_and_url_side_channels() {
        for url in [
            "http://example.com/index.json",
            "https://user:pass@example.com/index.json",
            "https://example.com:8443/a",
            "https://example.com/a?token=x",
            "https://example.com/a#x",
            "file:///tmp/a",
            "https://127.0.0.1/a",
            "https://[::1]/a",
        ] {
            assert!(catalog_url(url).is_err(), "{url}");
        }
        assert!(
            catalog_url("https://raw.githubusercontent.com/owner/repo/ref/path/index.json").is_ok()
        );
    }

    #[test]
    fn every_dns_answer_must_be_public_and_count_bounded() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "100.64.0.1",
            "169.254.169.254",
            "172.16.1.1",
            "192.168.0.1",
            "192.0.2.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "2001:db8::1",
            "2002:7f00:1::1",
        ] {
            assert!(!public_address(ip.parse().unwrap()), "{ip}");
        }
        let public = "1.1.1.1:443".parse().unwrap();
        assert!(validate_addresses(&[public]).is_ok());
        assert!(public_address("2606:4700:4700::1111".parse().unwrap()));
        assert!(validate_addresses(&[public, "127.0.0.1:443".parse().unwrap()]).is_err());
        assert!(validate_addresses(&[]).is_err());
        assert!(validate_addresses(&[public; 33]).is_err());
    }

    async fn fixture(
        status: &str,
        headers: &str,
        body: Vec<u8>,
    ) -> (Result<CatalogResponse, String>, String) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let response = format!("HTTP/1.1 {status}\r\nConnection: close\r\n{headers}\r\n");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            loop {
                let mut chunk = [0; 2048];
                let count = socket.read(&mut chunk).await.unwrap();
                request.extend_from_slice(&chunk[..count]);
                if count == 0 || request.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.write_all(&body).await;
            String::from_utf8(request).unwrap()
        });
        // Only this private test seam permits loopback HTTP; public command does not.
        let result = fetch_pinned(
            Url::parse(&format!(
                "http://fixture.invalid:{}/index.json",
                address.port()
            ))
            .unwrap(),
            &[address],
        )
        .await;
        (result, server.await.unwrap())
    }

    #[tokio::test]
    async fn actual_transport_preserves_raw_json_and_sends_no_authority_credentials() {
        let body = b"{ \"version\": 1, \"entries\": [] }\n".to_vec();
        let (result, request) =
            fixture("200 OK", "Content-Type: application/json\r\n", body.clone()).await;
        let result = result.unwrap();
        assert_eq!(result.body.as_bytes(), body);
        assert_eq!(result.sha256, format!("{:x}", Sha256::digest(&body)));
        assert!(request.starts_with("GET /index.json HTTP/1.1\r\n"));
        let lower = request.to_lowercase();
        assert!(lower.contains("accept-encoding: identity"));
        assert!(!lower.contains("authorization:"));
        assert!(!lower.contains("cookie:"));
    }

    #[tokio::test]
    async fn rejects_redirect_encoding_invalid_utf8_and_invalid_json() {
        for (status, headers, body) in [
            (
                "302 Found",
                "Location: http://127.0.0.1/private\r\n",
                b"{}".to_vec(),
            ),
            ("200 OK", "Content-Encoding: gzip\r\n", b"{}".to_vec()),
            ("200 OK", "", vec![0xff]),
            ("200 OK", "", b"<html>sign in</html>".to_vec()),
            ("200 OK", "", b"[]".to_vec()),
        ] {
            assert!(fixture(status, headers, body).await.0.is_err());
        }
    }

    #[tokio::test]
    async fn bounds_declared_and_streamed_response_bodies() {
        assert!(fixture("200 OK", "Content-Length: 2097153\r\n", Vec::new())
            .await
            .0
            .unwrap_err()
            .contains("2 MiB"));
        assert!(fixture("200 OK", "", vec![b' '; MAX_CATALOG_BYTES + 1])
            .await
            .0
            .unwrap_err()
            .contains("2 MiB"));
    }
}
