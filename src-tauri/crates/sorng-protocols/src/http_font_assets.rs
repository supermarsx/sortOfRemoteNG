//! A closed set of reviewed public font files, never a general URL proxy.
//! The independent client has verified TLS and no source cookies/credentials.
use super::AxumProxyState;
use axum::body::Body;
use axum::http::{Method, Response, StatusCode};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

pub(super) const PREFIX: &str = "/__sortofremoteng_assets_v1/synology-inter/";
const UPSTREAM: &str = "https://synostatic.synology.com/font/inter/";
pub(super) const MAX_BYTES: usize = 512 * 1024;

pub(super) struct ReviewedFontAssets {
    client: reqwest::Client,
    downloads: Semaphore,
    requests: Semaphore,
}

impl ReviewedFontAssets {
    pub(super) fn new(proxy: Option<reqwest::Proxy>, min_tls: &str) -> Result<Self, String> {
        let roots = super::native_root_store()
            .map_err(|_| "Unable to load trusted roots for public font resources".to_string())?;
        if roots.is_empty() {
            return Err("Trusted roots are unavailable for public font resources".into());
        }
        let versions = if min_tls.trim() == "1.3" {
            vec![&rustls::version::TLS13]
        } else {
            vec![&rustls::version::TLS13, &rustls::version::TLS12]
        };
        let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_protocol_versions(&versions)
        .map_err(|_| "Unable to configure verified font TLS".to_string())?
        .with_root_certificates(roots)
        .with_no_client_auth();
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .use_preconfigured_tls(tls)
            .cookie_store(false)
            .referer(false)
            .redirect(reqwest::redirect::Policy::none())
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(15))
            .pool_max_idle_per_host(4);
        if let Some(proxy) = proxy {
            builder = builder.proxy(proxy);
        }
        let client = builder
            .build()
            .map_err(|_| "Unable to create verified public font route".to_string())?;
        Ok(Self::from_client(client))
    }

    fn from_client(client: reqwest::Client) -> Self {
        Self {
            client,
            downloads: Semaphore::new(4),
            // All 28 subsets may be requested together. Keep their queue
            // bounded as well as the number of simultaneous upstream reads.
            requests: Semaphore::new(32),
        }
    }

    #[cfg(test)]
    pub(super) fn fixture(client: reqwest::Client) -> Self {
        Self::from_client(client)
    }

    pub(super) fn revoke(&self) {
        self.requests.close();
        self.downloads.close();
    }
}

fn names() -> impl Iterator<Item = String> {
    [400, 500, 600, 700]
        .into_iter()
        .flat_map(|weight| (1..=7).map(move |subset| format!("inter-w{weight}-{subset}.woff2")))
}

fn known_name(value: &str) -> bool {
    value.len() == 18 && names().any(|name| name == value)
}

pub(super) fn manifest(proxy_origin: &str) -> Vec<serde_json::Value> {
    names()
        .map(|name| {
            serde_json::json!({
                "upstreamUrl": format!("{UPSTREAM}{name}"),
                "proxyUrl": format!("{proxy_origin}{PREFIX}{name}")
            })
        })
        .collect()
}

/// Rewrite only a complete exact URL. Query/fragment, alternate schemes,
/// encoded names and additional path characters never acquire a capability.
pub(super) fn rewrite(text: &str, proxy_origin: &str) -> String {
    if !text.contains(UPSTREAM) {
        return text.to_string();
    }
    let mut output = text.to_string();
    for name in names() {
        let upstream = format!("{UPSTREAM}{name}");
        if !output.contains(&upstream) {
            continue;
        }
        let replacement = format!("{proxy_origin}{PREFIX}{name}");
        let mut result = String::with_capacity(output.len());
        let mut copied = 0;
        for (start, _) in output.match_indices(&upstream) {
            let end = start + upstream.len();
            let valid_before = output[..start].chars().next_back().is_none_or(|c| {
                c.is_ascii_whitespace() || matches!(c, '\'' | '"' | '`' | '(' | '=' | '>')
            });
            let valid_after = output[end..].chars().next().is_none_or(|c| {
                c.is_ascii_whitespace() || matches!(c, '\'' | '"' | '`' | ')' | '<')
            });
            if !valid_before || !valid_after {
                continue;
            }
            result.push_str(&output[copied..start]);
            result.push_str(&replacement);
            copied = end;
        }
        result.push_str(&output[copied..]);
        output = result;
    }
    output
}

fn refusal(status: StatusCode, message: &'static str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from(message))
        .expect("static font refusal")
}

fn valid_woff2(bytes: &[u8]) -> bool {
    if bytes.len() < 48 || bytes.len() > MAX_BYTES || &bytes[..4] != b"wOF2" {
        return false;
    }
    let read_u32 = |offset| u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap());
    let flavor = read_u32(4);
    let tables = u16::from_be_bytes([bytes[12], bytes[13]]);
    // OpenType/TrueType only; no collections or unbounded declared expansion.
    matches!(flavor, 0x0001_0000 | 0x4f54_544f)
        && read_u32(8) as usize == bytes.len()
        && (1..=256).contains(&tables)
        && bytes[14..16] == [0, 0]
        && (12..=16 * 1024 * 1024).contains(&read_u32(16))
        && read_u32(20) > 0
        && read_u32(20) as usize <= bytes.len() - 48
}

async fn download(assets: &ReviewedFontAssets, name: &str) -> Result<Vec<u8>, &'static str> {
    let _download = assets
        .downloads
        .acquire()
        .await
        .map_err(|_| "The public font route has ended.")?;
    // No request headers, URL values or bodies are inherited from the NAS.
    let mut response = assets
        .client
        .get(format!("{UPSTREAM}{name}"))
        .header(
            "Accept",
            "font/woff2,application/font-woff2,application/octet-stream,binary/octet-stream",
        )
        .header("Accept-Encoding", "identity")
        .send()
        .await
        .map_err(|_| {
            "The verified public font request failed; no alternate route was attempted."
        })?;
    if response.status() != reqwest::StatusCode::OK {
        return Err("The public font server returned an unsupported response.");
    }
    let headers = response.headers();
    let mime = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .map(str::trim);
    if headers.get_all("content-type").iter().count() != 1
        || !mime.is_some_and(|mime| {
            [
                "font/woff2",
                "application/font-woff2",
                "application/octet-stream",
                "binary/octet-stream",
            ]
            .iter()
            .any(|allowed| mime.eq_ignore_ascii_case(allowed))
        })
        || headers
            .get("content-encoding")
            .is_some_and(|v| v.as_bytes() != b"identity")
        || response
            .content_length()
            .is_some_and(|length| length > MAX_BYTES as u64)
    {
        return Err("The public font response has an unsupported type or size.");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The public font response was incomplete.")?
    {
        if chunk.len() > MAX_BYTES - bytes.len() {
            return Err("The public font exceeds the permitted size.");
        }
        bytes.extend_from_slice(&chunk);
    }
    if !valid_woff2(&bytes) {
        return Err("The public font response is not a supported WOFF2 file.");
    }
    Ok(bytes)
}

pub(super) async fn handle(
    state: Arc<AxumProxyState>,
    request: axum::extract::Request,
) -> Response<Body> {
    let headers = request.headers();
    if !super::proxy_request_headers_are_authorized(
        headers,
        &state.proxy_authority,
        &state.proxy_origin,
    ) || headers.get_all("host").iter().count() != 1
        || headers.get_all("origin").iter().count() > 1
        || headers
            .get("origin")
            .is_some_and(|value| value.to_str().ok() != Some(state.proxy_origin.as_str()))
        || headers
            .get("sec-fetch-site")
            .is_some_and(|v| v.as_bytes() == b"cross-site")
    {
        return refusal(
            StatusCode::FORBIDDEN,
            "The public font request is not authorized.",
        );
    }
    let Some(name) = request
        .uri()
        .path()
        .strip_prefix(PREFIX)
        .filter(|name| known_name(name))
    else {
        return refusal(StatusCode::NOT_FOUND, "Unknown reviewed public font.");
    };
    if request.method() != Method::GET
        || request.uri().query().is_some()
        || headers.contains_key("upgrade")
        || headers.contains_key("sec-websocket-key")
        || headers.contains_key("transfer-encoding")
        || headers
            .get("content-length")
            .is_some_and(|v| v.as_bytes() != b"0")
        || headers
            .get("sec-fetch-dest")
            .is_some_and(|v| !matches!(v.as_bytes(), b"font" | b"empty"))
    {
        return refusal(
            StatusCode::BAD_REQUEST,
            "Only reviewed public font GET requests are supported.",
        );
    }
    let name = name.to_string();
    if !axum::body::to_bytes(request.into_body(), 0)
        .await
        .is_ok_and(|bytes| bytes.is_empty())
    {
        return refusal(
            StatusCode::BAD_REQUEST,
            "Public font requests cannot carry a body.",
        );
    }
    let Some(assets) = state.network.font_assets.as_ref() else {
        return refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "The verified public font route is unavailable.",
        );
    };
    let Ok(_request) = assets.requests.try_acquire() else {
        return refusal(
            StatusCode::TOO_MANY_REQUESTS,
            "The public font request limit was reached.",
        );
    };
    match state
        .network
        .while_active(tokio::time::timeout(
            Duration::from_secs(30),
            download(assets, &name),
        ))
        .await
    {
        Ok(Ok(Ok(bytes))) => Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "font/woff2")
            .header("Content-Length", bytes.len())
            .header("X-Content-Type-Options", "nosniff")
            .header("Cache-Control", "no-store")
            .header("Cross-Origin-Resource-Policy", "same-origin")
            .body(Body::from(bytes))
            .expect("validated font response"),
        Ok(Ok(Err(message))) => refusal(StatusCode::BAD_GATEWAY, message),
        Ok(Err(_)) => refusal(
            StatusCode::GATEWAY_TIMEOUT,
            "The public font request timed out.",
        ),
        Err(_) => refusal(StatusCode::GONE, "This proxy session has ended."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn font_downloads_and_pending_requests_have_independent_hard_limits() {
        let assets = ReviewedFontAssets::fixture(reqwest::Client::new());
        let downloads = assets.downloads.try_acquire_many(4).unwrap();
        assert!(assets.downloads.try_acquire().is_err());
        let requests = assets.requests.try_acquire_many(32).unwrap();
        assert!(assets.requests.try_acquire().is_err());
        drop(downloads);
        drop(requests);
        assets.revoke();
        assert!(assets.downloads.try_acquire().is_err());
        assert!(assets.requests.try_acquire().is_err());
    }
}
