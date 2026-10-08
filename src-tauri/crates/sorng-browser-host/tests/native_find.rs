#[path = "../src/native_find.rs"]
mod model;
use model::{FindState, Request};

const A: &str = "10000000-0000-4000-8000-000000000001";
const B: &str = "10000000-0000-4000-8000-000000000002";
const C: &str = "10000000-0000-4000-8000-000000000003";

fn request(id: &str, text: &str, next: bool) -> Request<&'static str> {
    Request {
        request_id: id.into(),
        text: text.to_owned().into(),
        forward: true,
        match_case: false,
        find_next: next,
        completion: "owner-view",
    }
}

#[test]
fn only_native_counts_can_produce_a_result() {
    let mut state = FindState::default();
    assert!(state.reply(12, 8, 1, 1).is_none());
    let dispatch = state.submit(request(A, " term ", false)).unwrap();
    assert!(dispatch.restart);
    assert_eq!(dispatch.text.as_str(), " term ");
    assert!(dispatch.forward);
    assert!(!dispatch.match_case);
    let (owner, result) = state.reply(73, 8, 1, 0).unwrap();
    assert_eq!(owner, "owner-view");
    assert_eq!(result.request_id, A);
    assert_eq!(result.number_of_matches, 8);
    assert_eq!(result.active_match_ordinal, 1);
    assert!(!result.final_update);
    assert!(state.reply(73, 8, 1, 1).unwrap().1.final_update);
    assert!(state.reply(73, 9, 2, 0).is_none());
}

#[test]
fn unknown_values_are_not_fabricated_as_zero() {
    let mut state = FindState::default();
    state.submit(request(A, "needle", false));
    assert!(state.reply(-1, 0, 0, 1).is_none());
    assert!(state.reply(6, -1, -1, 0).is_none());
    assert!(state.reply(6, 3, -1, 0).is_none());
    assert!(state.reply(6, 3, 4, 0).is_none());
    assert!(state.reply(6, 3, 1, 2).is_none());
    let result = state.reply(6, 0, 0, 1).unwrap().1;
    assert_eq!(result.number_of_matches, 0);
    assert_eq!(result.active_match_ordinal, 0);
}

#[test]
fn next_is_serialized_until_final_then_requires_a_new_native_id() {
    let mut state = FindState::default();
    state.submit(request(A, "needle", false));
    assert!(state.submit(request(B, "needle", true)).is_none());
    assert!(!state.ready());
    assert!(state.reply(30, 7, 1, 0).is_none()); // old UI token superseded
    assert!(state.reply(30, 7, 1, 1).is_none());
    assert!(state.ready());
    assert!(!state.advance().unwrap().restart);
    assert!(state.reply(30, 7, 1, 1).is_none()); // late previous native result
    let result = state.reply(92, 7, 2, 1).unwrap().1; // other tabs used IDs
    assert_eq!(result.request_id, B);
    assert_eq!(result.active_match_ordinal, 2);
}

#[test]
fn queue_is_bounded_latest_intent_and_preserves_backwards_direction() {
    let mut state = FindState::default();
    state.submit(request(A, "needle", false));
    state.submit(request(B, "needle", true));
    let mut last = request(C, "needle", true);
    last.forward = false;
    assert!(state.submit(last).is_none());
    state.reply(10, 5, 1, 1);
    let dispatch = state.advance().unwrap();
    assert!(!dispatch.forward);
    assert!(!dispatch.restart);
    assert_eq!(state.reply(11, 5, 5, 1).unwrap().1.request_id, C);
}

#[test]
fn changed_query_and_case_force_a_new_native_session() {
    let mut state = FindState::default();
    state.submit(request(A, "one", false));
    state.reply(8, 4, 1, 0);
    state.submit(request(B, "one", true));
    assert!(state.submit(request(C, "two", true)).unwrap().restart);
    assert!(state.reply(8, 4, 1, 1).is_none());
    assert_eq!(state.reply(9, 2, 1, 1).unwrap().1.request_id, C);
    let mut case = request(A, "two", true);
    case.match_case = true;
    let dispatch = state.submit(case).unwrap();
    assert!(dispatch.restart && dispatch.match_case);
}

#[test]
fn explicit_restart_really_restarts_even_for_identical_text() {
    let mut state = FindState::default();
    state.submit(request(A, "same", false));
    state.reply(7, 3, 1, 1);
    assert!(state.submit(request(B, "same", false)).unwrap().restart);
    assert!(state.reply(7, 3, 1, 1).is_none());
    assert_eq!(state.reply(8, 3, 1, 1).unwrap().1.request_id, B);
}

#[test]
fn stop_navigation_and_owner_closure_clear_active_and_queued_work() {
    let mut state = FindState::default();
    state.submit(request(A, "one", false));
    state.reply(14, 3, 1, 0);
    state.submit(request(B, "one", true));
    state.clear();
    assert!(!state.ready());
    assert!(state.advance().is_none());
    assert!(state.reply(14, 3, 1, 1).is_none());
    assert!(state.submit(request(C, "one", true)).unwrap().restart);
    assert!(state.reply(14, 3, 1, 1).is_none());
    assert_eq!(state.reply(15, 3, 1, 1).unwrap().1.request_id, C);
}

#[test]
fn unknown_final_reply_drains_queue_without_a_fake_result() {
    let mut state = FindState::default();
    state.submit(request(A, "one", false));
    state.submit(request(B, "one", true));
    assert!(state.reply(4, -1, -1, 1).is_none());
    assert!(state.ready());
    assert!(state.advance().is_some());
}

#[test]
fn timeout_drops_pending_intents_but_not_a_completed_anchor() {
    let mut state = FindState::default();
    state.submit(request(A, "one", false));
    state.submit(request(B, "one", true));
    assert!(state.expire());
    assert!(state.advance().is_none());
    assert!(state.reply(5, 3, 1, 1).is_none());
    assert!(state.submit(request(C, "one", true)).unwrap().restart);
    state.reply(6, 3, 1, 1);
    assert!(!state.expire());
    assert!(!state.submit(request(A, "one", true)).unwrap().restart);
}

#[test]
fn root_and_popup_states_never_share_identifiers_or_completions() {
    let mut root = FindState::default();
    let mut popup = FindState::default();
    root.submit(request(A, "root", false));
    let mut child = request(B, "popup", false);
    child.completion = "popup-view";
    popup.submit(child);
    assert_eq!(root.reply(0, 4, 1, 1).unwrap().0, "owner-view");
    assert_eq!(popup.reply(17, 2, 1, 1).unwrap().0, "popup-view");
    assert!(!root.submit(request(C, "root", true)).unwrap().restart);
    assert_eq!(root.reply(18, 4, 2, 1).unwrap().1.request_id, C);
}

#[test]
fn uuid_contract_and_json_are_bounded_and_query_free() {
    assert!(model::valid_request_id(A));
    for value in [
        "",
        "search-text",
        "10000000-0000-4000-8000-00000000000z",
        "100000000000040008000000000000001",
    ] {
        assert!(!model::valid_request_id(value));
    }
    let result = model::NativeFindResult {
        request_id: A.into(),
        active_match_ordinal: 2,
        number_of_matches: 3,
        final_update: true,
    };
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        serde_json::json!({
            "requestId": A, "activeMatchOrdinal": 2, "numberOfMatches": 3, "finalUpdate": true,
        })
    );
}

#[test]
fn host_contract_uses_native_callbacks_and_document_fences_not_focus_or_scripts() {
    let host = include_str!("../src/cef_browser.rs");
    let native = include_str!("../src/cef_find.rs");
    assert!(host.contains("fn find_handler(&self) -> Option<FindHandler> { Some(cef_find::handler(self.shared.clone())) }"));
    assert!(host.contains("cef_find::invalidate(self);"));
    assert!(native.contains("generation != Some(slot.generation)"));
    assert!(native.contains("shared.focus_allowed(Some(browser))"));
    assert!(native.contains("if request.restart"));
    assert!(native.contains("host.stop_finding(1)"));
    for forbidden in [
        "execute_java_script",
        "execute_dev_tools_method",
        "set_focus",
        "was_hidden",
        "set_visibility",
    ] {
        assert!(!native.contains(forbidden));
    }
}
