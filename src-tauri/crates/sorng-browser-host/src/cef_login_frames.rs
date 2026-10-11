//! Shared native login frame boundary for the browser and renderer processes.
//!
//! A configured ModularForm profile may use a direct same-origin child. This
//! helper checks native ownership, topology and URL origins; the private login
//! closure MUST also select the connected iframe by the configured DOM id/name
//! and reject opaque/sandboxed contexts before requesting or using credentials.
//! CEF 154.0.32 GetName returns an assigned name or an internal unique name, NOT
//! a guaranteed DOM id (include/cef_frame.h; libcef/renderer/render_frame_util.cc).
//! Chromium 154.0.8037.58 WebLocalFrameImpl::CreateChildFrame passes the owner's
//! SubResourceAttributeName value as the unique-name fallback; script-created
//! frames can instead have a generated dynamic name. Do not gate id-only iLO
//! frames on that value or interpret a native frame identifier as a DOM id.

use crate::native_features::{browser_origin, NativeLoginAdapter};
use cef::*;

const MAX_LOGIN_FRAME_NAMES: usize = 8;
const MAX_LOGIN_FRAME_NAME_BYTES: usize = 128;

/// Default and malformed configurations permit only the actual main frame.
/// Contains no CEF handles; construct independently from native configuration
/// in each process. This is a frame boundary, not a credential consent grant.
#[derive(Clone, Debug, Default)]
pub(crate) struct LoginFramePolicy {
    same_origin_login_frames: Vec<String>,
}

impl LoginFramePolicy {
    pub(crate) fn from_configuration(adapter: NativeLoginAdapter, json: &str) -> Self {
        if adapter != NativeLoginAdapter::ModularForm {
            return Self::default();
        }
        let Some(value) = crate::cef_renderer::parse_login_configuration(json) else {
            return Self::default();
        };
        let Some(dict) = value.dictionary() else {
            return Self::default();
        };
        let key = CefString::from("sameOriginLoginFrames");
        if dict.get_type(Some(&key)) != ValueType::LIST {
            return Self::default();
        }
        let Some(names) = dict.list(Some(&key)) else {
            return Self::default();
        };
        Self::from_names(adapter, names.size(), |index| {
            (names.get_type(index) == ValueType::STRING)
                .then(|| CefString::from(&names.string(index)).to_string())
        })
    }

    // Keep validation independent of CEF allocation so the pure regression
    // tests do not load libcef. A missing/non-string entry invalidates the WHOLE
    // opt-in; never retain a valid prefix of a malformed configuration.
    fn from_names(
        adapter: NativeLoginAdapter,
        count: usize,
        mut name_at: impl FnMut(usize) -> Option<String>,
    ) -> Self {
        if adapter != NativeLoginAdapter::ModularForm || count == 0 || count > MAX_LOGIN_FRAME_NAMES
        {
            return Self::default();
        }
        let mut names = Vec::with_capacity(count);
        for index in 0..count {
            let Some(name) = name_at(index) else {
                return Self::default();
            };
            if name.is_empty()
                || name.len() > MAX_LOGIN_FRAME_NAME_BYTES
                || !name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
                || names.contains(&name)
            {
                return Self::default();
            }
            names.push(name);
        }
        Self {
            same_origin_login_frames: names,
        }
    }

    /// Call synchronously on the owning CEF callback thread (renderer main
    /// thread; normally UI in the browser). Uses only Browser/Frame methods
    /// available in BOTH processes: no BrowserHost, V8, DOM visit or task hop.
    /// A renderer without the actual main frame fails closed. Call again when
    /// releasing credentials/typing; the result is not a cached document grant.
    pub(crate) fn origin(&self, browser: &Browser, frame: &Frame) -> Option<String> {
        if browser.is_valid() != 1 {
            return None;
        }
        let presented = FrameFacts::read(browser, frame)?;
        let current = browser.frame_by_identifier(Some(&CefString::from(presented.id.as_str())))?;
        let current = FrameFacts::read(browser, &current)?;
        let main = browser.main_frame()?;
        let main = FrameFacts::read(browser, &main)?;
        self.origin_from_facts(
            browser.is_valid() == 1,
            Some(&main),
            &presented,
            Some(&current),
        )
    }

    fn origin_from_facts(
        &self,
        browser_valid: bool,
        main: Option<&FrameFacts>,
        presented: &FrameFacts,
        current: Option<&FrameFacts>,
    ) -> Option<String> {
        let main = main?;
        let current = current?;
        if !browser_valid
            || !main.attached()
            || !current.attached()
            || !main.is_main
            || main.parent.is_some()
            || presented != current
        {
            return None;
        }
        let main_origin = browser_origin(&main.url)?;
        let origin = browser_origin(&current.url)?;
        if current.is_main {
            // IsMain alone is insufficient: a retired main-frame wrapper or a
            // different native frame must not impersonate browser.main_frame().
            return (current == main).then_some(origin);
        }
        if self.same_origin_login_frames.is_empty()
            || current.id == main.id
            || origin != main_origin
        {
            return None;
        }
        let parent = current.parent.as_ref()?;
        (parent.valid && parent.same_browser && parent.is_main && parent.id == main.id)
            .then_some(origin)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ParentFacts {
    id: String,
    valid: bool,
    same_browser: bool,
    is_main: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FrameFacts {
    id: String,
    valid: bool,
    same_browser: bool,
    is_main: bool,
    url: String,
    parent: Option<ParentFacts>,
}

impl FrameFacts {
    fn attached(&self) -> bool {
        self.valid && self.same_browser && !self.id.is_empty()
    }

    fn read(browser: &Browser, frame: &Frame) -> Option<Self> {
        if frame.is_valid() != 1 || !belongs_to(browser, frame) {
            return None;
        }
        let facts = Self {
            id: CefString::from(&frame.identifier()).to_string(),
            valid: frame.is_valid() == 1,
            same_browser: belongs_to(browser, frame),
            is_main: frame.is_main() == 1,
            url: CefString::from(&frame.url()).to_string(),
            parent: frame.parent().map(|parent| ParentFacts {
                id: CefString::from(&parent.identifier()).to_string(),
                valid: parent.is_valid() == 1,
                same_browser: belongs_to(browser, &parent),
                is_main: parent.is_main() == 1,
            }),
        };
        facts.attached().then_some(facts)
    }
}

fn belongs_to(browser: &Browser, frame: &Frame) -> bool {
    frame.browser().is_some_and(|owner| {
        owner.is_valid() == 1 && owner.is_same(Some(&mut browser.clone())) == 1
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn native_api() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        crate::bootstrap_platform::select_pinned_api().unwrap();
    }

    fn configured(names: &[Option<&str>]) -> LoginFramePolicy {
        LoginFramePolicy::from_names(NativeLoginAdapter::ModularForm, names.len(), |index| {
            names[index].map(str::to_owned)
        })
    }

    fn policy() -> LoginFramePolicy {
        configured(&[Some("appFrame")])
    }

    fn main_frame() -> FrameFacts {
        FrameFacts {
            id: "native-main-token".into(),
            valid: true,
            same_browser: true,
            is_main: true,
            url: "https://ilo.test:8443/index.html".into(),
            parent: None,
        }
    }

    fn child_frame() -> FrameFacts {
        FrameFacts {
            id: "native-child-token".into(),
            valid: true,
            same_browser: true,
            is_main: false,
            url: "https://ilo.test:8443/login.html".into(),
            parent: Some(ParentFacts {
                id: main_frame().id,
                valid: true,
                same_browser: true,
                is_main: true,
            }),
        }
    }

    fn origin(policy: &LoginFramePolicy, main: &FrameFacts, frame: &FrameFacts) -> Option<String> {
        policy.origin_from_facts(true, Some(main), frame, Some(frame))
    }

    #[test]
    fn native_configuration_parser_reads_frame_list_and_enables_only_modular_form() {
        native_api();
        for json in [
            r#"{"sameOriginLoginFrames":["appFrame"]}"#,
            r#"{"sameOriginLoginFrames":["app\u0046rame"],"readiness":{"timeoutMs":8000}}"#,
        ] {
            let policy =
                LoginFramePolicy::from_configuration(NativeLoginAdapter::ModularForm, json);
            assert_eq!(policy.same_origin_login_frames, vec!["appFrame"]);
            assert_eq!(
                origin(&policy, &main_frame(), &child_frame()).as_deref(),
                Some("https://ilo.test:8443")
            );
            assert!(origin(&policy, &main_frame(), &main_frame()).is_some());
            for adapter in [NativeLoginAdapter::Generic, NativeLoginAdapter::Google] {
                let policy = LoginFramePolicy::from_configuration(adapter, json);
                assert!(policy.same_origin_login_frames.is_empty());
                assert_eq!(origin(&policy, &main_frame(), &child_frame()), None);
            }
        }
        let names: Vec<_> = (0..MAX_LOGIN_FRAME_NAMES)
            .map(|index| {
                format!(
                    "frame_{index}-{}",
                    "a".repeat(MAX_LOGIN_FRAME_NAME_BYTES - 8)
                )
            })
            .collect();
        assert!(names
            .iter()
            .all(|name| name.len() == MAX_LOGIN_FRAME_NAME_BYTES));
        let entries = names
            .iter()
            .map(|name| format!("\"{name}\""))
            .collect::<Vec<_>>()
            .join(",");
        let json = format!(r#"{{"sameOriginLoginFrames":[{entries}]}}"#);
        let policy = LoginFramePolicy::from_configuration(NativeLoginAdapter::ModularForm, &json);
        assert_eq!(policy.same_origin_login_frames, names);
        assert!(origin(&policy, &main_frame(), &child_frame()).is_some());
    }

    #[test]
    fn native_configuration_parser_fails_closed_on_absent_malformed_or_mixed_values() {
        native_api();
        for json in [
            "",
            "{",
            "null",
            "[]",
            "true",
            "{}",
            r#"{"other":{"sameOriginLoginFrames":["appFrame"]}}"#,
            r#"{"sameOriginLoginFrames":null}"#,
            r#"{"sameOriginLoginFrames":true}"#,
            r#"{"sameOriginLoginFrames":1}"#,
            r#"{"sameOriginLoginFrames":"appFrame"}"#,
            r#"{"sameOriginLoginFrames":{"0":"appFrame"}}"#,
            r#"{"sameOriginLoginFrames":[]}"#,
            r#"{"sameOriginLoginFrames":[null]}"#,
            r#"{"sameOriginLoginFrames":["appFrame",null]}"#,
            r#"{"sameOriginLoginFrames":["appFrame",true]}"#,
            r#"{"sameOriginLoginFrames":["appFrame",7]}"#,
            r#"{"sameOriginLoginFrames":["appFrame",1.5]}"#,
            r#"{"sameOriginLoginFrames":["appFrame",{}]}"#,
            r#"{"sameOriginLoginFrames":["appFrame",[]]}"#,
            r#"{"sameOriginLoginFrames":["appFrame",""]}"#,
            r#"{"sameOriginLoginFrames":["appFrame"," appFrame"]}"#,
            r#"{"sameOriginLoginFrames":["appFrame","app.Frame"]}"#,
            r#"{"sameOriginLoginFrames":["appFrame","app\u0000Frame"]}"#,
            r#"{"sameOriginLoginFrames":["appFrame","\u00e1ppFrame"]}"#,
            r#"{"sameOriginLoginFrames":["appFrame","appFrame"]}"#,
            r#"{"sameOriginLoginFrames":["appFrame","app\u0046rame"]}"#,
            r#"{"sameOriginLoginFrames":["appFrame",]}"#,
            r#"{"sameOriginLoginFrames":["appFrame"]} trailing"#,
            r#"{"sameOriginLoginFrames":["appFrame"],"__proto__":{}}"#,
            r#"{"sameOriginLoginFrames":["appFrame"],"other":{"constructor":{}}}"#,
        ] {
            let policy =
                LoginFramePolicy::from_configuration(NativeLoginAdapter::ModularForm, json);
            assert!(policy.same_origin_login_frames.is_empty(), "{json}");
            assert_eq!(
                origin(&policy, &main_frame(), &child_frame()),
                None,
                "{json}"
            );
            assert!(
                origin(&policy, &main_frame(), &main_frame()).is_some(),
                "{json}"
            );
        }
    }

    #[test]
    fn native_configuration_parser_enforces_list_name_and_whole_document_limits() {
        native_api();
        let too_many = (0..=MAX_LOGIN_FRAME_NAMES)
            .map(|index| format!("\"frame_{index}\""))
            .collect::<Vec<_>>()
            .join(",");
        let too_deep = format!("{}0{}", "{\"child\":".repeat(10), "}".repeat(10));
        for json in [
            format!(r#"{{"sameOriginLoginFrames":[{too_many}]}}"#),
            format!(
                r#"{{"sameOriginLoginFrames":["appFrame","{}"]}}"#,
                "a".repeat(MAX_LOGIN_FRAME_NAME_BYTES + 1)
            ),
            format!(
                r#"{{"sameOriginLoginFrames":["appFrame"],"padding":"{}"}}"#,
                "x".repeat(crate::cef_renderer::MAX_LOGIN_CONFIGURATION_BYTES)
            ),
            format!(r#"{{"sameOriginLoginFrames":["appFrame"],"other":{too_deep}}}"#),
        ] {
            let policy =
                LoginFramePolicy::from_configuration(NativeLoginAdapter::ModularForm, &json);
            assert!(policy.same_origin_login_frames.is_empty());
            assert_eq!(origin(&policy, &main_frame(), &child_frame()), None);
            assert!(origin(&policy, &main_frame(), &main_frame()).is_some());
        }
    }

    #[test]
    fn default_and_cloned_default_allow_only_the_actual_main_frame() {
        let policy = LoginFramePolicy::default().clone();
        let main = main_frame();
        assert_eq!(
            origin(&policy, &main, &main).as_deref(),
            Some("https://ilo.test:8443")
        );
        assert_eq!(origin(&policy, &main, &child_frame()), None);
        let mut impostor = main.clone();
        impostor.id = "retired-main-token".into();
        assert_eq!(origin(&policy, &main, &impostor), None);
    }

    #[test]
    fn only_modular_form_can_enable_children() {
        for adapter in [
            NativeLoginAdapter::Unsupported,
            NativeLoginAdapter::Manual,
            NativeLoginAdapter::Generic,
            NativeLoginAdapter::Porkbun,
            NativeLoginAdapter::Google,
            NativeLoginAdapter::Bitwarden,
            NativeLoginAdapter::Synology,
            NativeLoginAdapter::Cloudflare,
            NativeLoginAdapter::Yealink,
            NativeLoginAdapter::Adobe,
            NativeLoginAdapter::ChatGpt,
            NativeLoginAdapter::Claude,
            NativeLoginAdapter::ExchangeEcp,
            NativeLoginAdapter::ExchangeOwa,
            NativeLoginAdapter::VodafoneSmartRouter,
        ] {
            let policy =
                LoginFramePolicy::from_names(adapter, 1, |_| panic!("must not read names"));
            assert_eq!(origin(&policy, &main_frame(), &child_frame()), None);
            // This public entry point short-circuits before any CEF allocation.
            assert!(LoginFramePolicy::from_configuration(adapter, "malformed")
                .same_origin_login_frames
                .is_empty());
        }
    }

    #[test]
    fn invalid_names_invalidate_the_entire_opt_in() {
        for name in [
            "",
            " appFrame",
            "appFrame ",
            "app frame",
            "app\0Frame",
            "app\nFrame",
            "app\u{7f}Frame",
            "áppFrame",
            "app.Frame",
            "app/Frame",
            "*",
            "#appFrame",
            "<!--framePath //appFrame/<!--frame0-->-->",
        ] {
            let policy = configured(&[Some("appFrame"), Some(name)]);
            assert_eq!(
                origin(&policy, &main_frame(), &child_frame()),
                None,
                "{name:?}"
            );
            assert!(origin(&policy, &main_frame(), &main_frame()).is_some());
        }
        for names in [
            vec![],
            vec![None],
            vec![Some("appFrame"), None],
            vec![Some("appFrame"), Some("appFrame")],
        ] {
            assert!(configured(&names).same_origin_login_frames.is_empty());
        }
    }

    #[test]
    fn name_count_and_ascii_byte_length_are_bounded_without_truncation() {
        let at_limit = "a".repeat(MAX_LOGIN_FRAME_NAME_BYTES);
        let too_long = "a".repeat(MAX_LOGIN_FRAME_NAME_BYTES + 1);
        assert_eq!(
            configured(&[Some(&at_limit)])
                .same_origin_login_frames
                .len(),
            1
        );
        assert!(configured(&[Some(&too_long)])
            .same_origin_login_frames
            .is_empty());
        let policy = LoginFramePolicy::from_names(
            NativeLoginAdapter::ModularForm,
            MAX_LOGIN_FRAME_NAMES,
            |i| Some(format!("frame_{i}")),
        );
        assert_eq!(policy.same_origin_login_frames.len(), MAX_LOGIN_FRAME_NAMES);
        let policy = LoginFramePolicy::from_names(
            NativeLoginAdapter::ModularForm,
            MAX_LOGIN_FRAME_NAMES + 1,
            |_| panic!("oversized list must not be read"),
        );
        assert!(policy.same_origin_login_frames.is_empty());
    }

    #[test]
    fn configured_child_uses_native_identity_without_assuming_dom_id_is_cef_name() {
        // No CEF name fact participates: id-only/script-created iframe names
        // may be generated. The separate private JS closure selects appFrame.
        let policy = policy().clone();
        assert_eq!(
            origin(&policy, &main_frame(), &child_frame()).as_deref(),
            Some("https://ilo.test:8443")
        );
        let mut main = main_frame();
        let mut child = child_frame();
        main.url = "http://ilo.test:8080/".into();
        child.url = "http://ilo.test:8080/login".into();
        assert_eq!(
            origin(&policy, &main, &child).as_deref(),
            Some("http://ilo.test:8080")
        );
    }

    #[test]
    fn child_origin_requires_exact_scheme_host_and_effective_port() {
        for url in [
            "http://ilo.test:8443/",
            "https://other.test:8443/",
            "https://ilo.test/",
            "https://ilo.test:9443/",
            "https://ilo.test.evil:8443/",
        ] {
            let mut child = child_frame();
            child.url = url.into();
            assert_eq!(origin(&policy(), &main_frame(), &child), None, "{url}");
        }
        let mut main = main_frame();
        main.url = "https://ILO.test:443/".into();
        let mut child = child_frame();
        child.url = "https://ilo.test/login?next=1#form".into();
        assert_eq!(
            origin(&policy(), &main, &child).as_deref(),
            Some("https://ilo.test")
        );
    }

    #[test]
    fn unsafe_and_inherited_urls_are_denied_for_main_and_child() {
        for url in [
            "",
            "about:blank",
            "about:srcdoc",
            "data:text/html,login",
            "blob:https://ilo.test:8443/id",
            "javascript:login()",
            "file:///login",
            "https://user:pass@ilo.test:8443/",
            "https://ilo.test:8443/\n",
            "https://ilo.test:8443/\\login",
        ] {
            let mut main = main_frame();
            main.url = url.into();
            let mut child = child_frame();
            child.url = url.into();
            assert_eq!(origin(&policy(), &main, &main), None, "{url}");
            assert_eq!(origin(&policy(), &main_frame(), &child), None, "{url}");
            assert_eq!(origin(&policy(), &main, &child_frame()), None, "{url}");
        }
    }

    #[test]
    fn missing_detached_foreign_or_nested_parent_is_denied() {
        let child = child_frame();
        let parent = child.parent.clone().unwrap();
        for altered in [
            None,
            Some(ParentFacts {
                valid: false,
                ..parent.clone()
            }),
            Some(ParentFacts {
                same_browser: false,
                ..parent.clone()
            }),
            Some(ParentFacts {
                is_main: false,
                ..parent.clone()
            }),
            Some(ParentFacts {
                id: "sibling-or-retired-main".into(),
                ..parent.clone()
            }),
            Some(ParentFacts {
                id: String::new(),
                ..parent
            }),
        ] {
            let mut child = child.clone();
            child.parent = altered;
            assert_eq!(origin(&policy(), &main_frame(), &child), None);
        }
    }

    #[test]
    fn invalid_browser_main_or_child_cannot_authorize() {
        let main = main_frame();
        let child = child_frame();
        assert_eq!(
            policy().origin_from_facts(false, Some(&main), &child, Some(&child)),
            None
        );
        assert_eq!(
            policy().origin_from_facts(true, None, &child, Some(&child)),
            None
        );
        for altered in [
            FrameFacts {
                valid: false,
                ..child.clone()
            },
            FrameFacts {
                same_browser: false,
                ..child.clone()
            },
            FrameFacts {
                id: String::new(),
                ..child.clone()
            },
            FrameFacts {
                id: main.id.clone(),
                ..child.clone()
            },
            FrameFacts {
                is_main: true,
                ..child.clone()
            },
        ] {
            assert_eq!(origin(&policy(), &main, &altered), None);
        }
        for altered in [
            FrameFacts {
                valid: false,
                ..main.clone()
            },
            FrameFacts {
                same_browser: false,
                ..main.clone()
            },
            FrameFacts {
                id: String::new(),
                ..main.clone()
            },
            FrameFacts {
                is_main: false,
                ..main.clone()
            },
            FrameFacts {
                parent: child.parent.clone(),
                ..main.clone()
            },
        ] {
            assert_eq!(origin(&policy(), &altered, &child), None);
            assert_eq!(origin(&policy(), &altered, &altered), None);
        }
    }

    #[test]
    fn authoritative_lookup_must_exist_and_match_presented_frame_facts() {
        let main = main_frame();
        let child = child_frame();
        assert_eq!(
            policy().origin_from_facts(true, Some(&main), &child, None),
            None
        );
        for current in [
            FrameFacts {
                id: "replacement-child".into(),
                ..child.clone()
            },
            FrameFacts {
                url: "https://ilo.test:8443/next-document".into(),
                ..child.clone()
            },
            FrameFacts {
                parent: None,
                ..child.clone()
            },
            FrameFacts {
                valid: false,
                ..child.clone()
            },
            FrameFacts {
                same_browser: false,
                ..child.clone()
            },
        ] {
            assert_eq!(
                policy().origin_from_facts(true, Some(&main), &child, Some(&current)),
                None
            );
        }
    }
}
