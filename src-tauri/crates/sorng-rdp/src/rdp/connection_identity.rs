//! Actor selection without transport or runtime dependencies. Frontend tab
//! slots and legacy saved-connection/endpoint slots occupy separate namespaces.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RdpConnectionSelector {
    SessionId(String),
    FrontendSessionId(String),
    ConnectionId(String),
    Endpoint {
        host: String,
        port: u16,
        username: String,
    },
}

pub struct RdpConnectionIdentity<'a> {
    pub session_id: &'a str,
    pub frontend_session_id: Option<&'a str>,
    pub connection_id: Option<&'a str>,
    pub host: &'a str,
    pub port: u16,
    pub username: &'a str,
}

fn valid_slot_id(id: &str) -> bool {
    !id.trim().is_empty() && id.len() <= 256 && !id.chars().any(char::is_control)
}

impl RdpConnectionSelector {
    pub fn for_connect(
        frontend_session_id: Option<&str>,
        connection_id: Option<&str>,
        host: &str,
        port: u16,
        username: &str,
    ) -> Result<Self, String> {
        if let Some(id) = frontend_session_id {
            // Invalid explicit identity must not downgrade to a legacy slot.
            if !valid_slot_id(id) {
                return Err("Invalid RDP frontend session identity".into());
            }
            return Ok(Self::FrontendSessionId(id.to_owned()));
        }
        Ok(match connection_id {
            Some(id) if valid_slot_id(id) => Self::ConnectionId(id.to_owned()),
            Some(_) => return Err("Invalid RDP legacy connection identity".into()),
            None => Self::Endpoint {
                host: host.to_owned(),
                port,
                username: username.to_owned(),
            },
        })
    }

    /// An explicit actor always wins, including when it no longer exists.
    pub fn for_existing(session_id: Option<&str>, connection_id: Option<&str>) -> Option<Self> {
        match session_id {
            Some(id) => valid_slot_id(id).then(|| Self::SessionId(id.to_owned())),
            None => connection_id
                .filter(|id| valid_slot_id(id))
                .map(|id| Self::ConnectionId(id.to_owned())),
        }
    }

    pub fn matches(&self, identity: &RdpConnectionIdentity<'_>) -> bool {
        match self {
            Self::SessionId(id) => identity.session_id == id,
            Self::FrontendSessionId(id) => identity.frontend_session_id == Some(id.as_str()),
            Self::ConnectionId(id) => {
                identity.frontend_session_id.is_none()
                    && identity.connection_id == Some(id.as_str())
            }
            Self::Endpoint {
                host,
                port,
                username,
            } => {
                identity.frontend_session_id.is_none()
                    && identity.host == host
                    && identity.port == *port
                    && identity.username == username
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn actor<'a>(session_id: &'a str, tab: Option<&'a str>) -> RdpConnectionIdentity<'a> {
        RdpConnectionIdentity {
            session_id,
            frontend_session_id: tab,
            connection_id: Some("saved-connection"),
            host: "rdp.test",
            port: 3389,
            username: "user",
        }
    }

    fn slot(tab: Option<&str>, connection: Option<&str>) -> RdpConnectionSelector {
        RdpConnectionSelector::for_connect(tab, connection, "rdp.test", 3389, "user").unwrap()
    }

    #[test]
    fn tabs_of_one_saved_connection_have_independent_replacement_slots() {
        let a = slot(Some("tab-a"), Some("saved-connection"));
        let b = slot(Some("tab-b"), Some("saved-connection"));
        assert_ne!(a, b);
        assert!(a.matches(&actor("backend-a", Some("tab-a"))));
        assert!(!a.matches(&actor("backend-b", Some("tab-b"))));
        assert!(b.matches(&actor("backend-b", Some("tab-b"))));
    }

    #[test]
    fn replacement_identity_survives_backend_recreation_and_endpoint_changes() {
        let a = slot(Some("tab-a"), Some("saved-connection"));
        assert!(a.matches(&actor("backend-old", Some("tab-a"))));
        assert!(a.matches(&actor("backend-new", Some("tab-a"))));
        assert_eq!(
            a,
            RdpConnectionSelector::for_connect(Some("tab-a"), None, "127.0.0.1", 43190, "other")
                .unwrap()
        );
    }

    #[test]
    fn legacy_connection_and_endpoint_slots_cannot_replace_explicit_tabs() {
        for legacy in [slot(None, Some("saved-connection")), slot(None, None)] {
            assert!(legacy.matches(&actor("legacy-backend", None)));
            assert!(!legacy.matches(&actor("backend-a", Some("tab-a"))));
        }
        assert!(
            !slot(Some("tab-a"), Some("saved-connection")).matches(&actor("legacy-backend", None))
        );
    }

    #[test]
    fn explicit_identity_cannot_alias_a_legacy_connection_or_backend_id() {
        let frontend = slot(Some("saved-connection"), Some("saved-connection"));
        assert!(!frontend.matches(&actor("saved-connection", None)));
        assert!(frontend.matches(&actor("backend", Some("saved-connection"))));
    }

    #[test]
    fn exact_existing_actor_never_falls_through_to_a_peer() {
        let selector =
            RdpConnectionSelector::for_existing(Some("ended"), Some("saved-connection")).unwrap();
        assert!(!selector.matches(&actor("peer", None)));
        assert!(!selector.matches(&actor("peer", Some("tab-b"))));
        assert!(selector.matches(&actor("ended", Some("tab-a"))));
        assert!(RdpConnectionSelector::for_existing(None, None).is_none());
    }

    #[test]
    fn invalid_tab_ids_are_rejected_without_legacy_fallback() {
        for id in ["", " ", "tab\npeer", &"x".repeat(257)] {
            assert!(RdpConnectionSelector::for_connect(
                Some(id),
                Some("saved-connection"),
                "rdp.test",
                3389,
                "user"
            )
            .is_err());
        }
    }

    #[test]
    fn empty_legacy_ids_cannot_claim_a_shared_slot_or_fall_back_from_an_explicit_actor() {
        for id in ["", " ", "\n"] {
            assert!(
                RdpConnectionSelector::for_connect(None, Some(id), "rdp.test", 3389, "user")
                    .is_err()
            );
            assert!(RdpConnectionSelector::for_existing(None, Some(id)).is_none());
            assert!(
                RdpConnectionSelector::for_existing(Some(id), Some("saved-connection")).is_none()
            );
        }
        assert!(
            RdpConnectionSelector::for_existing(None, Some("saved-connection"))
                .unwrap()
                .matches(&actor("legacy", None))
        );
    }
}
