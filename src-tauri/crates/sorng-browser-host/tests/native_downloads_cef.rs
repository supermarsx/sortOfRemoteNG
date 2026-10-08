#![cfg(feature = "cef-host")]
//! Compile the public CEF attachment contract without starting a native engine.
#![allow(dead_code)]
use sorng_browser_host::{
    cef_downloads::{CefDownloadGuard, DownloadAttachment},
    ipc::OriginBrowserIdentity,
    native_downloads::*,
};
use sorng_protocols::origin_browser::BrowserIdentity;
use std::sync::Arc;

fn public_contract(
    slot: &DownloadAttachment,
    identity: BrowserIdentity,
    request: &DownloadControlRequest,
    delegate: Arc<dyn NativeDownloadDelegate>,
    guard: Arc<dyn CefDownloadGuard>,
) {
    let _: Result<(), DownloadError> = slot.attach(identity.clone(), delegate, guard);
    let _: Result<Vec<DownloadSnapshot>, DownloadError> =
        slot.list(&OriginBrowserIdentity::from_native(&identity));
    let _: Result<(), DownloadError> = slot.control(request);
    let _: cef::DownloadHandler = slot.handler();
    slot.revoke();
}
