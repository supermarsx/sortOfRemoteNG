//! Local resources owned by Chromium's inspector, not website permissions.
//! In particular `devtools://devtools/remote/` is a network-backed frontend and
//! must not be admitted by a general `devtools:` scheme exception.

pub(super) fn bundled_document(value: &str) -> bool {
    local_resource(value) == Some(LocalResource::Bundled)
}

pub(super) fn inspector_resource(value: &str) -> bool {
    local_resource(value).is_some()
}

pub(super) fn bootstrap_document(value: &str) -> bool {
    bundled_document(value)
        && url::Url::parse(value).is_ok_and(|url| url.path() == "/bundled/devtools_app.html")
}

pub(super) struct BootstrapRequest<'a> {
    pub no_browser: bool,
    pub no_frame: bool,
    pub navigation: i32,
    pub download: i32,
    pub main_frame: bool,
    pub method: &'a str,
    pub initiator: &'a str,
    pub url: &'a str,
}

impl BootstrapRequest<'_> {
    pub fn eligible(&self) -> bool {
        self.no_browser
            && self.no_frame
            && self.navigation == 1
            && self.download == 0
            && self.main_frame
            && self.method == "GET"
            && matches!(self.initiator, "" | "null")
            && bootstrap_document(self.url)
    }
}

#[derive(PartialEq)]
enum LocalResource {
    Bundled,
    Theme,
}

fn local_resource(value: &str) -> Option<LocalResource> {
    let url = url::Url::parse(value).ok()?;
    if url.scheme() != "devtools"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || value.contains('\\')
    {
        return None;
    }
    // Refuse ambiguous encoded path separators/dot segments before Chromium's
    // URLDataSource interprets the path. Queries on real bundled assets remain
    // supported (DevTools adds its own frontend settings there).
    let path = url.path().to_ascii_lowercase();
    if ["%2e", "%2f", "%5c", "%00"]
        .iter()
        .any(|part| path.contains(part))
    {
        return None;
    }
    match url.host_str()? {
        "devtools" if url.path().starts_with("/bundled/") => Some(LocalResource::Bundled),
        // ThemeSupport.ts in the pinned frontend requests Chromium's local
        // theme CSS. This has no network destination and no website authority.
        "theme" if url.path() == "/colors.css" => Some(LocalResource::Theme),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_browserless_native_inspector_document_can_consume_bootstrap() {
        let valid = || BootstrapRequest {
            no_browser: true,
            no_frame: true,
            navigation: 1,
            download: 0,
            main_frame: true,
            method: "GET",
            initiator: "null",
            url: "devtools://devtools/bundled/devtools_app.html?can_dock=true",
        };
        assert!(valid().eligible());
        for request in [
            BootstrapRequest {
                no_browser: false,
                ..valid()
            },
            BootstrapRequest {
                no_frame: false,
                ..valid()
            },
            BootstrapRequest {
                navigation: 0,
                ..valid()
            },
            BootstrapRequest {
                download: 1,
                ..valid()
            },
            BootstrapRequest {
                main_frame: false,
                ..valid()
            },
            BootstrapRequest {
                method: "POST",
                ..valid()
            },
            BootstrapRequest {
                initiator: "https://fixture.test",
                ..valid()
            },
            BootstrapRequest {
                url: "devtools://devtools/bundled/main.js",
                ..valid()
            },
            BootstrapRequest {
                url: "devtools://theme/colors.css",
                ..valid()
            },
            BootstrapRequest {
                url: "devtools://devtools/remote/devtools_app.html",
                ..valid()
            },
            BootstrapRequest {
                url: "https://fixture.test/devtools_app.html",
                ..valid()
            },
        ] {
            assert!(!request.eligible());
        }
    }

    #[test]
    fn inspector_loads_bundled_frontend_and_chromium_theme() {
        for value in [
            "devtools://devtools/bundled/devtools_app.html?targetType=tab",
            "devtools://devtools/bundled/entrypoints/main/main.js",
            "devtools://devtools/bundled/panels/elements/elements.js",
        ] {
            assert!(bundled_document(value), "{value}");
            assert!(inspector_resource(value), "{value}");
        }
        let theme = "devtools://theme/colors.css?sets=ui,chrome&version=123";
        assert!(inspector_resource(theme));
        assert!(!bundled_document(theme));
    }

    #[test]
    fn inspector_does_not_grant_network_or_other_privileged_resources() {
        for value in [
            "https://example.com/",
            "http://127.0.0.1/",
            "file:///secret",
            "chrome://settings/",
            "data:text/html,test",
            "about:blank",
            "devtools://devtools/remote/serve_file/version/main.js",
            "devtools://devtools/custom/devtools_app.html",
            "devtools://theme/other.css",
            "devtools://theme/colors.css/extra",
            "devtools://devtools.evil/bundled/main.js",
            "devtools://user@devtools/bundled/main.js",
            "devtools://devtools:80/bundled/main.js",
            "devtools://devtools/bundled/../remote/main.js",
            "devtools://devtools/bundled/%2e%2e/remote/main.js",
            "devtools://devtools/bundled/%2fremote/main.js",
            "devtools://devtools/bundled/..\\remote/main.js",
        ] {
            assert!(!inspector_resource(value), "{value}");
            assert!(!bundled_document(value), "{value}");
        }
    }
}
