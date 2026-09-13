//! Native-generated, bounded request diagnostics. No request payload or error
//! chain is serialized here; codes/stages come from closed native branches.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RedirectPathCategory {
    Root,
    Dsm,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyLogDiagnostic {
    pub phase: String,
    pub stage: String,
    pub code: String,
    pub outcome: String,
    /// Elapsed time through the reported stage, not a website-ready metric.
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lane: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queue_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream_status: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hop: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redirect_source_path: Option<RedirectPathCategory>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redirect_target_path: Option<RedirectPathCategory>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redirect_target_origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redirect_query_removed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub same_origin_redirects: Option<u32>,
}

pub(super) fn elapsed_ms(start: std::time::Instant) -> u64 {
    start.elapsed().as_millis().min(86_400_000) as u64
}

impl ProxyLogDiagnostic {
    pub(super) fn new(
        phase: &'static str,
        stage: &'static str,
        code: &'static str,
        outcome: &'static str,
        start: std::time::Instant,
    ) -> Self {
        Self {
            phase: phase.into(),
            stage: stage.into(),
            code: code.into(),
            outcome: outcome.into(),
            duration_ms: elapsed_ms(start),
            lane: None,
            queue_ms: None,
            active_ms: None,
            upstream_status: None,
            attempt_id: None,
            hop: None,
            redirect_source_path: None,
            redirect_target_path: None,
            redirect_target_origin: None,
            redirect_query_removed: None,
            same_origin_redirects: None,
        }
    }

    pub(super) fn with_redirect(mut self, redirect: &super::upstream::CrossOriginRedirect) -> Self {
        let category = |url: &reqwest::Url| match url.path() {
            "/" => RedirectPathCategory::Root,
            path if path == "/webman" || path.starts_with("/webman/") => RedirectPathCategory::Dsm,
            _ => RedirectPathCategory::Other,
        };
        self.upstream_status = Some(redirect.status);
        self.redirect_source_path = Some(category(&redirect.response_url));
        self.redirect_target_path = Some(category(&redirect.destination));
        let target = &redirect.destination;
        if matches!(target.scheme(), "http" | "https")
            && target.username().is_empty()
            && target.password().is_none()
            && target.port() != Some(0)
            && target.host_str().is_some_and(|host| !host.ends_with('.'))
        {
            self.redirect_target_origin = Some(target.origin().ascii_serialization());
        }
        self.redirect_query_removed = Some(target.query().is_some() || target.fragment().is_some());
        self.same_origin_redirects = Some(redirect.same_origin_redirects.min(20));
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_wire_contract_is_additive_and_contains_no_payload_fields() {
        let mut diagnostic = ProxyLogDiagnostic::new(
            "http",
            "response_headers",
            "http_response",
            "succeeded",
            std::time::Instant::now(),
        );
        diagnostic.upstream_status = Some(200);
        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["upstreamStatus"], 200);
        assert!(value["durationMs"].is_u64());
        assert_eq!(value.as_object().unwrap().len(), 6);
        assert!(value.get("attemptId").is_none());
        assert!(value.get("queueMs").is_none());
    }
}
