//! Profile-aware SSH home in a real process (t91).
//!
//! The app identity and the SSH home are process-wide and set once, so this
//! binary installs them exactly once, inside a single ordered test: production
//! first, then an isolated identity without an SSH home, then the installed
//! home. Every path lives in a temp dir; the user's real `~/.ssh` is never
//! opened.

use std::path::{Path, PathBuf};

use base64::Engine;
use sorng_core::{app_identity, ssh_home};
use sorng_ssh::ssh::service::{import_known_hosts, preview_known_hosts};
use sorng_storage::trust_store::test_support::install_active_runtime_for_tests;

const ISOLATED_ID: &str = "com.sortofremote.ng.e2e-test";

fn preview_error(path: Option<String>) -> String {
    preview_known_hosts(path)
        .err()
        .expect("preview should fail")
}

fn import_error(path: Option<String>) -> String {
    import_known_hosts(path).expect_err("import should fail")
}

#[test]
fn isolated_profile_resolves_known_hosts_only_under_its_installed_ssh_home() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp
        .path()
        .join(ISOLATED_ID)
        .join(ssh_home::ISOLATED_SSH_HOME_DIRNAME);
    let known_hosts = home.join(".ssh").join("known_hosts");
    let known_hosts_text = known_hosts.to_string_lossy().to_string();

    // ── 1. Production: nothing can be installed; the OS home is forwarded.
    assert!(!app_identity::is_isolated());
    let refused = ssh_home::install_isolated_home(home.clone()).unwrap_err();
    assert!(refused.contains("isolated profile"), "{refused}");
    assert_eq!(ssh_home::isolated_home(), None);
    let os_home = PathBuf::from("os-home-stand-in");
    assert_eq!(
        ssh_home::home_dir(|| Some(os_home.clone())),
        Ok(Some(os_home))
    );
    assert_eq!(ssh_home::home_dir(|| None), Ok(None));

    // ── 2. Isolated identity, no SSH home yet: fail closed, never the OS home.
    app_identity::install(ISOLATED_ID).unwrap();
    assert!(app_identity::is_isolated());
    let never_os_home =
        || -> Option<PathBuf> { panic!("an isolated profile must not resolve the OS home") };
    assert_eq!(
        ssh_home::home_dir(never_os_home),
        Err(ssh_home::UNINSTALLED_ISOLATED_HOME_ERROR.to_string())
    );
    assert_eq!(
        preview_error(None),
        ssh_home::UNINSTALLED_ISOLATED_HOME_ERROR
    );
    assert_eq!(
        import_error(None),
        ssh_home::UNINSTALLED_ISOLATED_HOME_ERROR
    );

    // Refused installs change nothing.
    let other = temp
        .path()
        .join("com.sortofremote.ng.other")
        .join(ssh_home::ISOLATED_SSH_HOME_DIRNAME);
    for path in [
        temp.path().join(ISOLATED_ID),
        temp.path().join(ISOLATED_ID).join(".ssh"),
        PathBuf::from(ISOLATED_ID).join(ssh_home::ISOLATED_SSH_HOME_DIRNAME),
        temp.path()
            .join(app_identity::PRODUCTION_IDENTIFIER)
            .join(ISOLATED_ID)
            .join(ssh_home::ISOLATED_SSH_HOME_DIRNAME),
        other.clone(),
    ] {
        assert!(
            ssh_home::install_isolated_home(path.clone()).is_err(),
            "{} must be refused",
            path.display()
        );
    }
    assert_eq!(ssh_home::isolated_home(), None);

    // ── 3. Install the isolated SSH home (set once).
    ssh_home::install_isolated_home(home.clone()).unwrap();
    ssh_home::install_isolated_home(home.clone()).unwrap();
    assert!(ssh_home::install_isolated_home(other).is_err());
    assert_eq!(ssh_home::isolated_home(), Some(home.as_path()));
    assert_eq!(ssh_home::home_dir(never_os_home), Ok(Some(home.clone())));
    // Installing does not create anything; the first write does.
    assert!(!home.exists());

    // ── 4. The Trust Center's default known_hosts is the isolated file.
    assert_eq!(preview_error(None), "known_hosts path is unavailable");
    let _trust = install_active_runtime_for_tests(temp.path().join("databases"), "db-t91");
    let empty = import_known_hosts(None).unwrap();
    assert_eq!((empty.imported, empty.skipped), (0, 0));
    assert_eq!(empty.path, known_hosts_text);
    assert!(!home.exists());

    let key = base64::engine::general_purpose::STANDARD.encode(b"isolated-home-fixture-key");
    write_known_hosts(&known_hosts, &format!("[127.0.0.1]:2222 ssh-rsa {key}\n"));

    let preview = preview_known_hosts(None).unwrap();
    let hosts: Vec<&str> = preview
        .document
        .records
        .iter()
        .map(|record| record.host.as_str())
        .collect();
    assert_eq!(hosts, ["127.0.0.1:2222"]);

    let imported = import_known_hosts(None).unwrap();
    assert_eq!(imported.imported, 1);
    assert_eq!(imported.path, known_hosts_text);

    // An explicit path is honoured as given, even in an isolated profile.
    let explicit = temp.path().join("chosen_known_hosts");
    write_known_hosts(
        &explicit,
        &format!("[chosen.example.test]:22 ssh-rsa {key}\n"),
    );
    let chosen = preview_known_hosts(Some(explicit.to_string_lossy().to_string())).unwrap();
    assert_eq!(chosen.document.records.len(), 1);
    assert_eq!(chosen.document.records[0].host, "chosen.example.test:22");
}

fn write_known_hosts(path: &Path, contents: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, contents).unwrap();
}
