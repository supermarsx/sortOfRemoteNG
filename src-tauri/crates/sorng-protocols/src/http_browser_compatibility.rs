use serde::{Deserialize, Serialize};

/// Optional page behavior for an already approved proxy document. These flags
/// grant no origins, credentials, scripts, TLS exceptions or native privileges.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct BrowserCompatibility {
    pub hide_webdriver: bool,
}

#[cfg(test)]
#[path = "http_browser_compatibility_tests.rs"]
mod tests;
