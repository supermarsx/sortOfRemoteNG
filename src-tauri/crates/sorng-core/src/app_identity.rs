//! # Compiled application identity
//!
//! Every per-profile location the app touches is derived from its Tauri
//! identifier: the Tauri app directories, the WebView2 user data folder and,
//! through [`keychain_namespace_for`], the OS keychain service names. A build
//! whose identifier is not [`PRODUCTION_IDENTIFIER`] is an **isolated**
//! profile (e2e, readme capture) and must never resolve production state.
//!
//! The identifier is fixed at compile time. `build.rs` resolves it with
//! [`resolve_build_identifier`] and embeds it in a static profile marker; the
//! app parses that marker with [`marker_identifier`] and calls [`install`]
//! once, before anything else runs. Nothing in this module reads the
//! environment, so no variable can redirect a production build.
//!
//! [`current_identifier`] defaults to the production identifier until
//! [`install`] runs, so code that never installs an identity keeps today's
//! production behaviour byte for byte.

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use serde_json::Value;

/// Identifier of the shipped application (`src-tauri/tauri.conf.json`).
pub const PRODUCTION_IDENTIFIER: &str = "com.sortofremote.ng";

/// Maximum identifier length in bytes.
pub const MAX_IDENTIFIER_LEN: usize = 128;

// Pieces of the static profile marker `SORNG_PROFILE_MARKER_V1[identifier=<id>]`.
// The e2e harness counts every complete marker in the linked binary, so the
// app's own static is the only place the marker may be spelled contiguously.
// These pieces stay separate (the brackets and `=` are char patterns) so the
// linker can never place them beside an identifier literal as a second marker.
const MARKER_NAME: &str = "SORNG_PROFILE_MARKER_V1";
const MARKER_FIELD: &str = "identifier";

/// When set, the binary refuses to start unless it is an isolated build
/// with exactly this identifier. See [`expected_profile_check`].
pub const EXPECT_ISOLATED_PROFILE_ENV: &str = "SORNG_EXPECT_ISOLATED_PROFILE";

/// File systems that fold letter case, where two spellings of one
/// identifier resolve to the same profile directory.
const CASE_INSENSITIVE_PATHS: bool = cfg!(any(windows, target_os = "macos"));

// ═══════════════════════════════════════════════════════════════════════
// Pure identifier rules
// ═══════════════════════════════════════════════════════════════════════

/// Validate an app identifier: `^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$`.
///
/// This excludes `@`, `/`, `*`, `#` and whitespace. Two spellings that would
/// alias the production profile directory are also rejected: a trailing `.`
/// (Windows strips it from path components) and a letter-case variant of
/// [`PRODUCTION_IDENTIFIER`].
pub fn validate_identifier(id: &str) -> Result<(), String> {
    let Some(first) = id.chars().next() else {
        return Err("app identifier is empty".to_string());
    };
    if id.len() > MAX_IDENTIFIER_LEN {
        return Err(format!(
            "app identifier is {} bytes long; the maximum is {MAX_IDENTIFIER_LEN}",
            id.len()
        ));
    }
    if !first.is_ascii_alphanumeric() {
        return Err(format!(
            "app identifier {id:?} must start with an ASCII letter or digit"
        ));
    }
    if let Some(bad) = id
        .chars()
        .find(|c| !(c.is_ascii_alphanumeric() || *c == '.' || *c == '-'))
    {
        return Err(format!(
            "app identifier {id:?} contains {bad:?}; only ASCII letters, digits, '.' and '-' are allowed"
        ));
    }
    if id.ends_with('.') {
        return Err(format!(
            "app identifier {id:?} must not end with '.'; Windows strips trailing dots from directory names"
        ));
    }
    if !is_production(id) && id.eq_ignore_ascii_case(PRODUCTION_IDENTIFIER) {
        return Err(format!(
            "app identifier {id:?} differs from the production identifier only by letter case and would share its profile directory"
        ));
    }
    Ok(())
}

/// Whether `id` is exactly the production identifier.
pub fn is_production(id: &str) -> bool {
    id == PRODUCTION_IDENTIFIER
}

/// Keychain service suffix for `id`: `None` for production, `@<id>` otherwise.
///
/// Callers pass a validated identifier.
pub fn keychain_namespace_for(id: &str) -> Option<String> {
    if is_production(id) {
        None
    } else {
        Some(format!("@{id}"))
    }
}

/// The static profile marker for `id`, assembled at run time.
pub fn profile_marker(id: &str) -> String {
    let mut marker = String::with_capacity(MARKER_NAME.len() + MARKER_FIELD.len() + id.len() + 3);
    marker.push_str(MARKER_NAME);
    marker.push('[');
    marker.push_str(MARKER_FIELD);
    marker.push('=');
    marker.push_str(id);
    marker.push(']');
    marker
}

/// Parse `SORNG_PROFILE_MARKER_V1[identifier=<id>]` and return the validated
/// identifier. The marker must match exactly, with nothing around it.
pub fn marker_identifier(marker: &str) -> Result<&str, String> {
    let id = marker
        .strip_prefix(MARKER_NAME)
        .and_then(|rest| rest.strip_prefix('['))
        .and_then(|rest| rest.strip_prefix(MARKER_FIELD))
        .and_then(|rest| rest.strip_prefix('='))
        .and_then(|rest| rest.strip_suffix(']'))
        .ok_or_else(|| format!("profile marker {marker:?} is malformed"))?;
    validate_identifier(id).map_err(|error| format!("profile marker {marker:?}: {error}"))?;
    Ok(id)
}

/// Resolve the identifier tauri-build compiles into the app.
///
/// Mirrors `tauri_build::try_build`: the base `tauri.conf.json`, then the
/// platform file (`tauri.<os>.conf.json`) and then the `TAURI_CONFIG`
/// environment value are combined with JSON merge patch (RFC 7396). Only the
/// top-level `identifier` is read, and it must validate. Malformed JSON is an
/// error, as it is for tauri-build.
pub fn resolve_build_identifier(
    base_conf_json: &str,
    platform_conf_json: Option<&str>,
    tauri_config_env: Option<&str>,
) -> Result<String, String> {
    let mut config = parse_config_json("tauri.conf.json", base_conf_json)?;
    if let Some(platform) = platform_conf_json {
        merge_patch(
            &mut config,
            &parse_config_json("platform config", platform)?,
        );
    }
    if let Some(env) = tauri_config_env {
        merge_patch(&mut config, &parse_config_json("TAURI_CONFIG", env)?);
    }
    let id = config
        .get("identifier")
        .ok_or_else(|| "merged Tauri config has no top-level identifier".to_string())?
        .as_str()
        .ok_or_else(|| "merged Tauri config identifier is not a string".to_string())?;
    validate_identifier(id)?;
    Ok(id.to_string())
}

fn parse_config_json(source: &str, json: &str) -> Result<Value, String> {
    let json = json.strip_prefix('\u{feff}').unwrap_or(json);
    serde_json::from_str(json).map_err(|error| format!("{source} is not valid JSON: {error}"))
}

/// JSON merge patch (RFC 7396), identical to `json_patch::merge`.
fn merge_patch(doc: &mut Value, patch: &Value) {
    let Value::Object(patch) = patch else {
        *doc = patch.clone();
        return;
    };
    if !doc.is_object() {
        *doc = Value::Object(serde_json::Map::new());
    }
    if let Value::Object(map) = doc {
        for (key, value) in patch {
            if value.is_null() {
                map.remove(key);
            } else {
                merge_patch(map.entry(key.as_str()).or_insert(Value::Null), value);
            }
        }
    }
}

/// Enforce `SORNG_EXPECT_ISOLATED_PROFILE`.
///
/// Unset passes. When set (even to an empty string) the build must be
/// isolated and its identifier must equal the value exactly.
pub fn expected_profile_check(build_id: &str, expect_env: Option<&str>) -> Result<(), String> {
    let Some(expected) = expect_env else {
        return Ok(());
    };
    if is_production(build_id) {
        return Err(format!(
            "{EXPECT_ISOLATED_PROFILE_ENV}={expected:?} but this binary was built with the production identifier {PRODUCTION_IDENTIFIER:?}; refusing to start against the production profile"
        ));
    }
    if build_id != expected {
        return Err(format!(
            "{EXPECT_ISOLATED_PROFILE_ENV}={expected:?} does not match this binary's identifier {build_id:?}; refusing to start"
        ));
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
// Profile directory checks
// ═══════════════════════════════════════════════════════════════════════

/// Where production would put `dir`: the same path with its last component
/// equal to `id` replaced by [`PRODUCTION_IDENTIFIER`]. `None` when no
/// component matches. Matching ignores letter case on Windows and macOS.
pub fn production_sibling(dir: &Path, id: &str) -> Option<PathBuf> {
    production_sibling_with(dir, id, CASE_INSENSITIVE_PATHS)
}

/// Whether two paths name the same location, component by component,
/// ignoring letter case on Windows and macOS.
pub fn paths_equivalent(a: &Path, b: &Path) -> bool {
    paths_equivalent_with(a, b, CASE_INSENSITIVE_PATHS)
}

/// Prove that a resolved profile directory belongs to the isolated profile
/// `id` and cannot alias production state.
///
/// Requires an isolated identifier, an absolute path without `..`, no
/// component naming the production identifier, a component equal to `id`,
/// and a path that differs from its [`production_sibling`].
pub fn verify_isolated_dir(dir: &Path, id: &str) -> Result<(), String> {
    verify_isolated_dir_with(dir, id, CASE_INSENSITIVE_PATHS)
}

fn component_is(name: &OsStr, expected: &str, case_insensitive: bool) -> bool {
    match name.to_str() {
        Some(name) if case_insensitive => name.to_lowercase() == expected.to_lowercase(),
        Some(name) => name == expected,
        None => false,
    }
}

fn production_sibling_with(dir: &Path, id: &str, case_insensitive: bool) -> Option<PathBuf> {
    let components: Vec<Component<'_>> = dir.components().collect();
    let index = components.iter().rposition(
        |component| matches!(component, Component::Normal(name) if component_is(name, id, case_insensitive)),
    )?;
    let mut sibling = PathBuf::new();
    for (position, component) in components.iter().enumerate() {
        if position == index {
            sibling.push(PRODUCTION_IDENTIFIER);
        } else {
            sibling.push(component.as_os_str());
        }
    }
    Some(sibling)
}

fn paths_equivalent_with(a: &Path, b: &Path, case_insensitive: bool) -> bool {
    let mut left = a.components();
    let mut right = b.components();
    loop {
        match (left.next(), right.next()) {
            (None, None) => return true,
            (Some(l), Some(r)) => {
                let (l, r) = (l.as_os_str(), r.as_os_str());
                let same = match (l.to_str(), r.to_str()) {
                    (Some(l), Some(r)) if case_insensitive => l.to_lowercase() == r.to_lowercase(),
                    _ => l == r,
                };
                if !same {
                    return false;
                }
            }
            _ => return false,
        }
    }
}

fn verify_isolated_dir_with(dir: &Path, id: &str, case_insensitive: bool) -> Result<(), String> {
    validate_identifier(id)?;
    if is_production(id) {
        return Err(format!(
            "{} belongs to the production identifier, not an isolated profile",
            dir.display()
        ));
    }
    if !dir.is_absolute() {
        return Err(format!("profile dir {} is not absolute", dir.display()));
    }
    if dir
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!(
            "profile dir {} contains '..' and could resolve outside the {id} profile",
            dir.display()
        ));
    }
    if dir.components().any(|component| {
        matches!(component, Component::Normal(name) if component_is(name, PRODUCTION_IDENTIFIER, case_insensitive))
    }) {
        return Err(format!(
            "profile dir {} is inside the production profile {PRODUCTION_IDENTIFIER}",
            dir.display()
        ));
    }
    let sibling = production_sibling_with(dir, id, case_insensitive).ok_or_else(|| {
        format!(
            "profile dir {} has no {id} component; it is not an isolated profile dir",
            dir.display()
        )
    })?;
    if paths_equivalent_with(dir, &sibling, case_insensitive) {
        return Err(format!(
            "profile dir {} resolves to its production sibling {}",
            dir.display(),
            sibling.display()
        ));
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
// Process-wide identity (set once)
// ═══════════════════════════════════════════════════════════════════════

struct IdentitySlot(OnceLock<String>);

impl IdentitySlot {
    const fn new() -> Self {
        Self(OnceLock::new())
    }

    fn install(&self, id: &str) -> Result<(), String> {
        validate_identifier(id)?;
        match self.0.set(id.to_string()) {
            Ok(()) => Ok(()),
            Err(_) => {
                let installed = self.current();
                if installed == id {
                    Ok(())
                } else {
                    Err(format!(
                        "app identity is already installed as {installed:?}; refusing to replace it with {id:?}"
                    ))
                }
            }
        }
    }

    fn current(&self) -> &str {
        self.0.get().map_or(PRODUCTION_IDENTIFIER, String::as_str)
    }

    fn is_isolated(&self) -> bool {
        !is_production(self.current())
    }
}

static IDENTITY: IdentitySlot = IdentitySlot::new();

/// Install the process identity. Set once: installing the same identifier
/// again is `Ok`, a different one is an error and changes nothing.
pub fn install(id: &str) -> Result<(), String> {
    IDENTITY.install(id)
}

/// The installed identifier, or [`PRODUCTION_IDENTIFIER`] before [`install`].
pub fn current_identifier() -> &'static str {
    IDENTITY.current()
}

/// Whether the installed identity is an isolated (non-production) profile.
pub fn is_isolated() -> bool {
    IDENTITY.is_isolated()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests must never install into the process-wide IDENTITY: every test in
    // this binary shares it. Set-once behaviour is exercised on local slots.

    const E2E: &str = "com.sortofremote.ng.e2e";
    const README_CAPTURE: &str = "com.sortofremote.ng.readme-capture";

    fn data_root() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\Users\tester\AppData\Roaming")
        } else {
            PathBuf::from("/home/tester/.local/share")
        }
    }

    // ── validate_identifier ─────────────────────────────────────────

    #[test]
    fn validate_accepts_production_and_isolated_identifiers() {
        let longest = format!("a{}", "b".repeat(MAX_IDENTIFIER_LEN - 1));
        for id in [
            PRODUCTION_IDENTIFIER,
            E2E,
            README_CAPTURE,
            "a",
            "9-x.y",
            longest.as_str(),
        ] {
            assert_eq!(validate_identifier(id), Ok(()), "{id}");
        }
    }

    #[test]
    fn validate_rejects_malformed_identifiers() {
        let too_long = "a".repeat(MAX_IDENTIFIER_LEN + 1);
        for id in [
            "",
            too_long.as_str(),
            ".com.sortofremote.ng",
            "-com.sortofremote.ng",
            "com.sortofremote.ng@e2e",
            "com/sortofremote",
            "com\\sortofremote",
            "com.sortofremote.*",
            "com.sortofremote#1",
            "com.sortofremote ng",
            " com.sortofremote.ng",
            "com.sortofremote.ng\n",
            "com.sortofremote.ng\t",
            "com_sortofremote",
            "com.sortofremoté",
            "com.sortofremote.ng.e2e]",
        ] {
            assert!(validate_identifier(id).is_err(), "{id:?} must be rejected");
        }
    }

    #[test]
    fn validate_rejects_spellings_that_alias_the_production_profile() {
        for id in [
            "COM.SORTOFREMOTE.NG",
            "Com.SortOfRemote.NG",
            "com.sortofremote.ng.",
            "com.sortofremote.ng.e2e.",
        ] {
            assert!(validate_identifier(id).is_err(), "{id:?} must be rejected");
        }
    }

    #[test]
    fn is_production_is_an_exact_match() {
        assert!(is_production(PRODUCTION_IDENTIFIER));
        for id in [
            E2E,
            README_CAPTURE,
            "COM.SORTOFREMOTE.NG",
            " com.sortofremote.ng",
            "",
        ] {
            assert!(!is_production(id), "{id:?}");
        }
    }

    #[test]
    fn keychain_namespace_is_none_only_for_production() {
        assert_eq!(keychain_namespace_for(PRODUCTION_IDENTIFIER), None);
        assert_eq!(
            keychain_namespace_for(E2E).as_deref(),
            Some("@com.sortofremote.ng.e2e")
        );
        assert_eq!(
            keychain_namespace_for(README_CAPTURE).as_deref(),
            Some("@com.sortofremote.ng.readme-capture")
        );
    }

    // ── markers ─────────────────────────────────────────────────────

    #[test]
    fn marker_round_trips_the_identifier() {
        assert_eq!(
            profile_marker(E2E),
            "SORNG_PROFILE_MARKER_V1[identifier=com.sortofremote.ng.e2e]"
        );
        for id in [PRODUCTION_IDENTIFIER, E2E, README_CAPTURE] {
            assert_eq!(marker_identifier(&profile_marker(id)), Ok(id));
        }
    }

    #[test]
    fn marker_parse_rejects_anything_but_an_exact_marker() {
        for marker in [
            "",
            "SORNG_PROFILE_MARKER_V1[identifier=]",
            "SORNG_PROFILE_MARKER_V1[identifier=com.sortofremote.ng.e2e",
            "SORNG_PROFILE_MARKER_V1identifier=com.sortofremote.ng.e2e]",
            "SORNG_PROFILE_MARKER_V2[identifier=com.sortofremote.ng.e2e]",
            " SORNG_PROFILE_MARKER_V1[identifier=com.sortofremote.ng.e2e]",
            "SORNG_PROFILE_MARKER_V1[identifier=com.sortofremote.ng.e2e] ",
            "SORNG_PROFILE_MARKER_V1[identifier=com.sortofremote.ng.e2e]]",
            "SORNG_PROFILE_MARKER_V1[identifier=com.sortofremote.ng@x]",
            "SORNG_PROFILE_MARKER_V1[identifier=COM.SORTOFREMOTE.NG]",
            "SORNG_PROFILE_MARKER_V1[identifiercom.sortofremote.ng.e2e]",
            "SORNG_PROFILE_MARKER_V1[identifier:com.sortofremote.ng.e2e]",
            "SORNG_PROFILE_MARKER_V1[ identifier=com.sortofremote.ng.e2e]",
            "SORNG_PROFILE_MARKER_V1(identifier=com.sortofremote.ng.e2e)",
        ] {
            assert!(marker_identifier(marker).is_err(), "{marker:?}");
        }
    }

    #[test]
    fn production_code_never_spells_a_marker_prefix_contiguously() {
        let source = include_str!("app_identity.rs").replace("\r\n", "\n");
        let production: String = source
            .split("#[cfg(test)]")
            .next()
            .unwrap()
            .lines()
            .map(|line| line.find("//").map_or(line, |index| &line[..index]))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(production.contains(r#"MARKER_NAME: &str = "SORNG_PROFILE_MARKER_V1";"#));
        for fragment in ["V1[", "[identifier", "identifier=", "{id}]"] {
            let quoted_marker_piece = production
                .split('"')
                .skip(1)
                .step_by(2)
                .any(|literal| literal.contains(fragment));
            assert!(
                !quoted_marker_piece,
                "a string literal in app_identity.rs contains {fragment:?}"
            );
        }
    }

    // ── resolve_build_identifier ────────────────────────────────────

    const BASE: &str = r#"{
        "productName": "sortOfRemoteNG",
        "identifier": "com.sortofremote.ng",
        "build": { "devUrl": "http://localhost:3000", "frontendDist": "../out" },
        "app": { "windows": [{ "label": "main" }] }
    }"#;

    #[test]
    fn base_config_alone_resolves_production() {
        assert_eq!(
            resolve_build_identifier(BASE, None, None).as_deref(),
            Ok(PRODUCTION_IDENTIFIER)
        );
    }

    #[test]
    fn dev_override_without_identifier_stays_production() {
        let dev = r#"{"build":{"devUrl":"http://localhost:3001"},"app":{"security":{"csp":"default-src 'self'"}}}"#;
        assert_eq!(
            resolve_build_identifier(BASE, None, Some(dev)).as_deref(),
            Ok(PRODUCTION_IDENTIFIER)
        );
    }

    #[test]
    fn e2e_override_resolves_the_isolated_identifier() {
        let e2e = r#"{"identifier":"com.sortofremote.ng.e2e","build":{"beforeBuildCommand":"npm run build"},"bundle":{"active":false}}"#;
        assert_eq!(
            resolve_build_identifier(BASE, None, Some(e2e)).as_deref(),
            Ok(E2E)
        );
    }

    #[test]
    fn platform_file_merges_before_tauri_config() {
        let platform = r#"{"identifier":"com.sortofremote.ng.platform"}"#;
        assert_eq!(
            resolve_build_identifier(BASE, Some(platform), None).as_deref(),
            Ok("com.sortofremote.ng.platform")
        );
        let e2e = r#"{"identifier":"com.sortofremote.ng.e2e"}"#;
        assert_eq!(
            resolve_build_identifier(BASE, Some(platform), Some(e2e)).as_deref(),
            Ok(E2E)
        );
        let no_identifier = r#"{"bundle":{"windows":{"wix":null}}}"#;
        assert_eq!(
            resolve_build_identifier(BASE, Some(no_identifier), None).as_deref(),
            Ok(PRODUCTION_IDENTIFIER)
        );
    }

    #[test]
    fn malformed_json_is_an_error_for_every_source() {
        let bad = r#"{"identifier": "#;
        assert!(resolve_build_identifier(bad, None, None)
            .unwrap_err()
            .contains("tauri.conf.json"));
        assert!(resolve_build_identifier(BASE, Some(bad), None)
            .unwrap_err()
            .contains("platform config"));
        assert!(resolve_build_identifier(BASE, None, Some(bad))
            .unwrap_err()
            .contains("TAURI_CONFIG"));
        assert!(resolve_build_identifier(BASE, None, Some("")).is_err());
    }

    #[test]
    fn missing_non_string_or_invalid_identifier_is_an_error() {
        assert!(resolve_build_identifier(r#"{"productName":"x"}"#, None, None).is_err());
        assert!(resolve_build_identifier(BASE, None, Some(r#"{"identifier":null}"#)).is_err());
        assert!(resolve_build_identifier(BASE, None, Some(r#"{"identifier":42}"#)).is_err());
        assert!(resolve_build_identifier(BASE, None, Some("[]")).is_err());
        assert!(
            resolve_build_identifier(BASE, None, Some(r#""com.sortofremote.ng.e2e""#)).is_err()
        );
        assert!(resolve_build_identifier(
            BASE,
            None,
            Some(r#"{"identifier":"com.sortofremote.ng@x"}"#)
        )
        .is_err());
        assert!(resolve_build_identifier(
            BASE,
            None,
            Some(r#"{"identifier":"COM.SORTOFREMOTE.NG"}"#)
        )
        .is_err());
    }

    #[test]
    fn nested_identifier_keys_do_not_count() {
        let nested =
            r#"{"bundle":{"identifier":"com.sortofremote.ng.e2e"},"app":{"identifier":"x"}}"#;
        assert_eq!(
            resolve_build_identifier(BASE, Some(nested), Some(nested)).as_deref(),
            Ok(PRODUCTION_IDENTIFIER)
        );
    }

    #[test]
    fn byte_order_mark_is_tolerated() {
        let with_bom = format!("\u{feff}{BASE}");
        assert_eq!(
            resolve_build_identifier(&with_bom, None, None).as_deref(),
            Ok(PRODUCTION_IDENTIFIER)
        );
    }

    #[test]
    fn repository_tauri_config_resolves_production() {
        let tauri_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let base = std::fs::read_to_string(tauri_dir.join("tauri.conf.json"))
            .expect("src-tauri/tauri.conf.json is readable");
        let platform_name = if cfg!(windows) {
            "tauri.windows.conf.json"
        } else if cfg!(target_os = "macos") {
            "tauri.macos.conf.json"
        } else {
            "tauri.linux.conf.json"
        };
        let platform = std::fs::read_to_string(tauri_dir.join(platform_name)).ok();
        assert_eq!(
            resolve_build_identifier(&base, platform.as_deref(), None).as_deref(),
            Ok(PRODUCTION_IDENTIFIER)
        );
    }

    #[test]
    fn merge_patch_follows_rfc_7396() {
        let cases = [
            (r#"{"a":"b"}"#, r#"{"a":"c"}"#, r#"{"a":"c"}"#),
            (r#"{"a":"b"}"#, r#"{"b":"c"}"#, r#"{"a":"b","b":"c"}"#),
            (r#"{"a":"b"}"#, r#"{"a":null}"#, r#"{}"#),
            (r#"{"a":"b","b":"c"}"#, r#"{"a":null}"#, r#"{"b":"c"}"#),
            (r#"{"a":["b"]}"#, r#"{"a":"c"}"#, r#"{"a":"c"}"#),
            (r#"{"a":"c"}"#, r#"{"a":["b"]}"#, r#"{"a":["b"]}"#),
            (
                r#"{"a":{"b":"c"}}"#,
                r#"{"a":{"b":"d","c":null}}"#,
                r#"{"a":{"b":"d"}}"#,
            ),
            (r#"{"a":[{"b":"c"}]}"#, r#"{"a":[1]}"#, r#"{"a":[1]}"#),
            (r#"["a","b"]"#, r#"["c","d"]"#, r#"["c","d"]"#),
            (r#"{"a":"b"}"#, r#"["c"]"#, r#"["c"]"#),
            (r#"{"a":"foo"}"#, "null", "null"),
            (r#"{"e":null}"#, r#"{"a":1}"#, r#"{"e":null,"a":1}"#),
            (r#"[1,2]"#, r#"{"a":"b","c":null}"#, r#"{"a":"b"}"#),
            (
                r#"{}"#,
                r#"{"a":{"bb":{"ccc":null}}}"#,
                r#"{"a":{"bb":{}}}"#,
            ),
        ];
        for (doc, patch, expected) in cases {
            let mut doc: Value = serde_json::from_str(doc).unwrap();
            merge_patch(&mut doc, &serde_json::from_str(patch).unwrap());
            assert_eq!(
                doc,
                serde_json::from_str::<Value>(expected).unwrap(),
                "{patch}"
            );
        }
    }

    // ── expected_profile_check ──────────────────────────────────────

    #[test]
    fn expectation_unset_passes_for_any_build() {
        assert_eq!(expected_profile_check(PRODUCTION_IDENTIFIER, None), Ok(()));
        assert_eq!(expected_profile_check(E2E, None), Ok(()));
    }

    #[test]
    fn expectation_matching_an_isolated_build_passes() {
        assert_eq!(expected_profile_check(E2E, Some(E2E)), Ok(()));
    }

    #[test]
    fn expectation_refuses_production_and_mismatches() {
        for (build, expected) in [
            (PRODUCTION_IDENTIFIER, PRODUCTION_IDENTIFIER),
            (PRODUCTION_IDENTIFIER, E2E),
            (E2E, "com.sortofremote.ng.e2e-mismatch"),
            (E2E, "COM.SORTOFREMOTE.NG.E2E"),
            (E2E, README_CAPTURE),
            (E2E, ""),
        ] {
            assert!(
                expected_profile_check(build, Some(expected)).is_err(),
                "build {build:?} expected {expected:?}"
            );
        }
        assert!(expected_profile_check(PRODUCTION_IDENTIFIER, Some(E2E))
            .unwrap_err()
            .contains("production identifier"));
    }

    // ── profile directories ─────────────────────────────────────────

    #[test]
    fn production_sibling_replaces_the_identifier_component() {
        let root = data_root();
        assert_eq!(
            production_sibling_with(&root.join(E2E), E2E, false),
            Some(root.join(PRODUCTION_IDENTIFIER))
        );
        assert_eq!(
            production_sibling_with(&root.join(E2E).join("logs"), E2E, false),
            Some(root.join(PRODUCTION_IDENTIFIER).join("logs"))
        );
        assert_eq!(
            production_sibling_with(&root.join("other"), E2E, false),
            None
        );
        assert_eq!(production_sibling_with(&root.join(E2E), "", false), None);
    }

    #[test]
    fn production_sibling_replaces_only_the_last_match() {
        let dir = data_root().join(E2E).join("nested").join(E2E);
        assert_eq!(
            production_sibling_with(&dir, E2E, false),
            Some(
                data_root()
                    .join(E2E)
                    .join("nested")
                    .join(PRODUCTION_IDENTIFIER)
            )
        );
    }

    #[test]
    fn production_sibling_matching_follows_platform_case_rules() {
        let upper = data_root().join("COM.SORTOFREMOTE.NG.E2E");
        assert_eq!(production_sibling_with(&upper, E2E, false), None);
        assert_eq!(
            production_sibling_with(&upper, E2E, true),
            Some(data_root().join(PRODUCTION_IDENTIFIER))
        );
    }

    #[test]
    fn production_identifier_is_its_own_sibling() {
        let dir = data_root().join(PRODUCTION_IDENTIFIER);
        let sibling = production_sibling(&dir, PRODUCTION_IDENTIFIER).unwrap();
        assert!(paths_equivalent(&dir, &sibling));
    }

    #[test]
    fn paths_equivalent_compares_components() {
        let root = data_root();
        assert!(paths_equivalent_with(
            &root.join("a"),
            &root.join("a"),
            false
        ));
        assert!(!paths_equivalent_with(
            &root.join("a"),
            &root.join("A"),
            false
        ));
        assert!(paths_equivalent_with(
            &root.join("a"),
            &root.join("A"),
            true
        ));
        assert!(!paths_equivalent_with(
            &root.join("a"),
            &root.join("a").join("b"),
            true
        ));
        assert!(!paths_equivalent_with(&root, &root.join("a"), true));
    }

    #[test]
    fn isolated_dirs_pass_verification() {
        let root = data_root();
        for mode in [false, true] {
            assert_eq!(verify_isolated_dir_with(&root.join(E2E), E2E, mode), Ok(()));
            assert_eq!(
                verify_isolated_dir_with(&root.join(E2E).join("logs"), E2E, mode),
                Ok(())
            );
        }
        assert_eq!(
            verify_isolated_dir(&root.join(README_CAPTURE), README_CAPTURE),
            Ok(())
        );
    }

    #[test]
    fn verification_refuses_dirs_that_could_be_production() {
        let root = data_root();
        let cases = [
            (root.join(PRODUCTION_IDENTIFIER), PRODUCTION_IDENTIFIER),
            (root.join(E2E).join("..").join(PRODUCTION_IDENTIFIER), E2E),
            (root.join(E2E).join("..").join("elsewhere"), E2E),
            (root.join(PRODUCTION_IDENTIFIER).join(E2E), E2E),
            (root.join("other"), E2E),
            (PathBuf::from(E2E), E2E),
            (root.join("COM.SORTOFREMOTE.NG"), "COM.SORTOFREMOTE.NG"),
        ];
        for (dir, id) in &cases {
            for mode in [false, true] {
                assert!(
                    verify_isolated_dir_with(dir, id, mode).is_err(),
                    "{} as {id} (case-insensitive: {mode})",
                    dir.display()
                );
            }
        }
        assert!(
            verify_isolated_dir_with(&root.join("Com.SortOfRemote.NG").join(E2E), E2E, true)
                .is_err()
        );
    }

    // ── set-once identity ───────────────────────────────────────────

    #[test]
    fn uninstalled_slot_reports_production() {
        let slot = IdentitySlot::new();
        assert_eq!(slot.current(), PRODUCTION_IDENTIFIER);
        assert!(!slot.is_isolated());
    }

    #[test]
    fn slot_installs_once() {
        let slot = IdentitySlot::new();
        assert_eq!(slot.install(E2E), Ok(()));
        assert_eq!(slot.current(), E2E);
        assert!(slot.is_isolated());
        assert_eq!(slot.install(E2E), Ok(()));
        assert!(slot.install(README_CAPTURE).is_err());
        assert!(slot.install(PRODUCTION_IDENTIFIER).is_err());
        assert_eq!(slot.current(), E2E);
    }

    #[test]
    fn production_install_cannot_be_upgraded_to_isolated() {
        let slot = IdentitySlot::new();
        assert_eq!(slot.install(PRODUCTION_IDENTIFIER), Ok(()));
        assert!(slot.install(E2E).is_err());
        assert_eq!(slot.current(), PRODUCTION_IDENTIFIER);
        assert!(!slot.is_isolated());
    }

    #[test]
    fn invalid_install_leaves_the_slot_empty() {
        let slot = IdentitySlot::new();
        assert!(slot.install("com.sortofremote.ng@e2e").is_err());
        assert!(slot.install("COM.SORTOFREMOTE.NG").is_err());
        assert!(slot.0.get().is_none());
        assert_eq!(slot.install(E2E), Ok(()));
    }

    #[test]
    fn concurrent_installs_settle_on_exactly_one_identity() {
        let slot = IdentitySlot::new();
        let shared = &slot;
        let ids = [
            "com.sortofremote.ng.a",
            "com.sortofremote.ng.b",
            "com.sortofremote.ng.c",
        ];
        let results: Vec<Result<(), String>> = std::thread::scope(|scope| {
            let handles: Vec<_> = ids
                .iter()
                .map(|id| scope.spawn(move || shared.install(id)))
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        let winner = ids[results.iter().position(Result::is_ok).unwrap()];
        assert_eq!(slot.current(), winner);
    }

    #[test]
    fn process_identity_defaults_to_production() {
        assert_eq!(current_identifier(), PRODUCTION_IDENTIFIER);
        assert!(!is_isolated());
        assert!(install("not a valid identifier").is_err());
        assert_eq!(current_identifier(), PRODUCTION_IDENTIFIER);
    }

    #[test]
    fn process_identity_functions_delegate_to_the_single_slot() {
        let source = include_str!("app_identity.rs");
        let source = source.split("#[cfg(test)]").next().unwrap();
        assert_eq!(source.matches("static IDENTITY: IdentitySlot").count(), 1);
        assert_eq!(source.matches("OnceLock::new()").count(), 1);
        for wrapper in [
            "IDENTITY.install(id)",
            "IDENTITY.current()",
            "IDENTITY.is_isolated()",
        ] {
            assert_eq!(source.matches(wrapper).count(), 1, "{wrapper}");
        }
    }
}
