//! Compile the app-only dialog/owner adapter even without loading CEF. This
//! intentionally does not open dialogs, launch file managers, or fetch URLs.
#[allow(dead_code)]
#[path = "../src/origin_browser_downloads.rs"]
mod owner;
