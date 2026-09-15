//! Native API endpoint resolution, not a browser navigation. Anonymous provider
//! requests cannot access the NAS client or its credentials. Every request uses
//! the same explicit transport route; no redirects or direct fallback.
use crate::{
    client::SynoClient,
    error::{SynologyError, SynologyResult},
    http_route::NativeHttpRoute,
    login_handshake::SessionRoute,
};
use reqwest::{
    cookie::{CookieStore, Jar},
    header, Client, Url,
};
use serde_json::{json, Value};
use sorng_quickconnect::{
    alias_digest, classify, discovery_server_id, original_alias, Route, PROBE_PATH, PROBE_QUERY,
};
use std::{
    collections::{BTreeSet, HashMap},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

const CONTROL_LIMIT: usize = 256 * 1024;
const MAX_CANDIDATES: usize = 8;
const USER_AGENT: &str = "SortOfRemoteNG-SynologyAPI/1";

fn current(active: &AtomicBool) -> SynologyResult<()> {
    if active.load(Ordering::Acquire) {
        Ok(())
    } else {
        Err(SynologyError::session_expired(
            "Synology connection attempt was cancelled",
        ))
    }
}

struct Provider {
    http: Client,
    // Separate exact-origin jars; never expose provider cookies to DSM/API.
    cookies: HashMap<String, Jar>,
    origin: String,
}

impl Provider {
    fn new(route: &NativeHttpRoute, alias: &str) -> SynologyResult<Self> {
        Ok(Self {
            http: route.builder(Duration::from_secs(25), false)?.build()?,
            cookies: HashMap::new(),
            origin: format!("https://{alias}.quickconnect.to"),
        })
    }

    async fn control(
        &mut self,
        url: &Url,
        alias: &str,
        tunnel: bool,
        active: &AtomicBool,
    ) -> SynologyResult<Value> {
        current(active)?;
        if classify(url, alias) != Some(Route::Control)
            || tunnel && url.host_str() == Some("global.quickconnect.to")
        {
            return Err(SynologyError::connection(
                "QuickConnect supplied an unsupported control endpoint",
            ));
        }
        let key = url.origin().ascii_serialization();
        if !self.cookies.contains_key(&key) && self.cookies.len() >= 2 {
            return Err(SynologyError::connection(
                "QuickConnect control endpoint limit reached",
            ));
        }
        let command = |id| {
            json!({"version":1,"command":if tunnel {"request_tunnel"} else {"get_server_info"},
            "stop_when_error":false,"stop_when_success":tunnel,"id":id,"serverID":alias,"is_gofile":false,"path":""})
        };
        let body = if tunnel {
            json!([command("mainapp_https")])
        } else {
            json!([command("mainapp_https"), command("mainapp_http")])
        };
        let mut request = self
            .http
            .post(url.clone())
            .header(header::USER_AGENT, USER_AGENT)
            .header(header::ACCEPT, "application/json")
            .header(header::ACCEPT_ENCODING, "identity")
            .header(
                header::CONTENT_TYPE,
                "application/x-www-form-urlencoded; charset=UTF-8",
            )
            .header(header::ORIGIN, &self.origin)
            .header(header::REFERER, format!("{}/", self.origin))
            .body(body.to_string());
        if let Some(cookie) = self.cookies.get(&key).and_then(|jar| jar.cookies(url)) {
            request = request.header(header::COOKIE, cookie);
        }
        let response = request.send().await.map_err(|_| {
            SynologyError::connection(
                "QuickConnect control request failed; check the selected proxy and network route",
            )
        })?;
        current(active)?;
        let cookies: Vec<_> = response
            .headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .cloned()
            .collect();
        if cookies.len() > 32
            || cookies
                .iter()
                .map(|value| value.as_bytes().len())
                .sum::<usize>()
                > 16 * 1024
        {
            return Err(SynologyError::connection(
                "QuickConnect control cookie response exceeded the safe limit",
            ));
        }
        let json = read_json(response, CONTROL_LIMIT, active).await?;
        if json.as_array().is_none_or(|items| items.len() > 16) {
            return Err(SynologyError::connection(
                "QuickConnect returned an unsupported discovery response",
            ));
        }
        current(active)?;
        self.cookies
            .entry(key)
            .or_default()
            .set_cookies(&mut cookies.iter(), url);
        Ok(json)
    }

    async fn probe(
        &self,
        http: &Client,
        url: &Url,
        alias: &str,
        identities: &BTreeSet<String>,
        active: &AtomicBool,
    ) -> SynologyResult<bool> {
        current(active)?;
        if classify(url, alias) != Some(Route::Probe) {
            return Ok(false);
        }
        // No cookies, authorization, SID, OTP or configured DSM credentials.
        let response = http
            .get(url.clone())
            .timeout(Duration::from_secs(4))
            .header(header::USER_AGENT, USER_AGENT)
            .header(header::ACCEPT, "application/json")
            .header(header::ACCEPT_ENCODING, "identity")
            .header(header::ORIGIN, &self.origin)
            .header(header::REFERER, format!("{}/", self.origin))
            .send()
            .await;
        current(active)?;
        let Ok(response) = response else {
            return Ok(false);
        };
        let json = match read_json(response, 64 * 1024, active).await {
            Ok(json) => json,
            Err(error) if !active.load(Ordering::Acquire) => return Err(error),
            Err(_) => return Ok(false),
        };
        Ok(json
            .get("ezid")
            .and_then(Value::as_str)
            .is_some_and(|id| identities.contains(id)))
    }
}

async fn read_json(
    mut response: reqwest::Response,
    limit: usize,
    active: &AtomicBool,
) -> SynologyResult<Value> {
    if !response.status().is_success() {
        return Err(SynologyError::connection(
            "QuickConnect returned a non-success response; redirects were not followed",
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| SynologyError::connection("QuickConnect response could not be read"))?
    {
        current(active)?;
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(SynologyError::connection(
                "QuickConnect response exceeded the safe limit",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    current(active)?;
    serde_json::from_slice(&bytes)
        .map_err(|_| SynologyError::connection("QuickConnect returned an invalid JSON response"))
}

fn control_url(host: &str, alias: &str) -> Option<Url> {
    let url = Url::parse(&format!("https://{host}/Serv.php")).ok()?;
    (url.host_str() == Some(host) && classify(&url, alias) == Some(Route::Control)).then_some(url)
}

fn regional_control(json: &Value, alias: &str) -> Option<Url> {
    for item in json.as_array()? {
        if let Some(url) = item
            .pointer("/env/control_host")
            .and_then(Value::as_str)
            .and_then(|host| control_url(host, alias))
            .filter(|url| url.host_str() != Some("global.quickconnect.to"))
        {
            return Some(url);
        }
        if let Some(sites) = item
            .get("sites")
            .and_then(Value::as_array)
            .filter(|sites| sites.len() <= 16)
        {
            if let Some(url) = sites
                .iter()
                .filter_map(Value::as_str)
                .filter_map(|host| control_url(host, alias))
                .find(|url| url.host_str() != Some("global.quickconnect.to"))
            {
                return Some(url);
            }
        }
    }
    None
}

fn evidence(
    json: &Value,
    alias: &str,
    identities: &mut BTreeSet<String>,
    candidates: &mut Vec<Url>,
) {
    let Some(items) = json.as_array().filter(|items| items.len() <= 16) else {
        return;
    };
    for item in items {
        let Some(server_id) = discovery_server_id(item) else {
            continue;
        };
        if identities.len() < 16 {
            identities.insert(alias_digest(server_id));
        }
        let mut add = |host: &str, port: u64| {
            if candidates.len() >= MAX_CANDIDATES || !(1..=65535).contains(&port) {
                return;
            }
            let Ok(url) = Url::parse(&format!("https://{host}:{port}{PROBE_PATH}?{PROBE_QUERY}"))
            else {
                return;
            };
            if url.host_str() == Some(host)
                && classify(&url, alias) == Some(Route::Probe)
                && !candidates.contains(&url)
            {
                candidates.push(url);
            }
        };
        // Reserve the relay candidate before bounded direct candidates so an
        // unreachable LAN cannot fill the budget and starve a working relay.
        if let Some(region) = item.pointer("/env/relay_region").and_then(Value::as_str) {
            add(&format!("{alias}.{region}.quickconnect.to"), 443);
        }
        // TLS smart-DNS endpoints only. Raw LAN/WAN IPs do not establish a
        // verified NAS name and cannot receive an automatic credential grant.
        if let Some(lan) = item
            .pointer("/smartdns/lan")
            .and_then(Value::as_array)
            .filter(|items| items.len() <= 16)
        {
            for host in lan.iter().filter_map(Value::as_str) {
                if let Some(port) = item.pointer("/service/port").and_then(Value::as_u64) {
                    add(host, port);
                }
            }
        }
        if let Some(host) = item.pointer("/smartdns/host").and_then(Value::as_str) {
            for path in ["/service/ext_port", "/service/port"] {
                if let Some(port) = item.pointer(path).and_then(Value::as_u64) {
                    add(host, port);
                }
            }
        }
    }
}

#[cfg(test)]
pub(crate) fn test_evidence(
    json: &Value,
    alias: &str,
    identities: &mut BTreeSet<String>,
    candidates: &mut Vec<Url>,
) {
    evidence(json, alias, identities, candidates)
}

async fn try_candidates(
    client: &mut SynoClient,
    provider: &Provider,
    alias: &str,
    identities: &BTreeSet<String>,
    candidates: &[Url],
    active: &AtomicBool,
    last_api_error: &mut Option<SynologyError>,
) -> SynologyResult<bool> {
    for probe in candidates {
        current(active)?;
        client.base_url = probe.origin().ascii_serialization();
        // Retain exactly this NAS client on success, but never carry one failed
        // candidate's cookies into a different endpoint.
        client.reset_anonymous_http(Some(&format!("https://{alias}.quickconnect.to/")))?;
        if !provider
            .probe(client.http_client(), probe, alias, identities, active)
            .await?
        {
            continue;
        }
        let discovered = client.discover_apis_cancellable(active).await;
        current(active)?;
        match discovered {
            Ok(()) if api_ready(client) => {
                client.identity.route = winning_route(probe, alias);
                return Ok(true);
            }
            Ok(()) => *last_api_error = Some(SynologyError::connection("The verified NAS did not advertise compatible DSM authentication and File Station APIs")),
            Err(error) => *last_api_error = Some(error),
        }
    }
    Ok(false)
}

/// Records only which kind of verified candidate won, never its host: a
/// smart-DNS name of this NAS on a DSM port, or the provider relay.
fn winning_route(probe: &Url, alias: &str) -> SessionRoute {
    let direct = format!("{alias}.direct.quickconnect.to");
    let host = probe.host_str().unwrap_or_default();
    if (host == direct || host.ends_with(&format!(".{direct}")))
        && matches!(probe.port(), Some(5001 | 5002))
    {
        SessionRoute::QuickconnectDirect
    } else {
        SessionRoute::QuickconnectRelay
    }
}

fn api_ready(client: &SynoClient) -> bool {
    [("SYNO.API.Auth", 6), ("SYNO.FileStation.Info", 2)]
        .iter()
        .all(|(name, maximum)| {
            client.api_info.get(*name).is_some_and(|info| {
                info.min_version > 0
                    && info.min_version <= info.max_version
                    && info.max_version <= 10_000
                    && client.best_version(name, *maximum).is_some_and(|version| {
                        version >= info.min_version
                            && client.resolve_url(name, version, "get").is_ok()
                    })
            })
        })
}

async fn resolve(client: &mut SynoClient, alias: &str, active: &AtomicBool) -> SynologyResult<()> {
    let mut provider = Provider::new(&client.route, alias)?;
    let global = Url::parse("https://global.quickconnect.to/Serv.php").expect("fixed URL");
    let first = provider.control(&global, alias, false, active).await?;
    let mut regional = regional_control(&first, alias);
    let mut identities = BTreeSet::from([alias_digest(alias)]);
    let mut candidates = Vec::new();
    let mut last_api_error = None;
    evidence(&first, alias, &mut identities, &mut candidates);
    if let Some(control) = regional.as_ref().filter(|_| candidates.is_empty()) {
        let response = provider.control(control, alias, false, active).await?;
        evidence(&response, alias, &mut identities, &mut candidates);
        // Do not recurse into newly advertised control hosts.
    }
    if try_candidates(
        client,
        &provider,
        alias,
        &identities,
        &candidates,
        active,
        &mut last_api_error,
    )
    .await?
    {
        return Ok(());
    }
    if let Some(control) = regional.take() {
        let response = provider.control(&control, alias, true, active).await?;
        let mut after_tunnel = Vec::new();
        evidence(&response, alias, &mut identities, &mut after_tunnel);
        // A tunnel response may omit the original discovery shape. Re-test only
        // the same bounded relay candidate once after this explicit setup step.
        for candidate in candidates
            .iter()
            .filter(|url| url.port_or_known_default() == Some(443))
        {
            if !after_tunnel.contains(candidate) {
                after_tunnel.push(candidate.clone());
            }
        }
        after_tunnel.truncate(MAX_CANDIDATES);
        if try_candidates(
            client,
            &provider,
            alias,
            &identities,
            &after_tunnel,
            active,
            &mut last_api_error,
        )
        .await?
        {
            return Ok(());
        }
    }
    if let Some(error) = last_api_error {
        return Err(SynologyError::new(
            error.kind.clone(),
            format!(
                "QuickConnect reached the verified NAS, but anonymous API discovery failed. {}",
                error.message
            ),
        )
        .with_diagnostic_from(&error));
    }
    Err(SynologyError::connection("QuickConnect did not provide a verified HTTPS File Station API endpoint. No NAS credentials were sent. Check QuickConnect access and the selected network route, then reconnect."))
}

pub(crate) async fn prepare(client: &mut SynoClient, active: &AtomicBool) -> SynologyResult<()> {
    current(active)?;
    let original = Url::parse(&client.base_url)?;
    let alias = original
        .host_str()
        .and_then(original_alias)
        .map(str::to_owned);
    if let Some(alias) = alias {
        // Even an HTTP landing alias is only an identifier: anonymous discovery
        // and every selected NAS endpoint use verified HTTPS, never a downgrade.
        tokio::time::timeout(Duration::from_secs(120), resolve(client, &alias, active)).await
            .map_err(|_| SynologyError::connection("QuickConnect endpoint resolution timed out before login; no credentials were sent"))??;
    } else {
        if original
            .host_str()
            .is_some_and(|host| host == "quickconnect.to" || host.ends_with(".quickconnect.to"))
        {
            return Err(SynologyError::connection("Enter the original NAS QuickConnect alias, not a provider control address or an unsupported QuickConnect URL. No credentials were sent."));
        }
        client.discover_apis_cancellable(active).await?;
    }
    current(active)
}
