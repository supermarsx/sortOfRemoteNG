//! # Profile-aware SSH home
//!
//! SSH, SFTP and SCP resolve their default `known_hosts` file and default
//! private keys under a home directory. Production resolves the OS home
//! exactly as before: [`home_dir`] forwards the caller's `dirs::home_dir`, so
//! every downstream fallback and error message is unchanged.
//!
//! An isolated profile (see [`crate::app_identity`]) must never read or write
//! the user's real `~/.ssh`. The app installs `<app data>/ssh-home` once, before
//! anything connects, and every SSH-family default path resolves under it: a
//! fresh isolated profile starts with no `known_hosts` and first-use host-key
//! prompts still happen. An isolated profile without an installed SSH home
//! fails closed instead of falling back to the OS home.
//!
//! Explicit paths a connection configures are not resolved here; they express
//! what the user asked for.

use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use crate::app_identity;

/// Name of the SSH home directory inside an isolated profile's app data dir.
pub const ISOLATED_SSH_HOME_DIRNAME: &str = "ssh-home";

/// Returned by [`home_dir`] for an isolated profile with no SSH home installed.
pub const UNINSTALLED_ISOLATED_HOME_ERROR: &str =
    "isolated profile has no SSH home; refusing to use the user's home directory";

/// Profile-aware home for SSH-family default paths, from explicit inputs.
///
/// - Not isolated: `Ok(os_home())`, calling `os_home` exactly once.
/// - Isolated with an installed home: `Ok(Some(installed))`; `os_home` is never
///   called.
/// - Isolated without one: `Err(UNINSTALLED_ISOLATED_HOME_ERROR)`; `os_home` is
///   never called.
pub fn home_dir_with(
    isolated: bool,
    installed: Option<&Path>,
    os_home: impl FnOnce() -> Option<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    if !isolated {
        return Ok(os_home());
    }
    installed
        .map(|home| Some(home.to_path_buf()))
        .ok_or_else(|| UNINSTALLED_ISOLATED_HOME_ERROR.to_string())
}

/// Check that `path` may be the SSH home of the isolated profile `identifier`:
/// `<isolated profile dir>/ssh-home`, where the profile dir passes
/// [`app_identity::verify_isolated_dir`].
fn validate_isolated_home(identifier: &str, path: &Path) -> Result<(), String> {
    app_identity::validate_identifier(identifier)?;
    if app_identity::is_production(identifier) {
        return Err(format!(
            "an SSH home can only be installed for an isolated profile; {identifier} keeps the OS home"
        ));
    }
    let mut components = path.components();
    if components.next_back() != Some(Component::Normal(ISOLATED_SSH_HOME_DIRNAME.as_ref())) {
        return Err(format!(
            "SSH home {} must end in {ISOLATED_SSH_HOME_DIRNAME}",
            path.display()
        ));
    }
    let profile_dir = components.as_path();
    let names_profile = profile_dir
        .file_name()
        .is_some_and(|name| app_identity::paths_equivalent(Path::new(name), Path::new(identifier)));
    if !names_profile {
        return Err(format!(
            "SSH home {} must be directly inside the {identifier} profile dir",
            path.display()
        ));
    }
    app_identity::verify_isolated_dir(path, identifier)
        .map_err(|error| format!("SSH home is not isolated: {error}"))
}

// ═══════════════════════════════════════════════════════════════════════
// Process-wide SSH home (set once)
// ═══════════════════════════════════════════════════════════════════════

struct SshHomeSlot(OnceLock<PathBuf>);

impl SshHomeSlot {
    const fn new() -> Self {
        Self(OnceLock::new())
    }

    fn install(&self, identifier: &str, path: PathBuf) -> Result<(), String> {
        validate_isolated_home(identifier, &path)?;
        match self.0.set(path) {
            Ok(()) => Ok(()),
            Err(path) => {
                let installed = self.get().unwrap_or(Path::new(""));
                if installed == path {
                    Ok(())
                } else {
                    Err(format!(
                        "SSH home is already installed as {}; refusing to replace it with {}",
                        installed.display(),
                        path.display()
                    ))
                }
            }
        }
    }

    fn get(&self) -> Option<&Path> {
        self.0.get().map(PathBuf::as_path)
    }
}

static ISOLATED_HOME: SshHomeSlot = SshHomeSlot::new();

/// Install the SSH home of the isolated profile. Call once at startup, after
/// [`app_identity::install`] and before anything connects.
///
/// Refused unless the installed identity is isolated and `path` is
/// `<isolated profile dir>/ssh-home` (absolute, no `..`, never inside the
/// production profile). Set once: the same path again is `Ok`, a different
/// one is an error and changes nothing.
pub fn install_isolated_home(path: PathBuf) -> Result<(), String> {
    ISOLATED_HOME.install(app_identity::current_identifier(), path)
}

/// The installed isolated SSH home, if any. Always `None` in production.
pub fn isolated_home() -> Option<&'static Path> {
    ISOLATED_HOME.get()
}

/// Home directory for SSH-family default paths (`.ssh/known_hosts`, default
/// private keys). Pass `dirs::home_dir`; see [`home_dir_with`].
pub fn home_dir(os_home: impl FnOnce() -> Option<PathBuf>) -> Result<Option<PathBuf>, String> {
    home_dir_with(app_identity::is_isolated(), isolated_home(), os_home)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    // Tests must never install into the process-wide ISOLATED_HOME or the app
    // identity: every test in this binary shares them. Set-once behaviour is
    // exercised on local slots.

    const E2E: &str = "com.sortofremote.ng.e2e";
    const README_CAPTURE: &str = "com.sortofremote.ng.readme-capture";

    fn data_root() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\Users\tester\AppData\Roaming")
        } else {
            PathBuf::from("/home/tester/.local/share")
        }
    }

    fn e2e_home() -> PathBuf {
        data_root().join(E2E).join(ISOLATED_SSH_HOME_DIRNAME)
    }

    fn os_home() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\Users\tester")
        } else {
            PathBuf::from("/home/tester")
        }
    }

    // ── pure resolution ─────────────────────────────────────────────

    #[test]
    fn production_forwards_the_os_home_unchanged_and_calls_it_once() {
        for home in [Some(os_home()), None] {
            for installed in [None, Some(e2e_home())] {
                let calls = Cell::new(0);
                let resolved = home_dir_with(false, installed.as_deref(), || {
                    calls.set(calls.get() + 1);
                    home.clone()
                });
                assert_eq!(resolved, Ok(home.clone()));
                assert_eq!(calls.get(), 1);
            }
        }
    }

    #[test]
    fn isolated_with_a_home_never_consults_the_os_home() {
        let home = e2e_home();
        let resolved = home_dir_with(true, Some(home.as_path()), || {
            panic!("an isolated profile must not resolve the OS home")
        });
        assert_eq!(resolved, Ok(Some(home)));
    }

    #[test]
    fn isolated_without_a_home_fails_closed() {
        let calls = Cell::new(0);
        let resolved = home_dir_with(true, None, || {
            calls.set(calls.get() + 1);
            Some(os_home())
        });
        assert_eq!(resolved, Err(UNINSTALLED_ISOLATED_HOME_ERROR.to_string()));
        assert_eq!(calls.get(), 0);
    }

    // ── install validation ──────────────────────────────────────────

    #[test]
    fn isolated_profile_homes_are_accepted() {
        assert_eq!(validate_isolated_home(E2E, &e2e_home()), Ok(()));
        let readme = data_root()
            .join(README_CAPTURE)
            .join(ISOLATED_SSH_HOME_DIRNAME);
        assert_eq!(validate_isolated_home(README_CAPTURE, &readme), Ok(()));
    }

    #[test]
    fn production_can_never_install_an_ssh_home() {
        let production = data_root()
            .join(app_identity::PRODUCTION_IDENTIFIER)
            .join(ISOLATED_SSH_HOME_DIRNAME);
        for (identifier, path) in [
            (app_identity::PRODUCTION_IDENTIFIER, &production),
            (app_identity::PRODUCTION_IDENTIFIER, &e2e_home()),
        ] {
            let error = validate_isolated_home(identifier, path).unwrap_err();
            assert!(error.contains("isolated profile"), "{error}");
        }
    }

    #[test]
    fn unsafe_or_misplaced_homes_are_refused() {
        let root = data_root();
        let cases = [
            // relative
            PathBuf::from(E2E).join(ISOLATED_SSH_HOME_DIRNAME),
            PathBuf::from(ISOLATED_SSH_HOME_DIRNAME),
            // wrong last component
            root.join(E2E),
            root.join(E2E).join(".ssh"),
            root.join(E2E).join("ssh-home-2"),
            root.join(E2E).join("SSH-HOME"),
            root.join(E2E)
                .join(ISOLATED_SSH_HOME_DIRNAME)
                .join("nested"),
            // not directly inside the profile dir
            root.join(E2E)
                .join("nested")
                .join(ISOLATED_SSH_HOME_DIRNAME),
            root.join("other").join(ISOLATED_SSH_HOME_DIRNAME),
            os_home().join(ISOLATED_SSH_HOME_DIRNAME),
            // production aliases
            root.join(app_identity::PRODUCTION_IDENTIFIER)
                .join(E2E)
                .join(ISOLATED_SSH_HOME_DIRNAME),
            root.join(app_identity::PRODUCTION_IDENTIFIER)
                .join("..")
                .join(E2E)
                .join(ISOLATED_SSH_HOME_DIRNAME),
            root.join(E2E)
                .join("..")
                .join(E2E)
                .join(ISOLATED_SSH_HOME_DIRNAME),
            PathBuf::new(),
        ];
        for path in &cases {
            assert!(
                validate_isolated_home(E2E, path).is_err(),
                "{} must be refused",
                path.display()
            );
        }
        assert!(validate_isolated_home("not an identifier", &e2e_home()).is_err());
        assert!(validate_isolated_home(README_CAPTURE, &e2e_home()).is_err());
    }

    #[test]
    fn profile_dir_matching_follows_the_platform_case_rule() {
        let upper = data_root()
            .join(E2E.to_uppercase())
            .join(ISOLATED_SSH_HOME_DIRNAME);
        assert_eq!(
            validate_isolated_home(E2E, &upper).is_ok(),
            cfg!(any(windows, target_os = "macos"))
        );
    }

    // ── set-once slot ───────────────────────────────────────────────

    #[test]
    fn uninstalled_slot_has_no_home() {
        let slot = SshHomeSlot::new();
        assert_eq!(slot.get(), None);
        assert_eq!(
            home_dir_with(true, slot.get(), || Some(os_home())),
            Err(UNINSTALLED_ISOLATED_HOME_ERROR.to_string())
        );
    }

    #[test]
    fn slot_installs_once() {
        let slot = SshHomeSlot::new();
        assert_eq!(slot.install(E2E, e2e_home()), Ok(()));
        assert_eq!(slot.get(), Some(e2e_home().as_path()));
        assert_eq!(slot.install(E2E, e2e_home()), Ok(()));

        let other = data_root()
            .join("com.sortofremote.ng.other")
            .join(ISOLATED_SSH_HOME_DIRNAME);
        assert!(slot.install("com.sortofremote.ng.other", other).is_err());
        assert_eq!(slot.get(), Some(e2e_home().as_path()));
        assert_eq!(
            home_dir_with(true, slot.get(), || panic!("installed home must win")),
            Ok(Some(e2e_home()))
        );
    }

    #[test]
    fn refused_install_leaves_the_slot_empty() {
        let slot = SshHomeSlot::new();
        assert!(slot
            .install(app_identity::PRODUCTION_IDENTIFIER, e2e_home())
            .is_err());
        assert!(slot.install(E2E, data_root().join(E2E)).is_err());
        assert!(slot.install(E2E, PathBuf::from("ssh-home")).is_err());
        assert_eq!(slot.get(), None);
        assert_eq!(slot.install(E2E, e2e_home()), Ok(()));
    }

    #[test]
    fn concurrent_installs_settle_on_exactly_one_home() {
        let slot = SshHomeSlot::new();
        let shared = &slot;
        let ids = [
            "com.sortofremote.ng.a",
            "com.sortofremote.ng.b",
            "com.sortofremote.ng.c",
        ];
        let results: Vec<Result<(), String>> = std::thread::scope(|scope| {
            let handles: Vec<_> = ids
                .iter()
                .map(|id| {
                    scope.spawn(move || {
                        shared.install(id, data_root().join(id).join(ISOLATED_SSH_HOME_DIRNAME))
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        let winner = ids[results.iter().position(Result::is_ok).unwrap()];
        assert_eq!(
            slot.get(),
            Some(
                data_root()
                    .join(winner)
                    .join(ISOLATED_SSH_HOME_DIRNAME)
                    .as_path()
            )
        );
    }

    // ── process-wide wrappers ───────────────────────────────────────

    #[test]
    fn process_ssh_home_defaults_to_the_os_home() {
        assert_eq!(isolated_home(), None);
        assert_eq!(home_dir(|| Some(os_home())), Ok(Some(os_home())));
        assert_eq!(home_dir(|| None), Ok(None));
        // The test process identity is production, so nothing installs.
        assert!(install_isolated_home(e2e_home()).is_err());
        assert_eq!(isolated_home(), None);
    }

    #[test]
    fn process_ssh_home_functions_delegate_to_the_single_slot() {
        let source = include_str!("ssh_home.rs");
        let source = source.split("#[cfg(test)]").next().unwrap();
        assert_eq!(
            source.matches("static ISOLATED_HOME: SshHomeSlot").count(),
            1
        );
        assert_eq!(source.matches("OnceLock::new()").count(), 1);
        for wrapper in [
            "ISOLATED_HOME.install(app_identity::current_identifier(), path)",
            "ISOLATED_HOME.get()",
            "home_dir_with(app_identity::is_isolated(), isolated_home(), os_home)",
        ] {
            assert_eq!(source.matches(wrapper).count(), 1, "{wrapper}");
        }
    }
}
