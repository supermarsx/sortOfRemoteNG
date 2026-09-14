//! Shared pure contracts. Discovery data is evidence, never permission to send
//! credentials or to contact arbitrary destinations. No networking or secrets.
use serde_json::Value;
use url::Url;

pub const PROBE_PATH: &str = "/webman/pingpong.cgi";
pub const PROBE_QUERY: &str = "action=cors&quickconnect=true";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    Control,
    Probe,
}

pub fn label(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 63
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !value.starts_with('-')
        && !value.ends_with('-')
}

/// The original alias may be supplied as its landing, direct or regional DNS
/// name. A lookalike suffix, URL, or arbitrary custom domain is not QuickConnect.
pub fn original_alias(host: &str) -> Option<&str> {
    if let Some(stem) = host.strip_suffix(".direct.quickconnect.to") {
        let mut labels = stem.rsplit('.');
        let alias = labels.next().filter(|value| label(value))?;
        return match (labels.next(), labels.next()) {
            (None, None) => Some(alias),
            (Some(prefix), None) if label(prefix) => Some(alias),
            _ => None,
        };
    }
    let stem = host.strip_suffix(".quickconnect.to")?;
    let mut labels = stem.split('.');
    let alias = labels.next().filter(|value| label(value))?;
    match (labels.next(), labels.next()) {
        (None, None) if !matches!(alias, "global" | "www") => Some(alias),
        (Some(region), None) if regional_label(region) => Some(alias),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn original_alias_preserves_exact_saved_smart_dns_forms() {
        for host in [
            "test-nas.quickconnect.to",
            "test-nas.fr3.quickconnect.to",
            "test-nas.direct.quickconnect.to",
            "192-168-50-10.test-nas.direct.quickconnect.to",
        ] {
            assert_eq!(original_alias(host), Some("test-nas"));
        }
        let host = "192-168-50-10.test-nas.direct.quickconnect.to";
        let probe = Url::parse(&format!("https://{host}:5001{PROBE_PATH}?{PROBE_QUERY}")).unwrap();
        assert_eq!(
            classify(&probe, original_alias(host).unwrap()),
            Some(Route::Probe)
        );
        assert_eq!(classify(&probe, "other-nas"), None);
    }

    #[test]
    fn saved_smart_dns_lookalikes_and_extra_prefixes_are_not_aliases() {
        for host in [
            "a.b.test-nas.direct.quickconnect.to",
            "-lan.test-nas.direct.quickconnect.to",
            "lan..direct.quickconnect.to",
            "lan.test-nas.direct.quickconnect.to.evil.invalid",
            "lan.test-nas.direct.quickconnect.to.",
            "https://lan.test-nas.direct.quickconnect.to",
            "test-nas.fr3x.quickconnect.to",
            "global.quickconnect.to",
            "www.quickconnect.to",
        ] {
            assert_eq!(original_alias(host), None);
        }
    }
}

fn regional_label(region: &str) -> bool {
    let bytes = region.as_bytes();
    (3..=63).contains(&bytes.len())
        && bytes[..2].iter().all(u8::is_ascii_lowercase)
        && bytes[2..].iter().all(u8::is_ascii_digit)
}

pub fn classify(url: &Url, alias: &str) -> Option<Route> {
    if !label(alias)
        || url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.as_str().len() > 2048
    {
        return None;
    }
    let host = url.host_str()?;
    if host.len() > 253 {
        return None;
    }
    if url.port_or_known_default() == Some(443)
        && url.path() == "/Serv.php"
        && url.query().is_none()
        && host.strip_suffix(".quickconnect.to").is_some_and(label)
    {
        return Some(Route::Control);
    }
    let suffix = format!("{alias}.direct.quickconnect.to");
    let same_nas = host == suffix || host.strip_suffix(&format!(".{suffix}")).is_some_and(label);
    let regional = host
        .strip_prefix(&format!("{alias}."))
        .and_then(|host| host.strip_suffix(".quickconnect.to"))
        .is_some_and(regional_label);
    ((same_nas && matches!(url.port(), Some(5001 | 5002))
        || regional && url.port_or_known_default() == Some(443))
        && url.path() == PROBE_PATH
        && url.query() == Some(PROBE_QUERY))
    .then_some(Route::Probe)
}

pub fn alias_digest(alias: &str) -> String {
    use md5::{Digest, Md5};
    hex::encode(Md5::digest(alias.as_bytes()))
}

/// Reviewed vendor ResponseParser.isValidServerInfo minimum shape. Never learn
/// an ID merely because a response contains a recursively nested serverID.
pub fn discovery_server_id(item: &Value) -> Option<&str> {
    if item.get("errno").and_then(Value::as_i64) != Some(0)
        || [
            "/server/interface",
            "/server/external/ip",
            "/service/port",
            "/service/ext_port",
            "/env/control_host",
            "/env/relay_region",
        ]
        .iter()
        .any(|path| item.pointer(path).is_none_or(Value::is_null))
    {
        return None;
    }
    item.pointer("/server/serverID")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control))
}
