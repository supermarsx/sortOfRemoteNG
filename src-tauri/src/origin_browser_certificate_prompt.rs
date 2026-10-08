//! App-window certificate prompt state. The actual certificate evidence and
//! approval capability remain in the native TLS waiter, never in this DTO.
use serde::{Deserialize, Serialize};
use sorng_browser_host::ipc::OriginBrowserIdentity;
use std::{collections::HashMap, sync::Arc, time::Instant};
use tokio::sync::oneshot;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Prompt {
    pub request_id: String,
    pub identity: OriginBrowserIdentity,
    pub origin: String,
    pub fingerprint: String,
    pub reason: String,
    pub temporary: bool,
    pub expires_at_unix_ms: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub revision: u64,
    pub prompt: Option<Prompt>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Decision {
    AllowOnce,
    Remember,
    Cancel,
}

#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Request {
    Pending {},
    Respond {
        request_id: String,
        identity: OriginBrowserIdentity,
        decision: Decision,
    },
}

struct Pending {
    prompt: Prompt,
    deadline: Instant,
    current: Arc<dyn Fn() -> bool + Send + Sync>,
    sender: oneshot::Sender<Decision>,
}

#[derive(Default)]
pub(crate) struct Registry {
    revision: u64,
    pending: HashMap<String, Pending>,
}

impl Registry {
    fn bump(&mut self) {
        self.revision += 1;
    }
    fn prune(&mut self, now: Instant) {
        let before = self.pending.len();
        self.pending
            .retain(|_, p| now < p.deadline && (p.current)());
        if before != self.pending.len() {
            self.bump();
        }
    }
    pub fn snapshot(&mut self, window: &str, now: Instant) -> Snapshot {
        self.prune(now);
        Snapshot {
            revision: self.revision,
            prompt: self.pending.get(window).map(|p| p.prompt.clone()),
        }
    }
    pub fn begin(
        &mut self,
        window: &str,
        prompt: Prompt,
        deadline: Instant,
        current: Arc<dyn Fn() -> bool + Send + Sync>,
        now: Instant,
    ) -> Option<(Snapshot, oneshot::Receiver<Decision>)> {
        self.prune(now);
        if self.pending.len() >= 64
            || self.pending.contains_key(window)
            || now >= deadline
            || !current()
        {
            return None;
        }
        let (sender, receiver) = oneshot::channel();
        self.pending.insert(
            window.into(),
            Pending {
                prompt,
                deadline,
                current,
                sender,
            },
        );
        self.bump();
        Some((self.snapshot(window, now), receiver))
    }
    pub fn remove(&mut self, window: &str, request_id: &str, now: Instant) -> Snapshot {
        if self
            .pending
            .get(window)
            .is_some_and(|p| p.prompt.request_id == request_id)
        {
            self.pending.remove(window);
            self.bump();
        }
        self.snapshot(window, now)
    }
    pub fn respond(
        &mut self,
        window: &str,
        request_id: &str,
        identity: &OriginBrowserIdentity,
        decision: Decision,
        now: Instant,
    ) -> Result<Snapshot, &'static str> {
        self.prune(now);
        identity
            .validate()
            .map_err(|_| "Invalid certificate review identity")?;
        if request_id.len() != 32
            || !request_id.bytes().all(|b| b.is_ascii_hexdigit())
            || !self.pending.get(window).is_some_and(|p| {
                p.prompt.request_id == request_id && &p.prompt.identity == identity
            })
        {
            return Err("This certificate review expired or belongs to another browser session");
        }
        let pending = self
            .pending
            .remove(window)
            .expect("validated pending review");
        self.bump();
        // oneshot send never runs the approval callback inline under this lock.
        let _ = pending.sender.send(decision);
        Ok(self.snapshot(window, now))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::atomic::{AtomicBool, Ordering},
        time::Duration,
    };
    fn identity() -> OriginBrowserIdentity {
        OriginBrowserIdentity {
            owner_database_id: "db".into(),
            connection_id: "connection".into(),
            session_id: "session".into(),
            attempt_id: "12345678-1234-4234-9234-123456789abc".into(),
        }
    }
    fn prompt(id: &str) -> Prompt {
        Prompt {
            request_id: id.into(),
            identity: identity(),
            origin: "https://example.test".into(),
            fingerprint: "ab".repeat(32),
            reason: "Review certificate".into(),
            temporary: false,
            expires_at_unix_ms: 123,
        }
    }
    const ID: &str = "12345678123456781234567812345678";
    #[test]
    fn only_exact_window_attempt_and_single_use_response_can_complete() {
        let now = Instant::now();
        let mut r = Registry::default();
        let (_, mut rx) = r
            .begin(
                "main",
                prompt(ID),
                now + Duration::from_secs(1),
                Arc::new(|| true),
                now,
            )
            .unwrap();
        assert!(r
            .respond("other", ID, &identity(), Decision::Remember, now)
            .is_err());
        let mut wrong = identity();
        wrong.attempt_id = "different".into();
        assert!(r
            .respond("main", ID, &wrong, Decision::Remember, now)
            .is_err());
        assert!(rx.try_recv().is_err());
        assert!(r
            .respond("main", ID, &identity(), Decision::AllowOnce, now)
            .unwrap()
            .prompt
            .is_none());
        assert_eq!(rx.try_recv().unwrap(), Decision::AllowOnce);
        assert!(r
            .respond("main", ID, &identity(), Decision::Remember, now)
            .is_err());
    }
    #[test]
    fn expiry_or_revocation_drops_sender_without_authorizing() {
        for expired in [false, true] {
            let now = Instant::now();
            let mut r = Registry::default();
            let valid = Arc::new(AtomicBool::new(true));
            let v = valid.clone();
            let (_, mut rx) = r
                .begin(
                    "main",
                    prompt(ID),
                    now + Duration::from_secs(1),
                    Arc::new(move || v.load(Ordering::Acquire)),
                    now,
                )
                .unwrap();
            if !expired {
                valid.store(false, Ordering::Release);
            }
            let checked = if expired {
                now + Duration::from_secs(1)
            } else {
                now
            };
            assert!(r
                .respond("main", ID, &identity(), Decision::Remember, checked)
                .is_err());
            assert_eq!(rx.try_recv(), Err(oneshot::error::TryRecvError::Closed));
            assert!(r.snapshot("main", checked).prompt.is_none());
        }
    }
    #[test]
    fn old_cleanup_cannot_remove_new_prompt_and_revisions_increase() {
        let now = Instant::now();
        let mut r = Registry::default();
        let (first, _) = r
            .begin(
                "main",
                prompt(ID),
                now + Duration::from_secs(1),
                Arc::new(|| true),
                now,
            )
            .unwrap();
        assert!(r
            .begin(
                "main",
                prompt(ID),
                now + Duration::from_secs(1),
                Arc::new(|| true),
                now
            )
            .is_none());
        let closed = r.remove("main", ID, now);
        assert!(closed.revision > first.revision);
        let next_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let (next, _rx) = r
            .begin(
                "main",
                prompt(next_id),
                now + Duration::from_secs(1),
                Arc::new(|| true),
                now,
            )
            .unwrap();
        let late = r.remove("main", ID, now);
        assert_eq!(late.revision, next.revision);
        assert_eq!(late.prompt.unwrap().request_id, next_id);
    }
    #[test]
    fn parser_rejects_extra_authority_and_unknown_decisions() {
        assert!(
            serde_json::from_str::<Request>(r#"{"action":"pending","certificate":"fake"}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<Decision>("\"yes\"").is_err());
    }
}
