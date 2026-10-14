// Included by cef_browser.rs: load errors affect a document, not its context.
wrap_load_handler! {
    struct NativeLoad { shared: Arc<Shared> }
    impl LoadHandler {
        fn on_loading_state_change(&self, browser: Option<&mut Browser>, is_loading: i32, can_go_back: i32, can_go_forward: i32) {
            // CEF includes child-frame loads here. Only main-frame BeforeBrowse
            // starts the automation fence; an iframe must not cancel typing.
            // Keep the stopped fallback for navigations cancelled before commit,
            // which do not receive OnLoadEnd, without clearing a main-load error.
            if is_loading == 0 && self.shared.accepts(browser.as_deref()) && self.shared.current() {
                let failed = self.shared.state.lock().map_or(true, |state| state.page.load_failure.is_some());
                self.shared.automation.lock().unwrap_or_else(|error| error.into_inner()).navigating = failed;
            }
            self.shared.update(browser.as_deref(), |page| {
                page.loading = is_loading == 1;
                page.can_go_back = can_go_back == 1;
                page.can_go_forward = can_go_forward == 1;
            });
        }
        fn on_load_end(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>, _http_status_code: i32) {
            if !self.shared.accepts(browser.as_deref()) || !self.shared.current() { return; }
            let (Some(browser), Some(frame)) = (browser, frame) else { return; };
            let Some(main) = browser.main_frame() else { return; };
            if frame.is_valid() != 1 || frame.is_main() != 1 || main.is_valid() != 1
                || CefString::from(&frame.identifier()).to_string() != CefString::from(&main.identifier()).to_string() { return; }
            // HTTP 4xx/5xx documents may contain useful server content; status
            // alone is not a transport failure. Conversely Chromium may finish
            // an internal error document after OnLoadError: never erase it here.
            let failed = self.shared.state.lock().map_or(true, |state| state.page.load_failure.is_some());
            self.shared.automation.lock().unwrap_or_else(|error| error.into_inner()).navigating = failed;
            let address = CefString::from(&frame.url()).to_string();
            let completed = !failed
                && address == CefString::from(&main.url()).to_string()
                && self.shared.session.lock().is_ok_and(|session|
                    navigation_allowed(&session, &self.shared.identity, &self.shared.permissions, &address, true));
            self.shared.update(Some(browser), |page| page.document_loaded = completed);
        }
        fn on_load_error(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>,
            error_code: Errorcode, _error_text: Option<&CefString>, _failed_url: Option<&CefString>) {
            if !self.shared.accepts(browser.as_deref()) || !self.shared.current() { return; }
            // Before commit (including a failed redirect), CEF can report the
            // provisional main frame while browser.main_frame() still describes
            // the old document. Use the callback's main/subframe role, not URL
            // or current-frame identity equality, to classify the failed load.
            let main_frame = frame.as_ref().is_some_and(|frame| frame.is_main() == 1);
            let code = cef_dll_sys::cef_errorcode_t::from(error_code) as i32;
            self.shared.navigation_status(NativeNavigationStatus::LoadError { code, main_frame });
            if let Some(failure) = crate::native_navigation::classify_load_error(code, main_frame) {
                // Keep the live context for back/navigation/DevTools. Do not
                // retry a possibly submitted POST or change security policy.
                // The shell hides this native surface while showing diagnostics.
                self.shared.automation.lock().unwrap_or_else(|error| error.into_inner()).navigating = true;
                self.shared.clear_automation();
                self.shared.cancel_certificate(None);
                // Hide synchronously on the CEF callback thread, before the
                // shell event is delivered. Chromium's provisional error/blank
                // surface cannot paint over the shell's themed diagnostics.
                if let Some(host) = browser.as_ref().and_then(|browser| browser.host()) {
                    host.set_focus(0);
                    let _ = native_surface::visible(host.window_handle(), false);
                }
                if let Ok(mut state) = self.shared.state.lock() {
                    let _ = state.control.hide(&self.shared.identity);
                }
                self.shared.update(browser.as_deref(), |page| {
                    page.load_failure = Some(failure);
                    page.loading = false;
                    page.document_loaded = false;
                });
            }
        }
    }
}

#[cfg(test)]
#[path = "cef_load_tests.rs"]
mod load_tests;
