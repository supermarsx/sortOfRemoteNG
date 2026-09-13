//! Closed original-NAS QuickConnect operations. These bounded defaults
//! capabilities cannot be expanded by any provider response.
use reqwest::Url;

pub(super) const PATH: &str = "/__sortofremoteng_quickconnect_discovered_v1";
const PROBE_PATH: &str = "/webman/pingpong.cgi";
const PROBE_QUERY: &str = "action=cors&quickconnect=true";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Route {
    Control,
    Probe,
}

fn label(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 63
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !value.starts_with('-')
        && !value.ends_with('-')
}

pub(super) fn classify(url: &Url, alias: &str) -> Option<Route> {
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
        .is_some_and(|region| {
            let bytes = region.as_bytes();
            (3..=63).contains(&bytes.len())
                && bytes[..2].iter().all(u8::is_ascii_lowercase)
                && bytes[2..].iter().all(u8::is_ascii_digit)
        });
    ((same_nas && matches!(url.port(), Some(5001 | 5002))
        || regional && url.port_or_known_default() == Some(443))
        && url.path() == PROBE_PATH
        && url.query() == Some(PROBE_QUERY))
    .then_some(Route::Probe)
}

pub(super) fn alias_digest(alias: &str) -> String {
    use md5::{Digest, Md5};
    hex::encode(Md5::digest(alias.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_probe_capability_is_exact_original_alias_port_and_operation() {
        for host in [
            "test-nas.direct.quickconnect.to",
            "192-168-50-100.test-nas.direct.quickconnect.to",
        ] {
            for port in [5001, 5002] {
                let url = Url::parse(&format!("https://{host}:{port}{PROBE_PATH}?{PROBE_QUERY}"))
                    .unwrap();
                assert_eq!(classify(&url, "test-nas"), Some(Route::Probe));
                assert_eq!(classify(&url, "other-nas"), None);
            }
        }
        for authority in [
            "test-nas.fr3.quickconnect.to",
            "test-nas.de2.quickconnect.to:443",
        ] {
            let url =
                Url::parse(&format!("https://{authority}{PROBE_PATH}?{PROBE_QUERY}")).unwrap();
            assert_eq!(classify(&url, "test-nas"), Some(Route::Probe));
            assert_eq!(classify(&url, "other-nas"), None);
        }
    }
    #[test]
    fn candidate_syntax_cannot_expand_into_other_aliases_queries_methods_or_provider_suffixes() {
        for value in [
            "http://test-nas.direct.quickconnect.to:5001/webman/pingpong.cgi?action=cors&quickconnect=true",
            "https://other-nas.direct.quickconnect.to:5001/webman/pingpong.cgi?action=cors&quickconnect=true",
            "https://a.b.test-nas.direct.quickconnect.to:5001/webman/pingpong.cgi?action=cors&quickconnect=true",
            "https://test-nas.direct.quickconnect.to:444/webman/pingpong.cgi?action=cors&quickconnect=true",
            "https://test-nas.direct.quickconnect.to:5001/webman/pingpong.cgi?action=cors&quickconnect=true&secret=x",
            "https://dec.quickconnect.to/Serv.php?secret=x",
            "https://dec.quickconnect.to.evil.invalid/Serv.php",
            "https://user@dec.quickconnect.to/Serv.php",
            "https://dec.quickconnect.to:5001/Serv.php",
            "https://dec.quickconnect.to./Serv.php",
            "https://other-nas.fr3.quickconnect.to/webman/pingpong.cgi?action=cors&quickconnect=true",
            "https://test-nas.fr.quickconnect.to/webman/pingpong.cgi?action=cors&quickconnect=true",
            "https://test-nas.fr3x.quickconnect.to/webman/pingpong.cgi?action=cors&quickconnect=true",
            "https://test-nas.x.fr3.quickconnect.to/webman/pingpong.cgi?action=cors&quickconnect=true",
            "https://test-nas.fr3.quickconnect.to:5001/webman/pingpong.cgi?action=cors&quickconnect=true",
            "http://test-nas.fr3.quickconnect.to/webman/pingpong.cgi?action=cors&quickconnect=true",
            "https://test-nas.fr3.quickconnect.to/webman/pingpong.cgi?action=cors&quickconnect=true&private=secret",
            "https://test-nas.fr3.quickconnect.to/webapi/auth.cgi?action=cors&quickconnect=true",
        ] { assert!(classify(&Url::parse(value).unwrap(), "test-nas").is_none(), "{value}"); }
    }
}
