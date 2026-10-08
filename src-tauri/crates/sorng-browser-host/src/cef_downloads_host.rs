//! Include as a child module of cef_browser once its shared editing lane is
//! released. The host and NativeClient share one DownloadAttachment field.
use super::{BrowserError, CefBrowserHost, Shared};
use crate::{
    cef_downloads::CefDownloadGuard,
    cef_requests::navigation_allowed,
    ipc::OriginBrowserIdentity,
    native_downloads::{
        download_policy_url, DownloadControlRequest, DownloadError, DownloadSnapshot,
        NativeDownloadDelegate,
    },
};
use cef::{Browser, CefString, ImplBrowser, ImplFrame};
use sorng_protocols::origin_browser::BrowserIdentity;
use std::sync::Arc;

impl CefDownloadGuard for Shared {
    fn is_current(&self) -> bool {
        Shared::current(self)
    }
    fn accepts(&self, browser: &Browser) -> bool {
        Shared::accepts(self, Some(browser))
    }
    fn allows_destination(&self, browser: &Browser, url: &str) -> bool {
        if !Shared::accepts(self, Some(browser)) {
            return false;
        }
        let document = browser
            .main_frame()
            .filter(|frame| {
                frame.is_valid() == 1
                    && frame.is_main() == 1
                    && frame
                        .browser()
                        .is_some_and(|owner| owner.identifier() == browser.identifier())
            })
            .map(|frame| CefString::from(&frame.url()).to_string());
        let Some(policy_url) = download_policy_url(url, document.as_deref()) else {
            return false;
        };
        let session = match self.session.lock() {
            Ok(session) => session,
            Err(poisoned) => {
                let _ = poisoned.into_inner().revoke(&self.identity);
                return false;
            }
        };
        navigation_allowed(
            &session,
            &self.identity,
            &self.permissions,
            &policy_url,
            true,
        )
    }
}

impl CefBrowserHost<'_> {
    /// Native-only attachment, after inert host creation and before navigation.
    /// An explicitly disabled delegate installs successfully but permits no
    /// downloads; disabling downloads must not prevent website startup.
    pub fn enable_downloads(
        &self,
        delegate: Arc<dyn NativeDownloadDelegate>,
    ) -> Result<(), BrowserError> {
        self.check(self.identity())?;
        self.downloads
            .attach(self.identity().clone(), delegate, self.shared.clone())
            .map_err(|_| BrowserError::StateUnavailable)
    }

    pub fn downloads(
        &self,
        identity: &BrowserIdentity,
    ) -> Result<Vec<DownloadSnapshot>, DownloadError> {
        self.check(identity)
            .map_err(|_| DownloadError::OwnerUnavailable)?;
        self.downloads
            .list(&OriginBrowserIdentity::from_native(identity))
    }

    pub fn download_control(&self, request: &DownloadControlRequest) -> Result<(), DownloadError> {
        request
            .identity
            .validate_matches(self.identity())
            .map_err(|_| DownloadError::OwnerUnavailable)?;
        self.check(self.identity())
            .map_err(|_| DownloadError::OwnerUnavailable)?;
        self.downloads.control(request)
    }
}
