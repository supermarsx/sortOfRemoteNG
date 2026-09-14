//! Browser authorization remains in its native document/attempt guards; the
//! exact destination grammar is shared with the native API resolver.
#[cfg(test)]
use reqwest::Url;
pub(super) const PATH: &str = "/__sortofremoteng_quickconnect_discovered_v1";
pub(super) use sorng_quickconnect::{alias_digest, classify, Route};
#[cfg(test)]
use sorng_quickconnect::{PROBE_PATH, PROBE_QUERY};

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
