//! Read-only, attempt-local website certificate observations. No network access.
use serde::{Deserialize, Serialize};
use sorng_browser_host::ipc::OriginBrowserIdentity;
use std::{collections::BTreeMap, sync::Mutex};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    pub identity: OriginBrowserIdentity,
    pub sequence: u64,
    pub origin: String,
    #[serde(default)]
    pub view_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Certificate {
    pub subject: String,
    pub issuer: String,
    pub fingerprint: String,
    pub valid_from: String,
    pub valid_to: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Observation {
    pub system_ca_valid: bool,
    pub reviewed: Option<bool>,
    pub observed_at: String,
    pub chain: Vec<Certificate>,
    pub tls_version: Option<String>,
    pub cipher_suite: Option<String>,
    pub source: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Response {
    pub identity: OriginBrowserIdentity,
    pub sequence: u64,
    pub origin: String,
    pub observation: Option<Observation>,
    pub availability: &'static str,
    pub view_id: Option<String>,
}

/// At most 128 origins, each with a 64 KiB public metadata projection. DER,
/// PEM and private data never cross this API. Only real upstream admissions
/// call record; the intercepted CEF proxy-leaf fast path must never call it.
#[derive(Default)]
pub(crate) struct Observations(Mutex<Store>);

#[derive(Default)]
struct Store {
    revision: u64,
    entries: BTreeMap<String, Entry>,
    protected_root: Option<String>,
    protected_child: Option<String>,
    protected_child_view: Option<String>,
    inspections: BTreeMap<Option<String>, (u64, String, u64)>,
    browser_sequences: BTreeMap<Option<String>, (u64, bool)>,
}

struct Entry {
    revision: u64,
    hash: [u8; 32],
    observation: Option<Observation>,
    pending: bool,
    origin: String,
}

impl Observations {
    /// One passive native navigation inspection per exact shell snapshot.
    /// Pending retries coalesce; a later document or explicit native snapshot
    /// change gets a new inspection instead of reusing another TLS session.
    pub fn begin_inspection(
        &self,
        view_id: &Option<String>,
        sequence: u64,
        origin: &str,
    ) -> Option<u64> {
        let Ok(mut store) = self.0.lock() else {
            return None;
        };
        if store
            .inspections
            .get(view_id)
            .is_some_and(|(saved, saved_origin, _)| *saved == sequence && saved_origin == origin)
        {
            return None;
        }
        let ticket = store.revision.checked_add(1)?;
        store.revision = ticket;
        let request = (sequence, origin.to_owned(), ticket);
        if store.inspections.len() >= 17 && !store.inspections.contains_key(view_id) {
            if let Some(old) = store.inspections.keys().find(|key| key.is_some()).cloned() {
                store.inspections.remove(&old);
            }
        }
        store.inspections.insert(view_id.clone(), request);
        store.browser_sequences.remove(view_id);
        store.entries.remove(&navigation_key(view_id, origin));
        Some(ticket)
    }
    pub fn record(&self, origin: &str, chain: &[Vec<u8>], system_ca_valid: bool, reviewed: bool) {
        self.record_transport(
            origin,
            chain,
            system_ca_valid,
            Some(reviewed),
            None,
            None,
            "upstream-handshake",
            true,
        );
    }

    pub fn protect(&self, origin: &str, child: bool) {
        if canonical_origin(origin).as_deref() != Some(origin) {
            return;
        }
        if let Ok(mut store) = self.0.lock() {
            if child {
                store.protected_child = Some(origin.to_owned());
            } else {
                store.protected_root = Some(origin.to_owned());
            }
        }
    }

    pub fn protect_view(&self, view_id: &Option<String>, origin: &str) {
        if canonical_origin(origin).as_deref() != Some(origin) {
            return;
        }
        if let Ok(mut store) = self.0.lock() {
            if view_id.is_some() {
                store.protected_child = Some(origin.to_owned());
                store.protected_child_view = view_id.clone();
            } else {
                store.protected_root = Some(origin.to_owned());
                store.protected_child = None;
                store.protected_child_view = None;
            }
        }
    }

    pub fn record_transport(
        &self,
        origin: &str,
        chain: &[Vec<u8>],
        system_ca_valid: bool,
        reviewed: Option<bool>,
        tls_version: Option<String>,
        cipher_suite: Option<String>,
        source: &'static str,
        pending: bool,
    ) {
        self.record_key(
            origin,
            origin,
            chain,
            system_ca_valid,
            reviewed,
            tls_version,
            cipher_suite,
            source,
            pending,
            None,
        );
    }

    pub fn record_navigation(
        &self,
        view_id: Option<String>,
        inspection_id: u64,
        sequence: u64,
        origin: &str,
        chain: &[Vec<u8>],
        system_ca_valid: bool,
        tls_version: Option<String>,
        cipher_suite: Option<String>,
        pending: bool,
    ) {
        let key = navigation_key(&view_id, origin);
        self.record_key(
            &key,
            origin,
            chain,
            system_ca_valid,
            None,
            tls_version,
            cipher_suite,
            "browser-navigation",
            pending,
            Some((view_id, sequence, inspection_id)),
        );
    }

    fn record_key(
        &self,
        key: &str,
        origin: &str,
        chain: &[Vec<u8>],
        system_ca_valid: bool,
        reviewed: Option<bool>,
        tls_version: Option<String>,
        cipher_suite: Option<String>,
        source: &'static str,
        pending: bool,
        browser: Option<(Option<String>, u64, u64)>,
    ) {
        use sha2::{Digest, Sha256};
        if canonical_origin(origin).as_deref() != Some(origin) || !origin.starts_with("https://") {
            return;
        }
        if chain.is_empty()
            || chain.len() > 32
            || chain
                .iter()
                .try_fold(0usize, |total, der| total.checked_add(der.len()))
                .is_none_or(|total| total > 2 * 1024 * 1024)
        {
            // Admission and inspection have different payload limits. An
            // admitted replacement too large for this inspector must clear
            // the old chain and invalidate any parse already in flight.
            if let Ok(mut store) = self.0.lock() {
                if browser.as_ref().is_some_and(|(view, _, ticket)| {
                    store.inspections.get(view).map(|value| value.2) != Some(*ticket)
                }) {
                    return;
                }
                store.entries.remove(key);
            }
            return;
        }
        let mut hash = Sha256::new();
        for der in chain {
            hash.update((der.len() as u64).to_le_bytes());
            hash.update(der);
        }
        let hash: [u8; 32] = hash.finalize().into();
        let clean = |value: Option<String>| {
            value.filter(|value| {
                !value.is_empty()
                    && value.len() <= 128
                    && value.bytes().all(|byte| (32..=126).contains(&byte))
            })
        };
        let tls_version = clean(tls_version);
        let cipher_suite = clean(cipher_suite);
        let Ok(mut store) = self.0.lock() else {
            return;
        };
        if let Some((view, sequence, ticket)) = browser {
            if store.inspections.get(&view).map(|value| value.2) != Some(ticket) {
                return;
            }
            if store
                .browser_sequences
                .get(&view)
                .is_some_and(|(last, terminal)| {
                    *last > sequence || (*last == sequence && *terminal && pending)
                })
            {
                return;
            }
            if store.browser_sequences.len() >= 17 && !store.browser_sequences.contains_key(&view) {
                if let Some(old) = store
                    .browser_sequences
                    .keys()
                    .find(|key| key.is_some())
                    .cloned()
                {
                    store.browser_sequences.remove(&old);
                }
            }
            store.browser_sequences.insert(view, (sequence, !pending));
        }
        let Some(revision) = store.revision.checked_add(1) else {
            return;
        };
        store.revision = revision;
        if let Some(entry) = store.entries.get_mut(key) {
            if let Some(observation) = entry.observation.as_mut().filter(|_| entry.hash == hash) {
                entry.revision = revision;
                entry.pending = pending;
                observation.system_ca_valid = system_ca_valid;
                observation.reviewed = reviewed;
                observation.tls_version = tls_version;
                observation.cipher_suite = cipher_suite;
                observation.source = source;
                observation.observed_at = chrono::Utc::now().to_rfc3339();
                return;
            }
        }
        // A newly observed chain must never leave an older certificate in the
        // inspector if this projection cannot represent the replacement.
        if store.entries.len() >= 128 && !store.entries.contains_key(key) {
            let oldest = store
                .entries
                .iter()
                .filter(|(key, value)| {
                    let root = store.protected_root.as_ref();
                    let child = store.protected_child.as_ref();
                    let protected_handshake = !key.contains('\0')
                        && (root == Some(&value.origin) || child == Some(&value.origin));
                    let protected_navigation = root
                        .is_some_and(|origin| **key == navigation_key(&None, origin))
                        || store.protected_child_view.as_ref().zip(child).is_some_and(
                            |(id, origin)| **key == navigation_key(&Some(id.clone()), origin),
                        );
                    !(protected_handshake || protected_navigation)
                })
                .min_by_key(|(_, value)| value.revision)
                .map(|(key, _)| key.clone());
            if let Some(oldest) = oldest {
                store.entries.remove(&oldest);
            } else {
                return;
            }
        }
        store.entries.insert(
            key.to_owned(),
            Entry {
                revision,
                hash,
                observation: None,
                pending: true,
                origin: origin.to_owned(),
            },
        );
        // Certificate parsing is worker-only and runs outside the inspection
        // mutex. The synchronous shell reader never waits for X.509 parsing.
        drop(store);
        let Ok(parsed) = sorng_protocols::http::capture_peer_certificate_chain(chain) else {
            self.finish_unavailable(key, revision);
            return;
        };
        if parsed.chain.is_empty()
            || parsed
                .chain
                .iter()
                .any(|entry| entry.details.parse_error.is_some())
        {
            self.finish_unavailable(key, revision);
            return;
        }
        let observation = Observation {
            system_ca_valid,
            reviewed,
            observed_at: chrono::Utc::now().to_rfc3339(),
            tls_version,
            cipher_suite,
            source,
            chain: parsed
                .chain
                .into_iter()
                .map(|entry| Certificate {
                    subject: entry.subject,
                    issuer: entry.issuer,
                    fingerprint: entry.fingerprint,
                    valid_from: entry.valid_from,
                    valid_to: entry.valid_to,
                })
                .collect(),
        };
        if serde_json::to_vec(&observation).map_or(true, |value| value.len() > 64 * 1024) {
            self.finish_unavailable(key, revision);
            return;
        }
        let Ok(mut store) = self.0.lock() else {
            return;
        };
        if let Some(entry) = store
            .entries
            .get_mut(key)
            .filter(|entry| entry.revision == revision)
        {
            entry.observation = Some(observation);
            entry.pending = pending;
        }
    }
    fn finish_unavailable(&self, origin: &str, revision: u64) {
        if let Ok(mut store) = self.0.lock() {
            if let Some(entry) = store
                .entries
                .get_mut(origin)
                .filter(|entry| entry.revision == revision)
            {
                entry.pending = false;
            }
        }
    }
    pub fn read(&self, origin: &str) -> (&'static str, Option<Observation>) {
        self.read_view(origin, &None)
    }
    pub fn read_view(
        &self,
        origin: &str,
        view_id: &Option<String>,
    ) -> (&'static str, Option<Observation>) {
        let Ok(store) = self.0.try_lock() else {
            return ("pending", None);
        };
        let entry = if store.inspections.contains_key(view_id) {
            store.entries.get(&navigation_key(view_id, origin))
        } else {
            store.entries.get(origin)
        };
        match entry {
            Some(entry) => (
                if entry.pending {
                    "pending"
                } else if entry.observation.is_some() {
                    "available"
                } else {
                    "unavailable"
                },
                entry.observation.clone(),
            ),
            None => ("pending", None),
        }
    }
    pub fn get(&self, origin: &str) -> Option<Observation> {
        self.0
            .try_lock()
            .ok()?
            .entries
            .get(origin)?
            .observation
            .clone()
    }
}

fn navigation_key(view_id: &Option<String>, origin: &str) -> String {
    match view_id {
        None => format!("R\0{origin}"),
        Some(id) => format!("C:{id}\0{origin}"),
    }
}

pub(crate) fn canonical_origin(value: &str) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

pub(crate) fn matches_page(sequence: u64, current_url: &str, request: &Request) -> bool {
    request.origin.len() <= 2048
        && sequence == request.sequence
        && canonical_origin(current_url).as_deref() == Some(request.origin.as_str())
        && canonical_origin(&request.origin).as_deref() == Some(request.origin.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_origins_keep_scheme_and_port_and_reject_credentials() {
        assert_eq!(
            canonical_origin("https://10.15.27.1/a?q=secret"),
            Some("https://10.15.27.1".into())
        );
        assert_eq!(
            canonical_origin("https://site.test:8443/path"),
            Some("https://site.test:8443".into())
        );
        assert_eq!(
            canonical_origin("http://site.test"),
            Some("http://site.test".into())
        );
        assert_eq!(canonical_origin("https://user:secret@site.test"), None);
        assert_eq!(canonical_origin("data:text/html,test"), None);
    }
    #[test]
    fn malformed_or_missing_chain_never_becomes_security_evidence() {
        let evidence = Observations::default();
        evidence.record("https://site.test", &[], true, false);
        evidence.record("https://site.test", &[vec![1, 2, 3]], true, true);
        assert!(evidence.get("https://site.test").is_none());
    }
    #[test]
    fn shell_inspection_does_not_wait_for_a_busy_observation_store() {
        let evidence = Observations::default();
        let _busy = evidence.0.lock().unwrap();
        assert!(evidence.get("https://site.test").is_none());
    }
    #[test]
    fn navigation_sequence_fences_even_same_origin_and_return_redirects() {
        let request: Request = serde_json::from_value(serde_json::json!({
            "identity": {"ownerDatabaseId":"db", "connectionId":"conn", "sessionId":"session", "attemptId":"00000000-0000-0000-0000-000000000001"},
            "sequence": 3, "origin":"https://site.test"
        })).unwrap();
        assert!(matches_page(3, "https://site.test/a", &request));
        assert!(!matches_page(4, "https://site.test/a", &request));
        assert!(!matches_page(3, "https://other.test/a", &request));
        assert!(!matches_page(3, "https://site.test:8443/a", &request));
        assert!(!matches_page(3, "http://site.test/a", &request));
    }
    #[test]
    fn projects_real_public_certificate_metadata_without_der_pem_or_private_keys() {
        let certificate =
            sorng_protocols::private_forward_proxy::intercept::InterceptAuthority::generate()
                .unwrap();
        let chain = vec![certificate.anchor_der().to_vec()];
        let observations = Observations::default();
        observations.record("https://site.test", &chain, false, true);
        let value = observations.get("https://site.test").unwrap();
        assert!(!value.system_ca_valid);
        assert_eq!(value.reviewed, Some(true));
        assert_eq!(value.chain.len(), 1);
        assert_eq!(value.chain[0].fingerprint.len(), 64);
        let encoded = serde_json::to_string(&value).unwrap();
        assert!(!encoded.contains("BEGIN"));
        assert!(!encoded.contains("derBase64"));
        assert!(!encoded.contains("private"));
        observations.record("https://site.test", &chain, true, false);
        let refreshed = observations.get("https://site.test").unwrap();
        assert!(refreshed.system_ca_valid);
        assert_eq!(refreshed.reviewed, Some(false));
        observations.protect("https://site.test", false);
        observations.protect("https://child.test", true);
        observations.record("https://child.test", &chain, true, false);
        for index in 0..140 {
            observations.record(&format!("https://site{index}.test"), &chain, true, false);
        }
        assert!(observations.0.lock().unwrap().entries.len() <= 128);
        assert!(observations.get("https://site.test").is_some());
        assert!(observations.get("https://child.test").is_some());
        observations.record("https://site8.test", &[vec![1, 2, 3]], true, false);
        assert!(observations.get("https://site8.test").is_none());
        observations.record("https://site.test", &chain, true, false);
        observations.record(
            "https://site.test",
            &vec![chain[0].clone(); 33],
            true,
            false,
        );
        assert!(observations.get("https://site.test").is_none());
        observations.record("https://site.test", &chain, true, false);
        observations.record(
            "https://site.test",
            &[vec![0; 2 * 1024 * 1024 + 1]],
            true,
            false,
        );
        assert!(observations.get("https://site.test").is_none());
    }

    #[test]
    fn pending_navigation_and_negotiated_upstream_details_are_explicit() {
        let cert =
            sorng_protocols::private_forward_proxy::intercept::InterceptAuthority::generate()
                .unwrap();
        let chain = vec![cert.anchor_der().to_vec()];
        let observations = Observations::default();
        assert_eq!(observations.read("https://site.test").0, "pending");
        observations.record_transport(
            "https://site.test",
            &chain,
            true,
            Some(false),
            Some("TLS 1.3".into()),
            Some("TLS13_AES_256_GCM_SHA384".into()),
            "upstream-handshake",
            false,
        );
        let (state, value) = observations.read("https://site.test");
        assert_eq!(state, "available");
        let value = value.unwrap();
        assert_eq!(value.tls_version.as_deref(), Some("TLS 1.3"));
        assert_eq!(
            value.cipher_suite.as_deref(),
            Some("TLS13_AES_256_GCM_SHA384")
        );
        assert_eq!(value.reviewed, Some(false));
        observations.record_transport(
            "https://site.test",
            &chain,
            true,
            None,
            Some("TLS 1.2".into()),
            None,
            "browser-navigation",
            true,
        );
        let (state, value) = observations.read("https://site.test");
        assert_eq!(state, "pending");
        let value = value.unwrap();
        assert_eq!(value.tls_version.as_deref(), Some("TLS 1.2"));
        assert!(value.cipher_suite.is_none());
        assert!(value.reviewed.is_none());
        observations.record_transport(
            "https://site.test",
            &chain,
            true,
            None,
            Some("TLS 1.2".into()),
            Some("TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256".into()),
            "browser-navigation",
            false,
        );
        assert_eq!(observations.read("https://site.test").0, "available");
        assert_eq!(
            observations
                .read("https://site.test")
                .1
                .unwrap()
                .cipher_suite
                .as_deref(),
            Some("TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256")
        );
    }

    #[test]
    fn same_origin_child_and_root_navigation_receipts_do_not_mix_certificates_or_ciphers() {
        let first =
            sorng_protocols::private_forward_proxy::intercept::InterceptAuthority::generate()
                .unwrap();
        let second =
            sorng_protocols::private_forward_proxy::intercept::InterceptAuthority::generate()
                .unwrap();
        let observations = Observations::default();
        let root_ticket = observations
            .begin_inspection(&None, 33, "https://site.test")
            .unwrap();
        let child_ticket = observations
            .begin_inspection(&Some("child".into()), 99, "https://site.test")
            .unwrap();
        observations.record_navigation(
            None,
            root_ticket,
            3,
            "https://site.test",
            &[first.anchor_der().to_vec()],
            true,
            Some("TLS 1.3".into()),
            Some("root-cipher".into()),
            false,
        );
        observations.record_navigation(
            Some("child".into()),
            child_ticket,
            9,
            "https://site.test",
            &[second.anchor_der().to_vec()],
            true,
            Some("TLS 1.2".into()),
            Some("child-cipher".into()),
            false,
        );
        let root = observations
            .read_view("https://site.test", &None)
            .1
            .unwrap();
        let child = observations
            .read_view("https://site.test", &Some("child".into()))
            .1
            .unwrap();
        assert_ne!(root.chain[0].fingerprint, child.chain[0].fingerprint);
        assert_eq!(root.cipher_suite.as_deref(), Some("root-cipher"));
        assert_eq!(child.cipher_suite.as_deref(), Some("child-cipher"));
    }

    #[test]
    fn delayed_pending_or_old_document_metadata_cannot_overwrite_terminal_navigation() {
        let certificate =
            sorng_protocols::private_forward_proxy::intercept::InterceptAuthority::generate()
                .unwrap();
        let chain = vec![certificate.anchor_der().to_vec()];
        let observations = Observations::default();
        let ticket = observations
            .begin_inspection(&None, 55, "https://site.test")
            .unwrap();
        observations.record_navigation(
            None,
            ticket,
            5,
            "https://site.test",
            &chain,
            true,
            Some("TLS 1.3".into()),
            Some("current-cipher".into()),
            false,
        );
        observations.record_navigation(
            None,
            ticket,
            5,
            "https://site.test",
            &chain,
            true,
            Some("TLS 1.3".into()),
            None,
            true,
        );
        observations.record_navigation(
            None,
            ticket,
            4,
            "https://site.test",
            &chain,
            true,
            Some("TLS 1.2".into()),
            Some("old-cipher".into()),
            false,
        );
        let (availability, value) = observations.read("https://site.test");
        assert_eq!(availability, "available");
        assert_eq!(
            value.unwrap().cipher_suite.as_deref(),
            Some("current-cipher")
        );
    }

    #[test]
    fn new_same_certificate_handshake_does_not_borrow_prior_negotiated_parameters() {
        let certificate =
            sorng_protocols::private_forward_proxy::intercept::InterceptAuthority::generate()
                .unwrap();
        let chain = vec![certificate.anchor_der().to_vec()];
        let observations = Observations::default();
        observations.record_transport(
            "https://site.test",
            &chain,
            true,
            Some(false),
            Some("TLS 1.3".into()),
            Some("TLS13_AES_256_GCM_SHA384".into()),
            "upstream-handshake",
            false,
        );
        observations.record("https://site.test", &chain, true, true);
        let (availability, value) = observations.read("https://site.test");
        assert_eq!(availability, "pending");
        let value = value.unwrap();
        assert!(value.tls_version.is_none() && value.cipher_suite.is_none());
        assert_eq!(value.reviewed, Some(true));
    }

    #[test]
    fn inspection_retries_coalesce_per_view_and_exact_snapshot() {
        let observations = Observations::default();
        assert!(observations
            .begin_inspection(&None, 1, "https://site.test")
            .is_some());
        assert!(observations
            .begin_inspection(&None, 1, "https://site.test")
            .is_none());
        assert!(observations
            .begin_inspection(&Some("child".into()), 1, "https://site.test")
            .is_some());
        assert!(observations
            .begin_inspection(&None, 2, "https://site.test")
            .is_some());
        assert!(observations
            .begin_inspection(&None, 2, "https://other.test")
            .is_some());
        assert_ne!(
            navigation_key(&None, "https://site.test"),
            navigation_key(&Some("root".into()), "https://site.test")
        );
    }

    #[test]
    fn historical_same_origin_child_views_cannot_exhaust_protected_navigation_slots() {
        let cert =
            sorng_protocols::private_forward_proxy::intercept::InterceptAuthority::generate()
                .unwrap();
        let chain = vec![cert.anchor_der().to_vec()];
        let observations = Observations::default();
        observations.protect_view(&None, "https://site.test");
        let root = observations
            .begin_inspection(&None, 1, "https://site.test")
            .unwrap();
        observations.record_navigation(
            None,
            root,
            1,
            "https://site.test",
            &chain,
            true,
            None,
            None,
            false,
        );
        for index in 0..150 {
            let view = Some(format!("child-{index}"));
            observations.protect_view(&view, "https://site.test");
            let ticket = observations
                .begin_inspection(&view, 1, "https://site.test")
                .unwrap();
            observations.record_navigation(
                view.clone(),
                ticket,
                1,
                "https://site.test",
                &chain,
                true,
                None,
                Some(format!("cipher-{index}")),
                false,
            );
        }
        assert!(observations
            .read_view("https://site.test", &None)
            .1
            .is_some());
        let last = observations
            .read_view("https://site.test", &Some("child-149".into()))
            .1
            .unwrap();
        assert_eq!(last.cipher_suite.as_deref(), Some("cipher-149"));
        assert!(observations.0.lock().unwrap().entries.len() <= 128);
    }

    #[test]
    fn queued_old_worker_cannot_publish_into_a_new_same_origin_inspection_ticket() {
        let first =
            sorng_protocols::private_forward_proxy::intercept::InterceptAuthority::generate()
                .unwrap();
        let second =
            sorng_protocols::private_forward_proxy::intercept::InterceptAuthority::generate()
                .unwrap();
        let observations = Observations::default();
        let view = Some("child".to_owned());
        let old = observations
            .begin_inspection(&view, 100, "https://site.test")
            .unwrap();
        observations.record_navigation(
            view.clone(),
            old,
            40,
            "https://site.test",
            &[first.anchor_der().to_vec()],
            true,
            Some("TLS 1.2".into()),
            Some("old-cipher".into()),
            false,
        );
        let new = observations
            .begin_inspection(&view, 101, "https://site.test")
            .unwrap();
        // The IPC inventory revision and the child CEF event sequence belong
        // to different clocks. Only the opaque capture ticket connects them.
        observations.record_navigation(
            view.clone(),
            old,
            999,
            "https://site.test",
            &[first.anchor_der().to_vec()],
            true,
            Some("TLS 1.2".into()),
            Some("late-old-cipher".into()),
            false,
        );
        assert!(observations
            .read_view("https://site.test", &view)
            .1
            .is_none());
        observations.record_navigation(
            view.clone(),
            new,
            2,
            "https://site.test",
            &[second.anchor_der().to_vec()],
            true,
            Some("TLS 1.3".into()),
            Some("current-cipher".into()),
            false,
        );
        observations.record_navigation(
            view.clone(),
            old,
            1000,
            "https://site.test",
            &[],
            true,
            None,
            None,
            false,
        );
        let (status, value) = observations.read_view("https://site.test", &view);
        assert_eq!(status, "available");
        assert_eq!(
            value.unwrap().cipher_suite.as_deref(),
            Some("current-cipher")
        );
    }
}
