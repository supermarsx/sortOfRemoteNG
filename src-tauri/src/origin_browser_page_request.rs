//! Narrow shell DTOs; available even when native-browser is not compiled.
use serde::{Deserialize, Serialize};
use sorng_browser_host::ipc::OriginBrowserIdentity;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PageMenuRequest {
    pub identity: OriginBrowserIdentity,
    pub view_id: Option<String>,
    pub action: PageMenuAction,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum PageMenuAction {
    Print {},
    History {},
    HistoryJump { snapshot_id: String, index: i32 },
}

#[cfg(any(feature = "native-browser", test))]
impl PageMenuRequest {
    pub(crate) fn validate(&self) -> Result<(), &'static str> {
        self.identity
            .validate()
            .map_err(|_| "Invalid native page identity.")?;
        if self
            .view_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 128)
            || matches!(&self.action, PageMenuAction::HistoryJump { snapshot_id, index }
                if snapshot_id.is_empty() || snapshot_id.len() > 32 || !snapshot_id.bytes().all(|b| b.is_ascii_digit()) || *index < 0 || *index >= 128)
        {
            return Err("Invalid native page-menu request.");
        }
        Ok(())
    }
}

#[cfg(any(feature = "native-browser", test))]
pub(crate) fn target_is_current(
    target: Option<&str>,
    selected: Option<&str>,
    visible: bool,
    blocked: bool,
    mutating: bool,
) -> bool {
    target == selected && visible && (!mutating || !blocked)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> PageMenuRequest {
        PageMenuRequest {
            identity: OriginBrowserIdentity {
                owner_database_id: "owner".into(),
                connection_id: "connection".into(),
                session_id: "session".into(),
                attempt_id: "11111111-1111-4111-8111-111111111111".into(),
            },
            view_id: None,
            action: PageMenuAction::History {},
        }
    }
    #[test]
    fn validates_identity_token_size_and_bounded_index() {
        assert!(request().validate().is_ok());
        for (token, index) in [
            ("".to_string(), 0),
            ("x".into(), 0),
            ("1".repeat(33), 0),
            ("1".into(), -1),
            ("1".into(), 128),
        ] {
            let mut value = request();
            value.action = PageMenuAction::HistoryJump {
                snapshot_id: token,
                index,
            };
            assert!(value.validate().is_err());
        }
        let mut value = request();
        value.identity.owner_database_id.clear();
        assert!(value.validate().is_err());
        let mut value = request();
        value.view_id = Some("x".repeat(129));
        assert!(value.validate().is_err());
    }
    #[test]
    fn actions_reject_urls_scripts_print_paths_and_unknown_fields() {
        for invalid in [
            serde_json::json!({"kind":"print", "path":"output.pdf"}),
            serde_json::json!({"kind":"history", "limit":99999}),
            serde_json::json!({"kind":"historyJump", "snapshotId":"1", "index":0, "url":"https://fixture.invalid"}),
            serde_json::json!({"kind":"evaluate", "script":"print()"}),
        ] {
            assert!(serde_json::from_value::<PageMenuAction>(invalid).is_err());
        }
        for valid in [
            serde_json::json!({"kind":"print"}),
            serde_json::json!({"kind":"history"}),
            serde_json::json!({"kind":"historyJump", "snapshotId":"1", "index":0}),
        ] {
            assert!(serde_json::from_value::<PageMenuAction>(valid).is_ok());
        }
    }
    #[test]
    fn root_and_popup_are_exact_not_selection_fallbacks() {
        assert!(target_is_current(None, None, true, false, true));
        assert!(target_is_current(
            Some("child"),
            Some("child"),
            true,
            false,
            true
        ));
        assert!(!target_is_current(None, Some("child"), true, false, true));
        assert!(!target_is_current(Some("child"), None, true, false, true));
        assert!(!target_is_current(
            Some("old"),
            Some("new"),
            true,
            false,
            true
        ));
    }
    #[test]
    fn trusted_overlay_can_list_but_cannot_print_or_jump() {
        assert!(target_is_current(None, None, true, true, false));
        assert!(!target_is_current(None, None, true, true, true));
        assert!(!target_is_current(None, None, false, false, false));
        assert!(!target_is_current(None, None, false, false, true));
    }
}
