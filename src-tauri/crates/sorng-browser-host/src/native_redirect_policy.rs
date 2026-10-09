//! Pure decision for containing a denied redirect to one admitted resource or
//! verified main/subframe navigation. Downloads and workers are not eligible.
//! No URLs, credentials, CEF handles, transport changes or permission grants.
//!
//! Source contract verified against pinned CEF 682c378d70d5780061e96644dca16ddd8fd157a9:
//! `libcef/browser/net_service/resource_request_handler_wrapper.cc:929-961`
//! accepts a changed valid URL, updates the pending request and passes that URL
//! onward. Invalid/empty replacements cannot be relied on to stop the redirect.
//! `libcef/browser/net_service/proxy_url_loader_factory.cc:1058-1071` updates
//! the transport request URL; `FollowRedirect:778-798` calls `Restart:494-588`,
//! which rejects unsupported CORS schemes or re-enters OnBeforeRequest.
//! The wrapper reselects the handler at 608-624 and applies CANCEL at 762-771.
//! Thus a replacement handler must independently deny about:, not rely solely
//! on the previous handler's sticky flag. These are source guarantees; the
//! focused test harness is not live CEF transport verification.

/// A valid, non-network URL. An empty/invalid replacement is unsafe: pinned CEF
/// ignores it and keeps the original redirect destination.
pub(crate) const INERT_REDIRECT_TARGET: &str = "about:blank#blocked-native-request";

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct RedirectEvidence {
    pub admitted_request: bool,
    pub current_request_allowed: bool,
    pub verified_frame: bool,
    pub redirect_response: bool,
    pub inert_rewrite_succeeded: bool,
}

/// Only complete native evidence permits keeping the attempt alive. The caller
/// must set its sticky denied flag BEFORE rewriting, and continue cancelling
/// subsequent loads. This decision never allows the redirected request.
pub(crate) fn isolate_denied_redirect(evidence: RedirectEvidence) -> bool {
    evidence.admitted_request
        && evidence.current_request_allowed
        && evidence.verified_frame
        && evidence.redirect_response
        && evidence.inert_rewrite_succeeded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_missing_requirement_revokes_instead_of_isolating() {
        for bits in 0..32 {
            let evidence = RedirectEvidence {
                admitted_request: bits & 1 != 0,
                current_request_allowed: bits & 2 != 0,
                verified_frame: bits & 4 != 0,
                redirect_response: bits & 8 != 0,
                inert_rewrite_succeeded: bits & 16 != 0,
            };
            assert_eq!(isolate_denied_redirect(evidence), bits == 31, "{bits}");
        }
    }

    #[test]
    fn replacement_is_fixed_inert_and_not_an_empty_or_invalid_url() {
        assert_eq!(INERT_REDIRECT_TARGET, "about:blank#blocked-native-request");
        assert!(!INERT_REDIRECT_TARGET.contains("://"));
        assert!(!isolate_denied_redirect(RedirectEvidence::default()));
    }
}
