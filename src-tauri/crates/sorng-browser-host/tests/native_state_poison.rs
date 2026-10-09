//! Std-only source contracts for the two view-state poison paths.
//! Executable Shared/relay regressions live in cef_popups_tests.rs (cef-host).
const SOURCE: &str = include_str!("../src/cef_browser.rs");

fn block<'a>(source: &'a str, marker: &str) -> &'a str {
    let tail = source.split_once(marker).expect("production marker").1;
    let start = tail.find('{').expect("opening brace");
    let mut depth = 0;
    for (offset, byte) in tail[start..].bytes().enumerate() {
        match byte {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return &tail[start + 1..start + offset];
                }
            }
            _ => {}
        }
    }
    panic!("unterminated production block");
}

#[test]
fn callback_and_control_state_poison_record_reason_only_for_source() {
    for (method, branch, owner) in [
        ("fn update_state(&self,", "Err(poisoned) =>", "self"),
        ("fn check(&self, identity:", "if self.shared.state.is_poisoned()", "self.shared"),
    ] {
        let body = block(SOURCE, method);
        let poison = block(body, branch);
        let guard = format!("if {owner}.popup.view_closed().is_none()");
        let guarded = block(poison, &guard);
        assert!(guarded.contains(&format!("{owner}.session.lock()")));
        assert!(guarded.contains("BrowserSessionFailure::NativeState"));
        assert_eq!(poison.matches(".revoke_for(").count(), 1);
        assert_eq!(guarded.matches(".revoke_for(").count(), 1);
        assert!(!guarded.contains(".fault("), "both source and child must still fault");
        assert!(poison.contains(&format!("{owner}.fault(")));
    }
}

#[test]
fn shared_session_poison_still_revokes_regardless_of_view_role() {
    let current = block(SOURCE, "fn current(&self) -> bool");
    let poison = block(current, "Err(poisoned) =>");
    assert!(poison.contains("revoke_for(&self.identity, BrowserSessionFailure::NativeState)"));
    assert!(!poison.contains("view_closed()"));

    let revoke = block(SOURCE, "fn revoke(&self)");
    assert!(revoke.contains("closed.store(true, Ordering::Release)"));
    assert!(revoke.contains("session.revoke(&self.identity)"));
}
