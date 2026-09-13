//! Native-only, document-bound direct-probe grants. Control URL syntax describes
//! the separate closed provider capability; only verified original-alias
//! discovery replies can enroll direct NAS probes.
use reqwest::Url;
use serde_json::Value;
use std::collections::BTreeSet;

pub(super) const PATH: &str = "/__sortofremoteng_quickconnect_discovered_v1";
const PROBE_PATH: &str = "/webman/pingpong.cgi";
const PROBE_QUERY: &str = "action=cors&quickconnect=true";
const MAX_PROBES: usize = 32;

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
    if url.scheme() != "https"
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
    (same_nas
        && matches!(url.port(), Some(5001 | 5002))
        && url.path() == PROBE_PATH
        && url.query() == Some(PROBE_QUERY))
    .then_some(Route::Probe)
}

#[derive(Clone, Copy)]
pub(super) struct Ticket {
    sequence: u64,
    revision: u64,
}

#[derive(Default)]
pub(super) struct Registry {
    sequence: u64,
    revision: u64,
    alias: String,
    probes: BTreeSet<String>,
    pending: BTreeSet<u64>,
    revoked: bool,
}
impl Registry {
    pub(super) fn revoke(&mut self) {
        self.revoked = true;
        self.probes.clear();
        self.pending.clear();
    }

    pub(super) fn begin(&mut self, sequence: u64, alias: &str) -> Option<Ticket> {
        if self.revoked
            || sequence == 0
            || sequence < self.sequence
            || (!self.alias.is_empty() && self.alias != alias)
        {
            return None;
        }
        if sequence != self.sequence {
            self.sequence = sequence;
            self.alias = alias.to_string();
            self.probes.clear();
            self.pending.clear();
        }
        if self.pending.len() >= 8 {
            return None;
        }
        self.revision = self.revision.checked_add(1)?;
        self.pending.insert(self.revision);
        Some(Ticket {
            sequence,
            revision: self.revision,
        })
    }

    pub(super) fn allows(&self, sequence: u64, alias: &str, url: &Url) -> Option<Route> {
        if self.revoked || sequence != self.sequence || self.alias != alias {
            return None;
        }
        match classify(url, alias)? {
            Route::Control => None,
            Route::Probe => self.probes.contains(url.as_str()).then_some(Route::Probe),
        }
    }

    pub(super) fn finish(&mut self, ticket: Ticket) {
        if ticket.sequence == self.sequence {
            self.pending.remove(&ticket.revision);
        }
    }

    pub(super) fn learn(&mut self, ticket: Ticket, json: &Value) -> bool {
        if self.revoked
            || ticket.sequence != self.sequence
            || !self.pending.remove(&ticket.revision)
        {
            return false;
        }
        let Some(entries) = json.as_array().filter(|entries| entries.len() <= 2) else {
            return true;
        };
        for entry in entries {
            // sites[] is a vendor routing hint, not an exhaustive control-host
            // authorization list. Returned server IDs are also not assumed to
            // equal the validated request's original NAS alias.
            if entry
                .pointer("/server/pingpong_path")
                .and_then(Value::as_str)
                .is_some_and(|path| {
                    !path.is_empty() && path != format!("{PROBE_PATH}?{PROBE_QUERY}")
                })
            {
                continue;
            }
            let ports: Vec<u16> = ["/service/port", "/service/ext_port"]
                .iter()
                .filter_map(|path| entry.pointer(path))
                .filter_map(|value| {
                    value
                        .as_u64()
                        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
                })
                .filter_map(|port| u16::try_from(port).ok())
                .filter(|port| matches!(port, 5001 | 5002))
                .collect();
            let mut hosts = Vec::new();
            for key in ["/smartdns/lan", "/smartdns/lanv6"] {
                if let Some(values) = entry
                    .pointer(key)
                    .and_then(Value::as_array)
                    .filter(|values| values.len() <= MAX_PROBES)
                {
                    hosts.extend(values.iter().filter_map(Value::as_str));
                }
            }
            if let Some(host) = entry.pointer("/smartdns/host").and_then(Value::as_str) {
                hosts.push(host);
            }
            for host in hosts {
                for port in &ports {
                    let Ok(url) =
                        Url::parse(&format!("https://{host}:{port}{PROBE_PATH}?{PROBE_QUERY}"))
                    else {
                        continue;
                    };
                    if url.host_str() == Some(host)
                        && classify(&url, &self.alias) == Some(Route::Probe)
                        && self.probes.len() < MAX_PROBES
                    {
                        self.probes.insert(url.to_string());
                    }
                }
            }
        }
        true
    }
}

pub(super) fn valid_probe_json(json: &Value, alias: &str) -> bool {
    use md5::{Digest, Md5};
    let expected = hex::encode(Md5::digest(alias.as_bytes()));
    json.get("ezid").and_then(Value::as_str) == Some(expected.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn response() -> Value {
        serde_json::json!([{"sites":["dec.quickconnect.to"], "server":{"serverID":"provider-internal-id"},
            "smartdns":{"host":"test-nas.direct.quickconnect.to","lan":["192-168-50-100.test-nas.direct.quickconnect.to","other-nas.direct.quickconnect.to"]},
            "service":{"port":5001,"ext_port":"5002"}}])
    }
    #[test]
    fn concurrent_learning_is_one_use_alias_bound_and_stale_documents_never_grant() {
        let mut registry = Registry::default();
        let old = registry.begin(1, "test-nas").unwrap();
        let current = registry.begin(1, "test-nas").unwrap();
        let control = Url::parse("https://dec.quickconnect.to/Serv.php").unwrap();
        assert!(registry.learn(current, &response()));
        assert!(registry.learn(old, &response()));
        assert!(!registry.learn(old, &response()));
        // Control permission is the separately validated defaults namespace,
        // not a grant learned from response sites[].
        assert!(registry.allows(1, "test-nas", &control).is_none());
        let probe = Url::parse(&format!(
            "https://test-nas.direct.quickconnect.to:5001{PROBE_PATH}?{PROBE_QUERY}"
        ))
        .unwrap();
        for host in [
            "test-nas.direct.quickconnect.to",
            "192-168-50-100.test-nas.direct.quickconnect.to",
        ] {
            for port in [5001, 5002] {
                let url = Url::parse(&format!("https://{host}:{port}{PROBE_PATH}?{PROBE_QUERY}"))
                    .unwrap();
                assert_eq!(registry.allows(1, "test-nas", &url), Some(Route::Probe));
            }
        }
        assert!(registry.allows(1, "other-nas", &probe).is_none());
        registry.begin(2, "test-nas").unwrap();
        registry.learn(current, &response());
        assert!(registry.allows(2, "test-nas", &probe).is_none());
        assert!(registry.begin(1, "test-nas").is_none());
        registry.revoke();
        assert!(registry.begin(3, "test-nas").is_none());
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
        ] { assert!(classify(&Url::parse(value).unwrap(), "test-nas").is_none(), "{value}"); }
        let mut registry = Registry::default();
        let ticket = registry.begin(1, "test-nas").unwrap();
        let sites: Vec<_> = (0..16)
            .map(|i| format!("site{i}.quickconnect.to"))
            .collect();
        let hosts: Vec<_> = (0..32)
            .map(|i| format!("host{i}.test-nas.direct.quickconnect.to"))
            .collect();
        registry.learn(ticket, &serde_json::json!([{"sites":sites,"smartdns":{"lan":hosts},"service":{"port":5001,"ext_port":5002}}]));
        assert_eq!(registry.probes.len(), MAX_PROBES);
    }
}
