//! Bounded native HTTP/TLS, registration and egress diagnostics. Never renders
//! HTML, executes scripts, accesses credentials, or shares browser cookie jars.
use super::types::ToolkitRequest;
use reqwest::{
    header::{HeaderMap, LOCATION},
    redirect::Policy,
    Client, Method, Url,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    net::{IpAddr, SocketAddr},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
use x509_parser::extensions::GeneralName;

const MAX_BODY: usize = 1024 * 1024;
const MAX_WHOIS: usize = 256 * 1024;
const MAX_URL: usize = 4096;

fn url(value: &str, require_https: bool) -> Result<Url, String> {
    if value.is_empty()
        || value.len() > MAX_URL
        || value.chars().any(|c| c.is_control() || c.is_whitespace())
        || value.contains('\\')
    {
        return Err(
            "Enter a bounded HTTP(S) URL without whitespace, control characters or backslashes."
                .into(),
        );
    }
    let full = if value.contains("://") {
        value.to_owned()
    } else {
        format!("https://{value}")
    };
    // Reject even empty userinfo that a URL normalizer might discard.
    if full.split_once("://").is_some_and(|(_, rest)| {
        rest.split(['/', '?', '#'])
            .next()
            .unwrap_or("")
            .contains('@')
    }) {
        return Err("Credentials in URLs are not permitted.".into());
    }
    let mut parsed = Url::parse(&full).map_err(|_| "Invalid diagnostic URL")?;
    if !matches!(parsed.scheme(), "http" | "https")
        || (require_https && parsed.scheme() != "https")
        || parsed.host_str().is_none()
        || parsed.port() == Some(0)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only credential-free HTTP(S) URLs are supported; TLS requires HTTPS.".into());
    }
    parsed.set_fragment(None);
    Ok(parsed)
}

fn proxy(value: &str) -> Result<reqwest::Proxy, String> {
    if value.starts_with("socks") {
        // sorng-network's declared reqwest feature set has no socks feature.
        // Never silently use direct routing if a feature is unavailable.
        return Err(
            "SOCKS proxies are not enabled in this diagnostic build; choose HTTP/HTTPS explicitly."
                .into(),
        );
    }
    if !value.starts_with("http://") && !value.starts_with("https://") {
        return Err("Proxy URL must explicitly use http:// or https://.".into());
    }
    let parsed = url(value, false)?;
    if parsed.path() != "/" || parsed.query().is_some() || value.contains('#') {
        return Err("Proxy URL must not contain a path, query, or fragment.".into());
    }
    reqwest::Proxy::all(parsed).map_err(|_| "Invalid HTTP(S) proxy endpoint".into())
}

fn client(request: &ToolkitRequest) -> Result<Client, String> {
    let timeout = Duration::from_millis(request.timeout_ms.clamp(1, 60_000));
    let mut builder = Client::builder()
        .no_proxy() // Explicitly ignore HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY.
        .redirect(Policy::none())
        .referer(false)
        .use_rustls_tls()
        .tls_info(true)
        .pool_max_idle_per_host(0)
        .connect_timeout(timeout.min(Duration::from_secs(10)))
        .timeout(timeout)
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .user_agent("sortOfRemoteNG-NetworkToolkit/1");
    // Cookie storage is absent by default, including when another crate enables
    // reqwest's cookies feature. No cookie provider/default auth headers are set.
    match request.route.as_str() {
        "direct" if request.proxy_url.as_deref().is_none_or(|v| v.is_empty()) => {}
        "httpProxy" => {
            builder = builder.proxy(proxy(
                request
                    .proxy_url
                    .as_deref()
                    .ok_or("Choose an explicit proxy endpoint")?,
            )?)
        }
        _ => return Err("Invalid/ambiguous route; no direct fallback was attempted.".into()),
    }
    builder
        .build()
        .map_err(|_| "Could not initialize the selected route/TLS client".into())
}

fn request_error(error: &reqwest::Error) -> String {
    // reqwest's Display includes the URL. Avoid echoing arbitrary query secrets
    // or raw TLS/proxy error data into logs/UI, even though userinfo is rejected.
    if error.is_timeout() {
        "HTTP/TLS request timed out"
    } else if error.is_connect() {
        "Connection, proxy, or TLS verification failed; no direct/insecure fallback was attempted"
    } else if error.is_body() || error.is_decode() {
        "HTTP response body could not be read"
    } else {
        "HTTP request failed on the selected route"
    }
    .into()
}

fn displayed_headers(headers: &HeaderMap) -> (Vec<Value>, bool) {
    let mut output = Vec::new();
    let mut used = 0usize;
    let mut truncated = false;
    for (key, value) in headers.iter() {
        if output.len() >= 128 || used + key.as_str().len() + value.as_bytes().len() > 64 * 1024 {
            truncated = true;
            break;
        }
        used += key.as_str().len() + value.as_bytes().len();
        let text = if matches!(
            key.as_str(),
            "set-cookie" | "set-cookie2" | "authorization" | "proxy-authorization"
        ) {
            "[redacted]".to_owned()
        } else {
            String::from_utf8_lossy(value.as_bytes())
                .chars()
                .take(8192)
                .collect()
        };
        if value.as_bytes().len() > 8192 {
            truncated = true;
        }
        output.push(json!({"name": key.as_str(), "value": text}));
    }
    (output, truncated)
}

fn certificate(der: &[u8]) -> Result<Value, String> {
    if der.is_empty() || der.len() > 64 * 1024 {
        return Err("Peer certificate exceeds analysis bounds".into());
    }
    let (rest, parsed) = x509_parser::parse_x509_certificate(der)
        .map_err(|_| "Peer leaf certificate could not be parsed")?;
    if !rest.is_empty() {
        return Err("Trailing data in peer certificate".into());
    }
    let mut names = Vec::new();
    let mut names_truncated = false;
    if let Some(extension) = parsed
        .subject_alternative_name()
        .map_err(|_| "Malformed certificate subject alternatives")?
    {
        for item in &extension.value.general_names {
            if names.len() >= 128 {
                names_truncated = true;
                break;
            }
            match item {
                GeneralName::DNSName(name) => names.push(json!({"type": "DNS", "value": name.chars().take(253).collect::<String>()})),
                GeneralName::IPAddress(bytes) if bytes.len() == 4 => names.push(json!({"type": "IP", "value": std::net::Ipv4Addr::new(bytes[0], bytes[1], bytes[2], bytes[3]).to_string()})),
                GeneralName::IPAddress(bytes) if bytes.len() == 16 => {
                    let mut octets = [0; 16]; octets.copy_from_slice(bytes);
                    names.push(json!({"type": "IP", "value": std::net::Ipv6Addr::from(octets).to_string()}));
                }
                _ => {}
            }
        }
    }
    Ok(json!({"sha256": format!("{:x}", Sha256::digest(der)),
        "subject": parsed.subject().to_string().chars().take(2048).collect::<String>(),
        "issuer": parsed.issuer().to_string().chars().take(2048).collect::<String>(),
        "serial": parsed.raw_serial_as_string(), "notBeforeUnix": parsed.validity().not_before.timestamp(),
        "notAfterUnix": parsed.validity().not_after.timestamp(), "currentlyWithinValidityDates": parsed.validity().is_valid(),
        "signatureAlgorithmOid": parsed.signature_algorithm.algorithm.to_id_string(),
        "publicKeyAlgorithmOid": parsed.public_key().algorithm.algorithm.to_id_string(),
        "subjectAlternativeNames": names, "namesTruncated": names_truncated}))
}

struct Exchange {
    report: Value,
    body: Vec<u8>,
    status: u16,
}

async fn http(
    request: &ToolkitRequest,
    initial: Url,
    method: Method,
    max_bytes: usize,
    follow_redirects: bool,
) -> Result<Exchange, String> {
    let client = client(request)?;
    let max_redirects = request.number("maxRedirects", 5, 0, 5)? as usize;
    let start = Instant::now();
    let work = async {
        let mut current = initial;
        let mut hops = Vec::new();
        loop {
            let hop_start = Instant::now();
            // SAME immutable client/proxy selection for every hop, including a
            // host/scheme change. There is no secondary direct client.
            let mut response = client
                .request(method.clone(), current.clone())
                .send()
                .await
                .map_err(|e| request_error(&e))?;
            let status = response.status();
            let (headers, headers_truncated) = displayed_headers(response.headers());
            let tls = if current.scheme() == "https" {
                response
                    .extensions()
                    .get::<reqwest::tls::TlsInfo>()
                    .and_then(|info| info.peer_certificate())
                    .map(certificate)
                    .transpose()?
            } else {
                None
            };
            hops.push(json!({"url": current.as_str(), "status": status.as_u16(), "headersMs": hop_start.elapsed().as_millis() as u64,
                "headers": headers, "headersTruncated": headers_truncated, "certificate": tls,
                "normalTlsTrustVerified": current.scheme() == "https"}));
            if follow_redirects && matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308) {
                if hops.len() > max_redirects {
                    return Err(
                        "HTTP redirect limit exceeded (maximum 5); no extra request sent".into(),
                    );
                }
                let locations = response.headers().get_all(LOCATION);
                let mut locations = locations.iter();
                let location = locations
                    .next()
                    .ok_or("Redirect has no Location header")?
                    .to_str()
                    .map_err(|_| "Invalid redirect Location")?;
                if locations.next().is_some() {
                    return Err("Ambiguous duplicate redirect Location".into());
                }
                if location.len() > MAX_URL
                    || location
                        .chars()
                        .any(|c| c.is_control() || c.is_whitespace())
                    || location.contains('\\')
                {
                    return Err("Unsafe redirect Location".into());
                }
                // Validate raw absolute userinfo before URL normalization.
                if location.contains("://") {
                    url(location, false)?;
                } else if location.starts_with("//") {
                    url(&format!("{}:{location}", current.scheme()), false)?;
                }
                let joined = current
                    .join(location)
                    .map_err(|_| "Invalid redirect target")?;
                let next = url(joined.as_str(), false)?;
                if current.scheme() == "https" && next.scheme() != "https" {
                    return Err("HTTPS-to-HTTP redirect refused".into());
                }
                current = next;
                // Drop intermediate body without buffering/reading unbounded
                // data. No cookies, auth or Referer are forwarded.
                drop(response);
                continue;
            }
            let mut body = Vec::new();
            if method != Method::HEAD {
                if response
                    .content_length()
                    .is_some_and(|count| count > max_bytes as u64)
                {
                    return Err("HTTP body exceeds the configured limit (at most 1 MiB)".into());
                }
                while let Some(chunk) = response.chunk().await.map_err(|e| request_error(&e))? {
                    if chunk.len() > max_bytes.saturating_sub(body.len()) {
                        return Err("HTTP body exceeds the configured limit (at most 1 MiB)".into());
                    }
                    body.extend_from_slice(&chunk);
                }
            }
            return Ok(Exchange {
                report: json!({"url": current.as_str(), "method": method.as_str(), "status": status.as_u16(),
                "route": request.route, "redirectsFollowed": hops.len() - 1, "hops": hops,
                "bodyBytes": body.len(), "durationMs": start.elapsed().as_millis() as u64,
                "limits": {"maxBodyBytes": max_bytes, "maxRedirects": max_redirects, "cookiesStored": false,
                    "scriptsExecuted": false, "subresourcesFetched": false, "compressedResponsesDecoded": false}}),
                body,
                status: status.as_u16(),
            });
        }
    };
    tokio::time::timeout(
        Duration::from_millis(request.timeout_ms.clamp(1, 60_000)),
        work,
    )
    .await
    .map_err(|_| "HTTP redirect/body operation exceeded its total timeout".to_string())?
}

fn bool_option(request: &ToolkitRequest, key: &str, default: bool) -> Result<bool, String> {
    match request.option(key) {
        None => Ok(default),
        Some("true") => Ok(true),
        Some("false") => Ok(false),
        _ => Err(format!("{key} must be true or false")),
    }
}

fn whois_server(value: &str) -> Result<String, String> {
    if value.starts_with("whois://") {
        let parsed = Url::parse(value).map_err(|_| "Invalid WHOIS referral")?;
        if !parsed.username().is_empty()
            || parsed.password().is_some()
            || value.contains('@')
            || !matches!(parsed.path(), "" | "/")
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || parsed.port().is_some_and(|p| p != 43)
        {
            return Err("WHOIS referrals must be credential-free hosts on port 43".into());
        }
        let host = parsed
            .host_str()
            .ok_or("WHOIS referral has no host")?
            .trim_matches(['[', ']']);
        super::validate_host(host)?;
        Ok(host.to_string())
    } else {
        super::validate_host(value)?;
        Ok(value.to_ascii_lowercase())
    }
}

fn referral(text: &str) -> Result<Option<String>, String> {
    let mut found: Option<String> = None;
    for line in text.lines().take(8192) {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if !matches!(
            key.trim().to_ascii_lowercase().as_str(),
            "refer" | "whois" | "whois server" | "registrar whois server" | "referralserver"
        ) {
            continue;
        }
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let candidate = whois_server(value)?;
        if found.as_ref().is_some_and(|prior| prior != &candidate) {
            return Err("WHOIS reply contains conflicting referrals; no referral followed".into());
        }
        found = Some(candidate);
    }
    Ok(found)
}

async fn whois_exchange(
    addresses: &[SocketAddr],
    target: &str,
    max: usize,
) -> Result<String, String> {
    super::validate_host(target)?; // CR/LF, command switches and URLs are forbidden.
    let mut stream = TcpStream::connect(addresses)
        .await
        .map_err(|_| "WHOIS TCP connection failed")?;
    stream
        .write_all(format!("{target}\r\n").as_bytes())
        .await
        .map_err(|_| "WHOIS query could not be sent")?;
    let mut reply = Vec::new();
    stream
        .take((max + 1) as u64)
        .read_to_end(&mut reply)
        .await
        .map_err(|_| "WHOIS response could not be read")?;
    if reply.len() > max {
        return Err("WHOIS reply exceeds the 256 KiB limit".into());
    }
    Ok(String::from_utf8_lossy(&reply).into_owned())
}

async fn whois(request: &ToolkitRequest) -> Result<Value, String> {
    if request.route != "direct" || request.proxy_url.as_deref().is_some_and(|v| !v.is_empty()) {
        return Err(
            "WHOIS port 43 requires an explicit direct route; no proxy bypass was attempted".into(),
        );
    }
    super::validate_host(&request.target)?;
    let initial = whois_server(request.option("server").unwrap_or("whois.iana.org"))?;
    let follow = bool_option(request, "followReferral", true)?;
    let work = async {
        let mut server = initial;
        let mut replies = Vec::new();
        let mut warning = None;
        for index in 0..2 {
            let addresses = super::resolve(&server, 43).await?;
            let text = whois_exchange(&addresses, &request.target, MAX_WHOIS).await?;
            let next = if follow && index == 0 {
                match referral(&text) {
                    Ok(next) => next,
                    Err(error) => {
                        warning = Some(error);
                        None
                    }
                }
            } else {
                None
            };
            replies.push(json!({"server": server, "port": 43, "text": text}));
            if let Some(next) = next.filter(|next| next != &server) {
                server = next;
            } else {
                break;
            }
        }
        Ok(
            json!({"query": request.target, "replies": replies, "referralWarning": warning,
            "scope": "Unencrypted WHOIS on port 43; at most one validated referral. Registration text is provider-supplied, not proof of ownership or security."}),
        )
    };
    tokio::time::timeout(
        Duration::from_millis(request.timeout_ms.clamp(1, 60_000)),
        work,
    )
    .await
    .map_err(|_| "WHOIS operation exceeded its total timeout".to_string())?
}

fn rdap_url(request: &ToolkitRequest) -> Result<Url, String> {
    super::validate_host(&request.target)?;
    let mut endpoint = url(
        request.option("endpoint").unwrap_or("https://rdap.org"),
        false,
    )?;
    if endpoint.query().is_some() {
        return Err("RDAP endpoint must be a base URL without query parameters".into());
    }
    endpoint
        .path_segments_mut()
        .map_err(|_| "RDAP endpoint does not support path segments")?
        .pop_if_empty()
        .push(if request.target.parse::<IpAddr>().is_ok() {
            "ip"
        } else {
            "domain"
        })
        .push(&request.target);
    Ok(endpoint)
}

fn tls_url(request: &ToolkitRequest) -> Result<Url, String> {
    let target = if matches!(request.target.parse::<IpAddr>(), Ok(IpAddr::V6(_))) {
        format!("https://[{}]", request.target)
    } else {
        request.target.clone()
    };
    let mut endpoint = url(&target, true)?;
    if request.option("port").is_some() {
        let port = request.number("port", 443, 1, 65535)? as u16;
        if endpoint.port().is_some_and(|existing| existing != port) {
            return Err("TLS URL port conflicts with the selected port option".into());
        }
        endpoint
            .set_port(Some(port))
            .map_err(|_| "Invalid TLS port")?;
    }
    Ok(endpoint)
}

pub async fn run(request: &ToolkitRequest) -> Result<Value, String> {
    if request.tool == "whois" {
        return whois(request).await;
    }
    let max = request.number("maxBytes", MAX_BODY as u64, 1, MAX_BODY as u64)? as usize;
    match request.tool.as_str() {
        "rdap" => {
            let endpoint = rdap_url(request)?;
            let exchange = http(request, endpoint, Method::GET, max, true).await?;
            if !(200..300).contains(&exchange.status) {
                return Err(format!("RDAP provider returned HTTP {}", exchange.status));
            }
            let data: Value = serde_json::from_slice(&exchange.body)
                .map_err(|_| "RDAP provider did not return bounded valid JSON")?;
            Ok(json!({"http": exchange.report, "registration": data,
                "providerWarning": if request.option("endpoint").is_some() { "The configured RDAP provider receives this query; responses are provider-supplied." }
                    else { "Default provider rdap.org receives the query and may redirect to a registry. This is third-party registration data, not an ownership/security attestation." }}))
        }
        "publicIp" => {
            let endpoint = url(
                request
                    .option("endpoint")
                    .unwrap_or("https://api.ipify.org?format=json"),
                false,
            )?;
            let exchange = http(request, endpoint, Method::GET, max.min(16 * 1024), true).await?;
            if !(200..300).contains(&exchange.status) {
                return Err(format!(
                    "Public-IP provider returned HTTP {}",
                    exchange.status
                ));
            }
            let plain = std::str::from_utf8(&exchange.body)
                .map_err(|_| "Public-IP provider returned invalid text")?;
            let structured: Option<Value> = serde_json::from_str(plain).ok();
            let ip = structured
                .as_ref()
                .and_then(|v| v.get("ip"))
                .and_then(Value::as_str)
                .unwrap_or(plain.trim())
                .parse::<IpAddr>()
                .map_err(|_| "Provider response contains no valid single IP address")?;
            Ok(json!({"ip": ip.to_string(), "http": exchange.report,
                "providerWarning": if request.option("endpoint").is_some() { "The configured provider reports the egress address it sees through the selected route; this is not a DNS/proxy leak audit." }
                    else { "Third-party provider api.ipify.org reports the egress address it sees through the selected route; this is not a DNS/proxy leak audit." }}))
        }
        "tls" => {
            let exchange = http(request, tls_url(request)?, Method::HEAD, max, false).await?;
            if exchange.report["hops"][0]["certificate"].is_null() {
                return Err(
                    "HTTPS succeeded but peer leaf certificate information was unavailable".into(),
                );
            }
            Ok(
                json!({"http": exchange.report, "scope": "HTTPS HEAD with normal native-root/hostname trust verification. Leaf certificate only; redirects are not followed. No exhaustive protocol/cipher scan, revocation/CT audit, chain enumeration, or security-grade claim."}),
            )
        }
        "http" | "website" => {
            let method = match request.option("method").unwrap_or("GET") {
                "GET" => Method::GET,
                "HEAD" => Method::HEAD,
                _ => return Err("Only GET and HEAD diagnostics are permitted".into()),
            };
            let mut exchange =
                http(request, url(&request.target, false)?, method, max, true).await?;
            exchange.report["bodyText"] = json!(String::from_utf8_lossy(&exchange.body));
            exchange.report["scope"] = json!("HTTP response bytes displayed as untrusted text only. No JavaScript/rendering, links/subresources, credentials or browser cookies; not a full website/security audit. Compressed bytes are not decoded.");
            Ok(exchange.report)
        }
        _ => Err("Unknown web diagnostic".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{io::AsyncBufReadExt, net::TcpListener};

    fn request(tool: &str, target: String) -> ToolkitRequest {
        ToolkitRequest {
            job_id: "web-fixture".into(),
            tool: tool.into(),
            target,
            timeout_ms: 3000,
            route: "direct".into(),
            proxy_url: None,
            options: Default::default(),
        }
    }
    async fn read_request(stream: &mut TcpStream) -> String {
        let mut bytes = Vec::new();
        tokio::time::timeout(Duration::from_secs(2), async {
            while bytes.len() < 8192 && !bytes.ends_with(b"\r\n\r\n") {
                bytes.push(stream.read_u8().await.unwrap());
            }
        })
        .await
        .unwrap();
        String::from_utf8(bytes).unwrap()
    }
    async fn server(response: &'static [u8]) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request = read_request(&mut stream).await;
            stream.write_all(response).await.unwrap();
            request
        });
        (format!("http://{address}/"), task)
    }

    #[test]
    fn url_and_proxy_inputs_fail_closed() {
        for value in [
            "",
            "http://user:secret@host/",
            "http://@host/",
            "http://host\\@evil/",
            "file:///tmp/test",
            "javascript://host",
            "http://host:0",
            "http://host\r\nX-Evil:1",
            "http://a b/",
        ] {
            assert!(url(value, false).is_err(), "{value}");
        }
        assert!(url("http://localhost", true).is_err());
        assert_eq!(url("example.test", true).unwrap().scheme(), "https");
        for value in [
            "socks5://localhost:1234",
            "http://user:secret@host",
            "http://host/path",
            "http://host/?x=1",
            "http://host/#fragment",
            "host:8080",
        ] {
            assert!(proxy(value).is_err(), "{value}");
        }
        assert!(proxy("https://localhost:8080").is_ok());
    }
    #[test]
    fn header_redaction_and_display_bounds() {
        let mut headers = HeaderMap::new();
        headers.insert("set-cookie", "session=secret; HttpOnly".parse().unwrap());
        headers.insert("server", "fixture".parse().unwrap());
        let (values, truncated) = displayed_headers(&headers);
        assert!(!truncated);
        assert!(values
            .iter()
            .any(|v| v["name"] == "set-cookie" && v["value"] == "[redacted]"));
        assert!(!serde_json::to_string(&values)
            .unwrap()
            .contains("session=secret"));
        for _ in 0..130 {
            headers.append("x-many", "fixture".parse().unwrap());
        }
        let (values, truncated) = displayed_headers(&headers);
        assert!(truncated);
        assert!(values.len() <= 128);
    }
    #[test]
    fn certificate_parser_bounds_and_malformed_input() {
        for bytes in [
            vec![],
            vec![0; 64 * 1024 + 1],
            vec![0x30, 0xff, 0x01],
            vec![0; 512],
        ] {
            assert!(certificate(&bytes).is_err());
        }
    }
    #[test]
    fn whois_referrals_are_bounded_hostnames_not_commands() {
        assert_eq!(
            referral("refer: whois.example.test\nwhois: whois.example.test\n")
                .unwrap()
                .unwrap(),
            "whois.example.test"
        );
        assert_eq!(
            referral("ReferralServer: whois://whois.example.test:43\n")
                .unwrap()
                .unwrap(),
            "whois.example.test"
        );
        for text in [
            "refer: -x",
            "refer: host;cmd",
            "refer: whois://user:pass@host",
            "refer: whois://host:80",
            "refer: https://host",
            "refer: host/path",
            "refer: first.test\nwhois: second.test",
        ] {
            assert!(referral(text).is_err(), "{text}");
        }
        assert!(referral("Some text with no referral").unwrap().is_none());
    }
    #[test]
    fn rdap_url_uses_safe_path_segments_and_explicit_endpoint() {
        let mut req = request("rdap", "2001:db8::1".into());
        req.options
            .insert("endpoint".into(), "http://127.0.0.1:8000/api/".into());
        assert_eq!(
            rdap_url(&req).unwrap().as_str(),
            "http://127.0.0.1:8000/api/ip/2001:db8::1"
        );
        req.target = "example.test".into();
        assert!(rdap_url(&req)
            .unwrap()
            .path()
            .ends_with("/domain/example.test"));
        req.target = "../../private".into();
        assert!(rdap_url(&req).is_err());
        let mut tls = request("tls", "::1".into());
        tls.options.insert("port".into(), "8443".into());
        assert_eq!(tls_url(&tls).unwrap().as_str(), "https://[::1]:8443/");
        tls.target = "https://localhost:9443".into();
        assert!(tls_url(&tls).is_err());
    }
    #[tokio::test]
    async fn get_loopback_reports_bytes_headers_and_never_executes_html() {
        let (url, task) = server(b"HTTP/1.1 200 OK\r\nContent-Length: 25\r\nSet-Cookie: session=secret\r\nConnection: close\r\n\r\n<script>alert(1)</script>").await;
        let result = run(&request("website", url)).await.unwrap();
        let sent = task.await.unwrap();
        assert!(sent.starts_with("GET / HTTP/1.1"));
        assert_eq!(result["bodyText"], "<script>alert(1)</script>");
        assert_eq!(result["limits"]["scriptsExecuted"], false);
        let (url, task) = server(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nSet-Cookie: session=secret\r\nConnection: close\r\n\r\nok").await;
        let report = run(&request("http", url)).await.unwrap();
        task.await.unwrap();
        assert_eq!(report["bodyText"], "ok");
        assert_eq!(report["bodyBytes"], 2);
        assert_eq!(report["limits"]["scriptsExecuted"], false);
        assert!(!report.to_string().contains("session=secret"));
    }
    #[tokio::test]
    async fn head_and_disallowed_methods() {
        let (url, task) =
            server(b"HTTP/1.1 200 OK\r\nContent-Length: 999999999\r\nConnection: close\r\n\r\n")
                .await;
        let mut req = request("http", url);
        req.options.insert("method".into(), "HEAD".into());
        assert_eq!(run(&req).await.unwrap()["bodyBytes"], 0);
        assert!(task.await.unwrap().starts_with("HEAD "));
        req.options.insert("method".into(), "POST".into());
        assert!(run(&req).await.unwrap_err().contains("GET and HEAD"));
    }
    #[tokio::test]
    async fn redirects_use_same_proxy_and_never_forward_response_cookies() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let mut requests = Vec::new();
            for response in [b"HTTP/1.1 302 Found\r\nLocation: http://second.invalid/final\r\nSet-Cookie: private=secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".as_slice(),
                b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".as_slice()] {
                let (mut stream, _) = listener.accept().await.unwrap(); requests.push(read_request(&mut stream).await); stream.write_all(response).await.unwrap();
            }
            requests
        });
        let mut req = request("http", "http://first.invalid/start".into());
        req.route = "httpProxy".into();
        req.proxy_url = Some(format!("http://{address}"));
        let report = run(&req).await.unwrap();
        let requests = task.await.unwrap();
        assert!(requests[0].starts_with("GET http://first.invalid/start HTTP/1.1"));
        assert!(requests[1].starts_with("GET http://second.invalid/final HTTP/1.1"));
        assert!(requests
            .iter()
            .all(|r| !r.to_ascii_lowercase().contains("cookie:")
                && !r.to_ascii_lowercase().contains("authorization:")
                && !r.to_ascii_lowercase().contains("referer:")));
        assert_eq!(report["redirectsFollowed"], 1);
    }
    #[tokio::test]
    async fn failed_selected_proxy_does_not_contact_direct_target() {
        let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy_port = proxy_listener.local_addr().unwrap();
        drop(proxy_listener);
        let mut req = request(
            "http",
            format!("http://{}/", destination.local_addr().unwrap()),
        );
        req.route = "httpProxy".into();
        req.proxy_url = Some(format!("http://{proxy_port}"));
        assert!(run(&req).await.is_err());
        assert!(
            tokio::time::timeout(Duration::from_millis(50), destination.accept())
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn body_limits_enforced_for_content_length_and_chunked_responses() {
        for response in [b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello".as_slice(),
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\nhello\r\n0\r\n\r\n".as_slice()] {
            let (url, task) = server(response).await; let mut req = request("http", url); req.options.insert("maxBytes".into(), "4".into());
            assert!(run(&req).await.unwrap_err().contains("limit")); task.await.unwrap();
        }
    }
    #[tokio::test]
    async fn unsafe_or_excess_redirect_is_rejected_before_next_request() {
        for response in [b"HTTP/1.1 302 Found\r\nLocation: http://user:secret@other.invalid/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".as_slice(),
            b"HTTP/1.1 302 Found\r\nLocation: file:///private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".as_slice(),
            b"HTTP/1.1 302 Found\r\nLocation: /again\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".as_slice()] {
            let (url, task) = server(response).await; let mut req = request("http", url);
            if !response.windows(5).any(|v| v == b"user:") && !response.windows(5).any(|v| v == b"file:") { req.options.insert("maxRedirects".into(), "0".into()); }
            assert!(run(&req).await.is_err()); task.await.unwrap();
        }
    }
    #[tokio::test]
    async fn public_ip_and_rdap_use_configured_loopback_provider() {
        let (endpoint, task) = server(b"HTTP/1.1 200 OK\r\nContent-Length: 19\r\nConnection: close\r\n\r\n{\"ip\":\"192.0.2.10\"}").await;
        let mut req = request("publicIp", String::new());
        req.options.insert("endpoint".into(), endpoint);
        assert_eq!(run(&req).await.unwrap()["ip"], "192.0.2.10");
        task.await.unwrap();
        let (endpoint, task) =
            server(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n192.0.2.10")
                .await;
        req.options.insert("endpoint".into(), endpoint);
        assert_eq!(run(&req).await.unwrap()["ip"], "192.0.2.10");
        task.await.unwrap();
        let (endpoint, task) =
            server(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").await;
        let mut req = request("rdap", "example.test".into());
        req.options.insert("endpoint".into(), endpoint);
        assert_eq!(run(&req).await.unwrap()["registration"], json!({}));
        assert!(task.await.unwrap().starts_with("GET /domain/example.test "));
    }
    #[tokio::test]
    async fn whois_loopback_exchange_is_single_line_bounded_and_no_shell() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut query = Vec::new();
            while !query.ends_with(b"\r\n") {
                query.push(stream.read_u8().await.unwrap());
            }
            assert_eq!(query, b"example.test\r\n");
            stream.write_all(b"registration fixture").await.unwrap();
        });
        assert_eq!(
            whois_exchange(&[address], "example.test", MAX_WHOIS)
                .await
                .unwrap(),
            "registration fixture"
        );
        server.await.unwrap();
        assert!(whois_exchange(&[address], "host\r\ninjected", MAX_WHOIS)
            .await
            .is_err());
        let mut req = request("whois", "example.test".into());
        req.route = "httpProxy".into();
        assert!(run(&req).await.unwrap_err().contains("no proxy bypass"));
    }
    #[tokio::test]
    async fn stalled_response_is_bounded_by_total_deadline() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut req = request(
            "http",
            format!("http://{}/", listener.local_addr().unwrap()),
        );
        req.timeout_ms = 30;
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(1)).await;
            drop(stream);
        });
        let start = Instant::now();
        assert!(run(&req).await.is_err());
        assert!(start.elapsed() < Duration::from_millis(900));
        server.abort();
    }
    #[tokio::test]
    async fn self_signed_tls_is_rejected_without_insecure_retry() {
        // Reuse the repository's existing Node/OpenSSL certificate fixture. No
        // machine trust store mutation and no external service is involved.
        let script = r#"
import https from 'node:https';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureMockPveCertificate } from './e2e/helpers/fixtures/mock-pve/server.mjs';
const dir = mkdtempSync(join(tmpdir(), 'sorng-toolkit-tls-'));
let tls;
try { tls = ensureMockPveCertificate({certDir: dir}); } finally { rmSync(dir, {recursive:true, force:true}); }
const server = https.createServer({cert:tls.certificate, key:tls.privateKey}, (_,res) => { console.log('unexpected-http-request'); res.end('no'); });
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
setTimeout(() => process.exit(1), 15000).unref();
"#;
        let mut command = tokio::process::Command::new("node");
        command
            .args(["--input-type=module", "--eval", script])
            .current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.."))
            .stdout(std::process::Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .expect("Node/OpenSSL required for existing native TLS fixtures");
        let mut lines = tokio::io::BufReader::new(child.stdout.take().unwrap()).lines();
        let port: u16 = tokio::time::timeout(Duration::from_secs(10), lines.next_line())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .parse()
            .unwrap();
        let error = run(&request("tls", format!("https://127.0.0.1:{port}/")))
            .await
            .unwrap_err();
        assert!(error.contains("no direct/insecure fallback"));
        assert!(
            tokio::time::timeout(Duration::from_millis(100), lines.next_line())
                .await
                .is_err()
        );
        child.kill().await.unwrap();
    }
}
