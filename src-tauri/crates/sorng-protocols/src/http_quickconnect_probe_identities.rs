//! Volatile probe identities, not destination permissions. Only native verified
//! control replies may add hashes; the original alias and active document fence
//! their use. Nothing here is exported, persisted, or logged.
use serde_json::Value;
use std::{collections::BTreeSet, sync::Mutex};

const MAX_IDENTITIES: usize = 16;
#[cfg(test)]
const MAX_SERVER_ID_BYTES: usize = 256;

#[derive(Default)]
struct State {
    sequence: u64,
    alias: String,
    hashes: BTreeSet<String>,
    closed: bool,
}

#[derive(Default)]
pub(super) struct ProbeIdentities(Mutex<State>);

impl ProbeIdentities {
    pub(super) fn prepare(&self, sequence: u64, alias: &str) -> bool {
        let Ok(mut state) = self.0.lock() else {
            return false;
        };
        if state.closed || sequence == 0 || sequence < state.sequence {
            return false;
        }
        if sequence > state.sequence {
            state.sequence = sequence;
            state.alias = alias.into();
            state.hashes.clear();
        }
        state.alias == alias
    }

    pub(super) fn learn(&self, sequence: u64, alias: &str, json: &Value) {
        let Ok(mut state) = self.0.lock() else {
            return;
        };
        if state.closed || state.sequence != sequence || state.alias != alias {
            return;
        }
        let Some(items) = json
            .as_array()
            .filter(|items| items.len() <= MAX_IDENTITIES)
        else {
            return;
        };
        for item in items {
            let Some(id) = sorng_quickconnect::discovery_server_id(item) else {
                continue;
            };
            if state.hashes.len() < MAX_IDENTITIES {
                state.hashes.insert(super::discovered::alias_digest(id));
            }
        }
    }

    pub(super) fn accepts(&self, sequence: u64, alias: &str, json: &Value) -> bool {
        let Ok(state) = self.0.lock() else {
            return false;
        };
        if state.closed || state.sequence != sequence || state.alias != alias {
            return false;
        }
        json.get("ezid")
            .and_then(Value::as_str)
            .is_some_and(|hash| {
                hash == super::discovered::alias_digest(alias) || state.hashes.contains(hash)
            })
    }

    pub(super) fn revoke(&self) {
        if let Ok(mut state) = self.0.lock() {
            state.closed = true;
            state.alias.clear();
            state.hashes.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reply(id: &str) -> Value {
        serde_json::json!([{"errno":0,
            "server":{"serverID":id,"interface":[],"external":{"ip":"192.0.2.1"}},
            "service":{"port":5001,"ext_port":5002},
            "env":{"control_host":"dec.quickconnect.to","relay_region":"fr3"}}])
    }
    fn pong(id: &str) -> Value {
        serde_json::json!({"ezid":super::super::discovered::alias_digest(id)})
    }
    #[test]
    fn identities_are_bounded_nonrecursive_and_current_document_alias_only() {
        let receipts = ProbeIdentities::default();
        assert!(receipts.prepare(1, "nas"));
        assert!(receipts.accepts(1, "nas", &pong("nas")));
        for id in 0..MAX_IDENTITIES + 1 {
            receipts.learn(1, "nas", &reply(&format!("internal-{id}")));
        }
        assert!(receipts.accepts(1, "nas", &pong("internal-0")));
        assert!(receipts.accepts(1, "nas", &pong("internal-15")));
        assert!(!receipts.accepts(1, "nas", &pong("internal-16")));
        assert!(!receipts.accepts(1, "other", &pong("internal-0")));
        assert!(!receipts.prepare(1, "other"));
        assert!(receipts.prepare(2, "nas"));
        assert!(!receipts.prepare(1, "nas"));
        receipts.learn(1, "nas", &reply("late"));
        assert!(!receipts.accepts(2, "nas", &pong("internal-0")));
        assert!(!receipts.accepts(2, "nas", &pong("late")));
        assert!(!receipts.accepts(1, "nas", &pong("nas")));
        receipts.revoke();
        assert!(!receipts.prepare(3, "nas"));
        receipts.learn(2, "nas", &reply("late"));
        assert!(!receipts.accepts(2, "nas", &pong("nas")));
        assert!(receipts.0.lock().unwrap().hashes.is_empty());
    }
    #[test]
    fn only_successful_vendor_shaped_bounded_server_ids_are_learned() {
        for mutation in [
            "missing-errno",
            "error",
            "string-errno",
            "nested",
            "missing-shape",
            "empty",
            "control",
            "large",
            "many",
        ] {
            let receipts = ProbeIdentities::default();
            assert!(receipts.prepare(1, "nas"));
            let mut json = reply("internal");
            match mutation {
                "missing-errno" => {
                    json[0].as_object_mut().unwrap().remove("errno");
                }
                "error" => json[0]["errno"] = 13.into(),
                "string-errno" => json[0]["errno"] = "0".into(),
                "nested" => json = serde_json::json!({"data":json}),
                "missing-shape" => {
                    json[0]["env"]
                        .as_object_mut()
                        .unwrap()
                        .remove("relay_region");
                }
                "empty" => json[0]["server"]["serverID"] = "".into(),
                "control" => json[0]["server"]["serverID"] = "internal\0".into(),
                "large" => {
                    json[0]["server"]["serverID"] = "x".repeat(MAX_SERVER_ID_BYTES + 1).into()
                }
                "many" => json = Value::Array(vec![json[0].clone(); MAX_IDENTITIES + 1]),
                _ => unreachable!(),
            }
            receipts.learn(1, "nas", &json);
            assert!(receipts.0.lock().unwrap().hashes.is_empty(), "{mutation}");
        }
        let receipts = ProbeIdentities::default();
        assert!(receipts.prepare(1, "nas"));
        receipts.learn(1, "nas", &reply("internal-a"));
        receipts.learn(1, "nas", &reply("internal-b"));
        assert!(receipts.accepts(1, "nas", &pong("internal-a")));
        assert!(receipts.accepts(1, "nas", &pong("internal-b")));
    }
}
