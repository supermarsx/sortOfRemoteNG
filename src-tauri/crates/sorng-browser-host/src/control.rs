//! Native-only lifecycle and ownership boundary for an embedded browser host.
//!
//! This module neither creates a browser nor proves transport containment. In
//! particular, attaching a view does not make its OriginBrowserSession ready.
//! Callers install their native handlers before attachment, apply commands on
//! the owning UI thread, and synchronously stop/hide the view and revoke its
//! session on close, failure or database lock. No type here is an IPC DTO.

use sorng_protocols::origin_browser::{BrowserIdentity, BrowserPolicyError, OriginBrowserSession};
use std::fmt;

/// Bounds use logical pixels relative to the parent content view, not screen
/// coordinates. Hosts must also validate their DPI-scaled native conversion.
/// These caps prevent unbounded coordinates/surfaces, not permission grants.
pub const MAX_VIEWPORT_EXTENT: f64 = 32_768.0;
pub const MAX_VIEWPORT_AREA: f64 = 67_108_864.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ViewportBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl ViewportBounds {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Result<Self, ControlError> {
        if ![x, y, width, height].into_iter().all(f64::is_finite)
            || x < 0.0
            || y < 0.0
            || width < 1.0
            || height < 1.0
            || x + width > MAX_VIEWPORT_EXTENT
            || y + height > MAX_VIEWPORT_EXTENT
            || width * height > MAX_VIEWPORT_AREA
        {
            return Err(ControlError::InvalidBounds);
        }
        Ok(Self {
            x,
            y,
            width,
            height,
        })
    }

    pub fn x(self) -> f64 {
        self.x
    }
    pub fn y(self) -> f64 {
        self.y
    }
    pub fn width(self) -> f64 {
        self.width
    }
    pub fn height(self) -> f64 {
        self.height
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lifecycle {
    Starting,
    Attached,
    Hidden,
    Closing,
    Closed,
    Faulted,
}

/// Errors contain neither owner identifiers nor URLs, paths or credentials.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlError {
    InvalidBounds,
    StaleIdentity,
    InvalidTransition,
    NavigationUnavailable,
    Session(BrowserPolicyError),
}

impl fmt::Display for ControlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBounds => f.write_str("Browser viewport bounds are invalid"),
            Self::StaleIdentity => f.write_str("Browser operation belongs to another attempt"),
            Self::InvalidTransition => f.write_str("Browser lifecycle transition is unavailable"),
            Self::NavigationUnavailable => {
                f.write_str("Browser view cannot navigate in this state")
            }
            Self::Session(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ControlError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Session(error) => Some(error),
            _ => None,
        }
    }
}

/// One immutable owner and attempt. Reconnection requires a fresh control;
/// there is deliberately no reset, owner setter, serde, Debug or Clone.
pub struct BrowserControl {
    identity: BrowserIdentity,
    bounds: ViewportBounds,
    lifecycle: Lifecycle,
}

impl BrowserControl {
    pub fn new(identity: BrowserIdentity, bounds: ViewportBounds) -> Self {
        Self {
            identity,
            bounds,
            lifecycle: Lifecycle::Starting,
        }
    }

    pub fn identity(&self) -> &BrowserIdentity {
        &self.identity
    }

    pub fn bounds(&self) -> ViewportBounds {
        self.bounds
    }

    pub fn lifecycle(&self) -> Lifecycle {
        self.lifecycle
    }

    fn check_identity(&self, identity: &BrowserIdentity) -> Result<(), ControlError> {
        if identity == &self.identity {
            Ok(())
        } else {
            Err(ControlError::StaleIdentity)
        }
    }

    /// Record successful native attachment, not readiness, permissions or
    /// completion of dark-mode/login initialization. No network is authorized.
    pub fn attached(&mut self, identity: &BrowserIdentity) -> Result<(), ControlError> {
        self.check_identity(identity)?;
        if self.lifecycle != Lifecycle::Starting {
            return Err(ControlError::InvalidTransition);
        }
        self.lifecycle = Lifecycle::Attached;
        Ok(())
    }

    pub fn hide(&mut self, identity: &BrowserIdentity) -> Result<(), ControlError> {
        self.check_identity(identity)?;
        if !matches!(self.lifecycle, Lifecycle::Attached | Lifecycle::Hidden) {
            return Err(ControlError::InvalidTransition);
        }
        self.lifecycle = Lifecycle::Hidden;
        Ok(())
    }

    pub fn show(&mut self, identity: &BrowserIdentity) -> Result<(), ControlError> {
        self.check_identity(identity)?;
        if !matches!(self.lifecycle, Lifecycle::Attached | Lifecycle::Hidden) {
            return Err(ControlError::InvalidTransition);
        }
        self.lifecycle = Lifecycle::Attached;
        Ok(())
    }

    /// Zoom is configuration, not focus or visibility. Startup applies it to
    /// the hidden attached view before first navigation/presentation. It must
    /// not show the view, authorize navigation, or revive a closing attempt.
    pub fn authorize_zoom(&self, identity: &BrowserIdentity) -> Result<(), ControlError> {
        self.check_identity(identity)?;
        if !matches!(self.lifecycle, Lifecycle::Attached | Lifecycle::Hidden) {
            return Err(ControlError::InvalidTransition);
        }
        Ok(())
    }

    /// Store validated bounds; zero-sized/minimized tabs must hide the view
    /// instead. On a native resize failure, fault and revoke the owning session.
    pub fn resize(
        &mut self,
        identity: &BrowserIdentity,
        bounds: ViewportBounds,
    ) -> Result<(), ControlError> {
        self.check_identity(identity)?;
        if !matches!(
            self.lifecycle,
            Lifecycle::Starting | Lifecycle::Attached | Lifecycle::Hidden
        ) {
            return Err(ControlError::InvalidTransition);
        }
        self.bounds = bounds;
        Ok(())
    }

    /// Fence navigation before initiating asynchronous native close. Returns
    /// false for duplicate close requests; Faulted may retry native cleanup.
    /// The caller must revoke the owning relay and stop/hide the native view.
    pub fn begin_close(&mut self, identity: &BrowserIdentity) -> Result<bool, ControlError> {
        self.check_identity(identity)?;
        if matches!(self.lifecycle, Lifecycle::Closing | Lifecycle::Closed) {
            return Ok(false);
        }
        self.lifecycle = Lifecycle::Closing;
        Ok(true)
    }

    /// Only the native close-completion callback may acknowledge cleanup.
    pub fn closed(&mut self, identity: &BrowserIdentity) -> Result<(), ControlError> {
        self.check_identity(identity)?;
        if !matches!(self.lifecycle, Lifecycle::Closing | Lifecycle::Closed) {
            return Err(ControlError::InvalidTransition);
        }
        self.lifecycle = Lifecycle::Closed;
        Ok(())
    }

    /// A fault never revives a closed view. Closing remains Closing so its
    /// eventual native completion can still be acknowledged without reopening.
    pub fn fault(&mut self, identity: &BrowserIdentity) -> Result<(), ControlError> {
        self.check_identity(identity)?;
        if self.lifecycle == Lifecycle::Closed {
            return Err(ControlError::InvalidTransition);
        }
        if self.lifecycle != Lifecycle::Closing {
            self.lifecycle = Lifecycle::Faulted;
        }
        Ok(())
    }

    /// Admission immediately before a native navigation/resource operation.
    /// Do not cache this result or await between validation and native use.
    /// Hidden tabs remain eligible, but neither attachment nor visibility can
    /// substitute for the real session's readiness and exact-origin checks.
    /// This does not authorize credentials, login consent or script injection.
    pub fn authorize_navigation(
        &self,
        identity: &BrowserIdentity,
        session: &OriginBrowserSession,
        value: &str,
    ) -> Result<(), ControlError> {
        self.check_identity(identity)?;
        if !matches!(self.lifecycle, Lifecycle::Attached | Lifecycle::Hidden) {
            return Err(ControlError::NavigationUnavailable);
        }
        session
            .authorize_navigation(&self.identity, value)
            .map(|_| ())
            .map_err(ControlError::Session)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_protocols::{
        origin_browser::OriginBrowserPolicy,
        private_forward_proxy::{Authority, DialFuture, ProxyLimits, RouteDialer},
    };
    use std::sync::Arc;

    fn policy() -> OriginBrowserPolicy {
        OriginBrowserPolicy::new(
            "owner-fixture",
            "connection-fixture",
            "session-fixture",
            "https://example.test",
        )
        .unwrap()
    }

    fn bounds() -> ViewportBounds {
        ViewportBounds::new(10.5, 40.0, 1024.0, 768.0).unwrap()
    }

    fn control() -> (BrowserControl, BrowserIdentity) {
        let identity = policy().identity().clone();
        (BrowserControl::new(identity.clone(), bounds()), identity)
    }

    async fn session() -> OriginBrowserSession {
        let dialer: Arc<dyn RouteDialer> = Arc::new(|_: Authority| -> DialFuture {
            Box::pin(async { Err(std::io::Error::other("control fixture must not dial")) })
        });
        OriginBrowserSession::start(policy(), dialer, ProxyLimits::default())
            .await
            .unwrap()
    }

    #[test]
    fn bounds_preserve_fractional_coordinates_and_reject_invalid_inputs() {
        let valid = bounds();
        assert_eq!(
            (valid.x(), valid.y(), valid.width(), valid.height()),
            (10.5, 40.0, 1024.0, 768.0)
        );
        for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0] {
            for index in 0..4 {
                let mut values = [0.0, 0.0, 100.0, 100.0];
                values[index] = invalid;
                assert_eq!(
                    ViewportBounds::new(values[0], values[1], values[2], values[3]),
                    Err(ControlError::InvalidBounds)
                );
            }
        }
        for (x, y, width, height) in [
            (0.0, 0.0, 0.0, 10.0),
            (0.0, 0.0, 10.0, 0.0),
            (0.0, 0.0, 0.5, 10.0),
            (MAX_VIEWPORT_EXTENT, 0.0, 1.0, 1.0),
            (0.0, MAX_VIEWPORT_EXTENT, 1.0, 1.0),
            (0.0, 0.0, 8193.0, 8193.0),
            (f64::MAX, 0.0, f64::MAX, 1.0),
        ] {
            assert_eq!(
                ViewportBounds::new(x, y, width, height),
                Err(ControlError::InvalidBounds)
            );
        }
        assert!(ViewportBounds::new(
            MAX_VIEWPORT_EXTENT - 1.0,
            MAX_VIEWPORT_EXTENT - 1.0,
            1.0,
            1.0
        )
        .is_ok());
        assert!(ViewportBounds::new(0.0, 0.0, 8192.0, 8192.0).is_ok());
    }

    #[test]
    fn lifecycle_attachment_visibility_and_resize_are_explicit() {
        let (mut view, id) = control();
        assert_eq!(view.lifecycle(), Lifecycle::Starting);
        assert_eq!(view.hide(&id), Err(ControlError::InvalidTransition));
        assert_eq!(view.show(&id), Err(ControlError::InvalidTransition));
        assert_eq!(view.closed(&id), Err(ControlError::InvalidTransition));
        view.resize(&id, bounds()).unwrap();
        view.attached(&id).unwrap();
        assert_eq!(view.attached(&id), Err(ControlError::InvalidTransition));
        view.hide(&id).unwrap();
        view.hide(&id).unwrap();
        assert_eq!(view.lifecycle(), Lifecycle::Hidden);
        let replacement = ViewportBounds::new(0.0, 0.0, 800.0, 600.0).unwrap();
        view.resize(&id, replacement).unwrap();
        assert_eq!(view.bounds(), replacement);
        view.show(&id).unwrap();
        view.show(&id).unwrap();
        assert_eq!(view.lifecycle(), Lifecycle::Attached);
        assert!(view.identity() == &id);
    }

    #[test]
    fn every_mutation_rejects_another_attempt_without_changing_state() {
        let (mut view, id) = control();
        let stale = policy().identity().clone();
        assert!(stale != id);
        assert_eq!(view.attached(&stale), Err(ControlError::StaleIdentity));
        view.attached(&id).unwrap();
        assert_eq!(view.hide(&stale), Err(ControlError::StaleIdentity));
        assert_eq!(view.show(&stale), Err(ControlError::StaleIdentity));
        assert_eq!(
            view.authorize_zoom(&stale),
            Err(ControlError::StaleIdentity)
        );
        assert_eq!(
            view.resize(&stale, bounds()),
            Err(ControlError::StaleIdentity)
        );
        assert_eq!(view.begin_close(&stale), Err(ControlError::StaleIdentity));
        assert_eq!(view.closed(&stale), Err(ControlError::StaleIdentity));
        assert_eq!(view.fault(&stale), Err(ControlError::StaleIdentity));
        assert_eq!(view.lifecycle(), Lifecycle::Attached);
        assert_eq!(view.bounds(), bounds());
    }

    #[test]
    fn startup_zoom_accepts_hidden_views_without_showing_or_reviving_them() {
        let (mut view, id) = control();
        assert_eq!(
            view.authorize_zoom(&id),
            Err(ControlError::InvalidTransition)
        );
        view.attached(&id).unwrap();
        view.authorize_zoom(&id).unwrap();
        view.hide(&id).unwrap();
        view.authorize_zoom(&id).unwrap();
        assert_eq!(view.lifecycle(), Lifecycle::Hidden);
        view.fault(&id).unwrap();
        assert_eq!(
            view.authorize_zoom(&id),
            Err(ControlError::InvalidTransition)
        );
        view.begin_close(&id).unwrap();
        assert_eq!(
            view.authorize_zoom(&id),
            Err(ControlError::InvalidTransition)
        );
        view.closed(&id).unwrap();
        assert_eq!(
            view.authorize_zoom(&id),
            Err(ControlError::InvalidTransition)
        );
    }

    #[test]
    fn close_is_idempotent_and_late_attach_cannot_resurrect_a_view() {
        let (mut view, id) = control();
        assert!(view.begin_close(&id).unwrap());
        assert!(!view.begin_close(&id).unwrap());
        assert_eq!(view.attached(&id), Err(ControlError::InvalidTransition));
        assert_eq!(view.show(&id), Err(ControlError::InvalidTransition));
        assert_eq!(view.hide(&id), Err(ControlError::InvalidTransition));
        assert_eq!(
            view.resize(&id, bounds()),
            Err(ControlError::InvalidTransition)
        );
        view.fault(&id).unwrap();
        assert_eq!(view.lifecycle(), Lifecycle::Closing);
        view.closed(&id).unwrap();
        view.closed(&id).unwrap();
        assert!(!view.begin_close(&id).unwrap());
        assert_eq!(view.fault(&id), Err(ControlError::InvalidTransition));
        assert_eq!(view.attached(&id), Err(ControlError::InvalidTransition));
        assert_eq!(view.show(&id), Err(ControlError::InvalidTransition));
        assert_eq!(view.lifecycle(), Lifecycle::Closed);
    }

    #[test]
    fn fault_is_terminal_except_for_cleanup() {
        let (mut view, id) = control();
        view.attached(&id).unwrap();
        view.fault(&id).unwrap();
        view.fault(&id).unwrap();
        assert_eq!(view.lifecycle(), Lifecycle::Faulted);
        assert_eq!(view.show(&id), Err(ControlError::InvalidTransition));
        assert_eq!(view.hide(&id), Err(ControlError::InvalidTransition));
        assert_eq!(view.attached(&id), Err(ControlError::InvalidTransition));
        assert_eq!(
            view.resize(&id, bounds()),
            Err(ControlError::InvalidTransition)
        );
        assert!(view.begin_close(&id).unwrap());
        view.closed(&id).unwrap();
    }

    #[tokio::test]
    async fn attachment_and_visibility_never_fabricate_session_readiness() {
        let mut session = session().await;
        let id = session.policy().identity().clone();
        let mut view = BrowserControl::new(id.clone(), bounds());
        let url = "https://example.test/";
        assert_eq!(
            view.authorize_navigation(&id, &session, url),
            Err(ControlError::NavigationUnavailable)
        );
        view.attached(&id).unwrap();
        assert_eq!(
            view.authorize_navigation(&id, &session, url),
            Err(ControlError::Session(BrowserPolicyError::NotReady))
        );
        view.hide(&id).unwrap();
        view.authorize_zoom(&id).unwrap();
        assert_eq!(
            view.authorize_navigation(&id, &session, url),
            Err(ControlError::Session(BrowserPolicyError::NotReady))
        );
        view.show(&id).unwrap();
        session.revoke(&id).unwrap();
        assert_eq!(
            view.authorize_navigation(&id, &session, url),
            Err(ControlError::Session(BrowserPolicyError::Revoked))
        );
        session.stop().await.unwrap();
    }

    #[tokio::test]
    async fn navigation_rejects_stale_callbacks_and_substituted_sessions() {
        let mut session = session().await;
        let (mut view, id) = control();
        view.attached(&id).unwrap();
        let other = session.policy().identity();
        assert_eq!(
            view.authorize_navigation(other, &session, "https://example.test/"),
            Err(ControlError::StaleIdentity)
        );
        assert_eq!(
            view.authorize_navigation(&id, &session, "https://example.test/"),
            Err(ControlError::Session(BrowserPolicyError::StaleIdentity))
        );
        session.stop().await.unwrap();
    }

    #[tokio::test]
    async fn fault_and_close_deny_navigation_before_native_cleanup_finishes() {
        let mut session = session().await;
        let id = session.policy().identity().clone();
        let mut view = BrowserControl::new(id.clone(), bounds());
        view.attached(&id).unwrap();
        view.fault(&id).unwrap();
        assert_eq!(
            view.authorize_navigation(&id, &session, "https://example.test/"),
            Err(ControlError::NavigationUnavailable)
        );
        view.begin_close(&id).unwrap();
        assert_eq!(
            view.authorize_navigation(&id, &session, "https://example.test/"),
            Err(ControlError::NavigationUnavailable)
        );
        view.closed(&id).unwrap();
        assert_eq!(
            view.authorize_navigation(&id, &session, "https://example.test/"),
            Err(ControlError::NavigationUnavailable)
        );
        session.stop().await.unwrap();
    }
}
